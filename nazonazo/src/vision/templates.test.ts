import { describe, expect, it } from 'vitest';
import {
  BACKGROUND_CROPS,
  FOREGROUND_CROPS,
  MODIFIER_CROPS,
  REFERENCE_SIZE,
  SAMPLE_BACKGROUND_CROPS,
  SAMPLE_FOREGROUND_CROPS,
  SAMPLE_MODIFIER_CROPS,
} from './templates';

describe('対応表PNGのテンプレート定義', () => {
  it('前景6種、背景9種、修飾2種を画像内から切り出す', () => {
    expect(REFERENCE_SIZE).toEqual({ width: 1704, height: 958 });
    expect(Object.keys(FOREGROUND_CROPS)).toHaveLength(6);
    expect(Object.keys(BACKGROUND_CROPS)).toHaveLength(9);
    expect(Object.keys(MODIFIER_CROPS)).toHaveLength(2);

    for (const crop of [
      ...Object.values(FOREGROUND_CROPS),
      ...Object.values(BACKGROUND_CROPS),
      ...Object.values(MODIFIER_CROPS),
    ]) {
      expect(crop.x).toBeGreaterThanOrEqual(0);
      expect(crop.y).toBeGreaterThanOrEqual(0);
      expect(crop.x + crop.width).toBeLessThanOrEqual(REFERENCE_SIZE.width);
      expect(crop.y + crop.height).toBeLessThanOrEqual(REFERENCE_SIZE.height);
    }
  });

  it('実問題画像から追加テンプレートを用意する', () => {
    expect(SAMPLE_FOREGROUND_CROPS.map(({ id }) => id)).toEqual(['dinosaur', 'n', 'baby', 'dragon', 'shark']);
    expect(SAMPLE_BACKGROUND_CROPS).toHaveLength(9);
    expect(SAMPLE_MODIFIER_CROPS).toHaveLength(3);
  });
});
