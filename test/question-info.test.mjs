// Tests for the question-predictiveness engine (src/analysis/*).

import test from "node:test";
import assert from "node:assert/strict";
import {
  ALL_CODES,
  COUNTRIES,
  buildRespondents,
  buildRandomRespondents,
  buildContexts,
  rankByCodes,
  predictiveness,
  greedyOrder,
  nextBest,
} from "../src/analysis/question-info.js";
import { mseMetric, maeMetric } from "../src/analysis/metrics.js";
import { rankCountries, normalizeAnswer } from "../src/match.js";
import { loadJSON } from "./helpers.mjs";

const data = loadJSON("src/data/wvs.json");
const N = COUNTRIES.length;

// Shared, modest respondent set so the greedy run stays fast but non-trivial.
const reps = buildRespondents({ noise: 0.05, draws: 3, seed: 1 });
const result = greedyOrder(mseMetric, { respondents: reps });

test("ALL_CODES matches the dataset and rankByCodes ranks every country", () => {
  assert.equal(ALL_CODES.length, data.questions.length);
  assert.deepEqual(new Set(ALL_CODES), new Set(data.questions.map((q) => q.code)));
  const order = rankByCodes(new Map([["Q164", 1]]), ["Q164"], mseMetric);
  assert.equal(order.length, N);
  assert.equal(new Set(order).size, N);
});

test("analysis ranking is consistent with src/match.js rankCountries", () => {
  const cases = [
    new Map(ALL_CODES.map((c) => [c, midRaw(c)])),
    new Map([["Q164", 10], ["Q6", 1], ["Q182", 1], ["Q195", 8], ["Q22", 1]]),
    new Map([["Q1", 1], ["Q57", 1], ["Q240", 3], ["Q250", 9], ["Q209", 1]]),
  ];
  for (const raw of cases) {
    const codes = [...raw.keys()];
    const norm = new Map(codes.map((c) => [c, normalizeAnswer(c, raw.get(c))]));
    const mine = rankByCodes(norm, codes, mseMetric);
    const theirs = rankCountries(raw).map((c) => c.iso3);
    // match.js drops zero-overlap countries; compare on the common set, in order.
    const kept = new Set(theirs);
    assert.deepEqual(mine.filter((id) => kept.has(id)), theirs);
  }
});

function midRaw(code) {
  const q = data.questions.find((x) => x.code === code);
  return Math.round((q.min + q.max) / 2);
}

test("greedy order covers every question exactly once and is deterministic", () => {
  const codes = result.order.map((o) => o.code);
  assert.equal(codes.length, ALL_CODES.length);
  assert.deepEqual(new Set(codes), new Set(ALL_CODES));
  const again = greedyOrder(mseMetric, { respondents: reps });
  assert.deepEqual(again.order.map((o) => o.code), codes);
});

test("greedy composite objective is non-decreasing (each added question helps or holds)", () => {
  for (let i = 1; i < result.order.length; i++) {
    assert.ok(
      result.order[i].cumulative >= result.order[i - 1].cumulative - 1e-9,
      `objective dropped at step ${i + 1}`
    );
  }
});

test("accuracy improves with more questions and the full set reproduces itself", () => {
  const { curve } = result;
  // Few questions already recover most respondents' country; many beats few.
  assert.ok(curve[curve.length - 1].top1 > curve[0].top1 + 0.3);
  assert.ok(curve[curve.length - 1].tau > curve[0].tau);
  const full = curve[curve.length - 1];
  assert.ok(Math.abs(full.top1 - 1) < 1e-9, "full set should recover every source country");
  assert.ok(Math.abs(full.top5 - 1) < 1e-9, "full set should reproduce its own top-5");
  // ~1 (not exactly: the curve ranks over codes in greedy order while fullOrder
  // sums in dataset order, so near-tied countries can flip negligibly).
  assert.ok(full.tau > 0.999, "full set should reproduce its own ranking");
});

test("on exact (noise-free) profiles, the full survey ranks each country first", () => {
  const pure = buildContexts(buildRespondents(), mseMetric);
  const report = predictiveness(ALL_CODES, pure, mseMetric);
  assert.ok(Math.abs(report.top1 - 1) < 1e-9);
});

test("engine is metric-agnostic: a different metric still produces a full ordering", () => {
  const small = buildRespondents({ noise: 0.05, draws: 1, seed: 7 });
  const mae = greedyOrder(maeMetric, { respondents: small });
  assert.equal(mae.order.length, ALL_CODES.length);
  assert.deepEqual(new Set(mae.order.map((o) => o.code)), new Set(ALL_CODES));
  assert.ok(mae.curve[mae.curve.length - 1].tau > 0.999);
});

test("random respondents answer every question and are seed-deterministic", () => {
  const a = buildRandomRespondents({ count: 20, seed: 42 });
  const b = buildRandomRespondents({ count: 20, seed: 42 });
  assert.equal(a.length, 20);
  for (let i = 0; i < a.length; i++) {
    assert.equal(a[i].source, null);
    assert.equal(a[i].answers.size, ALL_CODES.length);
    assert.deepEqual([...a[i].answers.entries()], [...b[i].answers.entries()]);
    for (const v of a[i].answers.values()) assert.ok(v >= 0 && v <= 1);
  }
});

test("with random respondents, the target is the full-survey winner and the full set recovers it", () => {
  const reps = buildRandomRespondents({ count: 80, seed: 3 });
  const contexts = buildContexts(reps, mseMetric);
  // Target index is the respondent's own full-survey top match.
  for (const ctx of contexts) {
    assert.equal(COUNTRIES[ctx.targetIdx].iso3, ctx.fullOrder[0]);
  }
  const full = predictiveness(ALL_CODES, contexts, mseMetric);
  assert.ok(full.top1 > 0.999, "full set must reproduce each respondent's own winner");
  // A single question recovers far fewer (off-manifold respondents are hard).
  const one = predictiveness([ALL_CODES[0]], contexts, mseMetric);
  assert.ok(one.top1 < 0.5);
});

test("nextBest ranks remaining questions by descending marginal gain", () => {
  // Empty answers: every question is a candidate.
  const fromScratch = nextBest(new Map(), mseMetric);
  assert.equal(fromScratch.length, ALL_CODES.length);
  for (let i = 1; i < fromScratch.length; i++) {
    assert.ok(fromScratch[i].gain <= fromScratch[i - 1].gain + 1e-9);
  }
  // After some answers: only unanswered questions remain.
  const answered = new Map([
    ["Q164", normalizeAnswer("Q164", 9)],
    ["Q182", normalizeAnswer("Q182", 2)],
  ]);
  const next = nextBest(answered, mseMetric, { topM: 10 });
  assert.equal(next.length, ALL_CODES.length - 2);
  assert.ok(!next.some((r) => r.code === "Q164" || r.code === "Q182"));
});
