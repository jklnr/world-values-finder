// Ranking regression: canonical profiles must produce exactly the committed
// country rankings. Any change to the dataset, keying, normalization, or
// matching math that shifts results will fail here and force a deliberate
// snapshot regeneration (scripts/build-snapshots.mjs) with a reviewable diff.

import test from "node:test";
import assert from "node:assert/strict";
import { rankCountries } from "../src/match.js";
import { loadJSON } from "./helpers.mjs";

const { profiles } = loadJSON("test/fixtures/profiles.json");
const snapshots = loadJSON("test/fixtures/snapshots.json");
const data = loadJSON("src/data/wvs.json");

test("profiles answer every question with a legal value", () => {
  const scale = new Map(data.questions.map((q) => [q.code, q]));
  for (const [name, answers] of Object.entries(profiles)) {
    assert.deepEqual(
      new Set(Object.keys(answers)),
      new Set(scale.keys()),
      `${name}: profile must cover exactly the survey's questions`
    );
    for (const [code, v] of Object.entries(answers)) {
      const { min, max } = scale.get(code);
      assert.ok(
        Number.isInteger(v) && v >= min && v <= max,
        `${name}.${code}: answer ${v} outside scale ${min}-${max}`
      );
    }
  }
});

test("canonical profiles reproduce the committed rankings exactly", () => {
  for (const [name, answers] of Object.entries(profiles)) {
    const ranked = rankCountries(new Map(Object.entries(answers)));
    const snap = snapshots[name];
    assert.ok(snap, `no snapshot for profile ${name}`);
    assert.deepEqual(ranked.slice(0, 5).map((c) => c.iso3), snap.top5, `${name}: top-5 changed`);
    assert.deepEqual(ranked.slice(-5).map((c) => c.iso3), snap.bottom5, `${name}: bottom-5 changed`);
    assert.equal(Math.round(ranked[0].match), snap.topMatch, `${name}: top match score changed`);
  }
});

test("opposite profiles produce disjoint top-5 lists", () => {
  const tops = Object.entries(profiles).map(([, answers]) =>
    rankCountries(new Map(Object.entries(answers)))
      .slice(0, 5)
      .map((c) => c.iso3)
  );
  const [a, b] = tops;
  assert.ok(
    a.every((iso) => !b.includes(iso)),
    `secular-liberal and devout-traditional top-5 overlap: ${a} vs ${b}`
  );
});
