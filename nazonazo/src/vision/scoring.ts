export function maskDistance(a: Uint8Array, b: Uint8Array) {
  if (a.length !== b.length || a.length === 0) return 1;
  let intersection = 0;
  let union = 0;
  for (let index = 0; index < a.length; index += 1) {
    const aInk = a[index] >= 128;
    const bInk = b[index] >= 128;
    if (aInk || bInk) union += 1;
    if (aInk && bInk) intersection += 1;
  }
  return union === 0 ? 0 : 1 - intersection / union;
}

export function confidenceFromScores(scores: number[]) {
  if (scores.length === 0) return 0;
  const sorted = [...scores].sort((a, b) => a - b);
  const best = sorted[0];
  const second = sorted[1];
  const quality = clamp(1 - best);
  const separation = second === undefined ? 0 : clamp((second - best) * 2);
  return clamp(quality * 0.65 + separation * 0.35);
}

function clamp(value: number) {
  return Math.max(0, Math.min(1, value));
}
