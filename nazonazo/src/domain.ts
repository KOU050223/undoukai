export type ForegroundId = 'dinosaur' | 'dragon' | 'skull' | 'baby' | 'shark' | 'n';
export type BackgroundId =
  | 'none'
  | 'star'
  | 'circles'
  | 'flower'
  | 'diamond'
  | 'cross'
  | 'x'
  | 'loops'
  | 'squares'
  | 'petals';
export type Modifier = 'dakuten' | 'handakuten';

export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RecognitionCandidate {
  kana: string;
  confidence: number;
}

export interface DetectedToken {
  id: string;
  kind: 'glyph' | 'modifier' | 'question' | 'unknown';
  bounds: Bounds;
  line: number;
  kana?: string;
  foreground?: ForegroundId;
  background?: BackgroundId;
  modifier?: Modifier;
  confidence: number;
  candidates: RecognitionCandidate[];
}

const FOREGROUNDS: Exclude<ForegroundId, 'n'>[] = [
  'dinosaur',
  'dragon',
  'skull',
  'baby',
  'shark',
];

const COLUMNS: Array<{ background: BackgroundId; kana: Array<string | null> }> = [
  { background: 'none', kana: ['あ', 'い', 'う', 'え', 'お'] },
  { background: 'star', kana: ['か', 'き', 'く', 'け', 'こ'] },
  { background: 'circles', kana: ['さ', 'し', 'す', 'せ', 'そ'] },
  { background: 'flower', kana: ['た', 'ち', 'つ', 'て', 'と'] },
  { background: 'diamond', kana: ['な', 'に', 'ぬ', 'ね', 'の'] },
  { background: 'cross', kana: ['は', 'ひ', 'ふ', 'へ', 'ほ'] },
  { background: 'x', kana: ['ま', 'み', 'む', 'め', 'も'] },
  { background: 'loops', kana: ['や', null, 'ゆ', null, 'よ'] },
  { background: 'squares', kana: ['ら', 'り', 'る', 'れ', 'ろ'] },
  { background: 'petals', kana: ['わ', null, null, null, 'を'] },
];

const KANA_TO_PARTS = new Map<string, { foreground: ForegroundId; background: BackgroundId }>();
const PARTS_TO_KANA = new Map<string, string>();

for (const column of COLUMNS) {
  column.kana.forEach((kana, index) => {
    if (!kana) return;
    const parts = { foreground: FOREGROUNDS[index], background: column.background };
    KANA_TO_PARTS.set(kana, parts);
    PARTS_TO_KANA.set(key(parts.foreground, parts.background), kana);
  });
}
KANA_TO_PARTS.set('ん', { foreground: 'n', background: 'none' });
PARTS_TO_KANA.set(key('n', 'none'), 'ん');

const DAKUTEN: Record<string, string> = {
  か: 'が', き: 'ぎ', く: 'ぐ', け: 'げ', こ: 'ご',
  さ: 'ざ', し: 'じ', す: 'ず', せ: 'ぜ', そ: 'ぞ',
  た: 'だ', ち: 'ぢ', つ: 'づ', て: 'で', と: 'ど',
  は: 'ば', ひ: 'び', ふ: 'ぶ', へ: 'べ', ほ: 'ぼ',
};

const HANDAKUTEN: Record<string, string> = {
  は: 'ぱ', ひ: 'ぴ', ふ: 'ぷ', へ: 'ぺ', ほ: 'ぽ',
};

export const ALL_KANA = [...KANA_TO_PARTS.keys()];

export function partsFromKana(kana: string) {
  return KANA_TO_PARTS.get(kana) ?? null;
}

export function kanaFromParts(foreground: ForegroundId, background: BackgroundId) {
  return PARTS_TO_KANA.get(key(foreground, background)) ?? null;
}

export function applyModifier(kana: string, modifier: Modifier) {
  const table = modifier === 'dakuten' ? DAKUTEN : HANDAKUTEN;
  return table[kana] ?? kana;
}

export function tokensToText(tokens: DetectedToken[]) {
  const lines = new Map<number, DetectedToken[]>();
  for (const token of tokens) {
    const line = lines.get(token.line) ?? [];
    line.push(token);
    lines.set(token.line, line);
  }

  return [...lines.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, line]) => {
      const output: string[] = [];
      for (const token of line.sort((a, b) => a.bounds.x - b.bounds.x)) {
        if (token.kind === 'modifier') {
          const previous = output.at(-1);
          if (previous && token.modifier) output[output.length - 1] = applyModifier(previous, token.modifier);
        } else if (token.kind === 'question') {
          output.push('？');
        } else if (token.kind === 'glyph') {
          output.push(token.kana ?? '□');
        } else {
          output.push('□');
        }
      }
      return output.join('');
    })
    .join('\n');
}

function key(foreground: ForegroundId, background: BackgroundId) {
  return `${foreground}:${background}`;
}
