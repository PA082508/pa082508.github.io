/* interview-engine.js — СОБРАНО, НЕ НАПИСАНО РУКАМИ.
 * Источник: src/lib/interviewQuestions.ts, src/lib/interviewPrefill.ts, src/lib/interviewScatter.ts, src/lib/interviewFlow.ts, src/lib/interviewEngineBundle.ts
 * Отпечаток источников: b403fca606f759b7
 * Правка этого файла бессмысленна: он пересобирается из модулей приложения,
 * и страж сборки роняет гейт, если файл разошёлся с источником.
 */
"use strict";
(() => {
  // src/lib/interviewQuestions.ts
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
    const byCanon = /* @__PURE__ */ new Map();
    for (const r of dict.rows) {
      if (!set.includes(r.form)) continue;
      const q = byCanon.get(r.canonical);
      if (q) {
        q.targets.push({ form: r.form, key: r.key });
        continue;
      }
      const declared = (_a = dict.canonicals) == null ? void 0 : _a[r.canonical];
      byCanon.set(r.canonical, {
        canonical: r.canonical,
        level: (_b = declared == null ? void 0 : declared.level) != null ? _b : r.level,
        // ⭐ Канонический формат, когда источники расходятся; иначе — форма источника.
        format: (_c = declared == null ? void 0 : declared.canonicalFormat) != null ? _c : r.format,
        targets: [{ form: r.form, key: r.key }]
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
  function answerFor(q, forms) {
    if (q.level === "household") {
      return { ...q, state: "empty", value: null, found: [] };
    }
    const found = [];
    for (const t of q.targets) {
      const fd = forms[t.form];
      if (!fd) continue;
      const v = txt(fd[t.key]);
      if (!v) continue;
      found.push({ form: t.form, key: t.key, value: v });
    }
    const distinct = [...new Set(found.map((f) => f.value))];
    if (distinct.length === 0) return { ...q, state: "empty", value: null, found: [] };
    if (distinct.length === 1) return { ...q, state: "answered", value: distinct[0], found };
    return { ...q, state: "conflict", value: null, found };
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
    if (a.state !== "conflict") return null;
    const parts = a.found.map((f) => `"${f.value}" (from ${f.form})`);
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
    var _a, _b;
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
          put(t.form, t.key, q.value);
        }
      }
    }
    if (centerCode) {
      for (const f of forms) {
        if (CENTER_NAME_ONLY.includes(f)) continue;
        ((_b = data[f]) != null ? _b : data[f] = {}).center_code = centerCode;
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
  function applyConsent(base, facts) {
    const has = facts.hasEsignConsent;
    if (has === true) return base.filter((f) => f !== CONSENT);
    if (has === false) return [CONSENT, ...base.filter((f) => f !== CONSENT)];
    return base;
  }
  function planInterview(input) {
    var _a, _b, _c, _d, _e, _f;
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
      const per = applyConditions(registry, [...fam.forms], (_b = c.facts) != null ? _b : {});
      per.forms.forEach((f) => seen.add(f));
      for (const [cond] of Object.entries(CONDITION_OF)) {
        if (((_d = CONDITION_OF[cond]((_c = c.facts) != null ? _c : {})) != null ? _d : null) !== null) answered.add(cond);
      }
      noteUnanswered(per.unanswered);
      rounds.push({
        key: c.key,
        name: c.name,
        facts: (_e = c.facts) != null ? _e : {},
        answers: null,
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
    const filled = prefillQuestionnaire(q, prefill != null ? prefill : null);
    const familyQuestions = {
      ...filled,
      child: [],
      staff: filled.staff,
      counts: countOf({ ...filled, child: [] })
    };
    for (const r of rounds) {
      r.answers = { ...filled, family: [], household: [], staff: [], counts: countOf({ ...filled, family: [], household: [], staff: [] }) };
    }
    return { skipped: false, skipReason: null, familyQuestions, rounds, formsFinal, unanswered };
  }
  function countOf(p) {
    const c = { answered: 0, empty: 0, conflict: 0 };
    for (const a of [...p.family, ...p.child, ...p.household, ...p.staff]) c[a.state] += 1;
    return c;
  }
  var FAMILY_LEVEL_FORMS = ["iea", "usda_waiver", CONSENT];
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
        out.push({
          form: f,
          childKey: round.key,
          formData: (_h = r.data[f]) != null ? _h : {},
          preset: (_i = opts == null ? void 0 : opts.presets) == null ? void 0 : _i[f],
          priorSubmissionId: (_k = (_j = opts == null ? void 0 : opts.priorByForm) == null ? void 0 : _j[f]) != null ? _k : null,
          skipped: r.skipped
        });
      }
    }
    return out;
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
    formsForCondition
  };
  if (typeof window !== "undefined") window.PAInterview = API;
  var interviewEngineBundle_default = API;
})();
