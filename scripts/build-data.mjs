// Builds a compact, app-ready dataset from the real World Values Survey
// Wave 7 (2017-2022) cross-national microdata.
//
// Pipeline:
//   1. Download (and cache) the official OSF-hosted CSV.
//   2. Stream the ~180MB file, reading only the columns we need.
//   3. Drop WVS missing codes (negative), group by country (ISO3),
//      and compute the mean response for each sampled question.
//   4. Normalize each mean to [0,1] using that question's scale.
//   5. Emit src/data/wvs.json with question metadata + per-country values.
//
// Run with:  npm run data

import { createWriteStream, existsSync, mkdirSync, createReadStream } from "node:fs";
import { writeFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { pipeline } from "node:stream/promises";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const CACHE_DIR = resolve(__dirname, ".cache");
export const CSV_PATH = resolve(CACHE_DIR, "wvs7.csv");
const OUT_PATH = resolve(ROOT, "src/data/wvs.json");
const CSV_URL = "https://osf.io/36dgb/download";

// The sampled WVS questions. `min`/`max` are the substantive response scale;
// any value outside that range (the negative missing codes, etc.) is dropped.
// Keep this list in sync with the prompts in src/survey.js (same `code`).
const QUESTIONS = [
  { code: "Q1", min: 1, max: 4 },   // Important in life: Family
  { code: "Q6", min: 1, max: 4 },   // Important in life: Religion
  { code: "Q164", min: 1, max: 10 },// Importance of God
  { code: "Q57", min: 1, max: 2 },  // Most people can be trusted
  { code: "Q5", min: 1, max: 4 },   // Important in life: Work
  { code: "Q29", min: 1, max: 4 },  // Men make better political leaders
  { code: "Q182", min: 1, max: 10 },// Justifiable: homosexuality
  { code: "Q184", min: 1, max: 10 },// Justifiable: abortion
  { code: "Q185", min: 1, max: 10 },// Justifiable: divorce
  { code: "Q193", min: 1, max: 10 },// Justifiable: having casual sex
  { code: "Q181", min: 1, max: 10 },// Justifiable: accepting a bribe
  { code: "Q180", min: 1, max: 10 },// Justifiable: cheating on taxes
  { code: "Q45", min: 1, max: 3 },  // Future change: greater respect for authority
  { code: "Q240", min: 1, max: 10 },// Left-right political scale
  { code: "Q250", min: 1, max: 10 },// Importance of living in a democracy
  { code: "Q254", min: 1, max: 4 }, // How proud of your nationality
  { code: "Q106", min: 1, max: 10 },// Incomes equal vs. larger differences
  { code: "Q109", min: 1, max: 10 },// Competition good vs. harmful
  { code: "Q22", min: 1, max: 2 },  // Neighbours: homosexuals (1 would not like, 2 don't mind)
  { code: "Q19", min: 1, max: 2 },  // Neighbours: people of a different race
  { code: "Q21", min: 1, max: 2 },  // Neighbours: immigrants / foreign workers
  { code: "Q183", min: 1, max: 10 },// Justifiable: prostitution
  { code: "Q188", min: 1, max: 10 },// Justifiable: euthanasia
  { code: "Q235", min: 1, max: 4 }, // Govt type: strong leader (1 very good ... 4 very bad)
  { code: "Q237", min: 1, max: 4 }, // Govt type: army rule
  { code: "Q196", min: 1, max: 4 }, // Govt right: video surveillance in public areas
  { code: "Q197", min: 1, max: 4 }, // Govt right: monitor emails and internet information
  { code: "Q198", min: 1, max: 4 }, // Govt right: collect information without knowledge
  { code: "Q169", min: 1, max: 4 }, // When science & religion conflict, religion is right (1 strongly agree..4 strongly disagree)
  { code: "Q170", min: 1, max: 4 }, // Only acceptable religion is my religion
  { code: "Q111", min: 1, max: 2 }, // Priority: environment (1) vs economy (2); drops "other" (3)
  { code: "Q63", min: 1, max: 4 },  // Trust: people of another nationality
  { code: "Q259", min: 1, max: 4 }, // How close do you feel to: World (1 very close..4 not at all)
  { code: "Q187", min: 1, max: 10 },// Justifiable: suicide
  { code: "Q195", min: 1, max: 10 },// Justifiable: death penalty
  { code: "Q27", min: 1, max: 4 },  // Making my parents proud is a main life goal
  { code: "Q37", min: 1, max: 5 },  // Duty to society to have children
  { code: "Q38", min: 1, max: 5 },  // Adult children must care for parents
  { code: "Q30", min: 1, max: 4 },  // University more important for a boy
  { code: "Q33", min: 1, max: 5 },  // Jobs scarce: men more right than women
  { code: "Q35", min: 1, max: 5 },  // Wife earning more causes problems
  { code: "Q108", min: 1, max: 10 },// Government vs individual responsibility
  { code: "Q149", min: 1, max: 2 }, // Freedom vs equality
  { code: "Q158", min: 1, max: 10 },// Science & tech make life better (agree)
  { code: "Q163", min: 1, max: 10 },// World better off because of science (1 worse..10 better)
  { code: "Q166", min: 1, max: 2 }, // Believe in life after death (1 yes, 2 no)
  { code: "Q167", min: 1, max: 2 }, // Believe in hell
  { code: "Q168", min: 1, max: 2 }, // Believe in heaven
  { code: "Q209", min: 1, max: 3 }, // Signing a petition (1 have done..3 never)
  { code: "Q179", min: 1, max: 10 },// Justifiable: stealing property
];

// Per-question accessors that unify standard (mean + normalize) and derived
// (map each response to [0,1]) questions. Both contribute values already on
// the 0-1 scale, so a country's stored value is just the mean contribution.
function qSpec(q) {
  if (q.map) {
    return {
      valid: (v) => Number.isFinite(v) && v >= q.raw[0] && v <= q.raw[1],
      contrib: q.map,
      outMin: 0,
      outMax: 1,
    };
  }
  return {
    valid: (v) => Number.isFinite(v) && v >= q.min && v <= q.max,
    contrib: (v) => (v - q.min) / (q.max - q.min),
    outMin: q.min,
    outMax: q.max,
  };
}
const SPEC = new Map(QUESTIONS.map((q) => [q.code, qSpec(q)]));

// Minimum respondents per country/question for a mean to be trusted.
const MIN_RESPONSES = 30;

// ISO3 -> { name, iso2 }. Covers WVS Wave 7 participants (and then some).
const COUNTRY_META = {
  AND: { name: "Andorra", iso2: "AD" },
  ARG: { name: "Argentina", iso2: "AR" },
  ARM: { name: "Armenia", iso2: "AM" },
  AUS: { name: "Australia", iso2: "AU" },
  AUT: { name: "Austria", iso2: "AT" },
  BGD: { name: "Bangladesh", iso2: "BD" },
  BOL: { name: "Bolivia", iso2: "BO" },
  BRA: { name: "Brazil", iso2: "BR" },
  CAN: { name: "Canada", iso2: "CA" },
  CHL: { name: "Chile", iso2: "CL" },
  CHN: { name: "China", iso2: "CN" },
  COL: { name: "Colombia", iso2: "CO" },
  CYP: { name: "Cyprus", iso2: "CY" },
  CZE: { name: "Czechia", iso2: "CZ" },
  DEU: { name: "Germany", iso2: "DE" },
  ECU: { name: "Ecuador", iso2: "EC" },
  EGY: { name: "Egypt", iso2: "EG" },
  ETH: { name: "Ethiopia", iso2: "ET" },
  GRC: { name: "Greece", iso2: "GR" },
  GTM: { name: "Guatemala", iso2: "GT" },
  HKG: { name: "Hong Kong", iso2: "HK" },
  IDN: { name: "Indonesia", iso2: "ID" },
  IND: { name: "India", iso2: "IN" },
  IRN: { name: "Iran", iso2: "IR" },
  IRQ: { name: "Iraq", iso2: "IQ" },
  JOR: { name: "Jordan", iso2: "JO" },
  JPN: { name: "Japan", iso2: "JP" },
  KAZ: { name: "Kazakhstan", iso2: "KZ" },
  KEN: { name: "Kenya", iso2: "KE" },
  KGZ: { name: "Kyrgyzstan", iso2: "KG" },
  KOR: { name: "South Korea", iso2: "KR" },
  LBN: { name: "Lebanon", iso2: "LB" },
  LBY: { name: "Libya", iso2: "LY" },
  MAC: { name: "Macau", iso2: "MO" },
  MAR: { name: "Morocco", iso2: "MA" },
  MDV: { name: "Maldives", iso2: "MV" },
  MEX: { name: "Mexico", iso2: "MX" },
  MMR: { name: "Myanmar", iso2: "MM" },
  MNG: { name: "Mongolia", iso2: "MN" },
  MYS: { name: "Malaysia", iso2: "MY" },
  NGA: { name: "Nigeria", iso2: "NG" },
  NIC: { name: "Nicaragua", iso2: "NI" },
  NLD: { name: "Netherlands", iso2: "NL" },
  NZL: { name: "New Zealand", iso2: "NZ" },
  PAK: { name: "Pakistan", iso2: "PK" },
  PER: { name: "Peru", iso2: "PE" },
  PHL: { name: "Philippines", iso2: "PH" },
  PRI: { name: "Puerto Rico", iso2: "PR" },
  ROU: { name: "Romania", iso2: "RO" },
  RUS: { name: "Russia", iso2: "RU" },
  SGP: { name: "Singapore", iso2: "SG" },
  SRB: { name: "Serbia", iso2: "RS" },
  SVK: { name: "Slovakia", iso2: "SK" },
  THA: { name: "Thailand", iso2: "TH" },
  TJK: { name: "Tajikistan", iso2: "TJ" },
  TUN: { name: "Tunisia", iso2: "TN" },
  TUR: { name: "Turkey", iso2: "TR" },
  TWN: { name: "Taiwan", iso2: "TW" },
  UKR: { name: "Ukraine", iso2: "UA" },
  URY: { name: "Uruguay", iso2: "UY" },
  USA: { name: "United States", iso2: "US" },
  VEN: { name: "Venezuela", iso2: "VE" },
  VNM: { name: "Vietnam", iso2: "VN" },
  ZWE: { name: "Zimbabwe", iso2: "ZW" },
  GBR: { name: "United Kingdom", iso2: "GB" },
  ESP: { name: "Spain", iso2: "ES" },
  ITA: { name: "Italy", iso2: "IT" },
  FRA: { name: "France", iso2: "FR" },
  POL: { name: "Poland", iso2: "PL" },
  PRT: { name: "Portugal", iso2: "PT" },
  SWE: { name: "Sweden", iso2: "SE" },
  NOR: { name: "Norway", iso2: "NO" },
  FIN: { name: "Finland", iso2: "FI" },
  DNK: { name: "Denmark", iso2: "DK" },
  CHE: { name: "Switzerland", iso2: "CH" },
  ZAF: { name: "South Africa", iso2: "ZA" },
  GHA: { name: "Ghana", iso2: "GH" },
};

function flagEmoji(iso2) {
  if (!iso2 || iso2.length !== 2) return "\u{1F3F3}\uFE0F";
  const A = 0x1f1e6;
  return String.fromCodePoint(
    A + (iso2.charCodeAt(0) - 65),
    A + (iso2.charCodeAt(1) - 65)
  );
}

// Minimal CSV line splitter (handles double-quoted fields with commas).
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
        } else {
          inQ = false;
        }
      } else {
        cur += c;
      }
    } else if (c === '"') {
      inQ = true;
    } else if (c === ",") {
      out.push(cur);
      cur = "";
    } else {
      cur += c;
    }
  }
  out.push(cur);
  return out;
}

async function download() {
  if (existsSync(CSV_PATH)) {
    console.log("Using cached CSV at", CSV_PATH);
    return;
  }
  mkdirSync(CACHE_DIR, { recursive: true });
  console.log("Downloading WVS Wave 7 CSV (~180MB) from", CSV_URL, "...");
  const res = await fetch(CSV_URL, { redirect: "follow" });
  if (!res.ok || !res.body) {
    throw new Error(`Download failed: HTTP ${res.status}`);
  }
  await pipeline(res.body, createWriteStream(CSV_PATH));
  console.log("Saved to", CSV_PATH);
}

export async function aggregate() {
  const rl = createInterface({
    input: createReadStream(CSV_PATH, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });

  let header = null;
  let idxCountry = -1;
  const idxQ = {}; // code -> column index
  // country -> code -> { sum, n }
  const acc = new Map();
  let rows = 0;

  for await (const line of rl) {
    if (!line) continue;
    if (header === null) {
      header = splitCsv(line);
      idxCountry = header.indexOf("B_COUNTRY_ALPHA");
      for (const q of QUESTIONS) {
        const ix = header.indexOf(q.code);
        if (ix === -1) throw new Error(`Column ${q.code} not found in CSV`);
        idxQ[q.code] = ix;
      }
      if (idxCountry === -1) throw new Error("B_COUNTRY_ALPHA not found");
      continue;
    }
    const fields = splitCsv(line);
    const iso3 = fields[idxCountry];
    if (!iso3) continue;
    rows++;
    let byCode = acc.get(iso3);
    if (!byCode) {
      byCode = {};
      for (const q of QUESTIONS) byCode[q.code] = { sum: 0, n: 0 };
      acc.set(iso3, byCode);
    }
    for (const q of QUESTIONS) {
      const spec = SPEC.get(q.code);
      const v = Number(fields[idxQ[q.code]]);
      if (spec.valid(v)) {
        byCode[q.code].sum += spec.contrib(v);
        byCode[q.code].n += 1;
      }
    }
    if (rows % 20000 === 0) console.log("  ...processed", rows, "rows");
  }

  console.log("Processed", rows, "respondents across", acc.size, "countries.");
  return acc;
}

export function buildOutput(acc) {
  const countries = [];
  for (const [iso3, byCode] of acc) {
    const meta = COUNTRY_META[iso3];
    const values = {};
    let have = 0;
    for (const q of QUESTIONS) {
      const { sum, n } = byCode[q.code];
      if (n >= MIN_RESPONSES) {
        // sum already accumulates per-respondent values on the 0-1 scale.
        values[q.code] = Math.round((sum / n) * 1000) / 1000;
        have++;
      }
    }
    // Require coverage of most questions to keep the comparison meaningful.
    if (have < Math.ceil(QUESTIONS.length * 0.6)) continue;
    countries.push({
      iso3,
      name: meta ? meta.name : iso3,
      flag: flagEmoji(meta ? meta.iso2 : ""),
      values,
    });
  }
  countries.sort((a, b) => a.name.localeCompare(b.name));

  return {
    source: {
      survey: "World Values Survey Wave 7 (2017-2022)",
      version: "v6.0",
      url: "https://www.worldvaluessurvey.org/",
      citation:
        "Haerpfer, C., Inglehart, R., Moreno, A., Welzel, C., Kizilova, K., Diez-Medrano, J., Lagos, M., Norris, P., Ponarin, E. & Puranen, B. (eds.). World Values Survey: Round Seven - Country-Pooled Datafile. JD Systems Institute & WVSA Secretariat.",
      note: "Values are national mean responses normalized to 0-1 by each question's response scale.",
    },
    questions: QUESTIONS.map((q) => {
      const spec = SPEC.get(q.code);
      return { code: q.code, min: spec.outMin, max: spec.outMax };
    }),
    countries,
  };
}

async function main() {
  await download();
  const acc = await aggregate();
  const out = buildOutput(acc);
  mkdirSync(dirname(OUT_PATH), { recursive: true });
  await writeFile(OUT_PATH, JSON.stringify(out, null, 0));
  console.log(
    `Wrote ${out.countries.length} countries x ${out.questions.length} questions to ${OUT_PATH}`
  );
}

// Only run the full pipeline (which may download ~180MB) when this file is
// executed directly, so it can be imported by tests without side effects.
const invokedDirectly =
  process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
