// Compact URL serialization of the user's survey progress.
//
// The whole answer set is packed into a single query parameter ("a"). Each
// question contributes one digit in a mixed-radix
// number: digit 0 means "unseen", digit 1 means "skipped", and digit k>1
// selects the (k-1)-th valid answer.
//
// The combined value is a single BigInt rendered as base64url. A fully
// answered 50-question survey is ~22 characters; partial progress is smaller.

import { QUESTIONS } from "./survey.js";
import data from "./data/wvs.json" with { type: "json" };

const SCALE = new Map(data.questions.map((q) => [q.code, q]));

// One slot per question, in survey order. `values` is the ordered list of raw
// answer values; the index into it (plus one) is what we store.
const SLOTS = QUESTIONS.map((q) => {
  let values;
  if (q.type === "choice") {
    values = q.options.map((o) => o.value);
  } else {
    const s = SCALE.get(q.code);
    values = [];
    for (let v = s.min; v <= s.max; v++) values.push(v);
  }
  return { code: q.code, values, radix: values.length + 2 };
});

function bigToBase64url(n) {
  if (n <= 0n) return "";
  let hex = n.toString(16);
  if (hex.length % 2) hex = "0" + hex;
  let bin = "";
  for (let i = 0; i < hex.length; i += 2) {
    bin += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16));
  }
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64urlToBig(str) {
  let b64 = str.replace(/-/g, "+").replace(/_/g, "/");
  while (b64.length % 4) b64 += "=";
  const bin = atob(b64);
  let n = 0n;
  for (let i = 0; i < bin.length; i++) n = (n << 8n) | BigInt(bin.charCodeAt(i));
  return n;
}

// answers: Map<code, rawValue>, skipped: Set<code> -> compact string.
//
// Slots are folded in reverse so the first question is the least-significant
// digit. Because users progress front-to-back, answering only the early
// questions keeps the encoded number (and thus the URL) small.
export function encodeProgress(answers, skipped = new Set()) {
  let acc = 0n;
  for (let i = SLOTS.length - 1; i >= 0; i--) {
    const slot = SLOTS[i];
    let digit = 0;
    if (answers.has(slot.code)) {
      const idx = slot.values.indexOf(answers.get(slot.code));
      if (idx >= 0) digit = idx + 2;
    } else if (skipped.has(slot.code)) {
      digit = 1;
    }
    acc = acc * BigInt(slot.radix) + BigInt(digit);
  }
  return bigToBase64url(acc);
}

// compact string -> { answers, skipped }. Tolerant of malformed input.
export function decodeProgress(str) {
  const answers = new Map();
  const skipped = new Set();
  if (!str) return { answers, skipped };
  let acc;
  try {
    acc = base64urlToBig(str);
  } catch {
    return { answers, skipped };
  }
  for (let i = 0; i < SLOTS.length; i++) {
    const slot = SLOTS[i];
    const r = BigInt(slot.radix);
    const digit = Number(acc % r);
    acc = acc / r;
    if (digit === 1) {
      skipped.add(slot.code);
    } else if (digit > 1 && slot.values[digit - 2] !== undefined) {
      answers.set(slot.code, slot.values[digit - 2]);
    }
  }
  return { answers, skipped };
}
