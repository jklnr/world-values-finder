// Question-predictiveness engine.
//
// Orders the survey questions by how well a small subset reproduces the
// full-survey country result. Ground truth requires no generative model: the
// countries in src/data/wvs.json ARE the respondents.
//
// Subtlety that drives the design: if a country answers as *itself* with zero
// error, it trivially matches itself on any single question, so exact-profile
// top-1 recovery is a useless (always-1.0) objective. The meaningful question
// is robustness: a user who answers *approximately* like a country should
// still be matched to it. So respondents include noisy draws around each
// country, every respondent's TARGET is its source country, and predictiveness
// measures how well a subset recovers the source under perturbation (plus how
// well it reproduces the full ranking, via Kendall tau).
//
// All scoring goes through a pluggable metric (see metrics.js); nothing here is
// MSE-specific, so the matching notion can be swapped later. Greedy selection
// uses a fast incremental path for "additive" metrics (per-question cost,
// averaged); other metrics fall back automatically to the generic ranker.

import data from "../data/wvs.json" with { type: "json" };
import { mseMetric, comparator } from "./metrics.js";

export const COUNTRIES = data.countries;
export const ALL_CODES = data.questions.map((q) => q.code);
const N = COUNTRIES.length;
const COUNTRY_INDEX = new Map(COUNTRIES.map((c, i) => [c.iso3, i]));

// Normalized values of every legal answer for each question (e.g. a 1-4 scale
// -> [0, 1/3, 2/3, 1]). Used to simulate respondents who pick real options.
const LEGAL_NORM = new Map(
  data.questions.map((q) => {
    const vals = [];
    for (let v = q.min; v <= q.max; v++) vals.push((v - q.min) / (q.max - q.min));
    return [q.code, vals];
  })
);

// Default respondent population for analysis: each country plus a few noisy
// copies, so robustness (not trivial self-recovery) is what gets rewarded.
export const DEFAULT_NOISE = { noise: 0.06, draws: 5, seed: 1 };

// ---------------------------------------------------------------------------
// Respondents
// ---------------------------------------------------------------------------

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);

// Snap a normalized value to the nearest legal (selectable) answer for a
// question -- i.e. the closest a real user, who must pick an option, can get.
export function snapToLegal(code, value) {
  const vals = LEGAL_NORM.get(code);
  if (!vals) return value;
  let best = vals[0];
  let bd = Infinity;
  for (const v of vals) {
    const d = Math.abs(v - value);
    if (d < bd) {
      bd = d;
      best = v;
    }
  }
  return best;
}

// Simulated respondents who answer every question with a random legal option,
// independently per question. This deliberately does NOT assume people lie on
// the country manifold: real individuals mix traits freely (devout on religion
// but liberal on gender, etc.), so question redundancy is judged across the
// whole answer space rather than across the 66 correlated national averages.
// Each respondent's target is whatever country the FULL survey matches it to
// (set in buildContexts), i.e. the result a short survey must reproduce.
export function buildRandomRespondents({ count = 500, seed = 1 } = {}) {
  const rng = mulberry32(seed);
  const respondents = [];
  for (let i = 0; i < count; i++) {
    const answers = new Map();
    for (const code of ALL_CODES) {
      const vals = LEGAL_NORM.get(code);
      answers.set(code, vals[Math.floor(rng() * vals.length)]);
    }
    respondents.push({ id: `R${i + 1}`, source: null, answers });
  }
  return respondents;
}

// One respondent per country (answering as itself), plus `draws` Gaussian-
// jittered copies when `noise > 0`. Every respondent records its `source`
// country -- the answer the subset is supposed to recover.
export function buildRespondents({ noise = 0, draws = 0, seed = 1 } = {}) {
  const rng = mulberry32(seed);
  const gauss = () => {
    const u = Math.max(rng(), 1e-12);
    const v = rng();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };

  const respondents = [];
  for (const c of COUNTRIES) {
    respondents.push({ id: c.iso3, source: c.iso3, answers: new Map(Object.entries(c.values)) });
    for (let d = 0; d < draws && noise > 0; d++) {
      const jittered = new Map();
      for (const [code, v] of Object.entries(c.values)) {
        jittered.set(code, clamp01(v + noise * gauss()));
      }
      respondents.push({ id: `${c.iso3}#${d + 1}`, source: c.iso3, answers: jittered });
    }
  }
  return respondents;
}

// ---------------------------------------------------------------------------
// Generic ranking (used for the curve, adaptive mode, and as the slow path)
// ---------------------------------------------------------------------------

// Rank all countries for one answer profile using only `codes`. `answers` is a
// Map<code, normalizedValue>. Best country first. Mirrors src/match.js: skip
// questions a country lacks; no overlap -> worst aggregate. Ties keep dataset
// order (stable), matching match.js.
export function rankByCodes(answers, codes, metric = mseMetric) {
  const cmp = comparator(metric);
  const scored = COUNTRIES.map((c) => {
    const costs = [];
    for (const code of codes) {
      if (!answers.has(code)) continue;
      const cv = c.values[code];
      if (cv === undefined) continue;
      costs.push(metric.cost(answers.get(code), cv));
    }
    return { id: c.iso3, score: metric.aggregate(costs) };
  });
  scored.sort((a, b) => cmp(a.score, b.score));
  return scored.map((s) => s.id);
}

// ---------------------------------------------------------------------------
// Contexts + metrics
// ---------------------------------------------------------------------------

// Per respondent: the full-survey result it should reproduce (ordering + the
// per-country score vector), its target (source) country, and a precomputed
// per-country cost row for fast greedy.
export function buildContexts(respondents, metric = mseMetric) {
  const cmp = comparator(metric);
  return respondents.map((r) => {
    const costByCountry = COUNTRIES.map((c) => {
      const row = new Map();
      for (const code of ALL_CODES) {
        if (!r.answers.has(code)) continue;
        const cv = c.values[code];
        if (cv === undefined) continue;
        row.set(code, metric.cost(r.answers.get(code), cv));
      }
      return row;
    });
    const fullScores = new Float64Array(N);
    for (let k = 0; k < N; k++) {
      const costs = [...costByCountry[k].values()];
      fullScores[k] = metric.aggregate(costs);
    }
    const fullOrder = COUNTRIES.map((c, i) => i)
      .sort((a, b) => cmp(fullScores[a], fullScores[b]))
      .map((i) => COUNTRIES[i].iso3);
    // Target = the source country when the respondent is a country, otherwise
    // (random/simulated respondents) the country the full survey matches it to.
    const targetIdx =
      r.source != null && COUNTRY_INDEX.has(r.source)
        ? COUNTRY_INDEX.get(r.source)
        : COUNTRY_INDEX.get(fullOrder[0]);
    return {
      id: r.id,
      source: r.source,
      answers: r.answers,
      targetIdx,
      fullOrder,
      fullTop5: new Set(fullOrder.slice(0, 5)),
      fullScores,
      costByCountry,
    };
  });
}

// Pearson correlation between two equal-length numeric arrays.
function pearson(a, b) {
  let ma = 0;
  let mb = 0;
  for (let i = 0; i < a.length; i++) {
    ma += a[i];
    mb += b[i];
  }
  ma /= a.length;
  mb /= b.length;
  let cov = 0;
  let va = 0;
  let vb = 0;
  for (let i = 0; i < a.length; i++) {
    const da = a[i] - ma;
    const db = b[i] - mb;
    cov += da * db;
    va += da * da;
    vb += db * db;
  }
  if (va === 0 || vb === 0) return 0;
  return cov / Math.sqrt(va * vb);
}

export function kendallTau(orderA, orderB) {
  const n = orderA.length;
  if (n < 2) return 1;
  const rankB = new Map(orderB.map((id, i) => [id, i]));
  let concordant = 0;
  let discordant = 0;
  for (let i = 0; i < n; i++) {
    const bi = rankB.get(orderA[i]);
    for (let j = i + 1; j < n; j++) {
      if (rankB.get(orderA[j]) > bi) concordant++;
      else discordant++;
    }
  }
  return (concordant - discordant) / ((n * (n - 1)) / 2);
}

// 0-based rank of the target country given a score array, with stable tie
// handling (dataset order) so it matches rankByCodes.
function targetRank(scores, targetIdx, lowerIsBetter) {
  const ts = scores[targetIdx];
  let rank = 0;
  for (let i = 0; i < scores.length; i++) {
    if (i === targetIdx) continue;
    const better = lowerIsBetter ? scores[i] < ts : scores[i] > ts;
    if (better || (scores[i] === ts && i < targetIdx)) rank++;
  }
  return rank;
}

// Full predictiveness report for a code subset (used for the accuracy curve).
//   hitScore: mean (N-1-rankOfTarget)/(N-1)  (1.0 = target ranked first)
//   top1:     fraction of respondents whose source country ranks first
//   top5:     mean overlap of subset top-5 with full-survey top-5
//   tau:      mean Kendall tau between subset ranking and full ranking
export function predictiveness(codes, contexts, metric = mseMetric) {
  let hit = 0;
  let top1 = 0;
  let top5 = 0;
  let tau = 0;
  for (const ctx of contexts) {
    const order = rankByCodes(ctx.answers, codes, metric);
    const rank = order.indexOf(COUNTRIES[ctx.targetIdx].iso3);
    hit += (N - 1 - rank) / (N - 1);
    if (rank === 0) top1 += 1;
    let overlap = 0;
    for (const id of order.slice(0, 5)) if (ctx.fullTop5.has(id)) overlap++;
    top5 += overlap / 5;
    tau += kendallTau(order, ctx.fullOrder);
  }
  const m = contexts.length;
  return { hitScore: hit / m, top1: top1 / m, top5: top5 / m, tau: tau / m };
}

// ---------------------------------------------------------------------------
// Greedy ordering (fast incremental path for additive metrics)
// ---------------------------------------------------------------------------

// Greedy forward selection: repeatedly add the question that most improves the
// objective. Primary objective is mean hitScore (recover each respondent's
// source country); since that saturates once ~a handful of questions identify
// the country, a small fidelity term (correlation of the running score vector
// to the full-survey score vector) breaks ties so the remaining questions are
// still ordered by how much they refine the overall result. Accounts for
// redundancy (e.g. several religiosity items); ties broken by code order.
const FIDELITY_WEIGHT = 0.1;

export function greedyOrder(metric = mseMetric, { respondents } = {}) {
  const reps = respondents ?? buildRandomRespondents({ count: 500, seed: 1 });
  const contexts = buildContexts(reps, metric);
  const lowerIsBetter = metric.lowerIsBetter;

  // Running accumulators of the chosen set's per-country cost sum/count.
  const sum = contexts.map(() => new Float64Array(N));
  const count = contexts.map(() => new Int32Array(N));
  const scores = new Float64Array(N);

  const evalObjective = (candidate) => {
    let acc = 0;
    for (let ci = 0; ci < contexts.length; ci++) {
      const ctx = contexts[ci];
      const rows = ctx.costByCountry;
      const s = sum[ci];
      const c = count[ci];
      for (let k = 0; k < N; k++) {
        const has = rows[k].has(candidate);
        const cnt = c[k] + (has ? 1 : 0);
        scores[k] = cnt > 0 ? (s[k] + (has ? rows[k].get(candidate) : 0)) / cnt : 1;
      }
      const rank = targetRank(scores, ctx.targetIdx, lowerIsBetter);
      const fidelity = pearson(scores, ctx.fullScores); // 1.0 when ranking matches full
      acc += (N - 1 - rank) / (N - 1) + FIDELITY_WEIGHT * fidelity;
    }
    return acc / contexts.length;
  };

  const remaining = new Set(ALL_CODES);
  const chosen = [];
  const order = [];
  const curve = [];
  let prev = 0;

  while (remaining.size > 0) {
    let best = null;
    let bestScore = -Infinity;
    for (const code of ALL_CODES) {
      if (!remaining.has(code)) continue;
      const score = evalObjective(code);
      if (score > bestScore + 1e-12) {
        bestScore = score;
        best = code;
      }
    }
    // Commit the winner into the accumulators.
    for (let ci = 0; ci < contexts.length; ci++) {
      const rows = contexts[ci].costByCountry;
      for (let k = 0; k < N; k++) {
        if (rows[k].has(best)) {
          sum[ci][k] += rows[k].get(best);
          count[ci][k] += 1;
        }
      }
    }
    chosen.push(best);
    remaining.delete(best);
    order.push({ code: best, cumulative: bestScore, marginalGain: bestScore - prev });
    prev = bestScore;
    curve.push({ k: chosen.length, ...predictiveness(chosen, contexts, metric) });
  }

  return { order, curve };
}

// Smallest prefix length whose top-1 recovery reaches `target`.
export function suggestCutoff(curve, target = 0.9) {
  const hit = curve.find((c) => c.top1 >= target);
  return hit ? hit.k : curve.length;
}

// ---------------------------------------------------------------------------
// Adaptive next-question selection
// ---------------------------------------------------------------------------

// Given answers so far (Map<code, normalizedValue>), rank remaining questions
// by how much each would further pin down the user's country. Hypotheses are
// the countries currently most consistent with the answers (all countries when
// nothing is answered yet); a question's value is its marginal improvement at
// telling those hypotheses apart.
export function nextBest(answersSoFar, metric = mseMetric, { topM = 12 } = {}) {
  const answeredCodes = ALL_CODES.filter((c) => answersSoFar.has(c));
  const remaining = ALL_CODES.filter((c) => !answersSoFar.has(c));

  const hypothesisIds =
    answeredCodes.length === 0
      ? COUNTRIES.map((c) => c.iso3)
      : rankByCodes(answersSoFar, answeredCodes, metric).slice(0, topM);

  const idToCountry = new Map(COUNTRIES.map((c) => [c.iso3, c]));
  const hypotheses = hypothesisIds.map((id) => ({
    id,
    source: id,
    answers: new Map(Object.entries(idToCountry.get(id).values)),
  }));
  const contexts = buildContexts(hypotheses, metric);

  const meanHit = (codes) => {
    let acc = 0;
    for (const ctx of contexts) {
      const order = rankByCodes(ctx.answers, codes, metric);
      const rank = order.indexOf(COUNTRIES[ctx.targetIdx].iso3);
      acc += (N - 1 - rank) / (N - 1);
    }
    return acc / contexts.length;
  };

  const base = meanHit(answeredCodes);
  const ranked = remaining.map((code) => ({
    code,
    gain: meanHit([...answeredCodes, code]) - base,
  }));
  ranked.sort((a, b) => b.gain - a.gain);
  return ranked;
}
