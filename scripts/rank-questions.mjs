// Orders the survey questions by predictiveness of the full-survey country
// result and prints the accuracy-vs-length curve. See
// src/analysis/question-info.js for the methodology.
//
//   npm run analyze:questions                  # default (MSE, 1000 random respondents)
//   node scripts/rank-questions.mjs --count=2000 --seed=3
//   node scripts/rank-questions.mjs --metric=mae
//   node scripts/rank-questions.mjs --write     # also emit src/data/question-order.json

import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { QUESTIONS } from "../src/survey.js";
import {
  greedyOrder,
  buildRandomRespondents,
  suggestCutoff,
} from "../src/analysis/question-info.js";
import { mseMetric, maeMetric } from "../src/analysis/metrics.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

function getFlag(name, fallback) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}
const hasFlag = (name) => process.argv.includes(`--${name}`);

const metric = getFlag("metric", "mse") === "mae" ? maeMetric : mseMetric;
const count = Number(getFlag("count", 1000));
const seed = Number(getFlag("seed", 1));
const target = Number(getFlag("target", 0.9));

const PROMPT = new Map(QUESTIONS.map((q) => [q.code, q]));
const label = (code) => {
  const q = PROMPT.get(code);
  return q ? `${q.category} :: ${q.text}` : "(unknown)";
};

const respondents = buildRandomRespondents({ count, seed });
const t0 = Date.now();
const { order, curve } = greedyOrder(metric, { respondents });
const elapsed = Date.now() - t0;

const pct = (x) => (x * 100).toFixed(1).padStart(5);

console.log(
  `\nQuestion predictiveness order  (metric=${metric.name}, random respondents=${respondents.length}, seed=${seed}, ${elapsed}ms)`
);
console.log(
  "Respondents answer each question independently at random; their target is the\n" +
    "country the full survey matches them to. Greedy by target recovery, with a\n" +
    "full-ranking-fidelity tiebreaker.\n"
);
// order[i] corresponds to the prefix of length i+1, i.e. curve[i].
console.log("  #  code   top1@k  tau@k   question");
order.forEach((o, i) => {
  const c = curve[i];
  console.log(
    `${String(i + 1).padStart(3)}  ${o.code.padEnd(5)}  ${pct(c.top1)}  ${c.tau.toFixed(3).padStart(6)}  ${label(o.code).slice(0, 70)}`
  );
});

console.log("\nAccuracy vs. number of questions asked:");
console.log("  k   hitScore   top1    top5     tau");
for (const c of curve) {
  console.log(
    `${String(c.k).padStart(3)}    ${pct(c.hitScore)}   ${pct(c.top1)}   ${pct(c.top5)}   ${c.tau.toFixed(3).padStart(6)}`
  );
}

const cutoff = suggestCutoff(curve, target);
console.log(
  `\nSuggested cutoff: ${cutoff} questions reach ${(target * 100).toFixed(0)}% top-1 recovery ` +
    `(of ${order.length} total).\n`
);

if (hasFlag("write")) {
  const OUT = resolve(ROOT, "src/data/question-order.json");
  await writeFile(
    OUT,
    JSON.stringify(
      {
        generatedBy: "scripts/rank-questions.mjs",
        metric: metric.name,
        respondents: respondents.length,
        respondentModel: "random",
        seed,
        order: order.map((o) => o.code),
        cutoff90: suggestCutoff(curve, 0.9),
        curve,
      },
      null,
      1
    ) + "\n"
  );
  console.log(`Wrote ${OUT}\n`);
}
