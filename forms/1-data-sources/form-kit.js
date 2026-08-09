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
       mintNameSelector:'#parent_name',  // optional: whose name a minted sample carries
       collect(){ return { formData:{…}, signatures:{…}, signatureDate:'YYYY-MM-DD' } },
       onSuccess(){…}                    // optional
     };</script>
   NO centerSelect — the center is ?center=/kiosk/embed ONLY (finding #6); a picker
   is a wrong-center filing risk and the kit strips one wherever it finds it.
     <script defer src="form-kit.js"></script>
   ============================================================ */
(function () {
  'use strict';

  // ── Deploy constants (single source — forms no longer inline these) ──────────
  var SUPA_URL = 'https://trrmyqfpxntmgxnqkikp.supabase.co';
  var SUPA_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRycm15cWZweG50bWd4bnFraWtwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA1OTczMzMsImV4cCI6MjA5NjE3MzMzM30.b2zlijzzwPPgZqTFNrOvhgNWZpBSxmQQioErMpoX_Ko';
  var ORG = '3a9a290e-7e49-491e-946b-ad86f2399910';
  // ⚠ THIS MAP IS THE SECOND HALF OF A CENTRE. enroll-registry.json (the storefront's
  // half) and this map (the form's half) must be edited in the SAME commit — a centre
  // present in only one of them produces the worst failure we have: the storefront hands
  // out a link that opens a form which then refuses to file. That is exactly how take 6
  // died (registry got zzdemo in 3695e64, this map did not). `--rehearse-only` now opens
  // the real form URL and asserts the submit channel is armed, so the drift cannot ride
  // silently to a recording again.
  var CENTERS = {
    pearl: '881ef4ce-1a27-4d3b-aa60-59d2a307bf2b',
    alpha: '099c404b-e6d3-4543-9d9a-1fb11a2ee62d',
    ridge: '4aed7d5a-00d0-4a4c-ac99-311046ad2027',
    zzdemo: '0de1b5a4-e6d8-4e34-a5e4-e3dde23e1c6c',   // one-time demo centre — not a live site, not in any claim
  };
  // Per-center identity for the resolved-center header (center-auto-detect spec).
  var CENTERS_INFO = {
    pearl: { name: 'Play Academy Parma Heights', address: '6285 Pearl Rd, Parma Heights', phone: '440-884-7529' },
    alpha: { name: 'Play Academy Highland Heights', address: '201 Alpha Park, Highland Heights', phone: '440-460-0600' },
    ridge: { name: 'Play Academy Wickliffe', address: '28930 Ridge Rd, Wickliffe', phone: '440-520-0031' },
    // Wording matches menumaker.centers row for zzdemo (name + address read 2026-07-27),
    // so nothing on camera claims to be a real site. Phone is a 555 number by scenario convention.
    zzdemo: { name: 'ZZ Demo', address: '(demo — not a real site)', phone: '(555) 010-0000' },
  };
  // Per-center CACFP meal schedule (menumaker.meal_schedule; uniform across all
  // classrooms 2026-07). §4 auto-derives ONLY from the resolved center's slots —
  // meals not served here (PM snack / evening snack) are NEVER auto-checked.
  var CM = { b: ['07:00', '08:00'], as: ['09:15', '09:45'], l: ['11:30', '12:30'], su: ['15:30', '16:30'] };
  // zzdemo has ZERO rows in menumaker.meal_schedule (measured 2026-07-27). It gets the same
  // uniform slots so a packet form's §4 behaves like a real centre's; seeding the demo centre's
  // real schedule is a DB write and waits for Nikolay's word.
  var CENTER_MEALS = { pearl: CM, alpha: CM, ridge: CM, zzdemo: CM };
  var MEALS = ['b', 'as', 'l', 'ps', 'su', 'es'];
  // Shared brand assets (drop pa-logo.png 603×203 + pa-icon-144.png into this dir).
  var LOGO_URL = 'pa-icon-192.png', FAVICON_URL = 'pa-icon-144.png';
  var centerResolved = false; // true once embed/?center/kiosk resolves a center

  var CFG = window.FORMKIT_CONFIG || {};
  var FORM_TYPE = CFG.formType || document.body.getAttribute('data-formkit-form') || 'unknown';
  var VERSION = CFG.version || '';
  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };
  var debounce = function (fn, ms) { var t; return function () { var a = arguments, c = this; clearTimeout(t); t = setTimeout(function () { fn.apply(c, a); }, ms); }; };

  // ── Honest refusal (no silent no-ops) ───────────────────────────────────────
  // Take 6 died because a refusal had nowhere to land: the toolbar's Submit was
  // DISABLED, so the click never reached submit(), and the only signal was a
  // passive yellow strip. Rule now: anything the kit refuses to do, it says — in
  // words, where the eye already is. An error ALWAYS gets a toast, even when the
  // toolbar status slot is missing, restyled away, or scrolled off screen.
  function toast(msg) {
    if (!msg) return;
    var old = $('.fk-toast'); if (old && old.parentNode) old.parentNode.removeChild(old);
    var t = document.createElement('div'); t.className = 'fk-toast fk-print-hidden';
    t.setAttribute('role', 'alert');
    t.textContent = msg;
    t.addEventListener('click', function () { if (t.parentNode) t.parentNode.removeChild(t); });
    document.body.appendChild(t);
    setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 9000);
  }
  function status(msg, kind) {
    var e = $('[data-formkit="status"]') || document.getElementById('st');
    // keep the toolbar's own class — `.fk-tb-status.er{color:#b91c1c}` needs BOTH,
    // and the old assignment wiped fk-tb-status, so every error rendered unstyled.
    if (e) { e.textContent = msg; e.className = 'fk-tb-status ' + (kind || ''); }
    if (kind === 'er') toast(msg);
  }
  function urlCenterParam() { try { return new URLSearchParams(location.search).get('center') || ''; } catch (_) { return ''; } }
  // The old text ("open this from your center's packet link or QR") misdiagnoses the
  // commonest case out loud: the parent DID open it from the packet link — the link
  // carried a centre this build of the form does not know. Name what was seen.
  function unresolvedCenterText() {
    var c = urlCenterParam();
    return c
      ? '⚠ Nothing was sent. This form does not recognise the center “' + c + '” in your link. '
        + 'Your answers are still here on this device — ask the center for a current packet link or QR and open the form again.'
      : "⚠ Nothing was sent. This form has no center — open it from your center's packet link or QR, and your answers will still be here.";
  }
  function refuseNoCenter() {
    var t = unresolvedCenterText();
    status(t, 'er');                        // toolbar line + toast (status toasts every 'er')
    if (_tbBanner) {
      _tbBanner.textContent = t;
      _tbBanner.style.display = '';
      _tbBanner.classList.remove('fk-flash');
      void _tbBanner.offsetWidth;           // restart the animation on a repeat press
      _tbBanner.classList.add('fk-flash');
      try { _tbBanner.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (_) {}
    }
  }

  // ── Center resolution (NO visible picker — ?center= / kiosk / embed only) ────
  var _center = '', _onCenter = [];   // _onCenter: run once the center resolves (no live picker)
  function centerCode() { return _center || CFG.centerCode || ''; }
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
  // Min-ink threshold: a genuine signature covers hundreds of pixels; an
  // accidental tap/dot covers <10. Require SIG_MIN_INK inked (alpha>0) pixels
  // before a canvas counts as "signed" — kit-wide, so getSig() and the
  // required-counter both reject a near-empty pad. Tunable.
  var SIG_MIN_INK = 40;
  function inkCount(c) { if (!c) return 0; var d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data, n = 0; for (var i = 3; i < d.length; i += 4) { if (d[i] > 0) { n++; if (n >= SIG_MIN_INK) return n; } } return n; }
  function hasInk(c) { return inkCount(c) >= SIG_MIN_INK; }
  function getSig(idOrEl) { var c = typeof idOrEl === 'string' ? document.getElementById(idOrEl) : idOrEl; return hasInk(c) ? c.toDataURL('image/png') : null; }
  function clearSig(idOrEl) { var c = typeof idOrEl === 'string' ? document.getElementById(idOrEl) : idOrEl; if (c) c.getContext('2d').clearRect(0, 0, c.width, c.height); }

  // ── Session packet (localStorage, 24-hour TTL) for cross-form autofill (§7) ──
  // 24h (was 90 min) by Nikolay's call 2026-07-17: a family that has already paid
  // the registration fee may fill the packet across the day, not in one sitting.
  // This TTL ALSO governs the signature sample below (pa_sig_sample) — a drawn
  // signature now persists for a day on THIS device. Safe while the device is
  // personal (a parent's phone): there is no kiosk today — nothing sets
  // window.PA_KIOSK anywhere. When a shared-tablet kiosk lands, the sample's TTL
  // must be split from the data TTL, or a day-old signature is offered to the
  // next person. Until then one timer is correct.
  var PK_KEY = 'pa_packet_profile', PK_TTL = 24 * 60 * 60 * 1000;
  function pkLoad() { try { var r = JSON.parse(localStorage.getItem(PK_KEY)); if (!r || Date.now() - r.ts > PK_TTL) { localStorage.removeItem(PK_KEY); return null; } return r; } catch (_) { return null; } }
  function pkWrite(data) { try { localStorage.setItem(PK_KEY, JSON.stringify({ ts: Date.now(), data: data })); } catch (_) {} }
  function fkFields() { return $$('[data-fk-field]'); }
  function savePacket() {
    var r = pkLoad() || { ts: Date.now(), data: {} };
    fkFields().forEach(function (e) { var k = e.getAttribute('data-fk-field'); var v = (e.value || '').trim(); if (k && v) r.data[k] = v; });
    if (centerCode()) r.data.center_code = centerCode();
    pkWrite(r.data);
  }
  // ZAKAZ 11 — storefront progress: if opened from a packet card (?k=<slot>), mark that
  // slot done in the shared same-origin store the storefront reads (cacfp_packet_v1). On
  // return, the storefront's refreshDone() shows a ✓. Distinct from the pa_packet_profile
  // prefill store above. Keep/pending cards never carry ?k, so they never get a ✓.
  function markSlotDone() {
    try {
      var k = new URLSearchParams(location.search).get('k'); if (!k) return;
      var SK = 'cacfp_packet_v1', o;
      try { o = JSON.parse(localStorage.getItem(SK)) || {}; } catch (_) { o = {}; }
      o.ts = Date.now(); o.done = o.done || {}; o.done[k] = true;
      localStorage.setItem(SK, JSON.stringify(o));
    } catch (_) {}
  }

  // ── Signature adoption (v1 — session-packet, no DB; ZAKAZ 9) ─────────────────
  // Consent MINTS a sample (its pad holds the drawn OR typed signature). Later
  // parent forms carrying data-fk-adopt show a "Use my signature" button that stamps
  // that sample onto their pad — no redraw. Sample sits beside pa_packet_profile
  // with the same 24-hour TTL; nothing is sent to a server (v1). Fallback = draw/type
  // as before when the session has no sample. v1.5 (addressed packets) will source
  // the sample from get_prefill by token — never from a bare ?center=.
  // SCOPE — samples live on separate shelves, one per signer role. The scope is the
  // VALUE of data-fk-mint / data-fk-adopt; a bare attribute means 'parent', so every
  // form shipped before scoping keeps working untouched.
  //
  // Why this is not cosmetic: Add-Staff is a director's kiosk/tablet — the SAME device
  // that just filled a family's packet. With one shared shelf, a staff form would offer
  // the PARENT's signature for a staff member to adopt, and a JD acknowledgment signed
  // that way is a forged signature. Cross-scope adoption is excluded structurally:
  // a pad can only ever read the key for its own scope. Never collapse these back to
  // one key, and never let adopt "fall back" to another scope when its own is empty —
  // an empty shelf must degrade to draw/type, which is exactly what initAdopt does.
  // ── SAMPLE SCOPE — the shelf is CONSERVED (2026-07-27, Nikolay: «чтобы избежать споров») ──
  // While this is 'none' there is NO minting, NO "Use my signature" button and NO shelf read
  // anywhere: every signature in the system is a fresh live stroke made on THAT document, with
  // its own date. The mechanic below is NOT deleted — it is locked behind this one flag, so
  // turning it back on is a decision, not a rewrite.
  //
  // Turning it on is gated on counsel (question #1 in docs/compliance/lawyer-memo.md) AND
  // Nikolay's word, and on the conditions written in
  // docs/specs/2026-07-27-signature-sample-unconservation.md — drawn-only, minted ONLY under
  // the consent text, applied by a deliberate tap per form, trailed as method='adopted' with
  // date + who + device, owner's authenticated session only. Flipping this constant alone is
  // NOT enough to satisfy those conditions; read the spec first.
  //   'none'   — conserved (DEFAULT)
  //   'parent' — the pre-2026-07-27 behaviour, kept for the day it is turned back on
  var SAMPLE_SCOPE = 'none';
  function samplesOn() { return SAMPLE_SCOPE !== 'none'; }

  var SIG_SAMPLE_PREFIX = 'pa_sig_sample';
  var SIG_SCOPE_DEFAULT = 'parent';
  // A shelf minted BEFORE the conservation must not survive it on someone's phone: while the
  // flag is off, drop the keys on boot. Nothing reads them anyway — this is so the device is
  // as empty as the claim we make about it.
  function purgeSamples() {
    try {
      for (var i = localStorage.length - 1; i >= 0; i--) {
        var k = localStorage.key(i);
        if (k && k.indexOf(SIG_SAMPLE_PREFIX) === 0) localStorage.removeItem(k);
      }
    } catch (_) {}
  }
  function sigScope(el, attr) { var v = el && el.getAttribute(attr); v = (v || '').trim(); return v || SIG_SCOPE_DEFAULT; }
  function sigSampleKey(scope) { return SIG_SAMPLE_PREFIX + ':' + (scope || SIG_SCOPE_DEFAULT); }
  function sigSampleSave(scope, png, name, method) {
    if (!samplesOn()) return;                                     // conserved: nothing is minted
    try { if (png) localStorage.setItem(sigSampleKey(scope), JSON.stringify({ ts: Date.now(), scope: scope || SIG_SCOPE_DEFAULT, png: png, name: name || '', method: method || 'draw' })); } catch (_) {}
  }
  function sigSampleLoad(scope) {
    if (!samplesOn()) return null;                                // conserved: the shelf is not read
    scope = scope || SIG_SCOPE_DEFAULT;
    function read(k) { try { var r = JSON.parse(localStorage.getItem(k)); if (!r || !r.png || Date.now() - r.ts > PK_TTL) return null; return r; } catch (_) { return null; } }
    var r = read(sigSampleKey(scope));
    // Legacy bridge: pre-scope kits wrote ONE unscoped key. Only a parent form could
    // ever have minted into it (Staff Consent was never live), so honour it for the
    // parent shelf alone — a mid-session parent keeps their sample across this deploy.
    // Self-expiring: nothing writes the bare key any more, and it dies with the 90-min TTL.
    if (!r && scope === SIG_SCOPE_DEFAULT) r = read(SIG_SAMPLE_PREFIX);
    return r;
  }
  function applySample(canvas, sample) {
    if (!canvas || !sample || !sample.png) return;
    var ctx = canvas.getContext('2d'), img = new Image();
    img.onload = function () {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      var s = Math.min(canvas.width / img.width, canvas.height / img.height, 1);
      var w = img.width * s, h = img.height * s;
      ctx.drawImage(img, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
      canvas.dispatchEvent(new Event('fk:ink', { bubbles: true }));
      refreshCounter();
    };
    img.src = sample.png;
  }
  function initAdopt(canvas) {
    if (!samplesOn()) return;                                     // conserved: no "Use my signature"
    if (!canvas || canvas.__fkAdopt || !canvas.hasAttribute('data-fk-adopt')) return;
    canvas.__fkAdopt = true;
    // ONLY this pad's own scope — a staff pad never sees the parent shelf, and vice versa.
    var sample = sigSampleLoad(sigScope(canvas, 'data-fk-adopt'));
    if (!sample) return;                                          // empty shelf → plain draw/type
    var parent = canvas.parentNode;
    if (parent.querySelector('.fk-adopt')) return;
    var btn = document.createElement('button'); btn.type = 'button'; btn.className = 'fk-adopt fk-print-hidden';
    // Families and staff read English. The label was Russian — it leaked from the spec
    // conversation into the product and shipped: every packet form after the Consent
    // showed an Ohio parent a button they cannot read.
    btn.textContent = '✍️ Use my signature';
    btn.addEventListener('click', function () { applySample(canvas, sample); });
    // Overlay forms (canvas in an absolutely-positioned box, e.g. v9): a compact button
    // pinned to the pad's top-left, so it never disturbs the seated overlay geometry.
    // Flow forms: an inline bar with a hint above the pad.
    var overlay = false;
    try { overlay = getComputedStyle(parent).position === 'absolute' || getComputedStyle(canvas).position === 'absolute'; } catch (_) {}
    if (overlay) {
      // Pin the button just above THIS pad using the canvas's own offset within its
      // positioned ancestor — works whether each pad has its own wrapper (v9) or all
      // pads share one host (dcy_01234). Sibling pads without data-fk-adopt get nothing.
      var op = canvas.offsetParent || parent;
      btn.setAttribute('style', 'position:absolute;left:' + canvas.offsetLeft + 'px;top:' + Math.max(0, canvas.offsetTop - 16) + 'px;z-index:30;font:700 10px Arial,sans-serif;padding:2px 8px;border-radius:6px;border:none;background:#0f4c35;color:#fff;cursor:pointer;white-space:nowrap;box-shadow:0 1px 3px rgba(0,0,0,.3)');
      op.appendChild(btn);
    } else {
      var bar = document.createElement('div'); bar.className = 'fk-adopt fk-print-hidden';
      bar.setAttribute('style', 'margin:0 0 6px;display:flex;gap:9px;align-items:center;flex-wrap:wrap');
      btn.setAttribute('style', 'font:700 12.5px Arial,sans-serif;padding:7px 14px;border-radius:8px;border:none;background:#0f4c35;color:#fff;cursor:pointer');
      var hint = document.createElement('span'); hint.textContent = 'from your consent — or sign below';
      hint.setAttribute('style', 'font-size:11px;color:#5f6b64');
      bar.appendChild(btn); bar.appendChild(hint);
      parent.insertBefore(bar, canvas);
    }
  }
  // Who the sample belongs to. The form declares it — the kit does NOT guess from
  // parent-shaped ids, which silently produced an empty name on any non-parent form.
  //   <canvas data-fk-mint="staff" data-fk-mint-name="#emp_name">
  // or CFG.mintNameSelector. No selector → no name (the sample still mints).
  function mintNameFor(canvas) {
    var sel = ((canvas && canvas.getAttribute('data-fk-mint-name')) || CFG.mintNameSelector || '').trim();
    if (!sel) return '';
    try { var e = $(sel); return e ? (e.value || '').trim() : ''; } catch (_) { return ''; }
  }
  // How the ink was made. The form already reports it in collect() —
  // 'typed' when the signer typed their name, 'drawn' when they drew it. Minting
  // hardcoded 'draw', so a typed signature was stamped into the sample as drawn and
  // every later adoption inherited that false record.
  function mintMethod(data) {
    var m = data && data.formData && data.formData.signature_method;
    return m === 'typed' ? 'typed' : 'draw';
  }
  function mintSignature(data) {
    if (!samplesOn()) return;                                     // conserved: submitting mints nothing
    try {
      var method = mintMethod(data);
      $$('[data-fk-mint]').forEach(function (c) {
        if (c.tagName !== 'CANVAS') return;
        var png = getSig(c); if (!png) return;
        sigSampleSave(sigScope(c, 'data-fk-mint'), png, mintNameFor(c), method);
      });
    } catch (_) {}
  }
  function applyPacket() {
    var r = pkLoad(); if (!r) return;
    fkFields().forEach(function (e) { var k = e.getAttribute('data-fk-field'); if (k && !(e.value || '').trim() && r.data[k]) { e.value = r.data[k]; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); } });
    var banner = $('[data-formkit="autofill-banner"]'); if (banner) banner.style.display = 'none';
    status('↳ Auto-filled from a previous form — please verify', '');
  }
  function initAutofill() {
    fkFields().forEach(function (e) { e.addEventListener('blur', savePacket); });
    var r = pkLoad();
    var anyEmpty = !!r && fkFields().some(function (e) { var k = e.getAttribute('data-fk-field'); return r.data[k] && !(e.value || '').trim(); });
    // Standalone packet flow: auto-fill empty identity fields from the previous form
    // in the packet, so a family types their child/parent name once (Consent, first,
    // writes both). Was previously gated behind an opt-in banner most forms lack, so
    // the chain never fired. The embed path has its own inject-prefill channel — skip.
    if (!EMBED.active && anyEmpty) { applyPacket(); anyEmpty = false; }
    var banner = $('[data-formkit="autofill-banner"]'); if (!banner) return;
    var has = r && (r.data.child_name || r.data.parent_name || r.data.street || r.data.phone_day);
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
  function markEmpties() {   // ALWAYS-ON red underline on empty required (not only after blur/Submit)
    requiredEls().forEach(function (e) { if (e.tagName === 'CANVAS' || !e.classList) return; e.classList.toggle('fk-invalid', !isFilled(e)); });
  }
  function refreshCounter() {
    var missing = requiredEls().filter(function (e) { return !isFilled(e); });
    var c = $('[data-formkit="counter"]');
    if (c) {
      c.textContent = missing.length ? (missing.length + ' required field' + (missing.length === 1 ? '' : 's') + ' remaining') : 'All required fields complete ✓';
      c.setAttribute('data-done', missing.length ? '0' : '1');
    }
    // Once nothing is missing, retract the "complete the highlighted fields" submit
    // error so it can't contradict the "All required fields complete ✓" counter.
    // Scoped to that exact message — never clears center/save/other errors.
    if (!missing.length) {
      var st = $('[data-formkit="status"]') || document.getElementById('st');
      if (st && st.className === 'er' && /highlighted fields/i.test(st.textContent || '')) { st.textContent = ''; st.className = ''; }
    }
    markEmpties();
    return missing;
  }
  function firstMissing() { var m = requiredEls().filter(function (e) { return !isFilled(e); }); return m[0] || null; }
  function gotoFirstMissing() {   // click the counter / a signature-lock → jump to the first empty required
    var f = firstMissing(); if (!f) return;
    try { f.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (_) {}
    if (f.focus) try { f.focus(); } catch (_) {}
    fieldMsg(f, true);
  }
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

  // ── Exclusive checkbox groups: data-fk-exclusive="group" — checking one clears
  //    the rest of its group (e.g. Yes/No pairs, "has / does not have"). ─────────
  function initExclusive() {
    $$('[data-fk-exclusive]').forEach(function (cb) {
      cb.addEventListener('change', function () {
        if (cb.checked) {
          var g = cb.getAttribute('data-fk-exclusive');
          $$('[data-fk-exclusive="' + g + '"]').forEach(function (o) { if (o !== cb && o.checked) o.checked = false; });
        }
        refreshCounter();
      });
    });
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
  function toMin(t) { // accepts "HH:MM" (24h) and "H:MM am/pm" (form selects)
    if (!t) return null; t = String(t).trim().toLowerCase();
    var ap = (t.match(/(am|pm)$/) || [])[1]; if (ap) t = t.replace(/(am|pm)$/, '').trim();
    var p = t.split(':'); if (p.length < 2) return null;
    var h = +p[0], mi = +p[1]; if (isNaN(h) || isNaN(mi)) return null;
    if (ap === 'pm' && h < 12) h += 12; if (ap === 'am' && h === 12) h = 0;
    return h * 60 + mi;
  }
  // §4 — auto-check meals STRICTLY from the resolved center's meal_schedule
  // ("hours × the CENTER's slots"). No center resolved ⇒ do nothing (waits, no
  // generic fallback). Meals the center doesn't serve are never auto-checked.
  function autoMeals(day) {
    var grid = $('[data-fk-meals]'); if (!grid) return;
    var slots = CENTER_MEALS[centerCode()]; if (!slots) return;   // ← center gate
    var win = [];
    [['arr1', 'dep1'], ['arr2', 'dep2']].forEach(function (pr) {
      var a = toMin((document.getElementById('f_' + day + '_' + pr[0]) || {}).value), d = toMin((document.getElementById('f_' + day + '_' + pr[1]) || {}).value);
      if (a != null && d != null && d > a) win.push([a, d]);
    });
    // Full re-derive (NOT add-only): each non-user-set meal is SET to its overlap
    // result — checked when it overlaps the in-care window, UNCHECKED otherwise —
    // so changing the hours drops stale auto-checks (e.g. Supper falls off when the
    // day now ends at 3:00pm). No valid window (win empty) ⇒ all non-user meals clear.
    Object.keys(slots).forEach(function (m) {
      var cb = document.getElementById('cb_' + day + '_' + m); if (!cb || cb.getAttribute('data-fk-userset')) return;
      var s = toMin(slots[m][0]), e = toMin(slots[m][1]);
      // «≤» lenient border: arrival exactly at a slot's end still counts as
      // present for that meal (e.g. arrive 8:00, Breakfast 07:00–08:00 → check
      // Breakfast — the 8:00 child eats breakfast). Arrival side only (w[0] <= e);
      // departure side stays strict (s < w[1]). Strict «<» is a later config.
      var overlap = win.some(function (w) { return w[0] <= e && s < w[1]; });
      if (overlap) { cb.checked = true; tagAuto(cb); }
      else { cb.checked = false; untagAuto(cb); }
    });
  }
  function tagAuto(cb) {
    var lbl = cb.closest('label') || cb.parentNode; if (!lbl || lbl.querySelector('.fk-auto')) return;
    var t = document.createElement('span'); t.className = 'fk-auto'; t.textContent = 'auto'; lbl.appendChild(t);
  }
  function untagAuto(cb) { var lbl = cb.closest('label') || cb.parentNode; if (!lbl) return; var t = lbl.querySelector('.fk-auto'); if (t) t.remove(); }
  function rederiveAll() { DAYS.forEach(autoMeals); }
  function initWeek() {
    var grid = $('[data-fk-week]'); if (!grid) return;
    // meal auto-derive on arrival/departure change; mark user overrides
    $$('[id^=cb_]').forEach(function (cb) { if (/^cb_[a-z]+_[a-z]+$/.test(cb.id)) cb.addEventListener('change', function () { cb.setAttribute('data-fk-userset', '1'); }); });
    // F1 — changing ANY time field re-derives the WHOLE row. Policy: a time change
    // RESETS that row's manual meal overrides (predictable — set overrides after the
    // final time), then full re-derive drops stale checks (e.g. Supper at 3:00pm).
    DAYS.forEach(function (day) { FIELDS.forEach(function (f) { var el = document.getElementById('f_' + day + '_' + f); if (el) el.addEventListener('change', function () {
      // F3 — entering a time = the day is in care: auto-check the day box so a filled
      // row can never be silently out-of-care (which would drop it on serialize).
      var dcb = document.getElementById('cb_' + day); if (dcb && el.value) dcb.checked = true;
      MEALS.forEach(function (m) { var cb = document.getElementById('cb_' + day + '_' + m); if (cb) cb.removeAttribute('data-fk-userset'); });
      autoMeals(day); refreshCounter();
    }); }); });
    // F2 — unchecking a day (out of care) CLEARS the row: hours + meals, so no phantom
    // times/meals linger (or serialize). Checking a day leaves it for the user to fill.
    DAYS.forEach(function (day) { var dcb = document.getElementById('cb_' + day); if (!dcb) return; dcb.addEventListener('change', function () {
      if (dcb.checked) return;
      FIELDS.forEach(function (f) { var el = document.getElementById('f_' + day + '_' + f); if (el) el.value = ''; });
      MEALS.forEach(function (m) { var cb = document.getElementById('cb_' + day + '_' + m); if (cb) { cb.checked = false; cb.removeAttribute('data-fk-userset'); untagAuto(cb); } });
      refreshCounter();
    }); });
    // Re-derive every in-care day once the center resolves (§4 depends on it; no live picker).
    _onCenter.push(rederiveAll);
    // Smart-Monday chip
    var host = $('[data-fk-week-apply]'); if (!host) return;
    var chip = document.createElement('button'); chip.type = 'button'; chip.className = 'fk-chip fk-print-hidden'; chip.textContent = '↓ Apply Monday to Tue–Fri';
    var undo = null, snapshot = null;
    // F5 — Apply is meaningful only when Monday has hours; an EMPTY Monday must never
    // overwrite already-filled Tue–Fri. monHasHours gates both the click (no-op) and
    // the chip's disabled state.
    function monHasHours() { return FIELDS.some(function (f) { var e = document.getElementById('f_mon_' + f); return e && e.value; }); }
    function syncApply() { var on = monHasHours(); chip.disabled = !on; chip.style.opacity = on ? '' : '.45'; chip.style.cursor = on ? '' : 'not-allowed'; chip.title = on ? '' : 'Fill Monday first'; }
    chip.addEventListener('click', function () {
      if (!monHasHours()) { status('Fill Monday first — nothing to apply', 'er'); return; }   // never wipe filled days with an empty source
      snapshot = {};
      var snap = function (id, v) { if (!(id in snapshot)) snapshot[id] = v; };
      COPY.forEach(function (day) {
        // (a) Monday is filled ⇒ Tue–Fri are in care too (F3 — no silent out-of-care rows)
        var srcDay = document.getElementById('cb_mon'), dstDay = document.getElementById('cb_' + day);
        if (srcDay && dstDay) { snap('cb_' + day, dstDay.checked); dstDay.checked = true; }
        // (b) copy arrive/depart
        FIELDS.forEach(function (f) { var src = document.getElementById('f_mon_' + f), dst = document.getElementById('f_' + day + '_' + f); if (src && dst) { snap('f_' + day + '_' + f, dst.value); dst.value = src.value; } });
        // clear this day's non-user-set meal checks, then re-derive from center slots
        MEALS.forEach(function (m) { var d = document.getElementById('cb_' + day + '_' + m); if (d && !d.getAttribute('data-fk-userset')) { snap('cb_' + day + '_' + m, d.checked); d.checked = false; untagAuto(d); } });
        autoMeals(day);
      });
      refreshCounter();
      status('Applied Monday to Tue–Fri', '');
      if (!undo) { undo = document.createElement('button'); undo.type = 'button'; undo.className = 'fk-chip fk-print-hidden'; undo.textContent = '↶ Undo'; undo.addEventListener('click', function () { if (!snapshot) return; Object.keys(snapshot).forEach(function (id) { var e = document.getElementById(id); if (!e) return; if (id.indexOf('cb_') === 0) { e.checked = snapshot[id]; untagAuto(e); } else e.value = snapshot[id]; }); snapshot = null; refreshCounter(); status('Undone', ''); }); host.appendChild(undo); }
    });
    host.appendChild(chip);
    // Keep the chip disabled until Monday has hours (updates live as Monday is filled).
    FIELDS.forEach(function (f) { var e = document.getElementById('f_mon_' + f); if (e) e.addEventListener('change', syncApply); });
    syncApply();
  }

  // ── §8 Encouragement banner + progress ───────────────────────────────────────
  function initBanner() {
    var b = $('[data-formkit="banner"]'); if (!b) return;
    var q = new URLSearchParams(location.search);
    var n = q.get('formn') || (CFG.packet && CFG.packet.n), m = q.get('formm') || (CFG.packet && CFG.packet.m);
    b.classList.add('fk-banner', 'fk-print-hidden');
    var msg = b.querySelector('[data-fk-banner-msg]') || b;
    // The form may declare its own line — a staff form must not tell an employee
    // that "enrolling" is quick. Bare attribute (no value) keeps the parent default.
    var own = (msg.getAttribute && (msg.getAttribute('data-fk-banner-msg') || '').trim()) || (CFG.bannerMsg || '').trim();
    msg.textContent = own || '✨ Enrolling is faster than it looks';
    if (n && m) { var chip = document.createElement('span'); chip.className = 'fk-progress'; chip.textContent = 'Form ' + n + ' of ' + m; b.appendChild(chip); }
  }

  // ── Print date-swap (empty date inputs → text so paper shows blank) ───────────
  var _swap = [];
  window.addEventListener('beforeprint', function () { _swap = []; $$('input[type=date]').forEach(function (e) { if (!e.value) { _swap.push(e); e.type = 'text'; } }); });
  window.addEventListener('afterprint', function () { _swap.forEach(function (e) { e.type = 'date'; }); _swap = []; });

  // ── РЕДАКЦИЯ ФОРМЫ, КОТОРУЮ ПОДПИСАЛИ ────────────────────────────────────────
  // ПОВОД (09.08). Запись подписи не говорила, ПРОТИВ КАКОЙ редакции она подписана:
  // `form_version` стоял пустым у всех 8 консентов и ещё 90 записей. Пока редакций
  // одна — это мелочь; в день, когда `current` переводят (v4 → v5 в этот же день),
  // это юридический хвост: доказать «подписано против v5» нечем.
  //
  // ОБЪЯВЛЯЕТ САМА СТРАНИЦА, а не реестр: указатель реестра говорит, что СЕЙЧАС
  // считается текущим, а запись обязана помнить, что человек ДЕРЖАЛ ПЕРЕД ГЛАЗАМИ.
  // Родня канону провода происхождения: «редакция берётся у самой формы».
  //   1. <meta name="fk-form-version" content="v5"> — если форма сказала прямо;
  //   2. иначе — из имени файла (`…_v5.html`): в этом репозитории редакция ЕСТЬ имя;
  //   3. иначе — null. НЕ УГАДЫВАЕМ: пустое поле честнее выдуманного.
  function fkVersion() {
    try {
      var m = document.querySelector('meta[name="fk-form-version"]');
      var own = m && (m.getAttribute('content') || '').trim();
      if (own) return own;
      var f = (location.pathname.split('/').pop() || '');
      var hit = f.match(/_v(\d+)\.html?$/i);
      return hit ? 'v' + hit[1] : null;
    } catch (e) { return null; }
  }

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
  // F4 — one submission per filled form. _submitting blocks the double-click race;
  // _submitted locks the form after success so repeated Submit / Enter can't create
  // duplicate Inbox entries. Edits after submit = a NEW form (Start a new form).
  var _submitting = false, _submitted = false;
  // F4 part 2 — per-load idempotency token. A repeat of the same token (double-click,
  // retry) makes submit_enrollment_form return the SAME submission (server dedup).
  // A new form gets a fresh token (see newForm). Null on old browsers → server treats
  // it as no-key (normal insert). Embed path writes via the host → host follow-up.
  function newIdemp() { return (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : null; }
  var IDEMP = newIdemp();
  function shortRef(v) { var s = (v && typeof v === 'object') ? (v.id || v.submissionId || v.ref || '') : v; s = String(s == null ? '' : s); return s ? s.slice(0, 8).toUpperCase() : ''; }
  function lockForm(ref) {
    _submitted = true;
    $$('input,select,textarea,button').forEach(function (el) { if (!el.hasAttribute('data-fk-newform')) el.disabled = true; });
    if ($('.fk-submitted-banner')) return;
    var b = document.createElement('div'); b.className = 'fk-submitted-banner fk-print-hidden';
    b.setAttribute('style', 'position:sticky;bottom:0;left:0;right:0;z-index:9999;background:#0a7d46;color:#fff;padding:12px 16px;font:600 14px/1.4 Arial,sans-serif;display:flex;gap:14px;align-items:center;justify-content:center;flex-wrap:wrap;box-shadow:0 -2px 12px rgba(0,0,0,.18)');
    var txt = document.createElement('span'); txt.innerHTML = '✓ Submitted for center review' + (ref ? ' — Ref <strong>' + ref + '</strong>' : '') + '. Need changes?';
    var nf = document.createElement('button'); nf.type = 'button'; nf.setAttribute('data-fk-newform', '1'); nf.textContent = 'Start a new form';
    nf.setAttribute('style', 'background:#fff;color:#0a7d46;border:none;border-radius:8px;padding:8px 16px;font:700 13px Arial,sans-serif;cursor:pointer');
    nf.addEventListener('click', newForm);
    b.appendChild(txt); b.appendChild(nf);
    document.body.appendChild(b);
  }
  function newForm() {
    var b = $('.fk-submitted-banner'); if (b) b.remove();
    $$('input,select,textarea,button').forEach(function (el) { el.disabled = false; });
    _submitted = false;
    IDEMP = newIdemp();   // fresh idempotency token for the new form
    if (CFG.reset) { try { CFG.reset(); } catch (e) {} } else { location.reload(); return; }
    try { window.scrollTo(0, 0); } catch (e) {}
  }
  // ── Session-life notice ──────────────────────────────────────────────────────
  // The kit keeps your answers AND signature on THIS device for PK_TTL (24h), so a
  // family can fill the packet across the day. Tell them plainly: nothing is on a
  // server until Submit; a different phone or browser starts empty; after the day
  // it clears. Shown once per TTL window — the packet's later forms in the same
  // sitting stay quiet (flag carries the same 24h life as the data it describes).
  var NOTICE_KEY = 'pa_fk_notice_ts';
  function sessionNotice() {
    try { var ts = +localStorage.getItem(NOTICE_KEY); if (ts && Date.now() - ts < PK_TTL) return; } catch (_) {}
    if ($('.fk-life-notice')) return;
    var hrs = Math.round(PK_TTL / 3600000);
    var b = document.createElement('div'); b.className = 'fk-life-notice fk-print-hidden';
    b.setAttribute('style', 'position:sticky;top:0;left:0;right:0;z-index:9998;background:#fef3c7;color:#92400e;padding:11px 16px;font:600 13px/1.45 Arial,sans-serif;display:flex;gap:12px;align-items:center;justify-content:center;flex-wrap:wrap;box-shadow:0 2px 10px rgba(0,0,0,.12)');
    var txt = document.createElement('span');
    txt.innerHTML = '⏳ This form saves your answers and signature <strong>on this device for ' + hrs + ' hours</strong>, so you can finish later — but on the same phone and browser. Nothing is sent to the center until you press Submit. After ' + hrs + ' hours, or on a different device, it starts fresh.';
    var ok = document.createElement('button'); ok.type = 'button'; ok.textContent = 'Got it';
    ok.setAttribute('style', 'background:#92400e;color:#fff;border:none;border-radius:8px;padding:7px 15px;font:700 12px Arial,sans-serif;cursor:pointer;flex:none');
    ok.addEventListener('click', function () { b.remove(); });
    b.appendChild(txt); b.appendChild(ok);
    document.body.insertBefore(b, document.body.firstChild);
    // Mark seen on SHOW, not on dismiss — the packet index (parent-forms.html)
    // shares this exact key, so whichever surface the parent hits first (usually
    // the index) shows it once and every later form stays quiet for the window.
    try { localStorage.setItem(NOTICE_KEY, String(Date.now())); } catch (_) {}
  }
  async function submit() {
    if (_submitting || _submitted) return;   // in-flight / already-submitted guard
    // Centre FIRST. It used to be checked after field validation, so a parent learned
    // the link was unusable only after filling and signing the whole form — take 6 to
    // the letter. The bigger blocker is named on the first press, whenever it comes.
    if (!centerUuid()) { refuseNoCenter(); return; }   // #6 still absolute — but now it REFUSES OUT LOUD
    var missing = refreshCounter();
    if (missing.length) { var f = firstMissing(); if (f) { (f.scrollIntoView || function () {}).call(f, { behavior: 'smooth', block: 'center' }); if (f.focus) f.focus(); fieldMsg(f, true); } status('Please complete the highlighted fields', 'er'); return; }
    var data;
    try { data = CFG.collect ? CFG.collect() : null; } catch (e) { status('Error: ' + e.message, 'er'); return; }
    if (!data) { status('Nothing to submit', 'er'); return; }
    _submitting = true;
    status('Saving…', 'in');
    try {
      var res;
      if (CFG.submit) {
        // Form supplies its own transport (e.g. a legacy dedicated-table insert)
        // — the kit still owns validation/UX, this only replaces the write.
        res = await CFG.submit(data);
      } else if (EMBED.active) { res = await EMBED.save(data.formData, data.signatures, data.signatureDate); }
      else {
        res = await rpc({ p_org: ORG, p_center: centerUuid(), p_submission_type: FORM_TYPE, p_form_data: data.formData, p_signatures: data.signatures || {}, p_signature_date: data.signatureDate || null, p_source: 'online', p_idempotency_key: IDEMP, p_form_version: fkVersion() });
      }
      status('Submitted for center review', 'ok');
      savePacket();
      markSlotDone();
      mintSignature(data);
      var ref = shortRef(res);
      lockForm(ref);                     // read-only + banner; blocks re-submit
      if (CFG.onSuccess) CFG.onSuccess(ref);   // pass the Ref so a form's #done can echo it
    } catch (e) { status('Error: ' + e.message, 'er'); if (window.console) console.error(e); }
    finally { _submitting = false; }
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
        send({ type: 'save', formType: FORM_TYPE, formData: fd, signatures: sigs || null, signatureDate: sigDate || null, formVersion: fkVersion(), nonce: nonce });
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
        if (center) setResolvedCenter(center);
        window.addEventListener('message', function (ev) {
          if (ev.origin !== st.HOST) return;
          var d = ev.data; if (!d || d.__paEmbed !== true || d.ns !== 'pa-embed' || d.v !== 1) return;
          if (d.type === 'saved') { var p = st.pend[d.nonce]; if (p) { delete st.pend[d.nonce]; p.res(d); } }
          else if (d.type === 'error') { var q2 = st.pend[d.nonce]; if (q2) { delete st.pend[d.nonce]; q2.rej(new Error(d.message || 'Host error')); } }
          else if (d.type === 'inject') {
            try {
              if (d.reset && CFG.reset) CFG.reset();
              if (d.center) setResolvedCenter(d.center);
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
        // Graceful fallback — the embed handshake failed (registry unreachable,
        // parent origin not allow-listed, or missing host/registry params).
        // Don't trap the family on a dead-end message: drop out of embed mode so
        // the form works standalone here, and offer to reopen it in a real tab.
        document.documentElement.classList.remove('pa-embed');
        st.active = false;
        var center = q.get('center'); if (center) setResolvedCenter(center); else try { resolveCenter(); } catch (_) {}
        var bar = document.createElement('div'); bar.className = 'fk-print-hidden';
        bar.setAttribute('style', 'position:sticky;top:0;z-index:9998;background:#8a6d00;color:#fff;padding:10px 16px;font:600 13px/1.4 Arial,sans-serif;display:flex;gap:12px;align-items:center;justify-content:center;flex-wrap:wrap');
        var msg = document.createElement('span'); msg.textContent = "This form couldn't load inside the app — you can complete it here, or open it in your browser.";
        var open = document.createElement('button'); open.type = 'button'; open.textContent = 'Open in browser';
        open.setAttribute('style', 'background:#fff;color:#8a6d00;border:none;border-radius:6px;padding:6px 14px;font:700 12px Arial,sans-serif;cursor:pointer');
        open.addEventListener('click', function () {
          var u = new URL(location.href);['embed', 'host', 'registry'].forEach(function (k) { u.searchParams.delete(k); });
          try { if (!window.open(u.toString(), '_blank')) location.href = u.toString(); } catch (_) { location.href = u.toString(); }
        });
        bar.appendChild(msg); bar.appendChild(open);
        if (document.body) document.body.insertBefore(bar, document.body.firstChild);
      }
    };
    return st;
  })();

  // ── Boot ─────────────────────────────────────────────────────────────────────
  // ── Center auto-detect + resolved-center header + brand assets ───────────────
  function injectFavicon() {
    if (!document.head || document.querySelector('link[rel="icon"][data-fk]')) return;
    var l = document.createElement('link'); l.rel = 'icon'; l.setAttribute('data-fk', '1'); l.setAttribute('sizes', '144x144'); l.href = FAVICON_URL; document.head.appendChild(l);
    var a = document.createElement('link'); a.rel = 'apple-touch-icon'; a.href = FAVICON_URL; document.head.appendChild(a);
  }
  // ── FINDING #6 — center pickers are FORBIDDEN on every form ──────────────────
  // The center is authoritative from ?center= / kiosk / embed ONLY. A parent must
  // never be able to file a form against the wrong center (claim-integrity risk).
  // initToolbar's strip only reached DIRECT children of the toolbar div, so a
  // picker parked elsewhere in the page (USDA's `.center-pick` block) stayed live.
  // This sweeps the whole document, unconditionally, before anything reads it.
  function isCenterPicker(s) {
    if (s.id === 'ctr') return true;
    return Array.prototype.some.call(s.options || [], function (o) { return /select\s+center/i.test(o.text || ''); });
  }
  function stripCenterPickers() {
    $$('select').filter(isCenterPicker).forEach(function (s) {
      // take the labelled wrapper when it exists only to host the picker,
      // else the select alone — never a container holding other fields.
      var host = s.closest('.center-pick') || (s.closest('label') && !s.closest('label').querySelector('input,textarea') ? s.closest('label') : null);
      var kill = host && host.querySelectorAll('select').length === 1 ? host : s;
      var box = kill.closest('.center-pick');
      if (box && box.querySelectorAll('select,input,textarea').length === 1) kill = box;
      if (kill.parentNode) kill.parentNode.removeChild(kill);
    });
    $$('.center-pick').forEach(function (b) { if (!b.querySelector('input,textarea,select') && b.parentNode) b.parentNode.removeChild(b); });
  }
  // The picker used to double as the source of the printed "Center" field
  // (ctrPick copied its option text into #f_center / #p1_center). With the picker
  // stripped that field silently went EMPTY on enroll v9 + IEA v6 — restore it
  // from the resolved center, which is more reliable than a parent's dropdown.
  function centerName() { var i = CENTERS_INFO[centerCode()]; return i ? i.name : ''; }
  function fillCenterFields() {
    var nm = centerName(); if (!nm) return;
    $$('[data-fk-center-name],#f_center,#p1_center').forEach(function (e) {
      if (!(e.value || '').trim()) { e.value = nm; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); }
    });
  }
  function renderCenterHeader(code) {
    var info = CENTERS_INFO[code]; if (!info) return;
    var box = $('[data-formkit="center-header"]');
    if (!box) { box = document.createElement('div'); box.setAttribute('data-formkit', 'center-header'); document.body.insertBefore(box, document.body.firstChild); }
    box.className = 'fk-center-header';
    box.innerHTML = '<img class="fk-logo" src="' + LOGO_URL + '" alt="Play Academy" onerror="this.style.display=\'none\'">'
      + '<div class="fk-center-meta"><div class="fk-center-name">' + info.name + '</div>'
      + '<div class="fk-center-contact">' + info.address + ' · ' + info.phone + '</div></div>';
  }
  function setResolvedCenter(code) {
    if (!code || !CENTERS[code]) return;
    centerResolved = true; _center = code;
    refreshToolbarCenter();   // brand-header chip + enable Submit
    fillCenterFields();       // #6 — restore the printed Center name the picker used to supply
    _onCenter.forEach(function (fn) { try { fn(); } catch (_) {} });
  }
  function resolveCenter() {
    // Priority: embed (handled in EMBED.boot) → ?center= → kiosk device → staff <select> fallback.
    try { var c = new URLSearchParams(location.search).get('center'); if (c && CENTERS[c]) { setResolvedCenter(c); return; } } catch (_) {}
    if (window.PA_KIOSK && window.PA_KIOSK.center && CENTERS[window.PA_KIOSK.center]) { setResolvedCenter(window.PA_KIOSK.center); return; }
    // #6 — unresolved is a DEAD END by design: no picker fallback. Submit stays
    // disabled behind the "open this from your center's link or QR" banner. A
    // wrong-center filing is worse than a re-opened link.
  }
  var ACOMP = { child_name: 'name', parent_name: 'name', full_name: 'name', dob: 'bday', birthdate: 'bday', parent_birthdate: 'bday', street: 'street-address', address: 'street-address', city: 'address-level2', zip: 'postal-code', phone_day: 'tel', phone: 'tel', email: 'email', parent_email: 'email' };
  function initAutocomplete() { $$('[data-fk-field]').forEach(function (e) { var k = e.getAttribute('data-fk-field'); if (ACOMP[k] && !e.getAttribute('autocomplete')) e.setAttribute('autocomplete', ACOMP[k]); }); }

  // ── Phone mask (packet standard §5.2): (XXX) XXX-XXXX ────────────────────────
  // Auto-wires every type=tel input so display AND the value read into the
  // payload are masked consistently — forms no longer inline oninput=fmtPhone.
  function fmtPhone(el) {
    var d = (el.value || '').replace(/\D/g, '').slice(0, 10);
    el.value = d.length > 6 ? '(' + d.slice(0, 3) + ') ' + d.slice(3, 6) + '-' + d.slice(6)
             : d.length > 3 ? '(' + d.slice(0, 3) + ') ' + d.slice(3)
             : d;
  }
  function initPhones() {
    $$('input[type=tel]').forEach(function (el) {
      if (el.getAttribute('data-fk-phone')) return;   // idempotent
      el.setAttribute('data-fk-phone', '1');
      el.setAttribute('inputmode', 'tel');
      el.addEventListener('input', function () { fmtPhone(el); });
      if (el.value) fmtPhone(el);                     // mask any pre-filled value
    });
  }

  // ── Date helper (OVERLAY forms only): MM/DD/YYYY input mask + a light popup
  //    calendar. Opt-in via [data-fk-date]. The picked date is written back into
  //    the SAME text field — the print layer stays plain text, so pixel-perfect
  //    print is untouched. Non-overlay forms keep native <input type=date>. ──────
  function pad2(n) { return ('0' + n).slice(-2); }
  function fmtDateInput(el) {
    var d = (el.value || '').replace(/\D/g, '').slice(0, 8);
    el.value = d.length > 4 ? d.slice(0, 2) + '/' + d.slice(2, 4) + '/' + d.slice(4)
             : d.length > 2 ? d.slice(0, 2) + '/' + d.slice(2) : d;
  }
  function parseMDY(v) {
    var m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec((v || '').trim()); if (!m) return null;
    var mo = +m[1] - 1, da = +m[2], yr = +m[3], dt = new Date(yr, mo, da);
    return (dt.getMonth() === mo && dt.getDate() === da) ? dt : null;
  }
  function fmtMDY(dt) { return pad2(dt.getMonth() + 1) + '/' + pad2(dt.getDate()) + '/' + dt.getFullYear(); }
  var CAL_MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  var _calEl = null, _calField = null, _calView = null, _calWired = false;
  function calCss() {
    if (document.getElementById('fk-cal-css')) return;
    var s = document.createElement('style'); s.id = 'fk-cal-css';
    s.textContent =
      '.fk-cal-ico{position:absolute;width:18px;height:18px;padding:0;border:none;background:transparent;cursor:pointer;font-size:13px;line-height:1;opacity:.65;z-index:6}'
      + '.fk-cal-ico:hover{opacity:1}'
      + '.fk-cal{position:absolute;z-index:9999;width:236px;background:#fff;border:1px solid #cfe0d5;border-radius:10px;box-shadow:0 10px 30px rgba(15,76,53,.28);padding:8px;font-family:Arial,Helvetica,sans-serif;user-select:none}'
      + '.fk-cal-hd{display:flex;align-items:center;justify-content:space-between;margin-bottom:6px}'
      + '.fk-cal-title{font-weight:700;color:#0f4c35;font-size:13px}'
      + '.fk-cal-nav{border:none;background:#eef3ef;color:#0f4c35;width:24px;height:24px;border-radius:6px;cursor:pointer;font-size:15px;line-height:1}'
      + '.fk-cal-nav:hover{background:#dcebe2}'
      + '.fk-cal-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:2px}'
      + '.fk-cal-dow-c{text-align:center;font-size:10px;font-weight:700;color:#9aa;padding:2px 0}'
      + '.fk-cal-day{border:none;background:transparent;border-radius:6px;height:28px;cursor:pointer;font-size:12.5px;color:#233}'
      + '.fk-cal-day:hover{background:#eef3ef}'
      + '.fk-cal-today{outline:1.5px solid #0f4c35;outline-offset:-1.5px;font-weight:700}'
      + '.fk-cal-sel{background:#0f4c35;color:#fff}.fk-cal-sel:hover{background:#0f4c35}'
      + '@media print{.fk-cal,.fk-cal-ico{display:none!important}}';
    document.head.appendChild(s);
  }
  function closeCal() { if (_calEl) { _calEl.parentNode && _calEl.parentNode.removeChild(_calEl); _calEl = null; _calField = null; } }
  function renderCal(sel) {
    var y = _calView.getFullYear(), m = _calView.getMonth();
    var today = new Date(); today.setHours(0, 0, 0, 0);
    var first = new Date(y, m, 1).getDay(), days = new Date(y, m + 1, 0).getDate();
    var h = '<div class="fk-cal-hd"><button type="button" class="fk-cal-nav" data-nav="-1">‹</button>'
      + '<span class="fk-cal-title">' + CAL_MONTHS[m] + ' ' + y + '</span>'
      + '<button type="button" class="fk-cal-nav" data-nav="1">›</button></div>'
      + '<div class="fk-cal-grid">' + ['S','M','T','W','T','F','S'].map(function (d) { return '<span class="fk-cal-dow-c">' + d + '</span>'; }).join('') + '</div>'
      + '<div class="fk-cal-grid">';
    for (var i = 0; i < first; i++) h += '<span></span>';
    for (var d = 1; d <= days; d++) {
      var dt = new Date(y, m, d); dt.setHours(0, 0, 0, 0);
      var c = 'fk-cal-day';
      if (+dt === +today) c += ' fk-cal-today';
      if (sel && sel.getFullYear() === y && sel.getMonth() === m && sel.getDate() === d) c += ' fk-cal-sel';
      h += '<button type="button" class="' + c + '" data-day="' + d + '">' + d + '</button>';
    }
    _calEl.innerHTML = h + '</div>';
  }
  function openCal(field) {
    closeCal(); _calField = field;
    var sel = parseMDY(field.value), t = new Date();
    _calView = sel ? new Date(sel.getFullYear(), sel.getMonth(), 1) : new Date(t.getFullYear(), t.getMonth(), 1);
    _calEl = document.createElement('div'); _calEl.className = 'fk-cal'; renderCal(sel);
    document.body.appendChild(_calEl);
    var r = field.getBoundingClientRect(), cw = 236;
    var left = r.left + window.scrollX, top = r.bottom + window.scrollY + 4;
    var maxL = window.scrollX + document.documentElement.clientWidth - cw - 8;
    if (left > maxL) left = maxL;
    _calEl.style.left = Math.max(8, left) + 'px'; _calEl.style.top = top + 'px';
  }
  function wireCalOnce() {
    if (_calWired) return; _calWired = true;
    document.addEventListener('click', function (e) {
      if (_calEl && _calEl.contains(e.target)) {
        var nav = e.target.getAttribute('data-nav');
        if (nav) { _calView.setMonth(_calView.getMonth() + (+nav)); renderCal(parseMDY(_calField.value)); return; }
        var day = e.target.getAttribute('data-day');
        if (day) { var dt = new Date(_calView.getFullYear(), _calView.getMonth(), +day);
          _calField.value = fmtMDY(dt); _calField.dispatchEvent(new Event('input', { bubbles: true })); closeCal(); }
        return;
      }
      if (_calEl && !(e.target.classList && e.target.classList.contains('fk-cal-ico'))) closeCal();
    });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeCal(); });
    window.addEventListener('scroll', function () { closeCal(); }, true);
  }
  function initDates() {
    var fields = $$('[data-fk-date]'); if (!fields.length) return;
    calCss(); wireCalOnce();
    fields.forEach(function (el) {
      if (el.getAttribute('data-fk-datewired')) return;   // idempotent
      el.setAttribute('data-fk-datewired', '1');
      el.setAttribute('inputmode', 'numeric');
      if (!el.placeholder) el.placeholder = 'MM/DD/YYYY';
      el.addEventListener('input', function () { fmtDateInput(el); });
      if (el.value) fmtDateInput(el);
      var ico = document.createElement('button');
      ico.type = 'button'; ico.className = 'fk-cal-ico fk-print-hidden'; ico.textContent = '📅';
      ico.setAttribute('tabindex', '-1'); ico.setAttribute('aria-label', 'Open calendar');
      ico.addEventListener('click', function (ev) { ev.stopPropagation(); if (_calField === el && _calEl) { closeCal(); } else { openCal(el); } });
      // overlay fields are absolutely positioned inside their .page → drop the icon
      // FLUSH INSIDE the field's right edge (never widens the field's footprint).
      ico.style.left = (el.offsetLeft + el.offsetWidth - 19) + 'px';
      ico.style.top = (el.offsetTop + Math.max(0, (el.offsetHeight - 18) / 2)) + 'px';
      (el.parentNode || document.body).appendChild(ico);
    });
  }

  // ── Address helper (provider-agnostic, KEYLESS): zip→city/state autofill +
  //    street suggestions. FAIL-OPEN — any network hiccup just leaves manual entry
  //    working. Opt-in: put [data-fk-address] on the street field; link the others
  //    via data-fk-addr-city/state/zip (element id) or the kit falls back to
  //    [data-fk-field=city|zip]. State ALWAYS comes from the geocoder. Provider is
  //    swappable via the GEO adapter (Census + zippopotam today; Places later). ──
  var GEO = {
    zip: function (z) {   // zip → {city,state} (zippopotam, keyless, CORS-ok)
      return fetch('https://api.zippopotam.us/us/' + z).then(function (r) { return r.ok ? r.json() : null; })
        .then(function (d) { var p = d && d.places && d.places[0]; return p ? { city: p['place name'], state: p['state abbreviation'] } : null; })
        .catch(function () { return null; });
    },
    suggest: function (q) {   // free-text → [{label,street,city,state,zip}] (US Census onelineaddress)
      var u = 'https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?benchmark=Public_AR_Current&format=json&address=' + encodeURIComponent(q);
      return fetch(u).then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
        var m = (d && d.result && d.result.addressMatches) || [];
        return m.slice(0, 5).map(function (a) { var c = a.addressComponents || {};
          var street = [c.fromAddress, c.streetName, c.suffixType].filter(Boolean).join(' ') || (a.matchedAddress || '').split(',')[0];
          return { label: a.matchedAddress || street, street: street, city: c.city || '', state: c.state || '', zip: c.zip || '' };
        });
      }).catch(function () { return []; });
    }
  };
  function _addrLinked(el, kind) {
    var id = el.getAttribute('data-fk-addr-' + kind);
    if (id) return document.getElementById(id.replace(/^#/, ''));
    return $('[data-fk-field="' + kind + '"]');
  }
  function _setIfEmpty(el, v) { if (el && v && !(el.value || '').trim()) { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); } }
  function addrCss() {
    if (document.getElementById('fk-addr-css')) return;
    var s = document.createElement('style'); s.id = 'fk-addr-css';
    s.textContent = '.fk-addr-list{position:absolute;z-index:9999;background:#fff;border:1px solid #cfe0d5;border-radius:8px;box-shadow:0 8px 24px rgba(15,76,53,.2);padding:4px;max-width:380px;font-family:Arial,Helvetica,sans-serif}'
      + '.fk-addr-item{display:block;width:100%;text-align:left;border:none;background:transparent;padding:7px 9px;font-size:12.5px;color:#233;cursor:pointer;border-radius:6px}'
      + '.fk-addr-item:hover{background:#eef3ef}@media print{.fk-addr-list{display:none!important}}';
    document.head.appendChild(s);
  }
  function initAddress() {
    var streets = $$('[data-fk-address]'); if (!streets.length) return;
    addrCss();
    streets.forEach(function (st) {
      if (st.getAttribute('data-fk-addrwired')) return; st.setAttribute('data-fk-addrwired', '1');
      var cityEl = _addrLinked(st, 'city'), stateEl = _addrLinked(st, 'state'), zipEl = _addrLinked(st, 'zip');
      if (zipEl) zipEl.addEventListener('blur', function () {
        var z = (zipEl.value || '').replace(/\D/g, '').slice(0, 5); if (z.length !== 5) return;
        GEO.zip(z).then(function (r) { if (!r) return; _setIfEmpty(cityEl, r.city); _setIfEmpty(stateEl, r.state); });
      });
      var box = null;
      function closeAddr() { if (box) { box.parentNode && box.parentNode.removeChild(box); box = null; } }
      var run = debounce(function () {
        var q = (st.value || '').trim(); if (q.length < 5) { closeAddr(); return; }
        GEO.suggest(q).then(function (list) {
          closeAddr(); if (!list.length) return;
          box = document.createElement('div'); box.className = 'fk-addr-list';
          list.forEach(function (a) {
            var it = document.createElement('button'); it.type = 'button'; it.className = 'fk-addr-item'; it.textContent = a.label;
            it.addEventListener('mousedown', function (e) { e.preventDefault();
              if (a.street) { st.value = a.street; st.dispatchEvent(new Event('input', { bubbles: true })); }
              _setIfEmpty(cityEl, a.city); _setIfEmpty(stateEl, a.state); _setIfEmpty(zipEl, a.zip); closeAddr();
            });
            box.appendChild(it);
          });
          document.body.appendChild(box);
          var r = st.getBoundingClientRect();
          box.style.left = (r.left + window.scrollX) + 'px'; box.style.top = (r.bottom + window.scrollY + 2) + 'px'; box.style.minWidth = r.width + 'px';
        });
      }, 350);
      st.addEventListener('input', run);
      st.addEventListener('blur', function () { setTimeout(closeAddr, 200); });
    });
  }

  // ── Unified FormToolbar — one brand toolbar for every form. Replaces whatever
  //    toolbar markup a form ships with (so the old two epochs + the visible
  //    center <select> all disappear). Order: brand header (logo · org · center
  //    chip) then the action row: [name] · Submit(filled) · Print(ghost) ·
  //    Clear(ghost-danger) · Expires(config only) · counter(pill) · special. ────
  var _tbSubmit = null, _tbBanner = null;
  function tbCss() {
    if (document.getElementById('fk-tb-css')) return;
    var s = document.createElement('style'); s.id = 'fk-tb-css';
    s.textContent =
      '.fk-toolbar{position:sticky;top:0;z-index:40;font-family:Arial,Helvetica,sans-serif;box-shadow:0 1px 0 rgba(15,76,53,.08)}'
      + '.fk-tb-brand{display:flex;align-items:center;gap:9px;background:#0f4c35;color:#fff;padding:7px 14px}'
      + '.fk-tb-logo{width:22px;height:22px;border-radius:5px;background:#fff;object-fit:contain;flex:0 0 auto}'
      + '.fk-tb-word{font-weight:700;font-size:13.5px;letter-spacing:.01em}'
      + '.fk-tb-center{margin-left:auto;display:inline-flex;align-items:center;gap:6px;font-size:12.5px;font-weight:600;background:rgba(255,255,255,.16);border-radius:20px;padding:4px 11px}'
      + '.fk-tb-row{display:flex;flex-wrap:wrap;align-items:center;gap:9px;background:#fff;padding:9px 14px;border-top:1px solid #e2e8e2}'
      + '.fk-tb-name{font-weight:700;font-size:14px;color:#12241b;margin-right:4px}'
      // SPECIFICITY: the kit reuses the form's own toolbar div, so a form rule like
      // `.toolbar button{background:#fff}` (0,1,1) outranks a bare `.fk-tb-submit`
      // (0,1,0) and repaints Submit white-on-white — present, enabled, invisible.
      // Every button rule below is scoped `.fk-toolbar button.<cls>` (0,2,1) so it
      // outranks any `.toolbar button` a form ships. NEVER weaken these selectors.
      + '.fk-toolbar button.fk-tb-b{font:inherit;font-size:12.5px;font-weight:700;border-radius:8px;padding:8px 15px;cursor:pointer;border:1.5px solid transparent;display:inline-flex;align-items:center;gap:6px}'
      + '.fk-toolbar button.fk-tb-submit{background:#0f4c35;color:#fff;border-color:#0f4c35}'
      + '.fk-toolbar button.fk-tb-submit:disabled{opacity:.5;cursor:not-allowed}'
      + '.fk-toolbar button.fk-tb-ghost{background:#fff;color:#0f4c35;border-color:#0f4c35}'
      + '.fk-toolbar button.fk-tb-danger{background:#fff;color:#b3402e;border-color:#b3402e}'
      + '.fk-tb-exp{font-size:11.5px;color:#6b7280;display:inline-flex;align-items:center;gap:5px;margin-left:2px}'
      + '.fk-tb-spacer{flex:1}'
      + '.fk-toolbar button.fk-tb-special{font:inherit;font-size:12px;font-weight:600;border-radius:8px;padding:7px 12px;background:#eef3ef;color:#0f4c35;border:1px solid #dcebe2;cursor:pointer}'
      + '.fk-tb-status{font-size:12.5px;font-weight:600}.fk-tb-status.ok{color:#0f4c35}.fk-tb-status.er{color:#b91c1c}.fk-tb-status.in{color:#6b7280}'
      + '.fk-tb-banner{display:flex;align-items:center;gap:9px;background:#fef3c7;color:#92400e;font-size:13px;font-weight:600;padding:10px 14px;border-top:1px solid #e2e8e2}'
      // unarmed = muted but LIVE. Never `disabled` — a click must always get an answer.
      + '.fk-toolbar button.fk-tb-submit.fk-tb-unarmed{background:#7f9c8e;border-color:#7f9c8e;cursor:pointer}'
      + '@keyframes fkFlash{0%,100%{background:#fef3c7}30%,60%{background:#fde68a;box-shadow:0 0 0 3px rgba(180,83,9,.35) inset}}'
      + '.fk-tb-banner.fk-flash{animation:fkFlash 1.1s ease-in-out 2}'
      + '.fk-toast{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:10000;max-width:min(620px,92vw);'
      + 'background:#7f1d1d;color:#fff;border-radius:10px;padding:13px 17px;font:600 13.5px/1.5 Arial,sans-serif;'
      + 'box-shadow:0 8px 26px rgba(0,0,0,.3);cursor:pointer}'
      + '@media print{.fk-toolbar,.fk-toast{display:none!important}}';
    document.head.appendChild(s);
  }
  function tbBtn(cls, txt) { var b = document.createElement('button'); b.type = 'button'; b.className = cls; b.innerHTML = txt; return b; }
  function refreshToolbarCenter() {
    var chip = $('[data-formkit="center-chip"]');
    var code = centerCode(), info = CENTERS_INFO[code], has = !!centerUuid();
    if (chip) { if (info) { chip.textContent = '📍 ' + info.name.replace(/^Play Academy\s+/, ''); chip.style.display = ''; } else { chip.style.display = 'none'; } }
    if (_tbBanner) { _tbBanner.style.display = has ? 'none' : ''; if (!has) _tbBanner.textContent = unresolvedCenterText(); }
    // Finding #6 is enforced in submit() — no centre resolved, no write, ever. The
    // button nevertheless stays ENABLED: a disabled button eats the click and answers
    // nothing, which is how a fully-filled, fully-signed form went four presses with no
    // word either way. Unarmed it looks muted; pressed, it says what is wrong.
    if (_tbSubmit) {
      // NOT aria-disabled either: the control really is live and really does answer,
      // and Playwright (like a screen reader) treats aria-disabled as disabled — which
      // would hide the very refusal path the rehearsal has to exercise.
      _tbSubmit.disabled = false;
      _tbSubmit.removeAttribute('aria-disabled');
      _tbSubmit.classList[has ? 'remove' : 'add']('fk-tb-unarmed');
      _tbSubmit.title = has ? '' : 'This form has no center yet — press to see why';
    }
  }
  function initToolbar() {
    var tb = $('[data-formkit="toolbar"]') || $('.toolbar') || document.getElementById('tb');
    if (!tb) { tb = document.createElement('div'); document.body.insertBefore(tb, document.body.firstChild); }
    tbCss();
    // title fallback: config → an <h1> already in the bar → document.title
    var h1 = tb.querySelector('h1');
    var title = CFG.title || (h1 && h1.textContent.trim()) || document.title || '';
    // PRESERVE controls some forms pack into their bar (v9/IEA: dynamic #exp, the
    // required counter, and the smart-week hosts that own the Apply-Monday chip).
    var keepExp = tb.querySelector('#exp');
    var keepCounter = tb.querySelector('[data-formkit="counter"]');
    var keepWeek = $$('[data-fk-week],[data-fk-week-apply],[data-fk-meals]', tb);
    // Strip ONLY the old toolbar bits — DIRECT-child <select>/<button>/<h1> and the
    // old status span — so nested things (e.g. the Apply-Monday chip) survive.
    Array.prototype.slice.call(tb.children).forEach(function (e) {
      if (/^(SELECT|BUTTON|H1)$/.test(e.tagName)) { tb.removeChild(e); return; }
      if (e.id === 'st' && e !== keepCounter) tb.removeChild(e);
    });
    tb.classList.add('fk-toolbar');
    var brand = document.createElement('div'); brand.className = 'fk-tb-brand';
    brand.innerHTML = '<img class="fk-tb-logo" src="' + LOGO_URL + '" alt="" onerror="this.style.display=\'none\'">'
      + '<span class="fk-tb-word" data-fk-org>' + (CFG.orgName || 'Play Academy') + '</span>'
      + '<span class="fk-tb-center" data-formkit="center-chip" style="display:none"></span>';
    var row = document.createElement('div'); row.className = 'fk-tb-row';
    var name = document.createElement('span'); name.className = 'fk-tb-name'; name.textContent = title;
    var bSubmit = tbBtn('fk-tb-b fk-tb-submit', '✔ Submit'); bSubmit.setAttribute('data-formkit', 'submit');
    var bPrint = tbBtn('fk-tb-b fk-tb-ghost', '🖨 Print'); bPrint.addEventListener('click', function () { window.print(); });
    var bClear = tbBtn('fk-tb-b fk-tb-danger', '✕ Clear'); bClear.addEventListener('click', function () { if (CFG.reset) CFG.reset(); });
    row.appendChild(name); row.appendChild(bSubmit); row.appendChild(bPrint); row.appendChild(bClear);
    // expiry: prefer the form's own dynamic #exp, else a static config slot
    if (keepExp) { keepExp.classList.add('fk-tb-exp'); row.appendChild(keepExp); }
    else if (CFG.expiry) { var exp = document.createElement('span'); exp.className = 'fk-tb-exp'; exp.textContent = '⏳ Renew in ' + CFG.expiry; row.appendChild(exp); }
    // required counter: reuse the form's own, else create one
    if (keepCounter) { keepCounter.classList.add('fk-print-hidden'); row.appendChild(keepCounter); }
    else { var cnt = document.createElement('span'); cnt.className = 'fk-counter fk-print-hidden'; cnt.setAttribute('data-formkit', 'counter'); row.appendChild(cnt); }
    var sp = document.createElement('span'); sp.className = 'fk-tb-spacer'; row.appendChild(sp);
    keepWeek.forEach(function (w) { row.appendChild(w); });   // Apply-Monday chip host, etc.
    (CFG.special || []).forEach(function (b) { var el = tbBtn('fk-tb-special', b.label); if (b.onClick) el.addEventListener('click', b.onClick); row.appendChild(el); });
    var st = document.createElement('span'); st.id = 'st'; st.className = 'fk-tb-status'; st.setAttribute('data-formkit', 'status'); row.appendChild(st);
    _tbBanner = document.createElement('div'); _tbBanner.className = 'fk-tb-banner fk-print-hidden';
    _tbBanner.textContent = "⚠ Please open this form from your center's packet link or QR.";
    tb.insertBefore(row, tb.firstChild); tb.insertBefore(brand, row); tb.appendChild(_tbBanner);
    _tbSubmit = bSubmit;
    refreshToolbarCenter(); refreshCounter();
  }

  function boot() {
    injectFavicon();
    if (!samplesOn()) purgeSamples();   // conserved: a shelf minted before the flip does not survive it
    stripCenterPickers();   // #6 — before anything can read or show a picker
    $$('[data-formkit="signature"]').forEach(function (c) { initSig(c); initAdopt(c); });
    initConditionals(); initValidation(); initTooltips(); initChoices();
    initWeek(); initBanner(); initAutofill(); initAutocomplete(); initPhones(); initDates(); initAddress(); initExclusive();
    if (EMBED.active) EMBED.boot(); else resolveCenter();  // resolve center (embed does its own)
    initToolbar();                                         // unified toolbar — brand + center chip / banner
    var sub = $('[data-formkit="submit"]'); if (sub) sub.addEventListener('click', function (e) { e.preventDefault(); submit(); });
    // click the required-counter or a signature-lock → scroll to the first empty required
    var cc = $('[data-formkit="counter"]'); if (cc) { cc.style.cursor = 'pointer'; cc.title = 'Go to the first required field'; cc.addEventListener('click', gotoFirstMissing); }
    $$('.siglock,[data-fk-goto]').forEach(function (l) { l.style.cursor = 'pointer'; l.addEventListener('click', gotoFirstMissing); });
    sessionNotice();   // 24h-life warning, once per TTL window
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();

  // ── Local-timezone date helpers (kit-wide) ───────────────────────────────────
  // NEVER use new Date().toISOString().split('T')[0] for a signature/"today"
  // value — toISOString() is UTC, so an evening submit east of the date line
  // (or any positive-offset tz) rolls to tomorrow. These format the LOCAL
  // calendar date, matching what the parent sees on the form.
  function isoDate(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function todayISO() { return isoDate(new Date()); }

  // ── Public API (forms may call these directly) ───────────────────────────────
  window.FormKit = {
    submit: submit, status: status,
    getSig: getSig, clearSig: clearSig, initSig: initSig,
    savePacket: savePacket, applyPacket: applyPacket,
    centerUuid: centerUuid, centerCode: centerCode, centerName: centerName,
    refreshCounter: refreshCounter, applyConditionals: applyConditionals,
    fmtPhone: fmtPhone, todayISO: todayISO, isoDate: isoDate,
    CENTERS: CENTERS, ORG: ORG,
    // KIT is the cache-bust number in the <script src="form-kit.js?v=N"> includes.
    // A rehearsal reads it to prove the browser got the build it thinks it got.
    KIT: 12,
    // armed() === true means "pressing Submit would really call the RPC". The
    // rehearsal asserts THIS, not the presence of a button ([[submit assert]]).
    armed: function () { return !!centerUuid(); },
    whyNotArmed: function () { return centerUuid() ? '' : unresolvedCenterText(); },
    // Exposed so a form's CFG.submit override can POST to its own dedicated
    // table without re-inlining the anon key (UX-only retrofit path).
    supa: { url: SUPA_URL, key: SUPA_KEY, headers: { apikey: SUPA_KEY, Authorization: 'Bearer ' + SUPA_KEY, 'Content-Type': 'application/json', 'Content-Profile': 'menumaker' } },
  };
})();
