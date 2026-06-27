// Semantic invariants: country-pair facts about world values that are common
// knowledge in the WVS literature, asserted by *meaning*. If a question were
// keyed to the wrong variable, normalized the wrong way, or had its scale
// direction flipped, these would fail loudly.
//
// Every pair's direction was asserted a priori from domain knowledge (not
// mined from the data) and then verified to hold with a wide margin. The
// asserted margin is deliberately ~half the observed gap so ordinary sampling
// noise in a future data refresh won't flap the test, but a keying/direction
// bug (which typically moves values by 0.3+) will.
//
// Reminder on direction: stored values are normalized so 0 corresponds to the
// scale's lowest response code. For "1 = Very important / Agree" items, LOWER
// therefore means more religious/agreeing; for justifiability (1 never .. 10
// always), HIGHER means more permissive.

import test from "node:test";
import assert from "node:assert/strict";
import { loadJSON } from "./helpers.mjs";

const data = loadJSON("src/data/wvs.json");
const byIso = new Map(data.countries.map((c) => [c.iso3, c]));

// [code, lowerIso3, higherIso3, margin, rationale]
const INVARIANTS = [
  ["Q164", "DEU", "EGY", 0.25, "importance of God: Egypt far more religious than Germany"],
  ["Q6", "EGY", "DEU", 0.25, "religion important (1=very): Egypt lower (more religious)"],
  ["Q166", "EGY", "JPN", 0.2, "belief in afterlife (1=yes): Egypt lower (near-universal belief)"],
  ["Q167", "EGY", "DEU", 0.4, "belief in hell (1=yes): Egypt lower"],
  ["Q168", "EGY", "JPN", 0.3, "belief in heaven (1=yes): Egypt lower"],
  ["Q169", "PAK", "DEU", 0.35, "religion right over science (4=disagree): Germany more secular"],
  ["Q22", "NGA", "NZL", 0.4, "homosexual neighbour (2=don't mind): New Zealand more accepting"],
  ["Q182", "NGA", "NZL", 0.3, "homosexuality justifiability: New Zealand higher"],
  ["Q184", "NGA", "DEU", 0.2, "abortion justifiability: Germany higher"],
  ["Q185", "PAK", "NLD", 0.3, "divorce justifiability: Netherlands higher"],
  ["Q188", "NGA", "NLD", 0.3, "euthanasia justifiability: Netherlands (where it is legal) higher"],
  ["Q193", "BGD", "NZL", 0.2, "casual sex justifiability: New Zealand higher"],
  ["Q187", "EGY", "NLD", 0.2, "suicide justifiability: Netherlands higher"],
  ["Q183", "PAK", "DEU", 0.18, "prostitution justifiability: Germany (where it is legal) higher"],
  ["Q195", "DEU", "JPN", 0.2, "death penalty justifiability: Japan (retains it) higher than Germany (abolished)"],
  ["Q29", "EGY", "NZL", 0.25, "men better leaders (4=disagree): New Zealand more egalitarian"],
  ["Q30", "PAK", "CAN", 0.2, "university for boys (4=disagree): Canada more egalitarian"],
  ["Q33", "EGY", "DEU", 0.3, "men's right to scarce jobs (5=disagree): Germany more egalitarian"],
  ["Q35", "NGA", "NLD", 0.2, "wife out-earning husband (5=disagree): Netherlands more egalitarian"],
  ["Q235", "RUS", "DEU", 0.14, "strong leader without parliament (4=very bad): Germany more opposed"],
  ["Q237", "PAK", "DEU", 0.25, "army rule (4=very bad): Germany more opposed"],
  ["Q250", "RUS", "DEU", 0.11, "importance of democracy: Germany higher"],
  ["Q57", "CHN", "BRA", 0.25, "generalized trust (2=careful): China famously high-trust, Brazil low"],
  ["Q37", "EGY", "DEU", 0.15, "duty to society to have children (1=agree): Egypt lower"],
  ["Q38", "PAK", "NLD", 0.25, "children's duty to care for parents (1=agree): Pakistan lower"],
  ["Q27", "EGY", "DEU", 0.13, "making parents proud (1=agree): Egypt lower"],
  ["Q209", "NZL", "EGY", 0.4, "signing petitions (1=have done): New Zealand lower (more petitioning)"],
  ["Q21", "THA", "NZL", 0.16, "immigrant neighbour (2=don't mind): New Zealand more accepting"],
  ["Q19", "MMR", "NZL", 0.3, "different-race neighbour (2=don't mind): New Zealand more accepting"],
  ["Q63", "CAN", "IRQ", 0.15, "trust in other nationalities (1=trust): Canada lower (more trusting)"],
];

test("invariants reference questions and countries that exist in the dataset", () => {
  const codes = new Set(data.questions.map((q) => q.code));
  for (const [code, lo, hi] of INVARIANTS) {
    assert.ok(codes.has(code), `${code} not in dataset`);
    for (const iso of [lo, hi]) {
      assert.ok(byIso.has(iso), `${iso} not in dataset`);
      assert.ok(
        byIso.get(iso).values[code] !== undefined,
        `${iso} has no data for ${code}; pick a different country pair`
      );
    }
  }
});

test("well-known cross-country value differences hold (keying, direction, normalization)", () => {
  for (const [code, lo, hi, margin, why] of INVARIANTS) {
    const a = byIso.get(lo).values[code];
    const b = byIso.get(hi).values[code];
    assert.ok(
      b - a >= margin,
      `${code}: expected ${hi} (${b}) to exceed ${lo} (${a}) by >= ${margin} -- ${why}. ` +
        `A violation here usually means the variable is miskeyed or its direction is flipped.`
    );
  }
});

test("most questions discriminate across countries (a swapped near-constant column would not)", () => {
  for (const q of data.questions) {
    const vals = data.countries
      .map((c) => c.values[q.code])
      .filter((v) => v !== undefined);
    const spread = Math.max(...vals) - Math.min(...vals);
    assert.ok(
      spread >= 0.08,
      `${q.code}: country means span only ${spread.toFixed(3)} -- suspicious for a values question`
    );
  }
});
