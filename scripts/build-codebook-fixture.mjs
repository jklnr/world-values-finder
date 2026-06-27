// Builds test/fixtures/codebook.json: an independently sourced extract of the
// official WVS-7 codebook (variable labels, card text, and value labels).
//
// The tests use this fixture as ground truth to verify that every survey item
// in src/survey.js is keyed to the right WVS variable -- the failure mode we
// once shipped (e.g. "euthanasia" keyed to Q186, which is actually "sex
// before marriage").
//
// Source: the WorldValuesBench project's machine-readable transcription of
// the official WVS-7 codebook (github.com/Demon702/WorldValuesBench). It is a
// third-party transcription of the official document, but crucially it is
// *independent* of this repo's hand-typed mapping, so agreement is meaningful.
//
// Run with:  node scripts/build-codebook-fixture.mjs

import { mkdirSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const OUT_PATH = resolve(ROOT, "test/fixtures/codebook.json");
const SOURCE_URL =
  "https://raw.githubusercontent.com/Demon702/WorldValuesBench/main/dataset_construction/codebook.json";

const res = await fetch(SOURCE_URL);
if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`);
const codebook = await res.json();

// Keep every Q-numbered substantive variable (Q1, Q33_3, Q82_EU, ...) so the
// tests can check our keying not just against the assigned variable but
// against every variable we *could* have keyed to.
const variables = {};
for (const [code, entry] of Object.entries(codebook)) {
  if (!/^Q\d+/.test(code)) continue;
  variables[code] = {
    label: entry.question ?? "",
    instruction: entry.question_instruction ?? "",
    choices: entry.choices ?? {},
  };
}

mkdirSync(dirname(OUT_PATH), { recursive: true });
await writeFile(
  OUT_PATH,
  JSON.stringify({ source: SOURCE_URL, retrieved: new Date().toISOString().slice(0, 10), variables }, null, 1)
);
console.log(`Wrote ${Object.keys(variables).length} variables to ${OUT_PATH}`);
