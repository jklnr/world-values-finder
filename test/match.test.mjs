// Unit tests for the MSE matching engine itself.

import test from "node:test";
import assert from "node:assert/strict";
import { rankCountries, normalizeAnswer, COUNTRIES } from "../src/match.js";
import { loadJSON } from "./helpers.mjs";

const data = loadJSON("src/data/wvs.json");
const scale = new Map(data.questions.map((q) => [q.code, q]));

test("normalizeAnswer maps scale endpoints to 0 and 1 and midpoints linearly", () => {
  assert.equal(normalizeAnswer("Q164", 1), 0);
  assert.equal(normalizeAnswer("Q164", 10), 1);
  assert.ok(Math.abs(normalizeAnswer("Q164", 5.5) - 0.5) < 1e-12);
  assert.equal(normalizeAnswer("Q57", 1), 0);
  assert.equal(normalizeAnswer("Q57", 2), 1);
  assert.equal(normalizeAnswer("NOPE", 3), null);
});

test("a single answer produces the hand-computed MSE for every country", () => {
  const answers = new Map([["Q164", 10]]);
  const ranked = rankCountries(answers);
  for (const c of ranked) {
    const expected = (1 - data.countries.find((x) => x.iso3 === c.iso3).values.Q164) ** 2;
    assert.ok(Math.abs(c.mse - expected) < 1e-12, `${c.iso3}: mse ${c.mse} != ${expected}`);
    assert.equal(c.overlap, 1);
  }
  // Sorted ascending by MSE.
  for (let i = 1; i < ranked.length; i++) {
    assert.ok(ranked[i - 1].mse <= ranked[i].mse);
  }
});

test("ranking is deterministic and unaffected by re-answering with the same value", () => {
  const answers = new Map([
    ["Q164", 3],
    ["Q182", 8],
    ["Q57", 1],
  ]);
  const a = rankCountries(answers);
  answers.set("Q182", 8); // identical re-answer
  const b = rankCountries(answers);
  assert.deepEqual(
    a.map((c) => [c.iso3, c.mse]),
    b.map((c) => [c.iso3, c.mse])
  );
});

test("countries are only scored on questions they have data for", () => {
  const allAnswers = new Map(data.questions.map((q) => [q.code, q.min]));
  const ranked = rankCountries(allAnswers);
  assert.equal(ranked.length, COUNTRIES.length);
  for (const c of ranked) {
    const have = Object.keys(
      data.countries.find((x) => x.iso3 === c.iso3).values
    ).length;
    assert.equal(c.overlap, have, `${c.iso3}: overlap should equal its data coverage`);
  }
});

test("answering with a country's own (denormalized) means ranks that country near the top", () => {
  for (const iso3 of ["NLD", "EGY", "JPN"]) {
    const country = data.countries.find((c) => c.iso3 === iso3);
    const answers = new Map();
    for (const [code, v] of Object.entries(country.values)) {
      const { min, max } = scale.get(code);
      // Round to a legal integer answer, the closest a user could get.
      answers.set(code, Math.min(max, Math.max(min, Math.round(min + v * (max - min)))));
    }
    const ranked = rankCountries(answers);
    const pos = ranked.findIndex((c) => c.iso3 === iso3);
    assert.ok(pos >= 0 && pos < 3, `${iso3}: expected top-3 for its own profile, got rank ${pos + 1}`);
    // Not ~100: answers are quantized to integers, and on the many binary
    // 1-2 items a fractional country mean (e.g. 0.6) is up to 0.5 away from
    // the nearest legal answer. ~80 is the realistic ceiling.
    assert.ok(ranked[pos].match > 75, `${iso3}: match ${ranked[pos].match} unexpectedly low for its own profile`);
  }
});

test("match score is bounded and monotone in MSE", () => {
  const answers = new Map([["Q164", 1], ["Q6", 1], ["Q182", 1]]);
  const ranked = rankCountries(answers);
  for (let i = 0; i < ranked.length; i++) {
    const c = ranked[i];
    assert.ok(c.match >= 0 && c.match <= 100);
    if (i > 0) assert.ok(c.match <= ranked[i - 1].match + 1e-9);
  }
});
