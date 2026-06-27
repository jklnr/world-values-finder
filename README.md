# World Values Finder

A single-page web app where you answer a sample of questions from the
[World Values Survey](https://www.worldvaluessurvey.org/) and, as you progress,
see which countries currently best align with your values.

The source compiles to exactly three flat files:

```
dist/values.html
dist/values.css
dist/values.js
```

These three files are fully self-contained — the survey/country data is bundled
into `values.js`, so no separate data file or network request is needed at runtime.

## How matching works

- Each question and each country's mean response is normalized to `[0, 1]`
  using that question's response scale.
- A country's alignment is the **mean squared error (MSE)** between your
  normalized answers and the country's normalized means, computed over the
  questions you've answered so far.
- Lower MSE = closer alignment. The displayed score is
  `match% = (1 - sqrt(MSE)) * 100`, and the leaderboard re-sorts live with each answer.

## Data

Country values are averages computes from the **World Values
Survey Wave 7 (2017-2022)** cross-national microdata (66 countries).

The build script `scripts/build-data.mjs` downloads the official dataset from its OSF
mirror (`https://osf.io/36dgb/download`, ~180MB, no registration needed), drops
missing codes, averages each sampled question by country, and normalizes the
result into `src/data/wvs.json`.

The following are git-ignored and must be generated locally (see First-time setup):

- `src/data/wvs.json` — aggregated country values (bundled into the app).
- `test/fixtures/codebook.json` — WVS-7 codebook extract used by the tests
  (fetched from the WorldValuesBench transcription of the official codebook).
- the raw `~180MB` CSV, cached under `scripts/.cache/`.

## First-time setup

```bash
npm install
npm run data                            # download + aggregate -> src/data/wvs.json (required)
node scripts/build-codebook-fixture.mjs # fetch codebook -> test/fixtures/codebook.json (for tests)
```

`npm run data` is required before `npm run dev`/`npm run build`, because the app
imports and bundles `src/data/wvs.json`. The codebook fixture is only needed to
run the test suite.

## Develop

```bash
npm run dev     # start the dev server (open the printed URL at /values.html)
```

## Test

```bash
npm test
```

The suite is designed to make variable-keying mistakes (a survey item wired to
the wrong WVS variable) impossible to ship silently:

- **Keying tests** (`test/keying.test.mjs`): every survey item's wording must
  match its assigned variable in `test/fixtures/codebook.json` — an
  independently sourced extract of the official WVS-7 codebook — better than
  any other of the 336 candidate variables (idf-weighted cosine similarity).
  Option labels and scale endpoints must sit at the correct response codes,
  which also catches reversed/shifted Likert scales.
- **Data-integrity tests** (`test/data-integrity.test.mjs`): survey and
  dataset cover identical codes; options span each scale exactly; values are
  normalized. When the raw CSV cache exists, every declared scale is checked
  against the values actually observed in the microdata.
- **Semantic invariants** (`test/invariants.test.mjs`): 35 well-known
  cross-country facts (e.g. Egypt more religious than Germany, Japan more
  death-penalty-tolerant than Germany) asserted by meaning; a miskeyed or
  direction-flipped variable fails these loudly.
- **Engine tests + snapshots** (`test/match.test.mjs`,
  `test/snapshot.test.mjs`): MSE math, determinism, missing-data handling,
  and exact ranking regressions for two canonical profiles. After an
  intentional data/logic change, regenerate with
  `node scripts/build-snapshots.mjs` and review the diff.

The codebook fixture is git-ignored; generate (or refresh) it with
`node scripts/build-codebook-fixture.mjs` before running the tests.

## Question predictiveness analysis

```bash
npm run analyze:questions          # ordered questions + accuracy-vs-length curve
npm run analyze:questions -- --write   # also emit src/data/question-order.json
```

Orders the questions by how well a short subset reproduces the full-survey
country result, so the list can be grown or shrunk deliberately. Respondents
are **simulated individuals** who answer each question independently at random;
a respondent's target is whichever country the full 50-question survey matches
it to. This deliberately avoids assuming people answer like one of the 66
nations: at the country level many items are correlated (religiosity questions
move together across nations) and look "redundant," but real individuals mix
traits freely, so judging predictiveness over random individuals keeps those
items meaningful. Greedy forward selection maximizes target recovery, with a
full-ranking-fidelity tiebreaker. Because off-manifold respondents are hard,
top-1 recovery rises gradually and only reaches 100% near the full set -- i.e.
for arbitrary individuals, most questions genuinely carry information.

This is an analysis aid: it ranks questions, but the final survey set is chosen
by hand, factoring in face validity (e.g. people expect to be asked about
family even though it barely discriminates) and perceived effort (enough
questions that respondents feel they conveyed their values).

The scoring metric is pluggable: [src/analysis/metrics.js](src/analysis/metrics.js)
defines `mseMetric` (matching the live app) behind a `cost`/`aggregate`/`lowerIsBetter`
interface, so a different matching notion is a new metric object with no engine
changes. The engine ([src/analysis/question-info.js](src/analysis/question-info.js))
also exposes `nextBest(answersSoFar, metric)` for adaptive, mid-survey
next-question selection. This is an analysis tool only; it does not yet reorder
the live survey.

## Build

```bash
npm run build   # emits dist/values.html, dist/values.css, dist/values.js
```

Because browsers block ES module scripts loaded over `file://`, serve the
output with any static server to view it, for example:

```bash
npx vite preview          # then open the printed URL at /values.html
# or
python3 -m http.server -d dist
```

## Attribution

Haerpfer, C., Inglehart, R., Moreno, A., Welzel, C., Kizilova, K.,
Diez-Medrano, J., Lagos, M., Norris, P., Ponarin, E. & Puranen, B. (eds.).
2022. *World Values Survey: Round Seven - Country-Pooled Datafile Version 5.0.*
Madrid, Spain & Vienna, Austria: JD Systems Institute & WVSA Secretariat.
doi:10.14281/18241.20.

This project is an independent, educational visualization and is not affiliated
with or endorsed by the World Values Survey Association.
