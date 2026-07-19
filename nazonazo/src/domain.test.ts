import { describe, expect, it } from 'vitest';
import {
  applyModifier,
  kanaFromParts,
  partsFromKana,
  tokensToText,
  type DetectedToken,
} from './domain';

describe('独自記号の対応表', () => {
  it.each([
    ['あ', 'dinosaur', 'none'],
    ['こ', 'shark', 'star'],
    ['せ', 'baby', 'circles'],
    ['ん', 'n', 'none'],
  ] as const)('%sを前景と背景へ対応付ける', (kana, foreground, background) => {
    expect(partsFromKana(kana)).toEqual({ foreground, background });
    expect(kanaFromParts(foreground, background)).toBe(kana);
  });

  it('存在しない組み合わせを未確定にする', () => {
    expect(kanaFromParts('dragon', 'loops')).toBeNull();
  });
});

describe('濁点・半濁点', () => {
  it.each([
    ['か', 'dakuten', 'が'],
    ['は', 'dakuten', 'ば'],
    ['は', 'handakuten', 'ぱ'],
  ] as const)('%sへ%sを適用して%sにする', (kana, modifier, expected) => {
    expect(applyModifier(kana, modifier)).toBe(expected);
  });

  it('適用できない文字は変更しない', () => {
    expect(applyModifier('あ', 'dakuten')).toBe('あ');
  });
});

describe('読み順と文字列復元', () => {
  it('上から下、左から右へ並べ、右側のサイを直前文字へ適用する', () => {
    const tokens: DetectedToken[] = [
      token('question', 180, 10, 1),
      token('glyph', 100, 10, 1, 'か'),
      token('modifier', 150, 10, 1, undefined, 'dakuten'),
      token('glyph', 10, 80, 2, 'こ'),
    ];

    expect(tokensToText(tokens)).toBe('が？\nこ');
  });
});

function token(
  kind: DetectedToken['kind'],
  x: number,
  y: number,
  line: number,
  kana?: string,
  modifier?: DetectedToken['modifier'],
): DetectedToken {
  return {
    id: `${kind}-${x}-${y}`,
    kind,
    bounds: { x, y, width: 32, height: 32 },
    line,
    kana,
    modifier,
    confidence: 1,
    candidates: [],
  };
}
