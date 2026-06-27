// Guards against the worst failure mode this app can have: a survey item
// keyed to the wrong WVS variable, silently comparing answers against
// unrelated country data (it happened: "euthanasia" was once keyed to Q186,
// which is actually "sex before marriage").
//
// Ground truth is test/fixtures/codebook.json, an independently sourced
// extract of the official WVS-7 codebook (see scripts/build-codebook-fixture.mjs).

import test from "node:test";
import assert from "node:assert/strict";
import { QUESTIONS } from "../src/survey.js";
import {
  loadJSON,
  surveyCorpus,
  tokenSet,
  substantiveChoices,
  buildScorer,
} from "./helpers.mjs";

const fixture = loadJSON("test/fixtures/codebook.json");
const VARIABLES = fixture.variables;
const scorer = buildScorer(VARIABLES);

// Derived items whose answer values are constructed (not raw WVS codes).
const DERIVED = new Set();

// Documented near-miss rivals. Q250's official questionnaire text is
// "...live in a country that is governed democratically" (which we use
// verbatim), but the codebook *label* is the terse "Importance of democracy",
// while sibling Q251 ("How democratically is this country being governed
// today") shares more surface words. Q250's keying is pinned down separately
// by the endpoint-label test ("Absolutely important" is a Q250 value label).
const EXPECTED_RIVALS = new Map([["Q250", new Set(["Q251"])]]);

test("every survey code exists in the official codebook", () => {
  for (const item of QUESTIONS) {
    assert.ok(VARIABLES[item.code], `${item.code} not found in codebook fixture`);
  }
});

test("survey wording matches the official wording of its assigned variable better than any other variable", () => {
  for (const item of QUESTIONS) {
    const tokens = surveyCorpus(item);
    const assigned = scorer.score(tokens, item.code);
    assert.ok(
      assigned > 0,
      `${item.code}: prompt/options share no content words with the official codebook entry "${VARIABLES[item.code].label}"`
    );
    const top = scorer.best(tokens);
    const allowedRival =
      top.code !== item.code && EXPECTED_RIVALS.get(item.code)?.has(top.code);
    assert.ok(
      assigned >= top.score - 1e-9 || allowedRival,
      `${item.code}: wording matches ${top.code} ("${VARIABLES[top.code].label}") better than its assigned variable ("${VARIABLES[item.code].label}") -- likely miskeyed`
    );
  }
});

test("choice option values are valid response codes for the assigned variable", () => {
  for (const item of QUESTIONS) {
    if (item.type !== "choice" || DERIVED.has(item.code)) continue;
    const keys = new Set(
      Object.keys(VARIABLES[item.code].choices || {}).map(Number)
    );
    for (const opt of item.options) {
      assert.ok(
        keys.has(opt.value),
        `${item.code}: option value ${opt.value} ("${opt.label}") is not a response code in the codebook`
      );
    }
  }
});

// If one of our option labels is recognizably the same phrase as an official
// value label, it must sit at the same numeric code. This catches reversed or
// shifted Likert scales. Matching: the official label's token set must be a
// subset of ours; the most specific (largest) such match decides; ties skip.
test("recognizable option labels sit at the correct response codes (no reversed scales)", () => {
  for (const item of QUESTIONS) {
    if (item.type !== "choice" || DERIVED.has(item.code)) continue;
    const official = substantiveChoices(VARIABLES[item.code]);
    for (const opt of item.options) {
      const ours = tokenSet(opt.label);
      let bestKey = null;
      let bestSize = 0;
      let tie = false;
      for (const [key, label] of Object.entries(official)) {
        const theirs = tokenSet(label);
        if (theirs.size === 0) continue;
        if ([...theirs].every((t) => ours.has(t))) {
          if (theirs.size > bestSize) {
            bestSize = theirs.size;
            bestKey = Number(key);
            tie = false;
          } else if (theirs.size === bestSize) {
            tie = true;
          }
        }
      }
      if (bestKey !== null && !tie) {
        assert.equal(
          bestKey,
          opt.value,
          `${item.code}: our option "${opt.label}" (value ${opt.value}) matches official label "${official[bestKey]}" which is response code ${bestKey} -- scale reversed or shifted?`
        );
      }
    }
  }
});

// Scale endpoints must agree with the official labels for the min/max codes.
test("scale endpoint labels match the official endpoint value labels", () => {
  const data = loadJSON("src/data/wvs.json");
  const scale = new Map(data.questions.map((q) => [q.code, q]));
  for (const item of QUESTIONS) {
    if (item.type !== "scale") continue;
    const official = substantiveChoices(VARIABLES[item.code]);
    const { min, max } = scale.get(item.code);
    for (const [bound, ourLabel] of [
      [min, item.lowLabel],
      [max, item.highLabel],
    ]) {
      const officialLabel = official[bound];
      if (!officialLabel) continue; // codebook lists no label for this code
      const a = tokenSet(ourLabel);
      const b = tokenSet(officialLabel);
      const subset = (x, y) => [...x].every((t) => y.has(t));
      assert.ok(
        subset(a, b) || subset(b, a),
        `${item.code}: endpoint ${bound} label "${ourLabel}" does not correspond to official "${officialLabel}" -- endpoints may be flipped`
      );
    }
  }
});
