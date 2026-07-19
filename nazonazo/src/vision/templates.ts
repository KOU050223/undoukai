import type { BackgroundId, Bounds, ForegroundId, Modifier } from '../domain';

export const REFERENCE_SIZE = { width: 1704, height: 958 } as const;

const cell = (x: number, y: number): Bounds => ({ x: x + 8, y: y + 8, width: 115, height: 115 });

export const FOREGROUND_CROPS: Record<ForegroundId, Bounds> = {
  dinosaur: cell(1434, 149),
  dragon: cell(1434, 280),
  skull: cell(1434, 412),
  baby: cell(1434, 544),
  shark: cell(1434, 675),
  n: cell(126, 149),
};

export const BACKGROUND_CROPS: Record<Exclude<BackgroundId, 'none'>, Bounds> = {
  star: cell(1304, 149),
  circles: cell(1173, 149),
  flower: cell(1043, 149),
  diamond: cell(912, 149),
  cross: cell(782, 149),
  x: cell(651, 149),
  loops: cell(521, 149),
  squares: cell(390, 149),
  petals: cell(258, 149),
};

export const MODIFIER_CROPS: Record<Modifier, Bounds> = {
  dakuten: { x: 158, y: 382, width: 70, height: 76 },
  handakuten: { x: 158, y: 563, width: 70, height: 76 },
};

export const SAMPLE_FOREGROUND_CROPS: Array<{ id: ForegroundId; bounds: Bounds }> = [
  { id: 'dinosaur', bounds: { x: 247, y: 89, width: 100, height: 92 } },
  { id: 'n', bounds: { x: 133, y: 105, width: 99, height: 62 } },
  { id: 'baby', bounds: { x: 377, y: 226, width: 99, height: 91 } },
  { id: 'dragon', bounds: { x: 593, y: 229, width: 97, height: 67 } },
  { id: 'shark', bounds: { x: 696, y: 81, width: 102, height: 90 } },
];

export const SAMPLE_BACKGROUND_CROPS: Array<{ id: Exclude<BackgroundId, 'none'>; bounds: Bounds }> = [
  { id: 'cross', bounds: { x: 21, y: 73, width: 105, height: 110 } },
  { id: 'cross', bounds: { x: 247, y: 89, width: 100, height: 92 } },
  { id: 'cross', bounds: { x: 134, y: 226, width: 97, height: 92 } },
  { id: 'flower', bounds: { x: 29, y: 227, width: 103, height: 96 } },
  { id: 'flower', bounds: { x: 575, y: 80, width: 98, height: 96 } },
  { id: 'squares', bounds: { x: 269, y: 226, width: 101, height: 91 } },
  { id: 'squares', bounds: { x: 377, y: 226, width: 99, height: 91 } },
  { id: 'diamond', bounds: { x: 484, y: 227, width: 101, height: 88 } },
  { id: 'x', bounds: { x: 696, y: 81, width: 102, height: 90 } },
];

export const SAMPLE_MODIFIER_CROPS: Array<{ id: Modifier; bounds: Bounds }> = [
  { id: 'handakuten', bounds: { x: 94, y: 56, width: 47, height: 53 } },
  { id: 'dakuten', bounds: { x: 225, y: 204, width: 47, height: 52 } },
  { id: 'dakuten', bounds: { x: 662, y: 56, width: 47, height: 53 } },
];

export const SAMPLE_QUESTION_CROP: Bounds = { x: 396, y: 411, width: 25, height: 22 };
