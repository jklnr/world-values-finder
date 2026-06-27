// Pluggable scoring metrics for country matching.
//
// The predictiveness engine (question-info.js) is written against this small
// interface and never references MSE directly, so swapping in a different
// notion of "distance between a user and a country" later means writing a new
// metric object here -- no engine changes.
//
// A metric scores how far an answer profile is from a country. All values are
// in normalized [0,1] space (the same space src/data/wvs.json stores).
//
//   cost(answerNorm, countryNorm) -> per-question contribution (>= 0)
//   aggregate(costs[])            -> combine per-question contributions
//   lowerIsBetter                 -> ranking direction
//
// MSE today = squared error per question, averaged over the answered/covered
// overlap, lower is better. This mirrors rankCountries() in src/match.js.

export const mseMetric = {
  name: "mse",
  cost: (answerNorm, countryNorm) => {
    const d = answerNorm - countryNorm;
    return d * d;
  },
  aggregate: (costs) => {
    if (costs.length === 0) return 1; // no overlap -> worst score (matches match.js)
    let s = 0;
    for (const c of costs) s += c;
    return s / costs.length;
  },
  lowerIsBetter: true,
};

// Manhattan / mean-absolute-error variant. Not used by the app yet; it exists
// so the engine and its tests demonstrate true metric-agnosticism.
export const maeMetric = {
  name: "mae",
  cost: (answerNorm, countryNorm) => Math.abs(answerNorm - countryNorm),
  aggregate: (costs) => {
    if (costs.length === 0) return 1;
    let s = 0;
    for (const c of costs) s += c;
    return s / costs.length;
  },
  lowerIsBetter: true,
};

// Convenience: turn a metric's aggregate into a comparison that always sorts
// "best first" regardless of direction.
export function comparator(metric) {
  return metric.lowerIsBetter ? (a, b) => a - b : (a, b) => b - a;
}
