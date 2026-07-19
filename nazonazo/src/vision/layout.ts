import type { Bounds, DetectedToken } from '../domain';

export function mergeNearbyBounds(bounds: Bounds[], gapRatio = 0.2): Bounds[] {
  const pending = bounds.map((item) => ({ ...item }));
  const result: Bounds[] = [];

  while (pending.length) {
    let current = pending.shift()!;
    let merged = true;
    while (merged) {
      merged = false;
      for (let index = pending.length - 1; index >= 0; index -= 1) {
        if (!shouldMerge(current, pending[index], gapRatio)) continue;
        current = union(current, pending[index]);
        pending.splice(index, 1);
        merged = true;
      }
    }
    result.push(current);
  }

  return result.sort((a, b) => a.y - b.y || a.x - b.x);
}

export function assignLines(bounds: Bounds[]): Array<{ bounds: Bounds; line: number }> {
  const rows: Array<{ centerY: number; height: number; items: Bounds[] }> = [];

  for (const item of [...bounds].sort((a, b) => centerY(a) - centerY(b))) {
    const row = rows.find((candidate) => {
      const tolerance = Math.max(candidate.height, item.height) * 0.55;
      return Math.abs(candidate.centerY - centerY(item)) <= tolerance;
    });
    if (row) {
      row.items.push(item);
      row.centerY = row.items.reduce((sum, value) => sum + centerY(value), 0) / row.items.length;
      row.height = Math.max(row.height, item.height);
    } else {
      rows.push({ centerY: centerY(item), height: item.height, items: [item] });
    }
  }

  return rows
    .sort((a, b) => a.centerY - b.centerY)
    .flatMap((row, line) => row.items.sort((a, b) => a.x - b.x).map((item) => ({ bounds: item, line })));
}

export function denseRegion(bounds: Bounds[], maxGapX: number, maxGapY: number): Bounds | null {
  if (bounds.length === 0) return null;
  const remaining = new Set(bounds.map((_, index) => index));
  const clusters: Bounds[][] = [];

  while (remaining.size) {
    const first = remaining.values().next().value as number;
    remaining.delete(first);
    const cluster = [bounds[first]];
    const queue = [first];
    while (queue.length) {
      const current = bounds[queue.shift()!];
      for (const index of [...remaining]) {
        const candidate = bounds[index];
        if (Math.abs(centerX(current) - centerX(candidate)) > maxGapX) continue;
        if (Math.abs(centerY(current) - centerY(candidate)) > maxGapY) continue;
        remaining.delete(index);
        cluster.push(candidate);
        queue.push(index);
      }
    }
    clusters.push(cluster);
  }

  const best = clusters.sort((a, b) => b.length - a.length || totalArea(b) - totalArea(a))[0];
  return best.reduce(union);
}

export function assignTokenLines(tokens: DetectedToken[]) {
  const modifiers = tokens.filter(({ kind }) => kind === 'modifier');
  const primary = tokens.filter(({ kind }) => kind !== 'modifier');
  const assignments = assignLines(primary.map(({ bounds }) => bounds));
  const result = primary.map((token) => ({
    ...token,
    line: assignments.find(({ bounds }) => bounds === token.bounds)?.line ?? 0,
  }));

  for (const modifier of modifiers) {
    const nearest = result.reduce<DetectedToken | null>((best, token) => {
      if (!best) return token;
      return tokenDistance(modifier, token) < tokenDistance(modifier, best) ? token : best;
    }, null);
    result.push({ ...modifier, line: nearest?.line ?? 0 });
  }
  return result;
}

function shouldMerge(a: Bounds, b: Bounds, gapRatio: number) {
  const horizontalGap = Math.max(a.x, b.x) - Math.min(a.x + a.width, b.x + b.width);
  const verticalGap = Math.max(a.y, b.y) - Math.min(a.y + a.height, b.y + b.height);
  const scale = Math.min(Math.max(a.width, a.height), Math.max(b.width, b.height));
  return horizontalGap <= scale * gapRatio && verticalGap <= scale * gapRatio;
}

function union(a: Bounds, b: Bounds): Bounds {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    width: Math.max(a.x + a.width, b.x + b.width) - x,
    height: Math.max(a.y + a.height, b.y + b.height) - y,
  };
}

function centerY(bounds: Bounds) {
  return bounds.y + bounds.height / 2;
}

function centerX(bounds: Bounds) {
  return bounds.x + bounds.width / 2;
}

function totalArea(bounds: Bounds[]) {
  return bounds.reduce((sum, item) => sum + item.width * item.height, 0);
}

function tokenDistance(a: DetectedToken, b: DetectedToken) {
  return Math.hypot(centerX(a.bounds) - centerX(b.bounds), centerY(a.bounds) - centerY(b.bounds));
}
