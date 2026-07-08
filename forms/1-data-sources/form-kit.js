/* ============================================================
   form-kit.js — one shared behaviour layer for every parent/physician form.
   CORE: single submit path (submit_enrollment_form RPC + signatures +
   pa-embed postMessage handshake), signature pads, print date-swap, and a
   session packet for cross-form autofill. UX LAYER (docs/form-ux-standard.md
   §1–8): inline validation + "N remaining", conditional sections, Smart
   Monday, meal auto-derive, explicit choice buttons, tooltips, cross-form
   autofill, encouragement banner + progress.

   Progressive enhancement: every feature is a NO-OP unless the form opts in
   via data-* attributes, so a form without hooks submits exactly as before.
   All kit chrome is print-hidden (see form-kit.css) for paper parity.

   A form declares:
     <script>window.FORMKIT_CONFIG = {
       formType:'cacfp_enrollment', version:'v9',
       centerSelect:'#ctr',              // optional: <select> mapped via CENTERS
       collect(){ return { formData:{…}, signatures:{…}, signatureDate:'YYYY-MM-DD' } },
       onSuccess(){…}                    // optional
     };</script>
     <script defer src="form-kit.js"></script>
   ============================================================ */
(function () {
  'use strict';

  // ── Deploy constants (single source — forms no longer inline these) ──────────
  var SUPA_URL = 'https://trrmyqfpxntmgxnqkikp.supabase.co';
  var SUPA_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRycm15cWZweG50bWd4bnFraWtwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA1OTczMzMsImV4cCI6MjA5NjE3MzMzM30.b2zlijzzwPPgZqTFNrOvhgNWZpBSxmQQioErMpoX_Ko';
  var ORG = '3a9a290e-7e49-491e-946b-ad86f2399910';
  var CENTERS = { pearl: '881ef4ce-1a27-4d3b-aa60-59d2a307bf2b', alpha: '099c404b-e6d3-4543-9d9a-1fb11a2ee62d', ridge: '4aed7d5a-00d0-4a4c-ac99-311046ad2027' };

  var CFG = window.FORMKIT_CONFIG || {};
  var FORM_TYPE = CFG.formType || document.body.getAttribute('data-formkit-form') || 'unknown';
  var VERSION = CFG.version || '';
  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };
  var debounce = function (fn, ms) { var t; return function () { var a = arguments, c = this; clearTimeout(t); t = setTimeout(function () { fn.apply(c, a); }, ms); }; };

  function status(msg, kind) {
    var e = $('[data-formkit="status"]') || document.getElementById('st');
    if (e) { e.textContent = msg; e.className = kind || ''; }
  }

  // ── Center select → center UUID ──────────────────────────────────────────────
  function centerEl() { return CFG.centerSelect ? $(CFG.centerSelect) : null; }
  function centerCode() { var e = centerEl(); return e ? e.value : (CFG.centerCode || ''); }
  function centerUuid() { return CENTERS[centerCode()] || null; }

  // ── Signature pads (auto-init every [data-formkit="signature"]) ──────────────
  function initSig(canvas) {
    if (!canvas || canvas.__fkSig) return; canvas.__fkSig = true;
    var ctx = canvas.getContext('2d');
    ctx.strokeStyle = '#000080'; ctx.lineWidth = 1.8; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    var drawing = false, lx, ly;
    function pos(e) { var r = canvas.getBoundingClientRect(), sx = canvas.width / r.width, sy = canvas.height / r.height, s = e.touches ? e.touches[0] : e; return { x: (s.clientX - r.left) * sx, y: (s.clientY - r.top) * sy }; }
    function dn(e) { e.preventDefault(); drawing = true; var p = pos(e); lx = p.x; ly = p.y; ctx.beginPath(); ctx.arc(lx, ly, 0.8, 0, Math.PI * 2); ctx.fill(); }
    function mv(e) { e.preventDefault(); if (!drawing) return; var p = pos(e); ctx.beginPath(); ctx.moveTo(lx, ly); ctx.lineTo(p.x, p.y); ctx.stroke(); lx = p.x; ly = p.y; canvas.dispatchEvent(new Event('fk:ink', { bubbles: true })); }
    function up() { drawing = false; }
    canvas.addEventListener('mousedown', dn); canvas.addEventListener('mousemove', mv);
    canvas.addEventListener('mouseup', up); canvas.addEventListener('mouseleave', up);
    canvas.addEventListener('touchstart', dn, { passive: false });
    canvas.addEventListener('touchmove', mv, { passive: false });
    canvas.addEventListener('touchend', up);
  }
  function hasInk(c) { if (!c) return false; var d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; return d.some(function (v, i) { return i % 4 === 3 && v > 0; }); }
  function getSig(idOrEl) { var c = typeof idOrEl === 'string' ? document.getElementById(idOrEl) : idOrEl; return hasInk(c) ? c.toDataURL('image/png') : null; }
  function clearSig(idOrEl) { var c = typeof idOrEl === 'string' ? document.getElementById(idOrEl) : idOrEl; if (c) c.getContext('2d').clearRect(0, 0, c.width, c.height); }

  // ── Session packet (localStorage, 90-min TTL) for cross-form autofill (§7) ───
  var PK_KEY = 'pa_packet_profile', PK_TTL = 90 * 60 * 1000;
  function pkLoad() { try { var r = JSON.parse(localStorage.getItem(PK_KEY)); if (!r || Date.now() - r.ts > PK_TTL) { localStorage.removeItem(PK_KEY); return null; } return r; } catch (_) { return null; } }
  function pkWrite(data) { try { localStorage.setItem(PK_KEY, JSON.stringify({ ts: Date.now(), data: data })); } catch (_) {} }
  function fkFields() { return $$('[data-fk-field]'); }
  function savePacket() {
    var r = pkLoad() || { ts: Date.now(), data: {} };
    fkFields().forEach(function (e) { var k = e.getAttribute('data-fk-field'); var v = (e.value || '').trim(); if (k && v) r.data[k] = v; });
    if (centerCode()) r.data.center_code = centerCode();
    pkWrite(r.data);
  }
  function applyPacket() {
    var r = pkLoad(); if (!r) return;
    fkFields().forEach(function (e) { var k = e.getAttribute('data-fk-field'); if (k && !(e.value || '').trim() && r.data[k]) { e.value = r.data[k]; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); } });
    var banner = $('[data-formkit="autofill-banner"]'); if (banner) banner.style.display = 'none';
    status('↳ Auto-filled from a previous form — please verify', '');
  }
  function initAutofill() {
    fkFields().forEach(function (e) { e.addEventListener('blur', savePacket); });
    var banner = $('[data-formkit="autofill-banner"]'); if (!banner) return;
    var r = pkLoad();
    var has = r && (r.data.child_name || r.data.parent_name || r.data.street || r.data.phone_day);
    var anyEmpty = fkFields().some(function (e) { var k = e.getAttribute('data-fk-field'); return r && r.data[k] && !(e.value || '').trim(); });
    if (!has || !anyEmpty) { banner.style.display = 'none'; return; }
    var who = (r.data.child_name || 'your previous answers');
    var whoEl = banner.querySelector('[data-fk-autofill-who]'); if (whoEl) whoEl.textContent = who;
    banner.style.display = '';
    var apply = banner.querySelector('.fk-apply'); if (apply) apply.addEventListener('click', applyPacket);
    var dismiss = banner.querySelector('.fk-dismiss'); if (dismiss) dismiss.addEventListener('click', function () { banner.style.display = 'none'; });
  }

  // ── §2 Conditional sections ──────────────────────────────────────────────────
  // <div data-show-when="fieldId:value">…</div> — supports truthy (no ":val"),
  // "!=", and comma-OR ("a,b"). Hidden → inputs marked data-inactive so
  // validation + the form's collect() skip them.
  function evalShow(spec) {
    var m = spec.split(':'); var id = m[0]; var rest = m.slice(1).join(':');
    var el = document.getElementById(id); if (!el) return false;
    var val = el.type === 'checkbox' ? (el.checked ? 'true' : '') : (el.value || '');
    if (rest === '' || rest === 'truthy') return !!val;
    var neg = false; if (rest.indexOf('!=') === 0) { neg = true; rest = rest.slice(2); }
    var opts = rest.split(',');
    var hit = opts.indexOf(val) !== -1;
    return neg ? !hit : hit;
  }
  function applyConditionals() {
    $$('[data-show-when]').forEach(function (box) {
      var show = evalShow(box.getAttribute('data-show-when'));
      box.hidden = !show;
      $$('input,select,textarea,canvas', box).forEach(function (i) { if (show) i.removeAttribute('data-inactive'); else i.setAttribute('data-inactive', '1'); });
    });
    refreshCounter();
  }
  function initConditionals() {
    if (!$$('[data-show-when]').length) return;
    var ids = {};
    $$('[data-show-when]').forEach(function (b) { ids[b.getAttribute('data-show-when').split(':')[0]] = 1; });
    Object.keys(ids).forEach(function (id) { var e = document.getElementById(id); if (e) { e.addEventListener('change', applyConditionals); e.addEventListener('input', applyConditionals); } });
    applyConditionals();
  }

  // ── §1 Inline validation + "N remaining" counter ─────────────────────────────
  function isFilled(el) {
    if (el.getAttribute('data-inactive')) return true; // hidden conditional → not required
    if (el.tagName === 'CANVAS') return hasInk(el);
    if (el.getAttribute('data-fk-choice')) return !!(el.querySelector('input') || {}).value;
    if (el.type === 'checkbox') return el.checked;
    return !!(el.value || '').trim();
  }
  function requiredEls() { return $$('[data-required]').filter(function (e) { return !e.getAttribute('data-inactive'); }); }
  function fieldMsg(el, show) {
    var box = el.tagName === 'CANVAS' || el.getAttribute('data-fk-choice') ? el : el;
    var next = box.parentNode.querySelector('.fk-msg');
    if (show) {
      if (!next) { next = document.createElement('div'); next.className = 'fk-msg'; box.parentNode.appendChild(next); }
      next.textContent = (el.getAttribute('data-label') || 'This field') + ' is required';
      if (el.classList) el.classList.add('fk-invalid');
    } else {
      if (next) next.remove();
      if (el.classList) el.classList.remove('fk-invalid');
    }
  }
  function refreshCounter() {
    var missing = requiredEls().filter(function (e) { return !isFilled(e); });
    var c = $('[data-formkit="counter"]');
    if (c) {
      c.textContent = missing.length ? (missing.length + ' required field' + (missing.length === 1 ? '' : 's') + ' remaining') : 'All required fields complete ✓';
      c.setAttribute('data-done', missing.length ? '0' : '1');
    }
    return missing;
  }
  function firstMissing() { var m = requiredEls().filter(function (e) { return !isFilled(e); }); return m[0] || null; }
  function initValidation() {
    if (!$$('[data-required]').length) return;
    $$('[data-required]').forEach(function (el) {
      var mark = debounce(function () { fieldMsg(el, !isFilled(el)); refreshCounter(); }, 250);
      el.addEventListener('blur', function () { fieldMsg(el, !isFilled(el)); refreshCounter(); }, true);
      el.addEventListener('input', mark); el.addEventListener('change', mark);
      el.addEventListener('fk:ink', mark);
    });
    refreshCounter();
  }

  // ── §6 Tooltips ──────────────────────────────────────────────────────────────
  function initTooltips() {
    $$('[data-tip]').forEach(function (host) {
      if (host.__fkTip) return; host.__fkTip = true;
      var tip = document.createElement('span'); tip.className = 'fk-tip'; tip.textContent = 'i'; tip.setAttribute('aria-label', host.getAttribute('data-tip'));
      var pop = document.createElement('span'); pop.className = 'fk-tip-pop'; pop.textContent = host.getAttribute('data-tip'); pop.style.display = 'none';
      tip.appendChild(pop);
      function show() { pop.style.display = 'block'; } function hide() { pop.style.display = 'none'; }
      tip.addEventListener('mouseenter', show); tip.addEventListener('mouseleave', hide);
      tip.addEventListener('click', function (e) { e.stopPropagation(); pop.style.display = pop.style.display === 'none' ? 'block' : 'none'; });
      document.addEventListener('click', hide);
      host.appendChild(tip);
    });
  }

  // ── §5 Explicit choice / consent buttons ─────────────────────────────────────
  // <div data-fk-choice="fieldId" [data-required] data-label="…">
  //   <button data-val="give">Give permission</button>
  //   <button data-val="deny" class="fk-deny">Do NOT give</button>
  //   <input type="hidden" id="fieldId"></div>
  // The chosen value lands in the hidden input; data-fk-choice-reveal="give:boxId"
  // toggles a revealed block (e.g. the matching signature).
  function initChoices() {
    $$('[data-fk-choice]').forEach(function (group) {
      if (group.__fkChoice) return; group.__fkChoice = true;
      if (!group.classList.contains('fk-choice')) group.classList.add('fk-choice');
      var id = group.getAttribute('data-fk-choice');
      var input = document.getElementById(id) || (function () { var i = document.createElement('input'); i.type = 'hidden'; i.id = id; group.appendChild(i); return i; })();
      if (group.hasAttribute('data-required')) input.setAttribute('data-required', '1');
      var reveal = (group.getAttribute('data-fk-choice-reveal') || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
      $$('button', group).forEach(function (btn) {
        btn.type = 'button'; btn.setAttribute('aria-pressed', 'false');
        btn.addEventListener('click', function () {
          $$('button', group).forEach(function (b) { b.setAttribute('aria-pressed', 'false'); });
          btn.setAttribute('aria-pressed', 'true');
          input.value = btn.getAttribute('data-val');
          reveal.forEach(function (r) { var p = r.split(':'); var box = document.getElementById(p[1]); if (box) box.hidden = (p[0] !== input.value); });
          input.dispatchEvent(new Event('change', { bubbles: true }));
          applyConditionals();
        });
      });
    });
  }

  // ── §3 Smart Monday + §4 meal auto-derive (CACFP weekly grid) ────────────────
  var DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'], COPY = ['tue', 'wed', 'thu', 'fri'];
  var FIELDS = ['arr1', 'dep1', 'arr2', 'dep2'];
  // Default CACFP service windows (center config overrides via CFG.mealSlots).
  var DEFAULT_SLOTS = { b: ['06:30', '08:30'], as: ['09:00', '10:00'], l: ['11:00', '13:00'], ps: ['14:30', '15:30'], su: ['17:00', '18:30'], es: ['19:30', '20:30'] };
  function toMin(t) { if (!t) return null; var p = t.split(':'); return (+p[0]) * 60 + (+p[1]); }
  function autoMeals(day) {
    var grid = $('[data-fk-meals]'); if (!grid) return;
    var slots = CFG.mealSlots || DEFAULT_SLOTS;
    var win = [];
    [['arr1', 'dep1'], ['arr2', 'dep2']].forEach(function (pr) {
      var a = toMin((document.getElementById('f_' + day + '_' + pr[0]) || {}).value), d = toMin((document.getElementById('f_' + day + '_' + pr[1]) || {}).value);
      if (a != null && d != null && d > a) win.push([a, d]);
    });
    if (!win.length) return;
    Object.keys(slots).forEach(function (m) {
      var cb = document.getElementById('cb_' + day + '_' + m); if (!cb || cb.getAttribute('data-fk-userset')) return;
      var s = toMin(slots[m][0]), e = toMin(slots[m][1]);
      var overlap = win.some(function (w) { return w[0] < e && s < w[1]; });
      if (overlap && !cb.checked) { cb.checked = true; tagAuto(cb); }
    });
  }
  function tagAuto(cb) {
    var lbl = cb.closest('label') || cb.parentNode; if (!lbl || lbl.querySelector('.fk-auto')) return;
    var t = document.createElement('span'); t.className = 'fk-auto'; t.textContent = 'auto'; lbl.appendChild(t);
  }
  function initWeek() {
    var grid = $('[data-fk-week]'); if (!grid) return;
    // meal auto-derive on arrival/departure change; mark user overrides
    $$('[id^=cb_]').forEach(function (cb) { if (/^cb_[a-z]+_[a-z]+$/.test(cb.id)) cb.addEventListener('change', function () { cb.setAttribute('data-fk-userset', '1'); }); });
    DAYS.forEach(function (day) { FIELDS.forEach(function (f) { var el = document.getElementById('f_' + day + '_' + f); if (el) el.addEventListener('change', function () { autoMeals(day); }); }); });
    // Smart-Monday chip
    var host = $('[data-fk-week-apply]'); if (!host) return;
    var chip = document.createElement('button'); chip.type = 'button'; chip.className = 'fk-chip fk-print-hidden'; chip.textContent = '↓ Apply Monday to Tue–Fri';
    var undo = null, snapshot = null;
    chip.addEventListener('click', function () {
      snapshot = {};
      COPY.forEach(function (day) {
        var inCare = document.getElementById('cb_' + day); if (inCare && !inCare.checked) return; // skip not-in-care days
        FIELDS.forEach(function (f) { var src = document.getElementById('f_mon_' + f), dst = document.getElementById('f_' + day + '_' + f); if (src && dst) { snapshot['f_' + day + '_' + f] = dst.value; dst.value = src.value; } });
        Object.keys(CFG.mealSlots || DEFAULT_SLOTS).forEach(function (m) { var src = document.getElementById('cb_mon_' + m), dst = document.getElementById('cb_' + day + '_' + m); if (src && dst) { snapshot['cb_' + day + '_' + m] = dst.checked; dst.checked = src.checked; } });
      });
      status('Applied Monday to Tue–Fri', '');
      if (!undo) { undo = document.createElement('button'); undo.type = 'button'; undo.className = 'fk-chip fk-print-hidden'; undo.textContent = '↶ Undo'; undo.addEventListener('click', function () { if (!snapshot) return; Object.keys(snapshot).forEach(function (id) { var e = document.getElementById(id); if (!e) return; if (id.indexOf('cb_') === 0) e.checked = snapshot[id]; else e.value = snapshot[id]; }); snapshot = null; status('Undone', ''); }); host.appendChild(undo); }
    });
    host.appendChild(chip);
  }

  // ── §8 Encouragement banner + progress ───────────────────────────────────────
  function initBanner() {
    var b = $('[data-formkit="banner"]'); if (!b) return;
    var q = new URLSearchParams(location.search);
    var n = q.get('formn') || (CFG.packet && CFG.packet.n), m = q.get('formm') || (CFG.packet && CFG.packet.m);
    b.classList.add('fk-banner', 'fk-print-hidden');
    var msg = b.querySelector('[data-fk-banner-msg]') || b;
    msg.textContent = '✨ Enrolling is faster than it looks';
    if (n && m) { var chip = document.createElement('span'); chip.className = 'fk-progress'; chip.textContent = 'Form ' + n + ' of ' + m; b.appendChild(chip); }
  }

  // ── Print date-swap (empty date inputs → text so paper shows blank) ───────────
  var _swap = [];
  window.addEventListener('beforeprint', function () { _swap = []; $$('input[type=date]').forEach(function (e) { if (!e.value) { _swap.push(e); e.type = 'text'; } }); });
  window.addEventListener('afterprint', function () { _swap.forEach(function (e) { e.type = 'date'; }); _swap = []; });

  // ── CORE submit — one path: embed host, else RPC ─────────────────────────────
  async function rpc(payload) {
    var r = await fetch(SUPA_URL + '/rest/v1/rpc/submit_enrollment_form', {
      method: 'POST',
      headers: { apikey: SUPA_KEY, Authorization: 'Bearer ' + SUPA_KEY, 'Content-Type': 'application/json', 'Content-Profile': 'menumaker' },
      body: JSON.stringify(payload),
    });
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  }
  async function submit() {
    var missing = refreshCounter();
    if (missing.length) { var f = firstMissing(); if (f) { (f.scrollIntoView || function () {}).call(f, { behavior: 'smooth', block: 'center' }); if (f.focus) f.focus(); fieldMsg(f, true); } status('Please complete the highlighted fields', 'er'); return; }
    if (CFG.centerSelect && !centerUuid()) { status('⚠ Select a center first', 'er'); var c = centerEl(); if (c) c.focus(); return; }
    var data;
    try { data = CFG.collect ? CFG.collect() : null; } catch (e) { status('Error: ' + e.message, 'er'); return; }
    if (!data) { status('Nothing to submit', 'er'); return; }
    status('Saving…', 'in');
    try {
      if (EMBED.active) { await EMBED.save(data.formData, data.signatures, data.signatureDate); }
      else {
        await rpc({ p_org: ORG, p_center: centerUuid(), p_submission_type: FORM_TYPE, p_form_data: data.formData, p_signatures: data.signatures || {}, p_signature_date: data.signatureDate || null, p_source: 'online' });
      }
      status('Submitted for center review', 'ok');
      savePacket();
      if (CFG.onSuccess) CFG.onSuccess();
    } catch (e) { status('Error: ' + e.message, 'er'); if (window.console) console.error(e); }
  }

  // ── pa-embed handshake (generalised from v8) ─────────────────────────────────
  var EMBED = (function () {
    var q = new URLSearchParams(location.search);
    var active = q.get('embed') === '1';
    var st = { active: active, HOST: null, pend: {} };
    if (!active) return st;
    document.documentElement.classList.add('pa-embed');
    var env = function (m) { return Object.assign({ __paEmbed: true, ns: 'pa-embed', v: 1 }, m); };
    var send = function (m) { if (st.HOST) parent.postMessage(env(m), st.HOST); };
    st.save = function (fd, sigs, sigDate) {
      return new Promise(function (res, rej) {
        var nonce = (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2));
        st.pend[nonce] = { res: res, rej: rej };
        send({ type: 'save', formType: FORM_TYPE, formData: fd, signatures: sigs || null, signatureDate: sigDate || null, nonce: nonce });
        setTimeout(function () { if (st.pend[nonce]) { delete st.pend[nonce]; rej(new Error('No response from host')); } }, 20000);
      });
    };
    st.boot = async function () {
      try {
        var host = q.get('host'), reg = q.get('registry'), center = q.get('center');
        if (!host || !reg) throw 0;
        var r = await fetch(reg); if (!r.ok) throw 0;
        var j = await r.json();
        if (!(j.allowedParentOrigins || []).includes(host)) throw 0;
        st.HOST = host;
        if (center && centerEl()) { centerEl().value = center; centerEl().dispatchEvent(new Event('change', { bubbles: true })); }
        window.addEventListener('message', function (ev) {
          if (ev.origin !== st.HOST) return;
          var d = ev.data; if (!d || d.__paEmbed !== true || d.ns !== 'pa-embed' || d.v !== 1) return;
          if (d.type === 'saved') { var p = st.pend[d.nonce]; if (p) { delete st.pend[d.nonce]; p.res(d); } }
          else if (d.type === 'error') { var q2 = st.pend[d.nonce]; if (q2) { delete st.pend[d.nonce]; q2.rej(new Error(d.message || 'Host error')); } }
          else if (d.type === 'inject') {
            try {
              if (d.reset && CFG.reset) CFG.reset();
              if (d.center && centerEl()) { centerEl().value = d.center; centerEl().dispatchEvent(new Event('change', { bubbles: true })); }
              if (d.prefill) { var r2 = pkLoad() || { ts: Date.now(), data: {} }; Object.assign(r2.data, d.prefill); pkWrite(r2.data); applyPacket(); if (CFG.applyPrefill) CFG.applyPrefill(d.prefill); }
              send({ type: 'resize', height: document.documentElement.scrollHeight });
            } catch (e) { if (window.console) console.error('inject', e); }
          }
          else if (d.type === 'submit') { submit(); }
        });
        send({ type: 'ready', formType: FORM_TYPE, version: VERSION });
        var ro = new ResizeObserver(function () { send({ type: 'resize', height: document.documentElement.scrollHeight }); });
        ro.observe(document.documentElement);
        send({ type: 'resize', height: document.documentElement.scrollHeight });
      } catch (e) {
        document.body.innerHTML = '<div style="font-family:Arial;padding:48px;text-align:center;color:#555;font-size:13pt">This form must be opened from the Play Academy application.</div>';
      }
    };
    return st;
  })();

  // ── Boot ─────────────────────────────────────────────────────────────────────
  function boot() {
    $$('[data-formkit="signature"]').forEach(initSig);
    initConditionals(); initValidation(); initTooltips(); initChoices();
    initWeek(); initBanner(); initAutofill();
    var sub = $('[data-formkit="submit"]'); if (sub) sub.addEventListener('click', function (e) { e.preventDefault(); submit(); });
    if (EMBED.active) EMBED.boot();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();

  // ── Public API (forms may call these directly) ───────────────────────────────
  window.FormKit = {
    submit: submit, status: status,
    getSig: getSig, clearSig: clearSig, initSig: initSig,
    savePacket: savePacket, applyPacket: applyPacket,
    centerUuid: centerUuid, centerCode: centerCode,
    refreshCounter: refreshCounter, applyConditionals: applyConditionals,
    CENTERS: CENTERS, ORG: ORG,
  };
})();
