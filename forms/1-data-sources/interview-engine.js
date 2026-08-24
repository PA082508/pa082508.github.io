/* interview-engine.js — СОБРАНО, НЕ НАПИСАНО РУКАМИ.
 * Источник: src/lib/interviewQuestions.ts, src/lib/interviewPrefill.ts, src/lib/interviewScatter.ts, src/lib/interviewFlow.ts, src/lib/interviewQueue.ts, src/lib/interviewEngineBundle.ts
 * Отпечаток источников: 0b39d6e291e34087
 * Правка этого файла бессмысленна: он пересобирается из модулей приложения,
 * и страж сборки роняет гейт, если файл разошёлся с источником.
 */
"use strict";
(() => {
  // src/lib/interviewQuestions.ts
  function cycleCanonicals(dict) {
    var _a;
    const out = /* @__PURE__ */ new Set();
    for (const c of Object.values((_a = dict.cycles) != null ? _a : {})) for (const k of c.canonicals) out.add(k);
    return out;
  }
  function branchOf(dict, form, key) {
    var _a, _b;
    return (_b = (_a = dict.branchFields) == null ? void 0 : _a[form]) == null ? void 0 : _b[key];
  }
  var DOOR_FORMS = ["start_form"];
  var ORDER = ["family", "child", "household", "staff"];
  function buildQuestionnaire(dict, formsInSet) {
    var _a, _b, _c;
    const set = [...new Set(formsInSet.filter(Boolean))];
    const door = set.find((f) => DOOR_FORMS.includes(f));
    const empty = {
      family: [],
      child: [],
      household: [],
      staff: [],
      unknownForms: [],
      skipped: false,
      skipReason: null
    };
    if (door) {
      return {
        ...empty,
        skipped: true,
        skipReason: `the set contains ${door} \u2014 that form is itself the conversation with a new family`
      };
    }
    const known = new Set(dict.rows.map((r) => r.form));
    const unknownForms = set.filter((f) => !known.has(f));
    const byCycle = cycleCanonicals(dict);
    const byCanon = /* @__PURE__ */ new Map();
    for (const r of dict.rows) {
      if (!set.includes(r.form)) continue;
      if (byCycle.has(r.canonical)) continue;
      const q = byCanon.get(r.canonical);
      if (q) {
        q.targets.push({ form: r.form, key: r.key, branch: branchOf(dict, r.form, r.key), branchOn: dict.branchOnValue });
        continue;
      }
      const declared = (_a = dict.canonicals) == null ? void 0 : _a[r.canonical];
      byCanon.set(r.canonical, {
        canonical: r.canonical,
        level: (_b = declared == null ? void 0 : declared.level) != null ? _b : r.level,
        // ⭐ Канонический формат, когда источники расходятся; иначе — форма источника.
        format: (_c = declared == null ? void 0 : declared.canonicalFormat) != null ? _c : r.format,
        targets: [{ form: r.form, key: r.key, branch: branchOf(dict, r.form, r.key), branchOn: dict.branchOnValue }]
      });
    }
    const out = { ...empty, unknownForms };
    for (const q of byCanon.values()) {
      if (ORDER.includes(q.level)) out[q.level].push(q);
    }
    return out;
  }
  function questionCount(q, children) {
    if (q.skipped) return 0;
    const kids = Math.max(0, children);
    return q.family.length + q.child.length * kids + q.household.length;
  }
  function targetsOf(q) {
    return [...new Set(q.targets.map((t) => `${t.form}.${t.key}`))].sort();
  }

  // src/lib/interviewPrefill.ts
  var txt = (v) => {
    if (v === null || v === void 0) return "";
    if (typeof v === "string") return v.trim();
    if (typeof v === "number" || typeof v === "boolean") return String(v);
    return "";
  };
  var sameValue = (v) => v.replace(/\s+/g, " ").trim().toLowerCase();
  function answerFor(q, forms, who) {
    if (q.level === "household") {
      return { ...q, state: "empty", value: null, found: [] };
    }
    const found = [];
    for (const t of q.targets) {
      const fd = forms[t.form];
      if (!fd) continue;
      const v = txt(fd[t.key]);
      if (!v) continue;
      found.push({ form: t.form, key: t.key, value: t.branch !== void 0 ? t.branch : v, who });
    }
    const distinct = [...new Set(found.map((f) => sameValue(f.value)))];
    if (distinct.length === 0) return { ...q, state: "empty", value: null, found: [] };
    if (distinct.length === 1) return { ...q, state: "answered", value: found[0].value, found };
    return { ...q, state: "conflict", value: null, found };
  }
  function answerAcross(q, sources) {
    const all = [];
    for (const s of sources) {
      const a = answerFor(q, s.forms, s.who);
      all.push(...a.found);
    }
    if (!all.length) return { ...q, state: "empty", value: null, found: [] };
    const distinct = [...new Set(all.map((f) => sameValue(f.value)))];
    if (distinct.length === 1) return { ...q, state: "answered", value: all[0].value, found: all };
    return { ...q, state: "conflict", value: null, found: all };
  }
  function prefillAcross(q, sources) {
    const map = (list) => list.map((x) => answerAcross(x, sources));
    const out = {
      family: map(q.family),
      child: map(q.child),
      household: map(q.household),
      staff: map(q.staff),
      skipped: q.skipped,
      skipReason: q.skipReason,
      counts: { answered: 0, empty: 0, conflict: 0 }
    };
    for (const a of [...out.family, ...out.child, ...out.household, ...out.staff]) out.counts[a.state] += 1;
    return out;
  }
  function prefillQuestionnaire(q, forms) {
    const src = forms != null ? forms : {};
    const map = (list) => list.map((x) => answerFor(x, src));
    const out = {
      family: map(q.family),
      child: map(q.child),
      household: map(q.household),
      staff: map(q.staff),
      skipped: q.skipped,
      skipReason: q.skipReason,
      counts: { answered: 0, empty: 0, conflict: 0 }
    };
    for (const a of [...out.family, ...out.child, ...out.household, ...out.staff]) {
      out.counts[a.state] += 1;
    }
    return out;
  }
  function conflictLine(a) {
    var _a;
    if (a.state !== "conflict") return null;
    const seen = /* @__PURE__ */ new Map();
    for (const f of a.found) {
      const label = f.who || f.form;
      const list = (_a = seen.get(f.value)) != null ? _a : [];
      if (!list.includes(label)) list.push(label);
      seen.set(f.value, list);
    }
    const parts = [...seen].map(([value, labels]) => `"${value}" (from ${labels.join(", ")})`);
    return `We have two answers on file \u2014 ${parts.join(" and ")}. Which one is correct today?`;
  }

  // src/lib/interviewScatter.ts
  var HOUSEHOLD_FORMS = ["iea"];
  var CENTER_NAME_ONLY = ["infant_meals", "fluid_milk"];
  var NEVER_SCATTER = /* @__PURE__ */ new Set([
    "parent_sig",
    "program_sig",
    "physician_sig",
    "sponsor_sig",
    "adult_sig",
    "parent_sig_dt",
    "program_sig_dt",
    "signature",
    "signatures",
    "signature_method",
    "signature_typed_value",
    "signature_date",
    "signed_date",
    "signed_date2",
    "signature2_method",
    "parent_signature_date",
    "physician_date_of_signature",
    "trainer_signature_date",
    "caregiver_signature_date",
    "permission_date",
    "authority_signature_img",
    "pg_init_1",
    "pg_init_2",
    "pg_init_3",
    "adm_init_1",
    "adm_init_2",
    "adm_init_3",
    "pg_rev_1",
    "pg_rev_2",
    "pg_rev_3",
    "adm_rev_1",
    "adm_rev_2",
    "adm_rev_3"
  ]);
  var ISO_TO_SHORT = { 1: "mon", 2: "tue", 3: "wed", 4: "thu", 5: "fri", 6: "sat", 7: "sun" };
  var ISO_TO_LONG = {
    1: "monday",
    2: "tuesday",
    3: "wednesday",
    4: "thursday",
    5: "friday",
    6: "saturday",
    7: "sunday"
  };
  function weekForForm(days, form) {
    var _a, _b, _c, _d, _e, _f, _g, _h;
    const out = {};
    for (const d of days) {
      if (form === "start_form") {
        out[ISO_TO_LONG[d.weekday]] = { from: (_a = d.arr1) != null ? _a : null, to: (_b = d.dep1) != null ? _b : null, from2: (_c = d.arr2) != null ? _c : null, to2: (_d = d.dep2) != null ? _d : null };
      } else {
        out[ISO_TO_SHORT[d.weekday]] = { in_care: true, arr1: (_e = d.arr1) != null ? _e : "", dep1: (_f = d.dep1) != null ? _f : "", arr2: (_g = d.arr2) != null ? _g : "", dep2: (_h = d.dep2) != null ? _h : "" };
      }
    }
    return out;
  }
  function scatterAnswers(input) {
    var _a, _b, _c;
    const { filled, forms, childKey, centerCode } = input;
    const data = {};
    const skipped = [];
    if (filled.skipped) return { data, skipped: [{ canonical: "*", reason: (_a = filled.skipReason) != null ? _a : "interview skipped" }] };
    const put = (form, key, value) => {
      var _a2;
      if (!forms.includes(form)) return;
      if (NEVER_SCATTER.has(key)) return;
      ((_a2 = data[form]) != null ? _a2 : data[form] = {})[key] = value;
    };
    const lists = [
      ["family", filled.family],
      ["child", filled.child],
      ["household", filled.household],
      ["staff", filled.staff]
    ];
    for (const [level, list] of lists) {
      for (const q of list) {
        if (q.state === "conflict") {
          skipped.push({ canonical: q.canonical, reason: "two answers on file \u2014 the family has not chosen yet" });
          continue;
        }
        if (q.state === "empty" || q.value === null) continue;
        for (const t of q.targets) {
          if (level === "household" && !HOUSEHOLD_FORMS.includes(t.form)) {
            skipped.push({ canonical: q.canonical, reason: `household level never leaves ${HOUSEHOLD_FORMS.join("/")}` });
            continue;
          }
          if (level === "child" && childKey === null) {
            skipped.push({ canonical: q.canonical, reason: "a child answer needs a child \u2014 none given" });
            continue;
          }
          if (t.branch !== void 0) {
            const on = String(q.value).trim().toLowerCase() === t.branch.trim().toLowerCase();
            put(t.form, t.key, on ? (_b = t.branchOn) != null ? _b : q.value : "");
            continue;
          }
          put(t.form, t.key, q.value);
        }
      }
    }
    if (centerCode) {
      for (const f of forms) {
        if (CENTER_NAME_ONLY.includes(f)) continue;
        ((_c = data[f]) != null ? _c : data[f] = {}).center_code = centerCode;
      }
    }
    return { data, skipped };
  }

  // src/lib/interviewFlow.ts
  var CONDITION_OF = {
    special_health_need: (f) => {
      var _a;
      return (_a = f.healthCondition) != null ? _a : null;
    },
    medication: (f) => {
      var _a;
      return (_a = f.medication) != null ? _a : null;
    },
    school_age: (f) => {
      var _a;
      return (_a = f.attendsSchool) != null ? _a : null;
    },
    infant: (f) => {
      var _a;
      return (_a = f.infant) != null ? _a : null;
    },
    special_diet: (f) => {
      var _a;
      return (_a = f.specialDiet) != null ? _a : null;
    }
  };
  var DOOR = "start_form";
  var CONSENT = "parent_consent";
  function formsForCondition(reg, condition) {
    var _a;
    return Object.entries((_a = reg.forms) != null ? _a : {}).filter(([, f]) => f && typeof f === "object" && f.condition === condition && !f.sameAs).map(([k]) => k).sort();
  }
  function applyConditions(reg, base, facts) {
    const forms = [...base];
    const added = [];
    const unanswered = [];
    for (const [condition, read] of Object.entries(CONDITION_OF)) {
      const v = read(facts);
      const candidates = formsForCondition(reg, condition);
      if (!candidates.length) continue;
      if (v === true) {
        for (const f of candidates) if (!forms.includes(f)) {
          forms.push(f);
          added.push(f);
        }
      } else if (v === null || v === void 0) {
        unanswered.push({ condition, forms: candidates });
      }
    }
    return { forms, added, unanswered };
  }
  function medsFromForms(forms) {
    var _a;
    const bag = (forms != null ? forms : {}).medical;
    if (!bag || String((_a = bag.dcy_form) != null ? _a : "") !== "01236") return [];
    const rows = bag.medications;
    if (!Array.isArray(rows)) return [];
    return rows.map((r) => r != null ? r : {}).map((r) => {
      var _a2, _b, _c;
      return { name: String((_a2 = r.name) != null ? _a2 : ""), dosage: String((_b = r.dosage) != null ? _b : ""), time: String((_c = r.time) != null ? _c : "") };
    }).filter((m) => m.name || m.dosage || m.time);
  }
  function applyConsent(base, facts) {
    const has = facts.hasEsignConsent;
    if (has === true) return base.filter((f) => f !== CONSENT);
    if (has === false) return [CONSENT, ...base.filter((f) => f !== CONSENT)];
    return base;
  }
  function planInterview(input) {
    var _a, _b, _c, _d, _e, _f, _g;
    const { dict, registry, baseForms, children, prefill, familyFacts } = input;
    const empty = {
      skipped: false,
      skipReason: null,
      familyQuestions: null,
      rounds: [],
      formsFinal: [],
      unanswered: []
    };
    if (baseForms.includes(DOOR)) {
      return {
        ...empty,
        skipped: true,
        formsFinal: [...baseForms],
        skipReason: `the set contains ${DOOR} \u2014 that form is itself the conversation with a new family`
      };
    }
    const fam = applyConditions(registry, applyConsent(baseForms, familyFacts != null ? familyFacts : {}), familyFacts != null ? familyFacts : {});
    const seen = new Set(fam.forms);
    const rounds = [];
    const answered = /* @__PURE__ */ new Set();
    const unanswered = [];
    const noteUnanswered = (list) => {
      for (const u of list) if (!unanswered.some((x) => x.condition === u.condition)) unanswered.push(u);
    };
    for (const [c] of Object.entries(CONDITION_OF)) {
      if (((_a = CONDITION_OF[c](familyFacts != null ? familyFacts : {})) != null ? _a : null) !== null) answered.add(c);
    }
    noteUnanswered(fam.unanswered);
    for (const c of children) {
      const meds = ((_b = c.meds) != null ? _b : []).filter((m) => {
        var _a2;
        return String((_a2 = m.name) != null ? _a2 : "").trim();
      });
      const facts = c.meds ? { ...(_c = c.facts) != null ? _c : {}, medication: meds.length > 0 } : (_d = c.facts) != null ? _d : {};
      const per = applyConditions(registry, [...fam.forms], facts);
      per.forms.forEach((f) => seen.add(f));
      for (const [cond] of Object.entries(CONDITION_OF)) {
        if (((_e = CONDITION_OF[cond](facts)) != null ? _e : null) !== null) answered.add(cond);
      }
      noteUnanswered(per.unanswered);
      rounds.push({
        key: c.key,
        name: c.name,
        facts,
        answers: null,
        meds,
        addedForms: per.added,
        forms: [.../* @__PURE__ */ new Set([...fam.forms, ...per.added])]
      });
    }
    if (((_f = familyFacts == null ? void 0 : familyFacts.hasEsignConsent) != null ? _f : null) === null) {
      unanswered.push({ condition: "esign_consent", forms: [CONSENT] });
    }
    for (let i = unanswered.length - 1; i >= 0; i--) {
      if (answered.has(unanswered[i].condition)) unanswered.splice(i, 1);
    }
    const formsFinal = [...seen].sort((a, b) => a === CONSENT ? -1 : b === CONSENT ? 1 : 0);
    const q = buildQuestionnaire(dict, formsFinal);
    const sources = children.map((c) => {
      var _a2;
      return { who: c.name, forms: (_a2 = c.prefill) != null ? _a2 : null };
    }).filter((s) => !!s.forms);
    const filled = sources.length ? prefillAcross(q, sources) : prefillQuestionnaire(q, prefill != null ? prefill : null);
    const familyQuestions = {
      ...filled,
      child: [],
      staff: filled.staff,
      counts: countOf({ ...filled, child: [] })
    };
    const blank = prefillQuestionnaire(q, null);
    const ownOf = new Map(children.map((c) => {
      var _a2;
      return [c.key, (_a2 = c.prefill) != null ? _a2 : null];
    }));
    for (const r of rounds) {
      const own = (_g = ownOf.get(r.key)) != null ? _g : null;
      const mine = own ? prefillQuestionnaire(q, own) : blank;
      r.answers = {
        ...mine,
        family: [],
        household: [],
        staff: [],
        counts: countOf({ ...mine, family: [], household: [], staff: [] })
      };
    }
    return { skipped: false, skipReason: null, familyQuestions, rounds, formsFinal, unanswered };
  }
  function countOf(p) {
    const c = { answered: 0, empty: 0, conflict: 0 };
    for (const a of [...p.family, ...p.child, ...p.household, ...p.staff]) c[a.state] += 1;
    return c;
  }
  var FAMILY_LEVEL_FORMS = ["iea", "usda_waiver", CONSENT];
  var MED_PERMISSION = "dcy_01217";
  var CARE_PLAN = "dcy_01236";
  var CARE_PLAN_ROWS = 3;
  function careePlanRows(meds) {
    return meds.slice(0, CARE_PLAN_ROWS).map((m) => ({ name: m.name, dosage: m.dosage, time: m.time }));
  }
  function medPermissionFields(m) {
    const out = {
      medication_name: m.name,
      dosage: m.dosage,
      administration_times: m.time
    };
    if (m.photo) out.pharmacy_label_photo = m.photo;
    return out;
  }
  function planSubmissions(plan, opts) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _i, _j, _k;
    if (plan.skipped || !plan.familyQuestions) return [];
    const out = [];
    const center = (_a = opts == null ? void 0 : opts.centerCode) != null ? _a : null;
    if (!plan.rounds.length) {
      const r = scatterAnswers({ filled: plan.familyQuestions, forms: plan.formsFinal, childKey: null, centerCode: center });
      return plan.formsFinal.map((f) => {
        var _a2, _b2, _c2, _d2;
        return {
          form: f,
          childKey: null,
          formData: (_a2 = r.data[f]) != null ? _a2 : {},
          preset: (_b2 = opts == null ? void 0 : opts.presets) == null ? void 0 : _b2[f],
          priorSubmissionId: (_d2 = (_c2 = opts == null ? void 0 : opts.priorByForm) == null ? void 0 : _c2[f]) != null ? _d2 : null,
          skipped: r.skipped
        };
      });
    }
    const familyForms = plan.formsFinal.filter((f) => FAMILY_LEVEL_FORMS.includes(f));
    if (familyForms.length) {
      const r = scatterAnswers({ filled: plan.familyQuestions, forms: familyForms, childKey: null, centerCode: center });
      for (const f of familyForms) {
        out.push({
          form: f,
          childKey: null,
          formData: (_b = r.data[f]) != null ? _b : {},
          preset: (_c = opts == null ? void 0 : opts.presets) == null ? void 0 : _c[f],
          priorSubmissionId: (_e = (_d = opts == null ? void 0 : opts.priorByForm) == null ? void 0 : _d[f]) != null ? _e : null,
          skipped: r.skipped
        });
      }
    }
    for (const round of plan.rounds) {
      const merged = {
        ...plan.familyQuestions,
        child: (_g = (_f = round.answers) == null ? void 0 : _f.child) != null ? _g : [],
        household: [],
        counts: plan.familyQuestions.counts
      };
      const mine = round.forms.filter((f) => !FAMILY_LEVEL_FORMS.includes(f));
      const r = scatterAnswers({ filled: merged, forms: mine, childKey: round.key, centerCode: center });
      for (const f of mine) {
        if (f === MED_PERMISSION && round.meds.length) {
          round.meds.forEach((m, i) => {
            var _a2, _b2;
            out.push({
              form: f,
              childKey: round.key,
              instance: i,
              formData: { ...(_a2 = r.data[f]) != null ? _a2 : {}, ...medPermissionFields(m) },
              preset: (_b2 = opts == null ? void 0 : opts.presets) == null ? void 0 : _b2[f],
              priorSubmissionId: null,
              skipped: r.skipped
            });
          });
          continue;
        }
        const data = { ...(_h = r.data[f]) != null ? _h : {} };
        if (f === CARE_PLAN && round.meds.length) data.medications = careePlanRows(round.meds);
        out.push({
          form: f,
          childKey: round.key,
          formData: data,
          preset: (_i = opts == null ? void 0 : opts.presets) == null ? void 0 : _i[f],
          priorSubmissionId: (_k = (_j = opts == null ? void 0 : opts.priorByForm) == null ? void 0 : _j[f]) != null ? _k : null,
          skipped: r.skipped
        });
      }
    }
    return out;
  }

  // src/lib/interviewQueue.ts
  var TECH = /* @__PURE__ */ new Set(["center_code", "dcy_form", "dcy_version", "type", "consent_title", "consent_version"]);
  var norm = (v) => String(v != null ? v : "").replace(/\s+/g, " ").trim().toLowerCase();
  function typeOfForm(reg, formKey) {
    var _a;
    const f = (_a = reg.forms) == null ? void 0 : _a[formKey];
    if (f && typeof f === "object") {
      const t = f.submissionType;
      if (typeof t === "string" && t) return t;
    }
    return formKey;
  }
  function sharedTypes(reg) {
    var _a, _b;
    const count = /* @__PURE__ */ new Map();
    for (const k of Object.keys((_a = reg.forms) != null ? _a : {})) {
      const t = typeOfForm(reg, k);
      count.set(t, ((_b = count.get(t)) != null ? _b : 0) + 1);
    }
    return new Set([...count].filter(([, n]) => n > 1).map(([t]) => t));
  }
  function acceptedBag(forms, reg, formKey) {
    var _a, _b;
    const t = typeOfForm(reg, formKey);
    const bag = (forms != null ? forms : {})[t];
    if (!bag) return null;
    if (!sharedTypes(reg).has(t)) return bag;
    const num = (_a = formKey.match(/(\d{4,5})/)) == null ? void 0 : _a[1];
    return num && String((_b = bag.dcy_form) != null ? _b : "") === num ? bag : null;
  }
  function newAnswers(dict, formKey, formData, bag) {
    const meaning = /* @__PURE__ */ new Map();
    for (const r of dict.rows) if (r.form === formKey) meaning.set(r.key, r.canonical);
    const mirrorHas = (key, value) => {
      const canon = meaning.get(key);
      if (!canon) return false;
      for (const [k2, c2] of meaning) {
        if (k2 === key || c2 !== canon) continue;
        const b = bag[k2];
        if (b != null && String(b) !== "" && norm(b) === norm(value)) return true;
      }
      return false;
    };
    const out = [];
    for (const [k, v] of Object.entries(formData)) {
      if (TECH.has(k) || v === "" || v == null) continue;
      const b = bag[k];
      if (b === void 0 || b === null || String(b) === "") {
        if (!mirrorHas(k, v)) out.push(k);
        continue;
      }
      if (norm(b) !== norm(v)) out.push(k);
    }
    return out;
  }
  function rowState(input) {
    var _a;
    if (((_a = input.instanceCount) != null ? _a : 1) > 1) return "todo";
    const bag = acceptedBag(input.childForms, input.registry, input.formKey);
    if (!bag) return "todo";
    return newAnswers(input.dict, input.formKey, input.formData, bag).length ? "updated" : "signed";
  }

  // src/lib/interviewEngineBundle.ts
  var API = {
    buildQuestionnaire,
    questionCount,
    targetsOf,
    DOOR_FORMS,
    prefillQuestionnaire,
    answerFor,
    conflictLine,
    scatterAnswers,
    weekForForm,
    planInterview,
    planSubmissions,
    applyConditions,
    formsForCondition,
    medsFromForms,
    rowState,
    acceptedBag,
    newAnswers,
    typeOfForm
  };
  if (typeof window !== "undefined") window.PAInterview = API;
  var interviewEngineBundle_default = API;
})();
