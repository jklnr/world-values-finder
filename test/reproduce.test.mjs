// Proves the committed dataset is reproducible from code: re-run the actual
// aggregation pipeline (scripts/build-data.mjs) against the cached raw WVS CSV
// and assert it deep-equals the committed src/data/wvs.json, byte-for-byte once
// serialized. Guarantees nobody hand-edited the data and that the generator
// stays in sync with what ships.
//
// Skips when the ~180MB CSV cache is absent (run `npm run data` first).

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { aggregate, buildOutput, CSV_PATH } from "../scripts/build-data.mjs";
import { loadJSON } from "./helpers.mjs";

test("committed wvs.json is exactly reproducible from build-data.mjs + raw CSV", { timeout: 180000 }, async (t) => {
  if (!existsSync(CSV_PATH)) {
    t.skip("raw CSV cache not present (run `npm run data` first)");
    return;
  }
  const regenerated = buildOutput(await aggregate());
  const committed = loadJSON("src/data/wvs.json");

  // Structural equality (key order independent).
  assert.deepEqual(regenerated, committed);
  // And identical once serialized the way the script writes it.
  assert.equal(JSON.stringify(regenerated, null, 0), JSON.stringify(committed, null, 0));
});
