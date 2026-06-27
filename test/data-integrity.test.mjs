// Structural consistency between the survey definition (src/survey.js), the
// bundled dataset (src/data/wvs.json), and -- when the raw WVS CSV cache is
// present -- the actual response scales observed in the microdata.

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { resolve } from "node:path";
import { QUESTIONS } from "../src/survey.js";
import { loadJSON, ROOT } from "./helpers.mjs";

const data = loadJSON("src/data/wvs.json");
const dataQ = new Map(data.questions.map((q) => [q.code, q]));

// Derived items: stored values are constructed shares, not raw-scale means.
const DERIVED = new Set();
// Codes where the raw data legitimately contains substantive values outside
// the declared range that the build intentionally drops (codebook-verified):
// Q111 has 3 = "Other answer"; Q254 has 5 = "I am not [nationality]".
const RANGE_EXCEPTIONS = new Map([
  ["Q111", new Set([3])],
  ["Q254", new Set([5])],
]);

test("survey and dataset cover exactly the same question codes, no duplicates", () => {
  const surveyCodes = QUESTIONS.map((q) => q.code);
  assert.equal(new Set(surveyCodes).size, surveyCodes.length, "duplicate codes in survey");
  const dataCodes = data.questions.map((q) => q.code);
  assert.equal(new Set(dataCodes).size, dataCodes.length, "duplicate codes in dataset");
  assert.deepEqual(new Set(surveyCodes), new Set(dataCodes));
});

test("every answer option is expressible on the question's declared scale", () => {
  for (const item of QUESTIONS) {
    const { min, max } = dataQ.get(item.code);
    if (item.type === "choice") {
      const values = item.options.map((o) => o.value);
      assert.equal(new Set(values).size, values.length, `${item.code}: duplicate option values`);
      for (const v of values) {
        assert.ok(v >= min && v <= max, `${item.code}: option value ${v} outside [${min}, ${max}]`);
      }
      assert.equal(
        values.length,
        max - min + 1,
        `${item.code}: ${values.length} options for a ${min}-${max} scale; users cannot express every scale point`
      );
    } else {
      assert.equal(item.type, "scale");
      assert.ok(item.lowLabel && item.highLabel, `${item.code}: scale item missing endpoint labels`);
      assert.ok(max - min + 1 >= 5, `${item.code}: ${min}-${max} is too narrow for a scale widget`);
    }
  }
});

test("country entries are well-formed and values are normalized", () => {
  assert.ok(data.countries.length >= 60, "unexpectedly few countries");
  const codes = new Set(data.questions.map((q) => q.code));
  for (const c of data.countries) {
    assert.match(c.iso3, /^[A-Z]{3}$/);
    assert.ok(c.name.length > 1, `${c.iso3}: missing name`);
    assert.ok(c.flag.length > 0, `${c.iso3}: missing flag`);
    const entries = Object.entries(c.values);
    assert.ok(
      entries.length >= Math.ceil(codes.size * 0.6),
      `${c.iso3}: only ${entries.length}/${codes.size} questions covered`
    );
    for (const [code, v] of entries) {
      assert.ok(codes.has(code), `${c.iso3}: value for unknown question ${code}`);
      assert.ok(v >= 0 && v <= 1, `${c.iso3}.${code}: value ${v} not in [0, 1]`);
    }
  }
});

test("source attribution survives the pipeline", () => {
  assert.ok(data.source.citation.includes("World Values Survey"));
  assert.ok(data.source.url.includes("worldvaluessurvey.org"));
});

// --------------------------------------------------------------------------
// Declared scales vs the raw microdata. Catches declaring 1-4 for a 1-5
// variable (which would silently mis-normalize every value). Runs only when
// the ~180MB CSV cache exists (created by `npm run data`).
// --------------------------------------------------------------------------

const CSV_PATH = resolve(ROOT, "scripts/.cache/wvs7.csv");

function splitCsv(line) {
  const out = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else inQ = false;
      } else cur += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out;
}

test("declared question scales exactly match the raw data", { timeout: 120000 }, async (t) => {
  if (!existsSync(CSV_PATH)) {
    t.skip("raw CSV cache not present (run `npm run data` first)");
    return;
  }
  const checked = data.questions.filter((q) => !DERIVED.has(q.code));
  const observed = new Map(checked.map((q) => [q.code, new Set()]));

  const rl = createInterface({
    input: createReadStream(CSV_PATH, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });
  let header = null;
  const colIdx = new Map();
  for await (const line of rl) {
    if (!line) continue;
    if (header === null) {
      header = splitCsv(line);
      for (const q of checked) {
        const ix = header.indexOf(q.code);
        assert.ok(ix !== -1, `${q.code}: column missing from raw CSV`);
        colIdx.set(q.code, ix);
      }
      continue;
    }
    const fields = splitCsv(line);
    for (const [code, ix] of colIdx) {
      const v = Number(fields[ix]);
      if (Number.isInteger(v) && v >= 0) observed.get(code).add(v);
    }
  }

  for (const q of checked) {
    const seen = observed.get(q.code);
    for (let v = q.min; v <= q.max; v++) {
      assert.ok(seen.has(v), `${q.code}: declared scale ${q.min}-${q.max} but value ${v} never occurs in the data`);
    }
    const stray = [...seen].filter(
      (v) => (v < q.min || v > q.max) && !RANGE_EXCEPTIONS.get(q.code)?.has(v)
    );
    assert.deepEqual(
      stray,
      [],
      `${q.code}: raw data contains substantive values ${stray} outside declared scale ${q.min}-${q.max}`
    );
  }
});
