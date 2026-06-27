// Shared utilities for the QC test suite.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(__dirname, "..");

export function loadJSON(relPath) {
  return JSON.parse(readFileSync(resolve(ROOT, relPath), "utf8"));
}

// --------------------------------------------------------------------------
// Tokenization for wording-vs-codebook comparison.
//
// We compare *stemmed content tokens*. Matching is weighted by inverse
// document frequency across all official variables, so generic survey words
// ("important", "agree", "justifiable") carry almost no weight while
// discriminating words ("euthanasia", "parliament", "obedience") dominate.
// --------------------------------------------------------------------------

const STOPWORDS = new Set([
  "a","an","the","and","or","of","to","in","on","at","for","with","is","are",
  "was","were","be","been","being","do","does","did","done","you","your","it",
  "its","that","this","these","those","would","should","could","have","has",
  "had","if","as","by","from","about","who","whom","whose","will","shall",
  "i","me","my","we","us","our","he","she","his","her","they","them","their",
  "there","here","when","what","which","how","why","whether","than","then",
  "so","such","but","nor","also","too","out","up","down","off","over","under",
  "don","t","s","d","ll","re","ve",
]);

const IRREGULAR = { children: "child", women: "woman", men: "man" };

function stem(token) {
  if (IRREGULAR[token]) return IRREGULAR[token];
  for (const suffix of ["ing", "ies", "es", "ed", "s"]) {
    if (token.endsWith(suffix) && token.length - suffix.length >= 3) {
      return token.slice(0, token.length - suffix.length);
    }
  }
  return token;
}

export function tokenize(text) {
  return (text || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 2 && !/^\d+$/.test(t) && !STOPWORDS.has(t))
    .map(stem);
}

export function tokenSet(text) {
  return new Set(tokenize(text));
}

// Substantive value labels of a codebook variable (skips missing codes and
// labels that are just the numeral itself, e.g. "2": "2" on 10-point scales).
export function substantiveChoices(entry) {
  const out = {};
  for (const [key, label] of Object.entries(entry.choices || {})) {
    const k = Number(key);
    if (!Number.isFinite(k) || k < 0) continue;
    if (String(label).trim() === String(key)) continue;
    out[k] = label;
  }
  return out;
}

// All official text we know about a codebook variable.
export function officialCorpus(entry) {
  const parts = [entry.label, entry.instruction];
  for (const label of Object.values(substantiveChoices(entry))) parts.push(label);
  return tokenSet(parts.join(" "));
}

// All user-facing text of one of our survey items.
export function surveyCorpus(item) {
  const parts = [item.text];
  if (item.options) for (const o of item.options) parts.push(o.label);
  if (item.lowLabel) parts.push(item.lowLabel);
  if (item.highLabel) parts.push(item.highLabel);
  return tokenSet(parts.join(" "));
}

// Builds a scorer over the whole codebook: score(surveyTokens, code) =
// sum over shared tokens of 1/df(token), df counted across all variables.
//
// Variables with huge enumerated choice lists (party preference, language at
// home, ...) are excluded from the rival pool in best(): their hundreds of
// proper-noun labels produce spurious rare-token matches, and they are not
// plausible keying targets for attitude questions. None of our survey items
// key to such a variable (asserted by callers via score(assigned) > 0).
const MAX_SUBSTANTIVE_CHOICES = 30;

export function buildScorer(variables) {
  const corpora = new Map(); // code -> Set(tokens)
  const eligible = new Set(); // codes that participate in best()
  const df = new Map(); // token -> number of variables containing it
  for (const [code, entry] of Object.entries(variables)) {
    const corpus = officialCorpus(entry);
    corpora.set(code, corpus);
    if (Object.keys(substantiveChoices(entry)).length <= MAX_SUBSTANTIVE_CHOICES) {
      eligible.add(code);
    }
    for (const t of corpus) df.set(t, (df.get(t) || 0) + 1);
  }

  // Token weight: inverse document frequency with a floor of 2, so a single
  // ultra-rare token (possibly an artifact of our paraphrasing) cannot
  // outvote several moderately distinctive shared tokens.
  const w = (t) => 1 / Math.max(df.get(t) ?? 2, 2);
  const mass = (tokens) => [...tokens].reduce((s, t) => s + w(t), 0);
  const officialMass = new Map(
    [...corpora].map(([code, corpus]) => [code, mass(corpus)])
  );

  // Idf-weighted cosine similarity between our survey wording and an official
  // variable's wording. Normalizing by both corpora's total weight means a
  // rival only wins if it genuinely *is* the better description, not merely
  // because one rare token leaked into a long unrelated entry.
  function score(surveyTokens, code) {
    const corpus = corpora.get(code);
    if (!corpus || corpus.size === 0) return 0;
    let shared = 0;
    for (const t of surveyTokens) if (corpus.has(t)) shared += w(t);
    if (shared === 0) return 0;
    return shared / Math.sqrt(mass(surveyTokens) * officialMass.get(code));
  }
  function best(surveyTokens) {
    let bestCode = null;
    let bestScore = -1;
    for (const code of eligible) {
      const s = score(surveyTokens, code);
      if (s > bestScore) {
        bestScore = s;
        bestCode = code;
      }
    }
    return { code: bestCode, score: bestScore };
  }
  return { score, best, corpora, df };
}
