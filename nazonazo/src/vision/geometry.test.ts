import { describe, expect, it } from 'vitest';
import { orderCorners } from './engine';

describe('四隅の順序', () => {
  it('回転した四角形でも各点を一度ずつ左上始まりの時計回りに並べる', () => {
    const points = [
      { x: 100, y: 10 },
      { x: 190, y: 100 },
      { x: 100, y: 190 },
      { x: 10, y: 100 },
    ];

    const ordered = orderCorners(points);

    expect(new Set(ordered.map(({ x, y }) => `${x}:${y}`))).toHaveLength(4);
    expect(ordered[0]).toEqual({ x: 100, y: 10 });
    expect(ordered).toEqual([points[0], points[1], points[2], points[3]]);
  });
});
