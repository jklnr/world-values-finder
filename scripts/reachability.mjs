// Runs N random users through the full matching gauntlet and reports which
// countries ever come up as the #1 match -- i.e. whether every country is
// reachable as a top result, or whether some are "unreachable" (their profile
// is always dominated by a neighbour, given the questions + MSE).
//
//   npm run analyze:reachability
//   node scripts/reachability.mjs --count=200000 --seed=1 --metric=mse
//
// Two diagnostics:
//   1. Random gauntlet: empirical #1 distribution over N uniform-random users.
//      A country with zero hits has a vanishingly small (or empty) basin.
//   2. Self-recovery probe: does answering as close to a country's profile as
//      the options allow return that country? Failing means its profile is
//      nearly a duplicate of a neighbour (e.g. Macau vs Hong Kong). This is NOT
//      a reachability claim -- a country can fail self-recovery yet still own a
//      large basin (Macau does). The random gauntlet is the reachability test.

import {
  COUNTRIES,
  ALL_CODES,
  rankByCodes,
  buildRandomRespondents,
  snapToLegal,
} from "../src/analysis/question-info.js";
import { mseMetric, maeMetric } from "../src/analysis/metrics.js";

function getFlag(name, fallback) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

const count = Number(getFlag("count", 100000));
const seedBase = Number(getFlag("seed", 1));
const metric = getFlag("metric", "mse") === "mae" ? maeMetric : mseMetric;

const NAME = new Map(COUNTRIES.map((c) => [c.iso3, c]));
const top1Counts = new Map(COUNTRIES.map((c) => [c.iso3, 0]));

// Stream users in batches so we never hold N answer-vectors in memory at once.
const BATCH = 5000;
let done = 0;
let batch = 0;
const t0 = Date.now();
while (done < count) {
  const n = Math.min(BATCH, count - done);
  const users = buildRandomRespondents({ count: n, seed: seedBase + batch });
  for (const u of users) {
    const winner = rankByCodes(u.answers, ALL_CODES, metric)[0];
    top1Counts.set(winner, top1Counts.get(winner) + 1);
  }
  done += n;
  batch += 1;
}
const elapsed = Date.now() - t0;

// Self-recovery probe: does each country win when a user answers as close to
// its profile as the discrete options allow? Failing => its profile is a near
// duplicate of the listed neighbour. (Not a reachability test; see header.)
const notRecovered = [];
for (const c of COUNTRIES) {
  const best = new Map(
    Object.entries(c.values).map(([code, v]) => [code, snapToLegal(code, v)])
  );
  const winner = rankByCodes(best, ALL_CODES, metric)[0];
  if (winner !== c.iso3) notRecovered.push({ iso3: c.iso3, by: winner });
}

const ranked = [...top1Counts.entries()]
  .map(([iso3, n]) => ({ iso3, n, pct: (100 * n) / count }))
  .sort((a, b) => b.n - a.n);

const reached = ranked.filter((r) => r.n > 0);
const never = ranked.filter((r) => r.n === 0);
const nameOf = (iso3) => (NAME.get(iso3)?.name ?? iso3);

console.log(
  `\nReachability gauntlet  (metric=${metric.name}, users=${count}, ${elapsed}ms)\n`
);
console.log(`Countries reachable as #1: ${reached.length} / ${COUNTRIES.length}`);
console.log(`Never the top match:       ${never.length}`);

if (never.length) {
  console.log("\nNever #1 in this sample:");
  for (const r of never) {
    console.log(
      `  ${r.iso3.padEnd(4)} ${nameOf(r.iso3).padEnd(22)} basin too small to hit in ${count} draws`
    );
  }
}

console.log("\nTop-match distribution (most reachable first):");
console.log("  rank  count    pct   country");
ranked.forEach((r, i) => {
  console.log(
    `${String(i + 1).padStart(5)}  ${String(r.n).padStart(6)}  ${r.pct.toFixed(2).padStart(6)}  ${NAME.get(r.iso3)?.flag ?? ""} ${nameOf(r.iso3)}`
  );
});

console.log(
  `\nProfile near-duplicates (fail self-recovery; NOT unreachable): ${notRecovered.length}`
);
for (const d of notRecovered) {
  console.log(`  ${d.iso3.padEnd(4)} ${nameOf(d.iso3).padEnd(22)} ~ ${nameOf(d.by)}`);
}
console.log();
