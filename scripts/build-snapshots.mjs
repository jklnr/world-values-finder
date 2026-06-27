// Regenerates test/fixtures/snapshots.json from the canonical profiles.
//
// Run this ONLY after an intentional change to the dataset or matching logic,
// and eyeball the diff: the whole point of the snapshot test is that country
// rankings must never change by accident.
//
// Run with:  node scripts/build-snapshots.mjs

import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { readFileSync } from "node:fs";
import { rankCountries } from "../src/match.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const PROFILES = JSON.parse(
  readFileSync(resolve(ROOT, "test/fixtures/profiles.json"), "utf8")
).profiles;
const OUT = resolve(ROOT, "test/fixtures/snapshots.json");

const snapshots = {};
for (const [name, answers] of Object.entries(PROFILES)) {
  const ranked = rankCountries(new Map(Object.entries(answers)));
  snapshots[name] = {
    top5: ranked.slice(0, 5).map((c) => c.iso3),
    bottom5: ranked.slice(-5).map((c) => c.iso3),
    topMatch: Math.round(ranked[0].match),
  };
}

await writeFile(OUT, JSON.stringify(snapshots, null, 2) + "\n");
console.log("Wrote", OUT);
console.log(JSON.stringify(snapshots, null, 2));
