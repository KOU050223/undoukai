import { describe, expect, it } from 'vitest';
import { assignLines, assignTokenLines, denseRegion, mergeNearbyBounds } from './layout';
import type { DetectedToken } from '../domain';

describe('文字領域のグルーピング', () => {
  it('同じ文字を構成する近接矩形をまとめる', () => {
    const merged = mergeNearbyBounds([
      { x: 10, y: 10, width: 20, height: 30 },
      { x: 27, y: 14, width: 18, height: 22 },
      { x: 90, y: 12, width: 30, height: 30 },
    ], 0.25);

    expect(merged).toEqual([
      { x: 10, y: 10, width: 35, height: 30 },
      { x: 90, y: 12, width: 30, height: 30 },
    ]);
  });

  it('Y方向の重なりから行番号を付け、行内を左から右へ返す', () => {
    const result = assignLines([
      { x: 80, y: 12, width: 20, height: 30 },
      { x: 10, y: 70, width: 20, height: 30 },
      { x: 10, y: 10, width: 20, height: 30 },
    ]);

    expect(result.map(({ bounds, line }) => [bounds.x, line])).toEqual([
      [10, 0],
      [80, 0],
      [10, 1],
    ]);
  });
});

describe('問題領域の選択', () => {
  it('近接する灰色図形の最大クラスタを選び、離れた注釈を除外する', () => {
    const region = denseRegion([
      { x: 70, y: 90, width: 70, height: 70 },
      { x: 190, y: 95, width: 70, height: 70 },
      { x: 310, y: 100, width: 70, height: 70 },
      { x: 80, y: 240, width: 70, height: 70 },
      { x: 210, y: 245, width: 70, height: 70 },
      { x: 1220, y: 280, width: 40, height: 40 },
    ], 180, 180);

    expect(region).toEqual({ x: 70, y: 90, width: 310, height: 225 });
  });
});

describe('修飾記号の行帰属', () => {
  it('文字の上にあるサイを最も近い文字と同じ行にする', () => {
    const glyphs = [token('glyph', 70, 130, 0), token('glyph', 190, 130, 0)];
    const modifier = token('modifier', 120, 80, 0);
    modifier.modifier = 'handakuten';

    const result = assignTokenLines([...glyphs, modifier]);

    expect(result.find(({ kind }) => kind === 'modifier')?.line).toBe(0);
  });
});

function token(kind: DetectedToken['kind'], x: number, y: number, line: number): DetectedToken {
  return {
    id: `${kind}-${x}-${y}`,
    kind,
    bounds: { x, y, width: kind === 'modifier' ? 35 : 80, height: kind === 'modifier' ? 35 : 60 },
    line,
    kana: kind === 'glyph' ? 'は' : undefined,
    confidence: 1,
    candidates: [],
  };
}
