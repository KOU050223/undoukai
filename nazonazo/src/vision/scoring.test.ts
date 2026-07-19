import { describe, expect, it } from 'vitest';
import { confidenceFromScores, maskDistance } from './scoring';

describe('テンプレート照合スコア', () => {
  it('同じマスクの距離を0にする', () => {
    expect(maskDistance(new Uint8Array([0, 255, 255]), new Uint8Array([0, 255, 255]))).toBe(0);
  });

  it('白背景を除外し、インク画素の重なりを距離にする', () => {
    expect(maskDistance(new Uint8Array([0, 255, 0, 255]), new Uint8Array([255, 255, 0, 0]))).toBeCloseTo(2 / 3);
  });

  it('広い白背景が一致してもインク位置が違えば最大距離にする', () => {
    expect(maskDistance(new Uint8Array([255, 0, 0, 0, 0]), new Uint8Array([0, 0, 0, 0, 255]))).toBe(1);
  });

  it('1位が近く2位との差が大きいほど高信頼にする', () => {
    expect(confidenceFromScores([0.08, 0.4, 0.7])).toBeGreaterThan(0.8);
    expect(confidenceFromScores([0.3, 0.31, 0.7])).toBeLessThan(0.5);
  });

  it('候補が1つだけなら存在しない2位との差を加点しない', () => {
    expect(confidenceFromScores([0.2])).toBeCloseTo(0.52);
  });
});
