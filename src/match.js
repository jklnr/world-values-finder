// Country alignment via mean squared error (MSE).
//
// The user's raw answer to a question is normalized to [0,1] using that
// question's scale (the same normalization applied to the country means in
// the data build). Alignment to a country is the MSE between the user's
// normalized answers and the country's normalized means, computed only over
// the questions the user has answered AND the country has data for.
//
// Lower MSE = closer alignment. We surface a friendly match score:
//   match = (1 - sqrt(MSE)) * 100   (clamped to [0, 100])

import data from "./data/wvs.json" with { type: "json" };

const SCALE = new Map(data.questions.map((q) => [q.code, q]));

export const COUNTRIES = data.countries;
export const SOURCE = data.source;

export function normalizeAnswer(code, rawValue) {
  const q = SCALE.get(code);
  if (!q) return null;
  return (rawValue - q.min) / (q.max - q.min);
}

// answers: Map<code, rawValue>  ->  ranked array of { ...country, mse, match, overlap }
export function rankCountries(answers) {
  const normUser = new Map();
  for (const [code, raw] of answers) {
    const n = normalizeAnswer(code, raw);
    if (n !== null) normUser.set(code, n);
  }

  const ranked = COUNTRIES.map((country) => {
    let sumSq = 0;
    let overlap = 0;
    for (const [code, userNorm] of normUser) {
      const cv = country.values[code];
      if (cv === undefined) continue;
      const diff = userNorm - cv;
      sumSq += diff * diff;
      overlap += 1;
    }
    const mse = overlap > 0 ? sumSq / overlap : 1;
    const match = Math.max(0, Math.min(100, (1 - Math.sqrt(mse)) * 100));
    return { ...country, mse, match, overlap };
  }).filter((c) => c.overlap > 0);

  ranked.sort((a, b) => a.mse - b.mse);
  return ranked;
}
