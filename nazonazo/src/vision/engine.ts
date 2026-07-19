import {
  ALL_KANA,
  kanaFromParts,
  partsFromKana,
  type BackgroundId,
  type Bounds,
  type DetectedToken,
  type ForegroundId,
  type Modifier,
} from '../domain';
import { assignTokenLines, denseRegion, mergeNearbyBounds } from './layout';
import { confidenceFromScores, maskDistance } from './scoring';
import {
  BACKGROUND_CROPS,
  FOREGROUND_CROPS,
  MODIFIER_CROPS,
  SAMPLE_BACKGROUND_CROPS,
  SAMPLE_FOREGROUND_CROPS,
  SAMPLE_MODIFIER_CROPS,
  SAMPLE_QUESTION_CROP,
} from './templates';
import referenceUrl from '../../nazonazo_cheat.png?url';
import problemUrl from '../../mondai.png?url';

export interface Point {
  x: number;
  y: number;
}

interface BinaryTemplate {
  id: string;
  mask: Uint8Array;
}

interface TemplateSet {
  foregrounds: BinaryTemplate[];
  backgrounds: BinaryTemplate[];
  modifiers: BinaryTemplate[];
  question: Uint8Array;
}

const MASK_SIZE = 64;
let templatesPromise: Promise<TemplateSet> | null = null;
let openCvPromise: Promise<any> | null = null;

export async function fileToCanvas(file: File) {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const scale = Math.min(1, 2200 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas;
}

export async function detectDocumentCorners(canvas: HTMLCanvasElement): Promise<Point[]> {
  const cv = await getOpenCv();
  const source = cv.imread(canvas);
  const gray = new cv.Mat();
  const blurred = new cv.Mat();
  const edges = new cv.Mat();
  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();
  let best: Point[] | null = null;
  let bestArea = canvas.width * canvas.height * 0.12;

  try {
    cv.cvtColor(source, gray, cv.COLOR_RGBA2GRAY);
    cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 0);
    cv.Canny(blurred, edges, 45, 130);
    cv.findContours(edges, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);

    for (let index = 0; index < contours.size(); index += 1) {
      const contour = contours.get(index);
      const perimeter = cv.arcLength(contour, true);
      const approx = new cv.Mat();
      try {
        cv.approxPolyDP(contour, approx, perimeter * 0.025, true);
        const area = Math.abs(cv.contourArea(approx));
        if (approx.rows !== 4 || area <= bestArea || !cv.isContourConvex(approx)) continue;
        const points: Point[] = [];
        for (let row = 0; row < 4; row += 1) {
          points.push({ x: approx.data32S[row * 2], y: approx.data32S[row * 2 + 1] });
        }
        best = orderCorners(points);
        bestArea = area;
      } finally {
        approx.delete();
        contour.delete();
      }
    }
  } finally {
    source.delete();
    gray.delete();
    blurred.delete();
    edges.delete();
    contours.delete();
    hierarchy.delete();
  }

  return best ?? insetCorners(canvas.width, canvas.height);
}

export async function warpDocument(canvas: HTMLCanvasElement, corners: Point[]) {
  const cv = await getOpenCv();
  const ordered = orderCorners(corners);
  const width = Math.max(distance(ordered[0], ordered[1]), distance(ordered[3], ordered[2]));
  const height = Math.max(distance(ordered[0], ordered[3]), distance(ordered[1], ordered[2]));
  const outputWidth = Math.max(320, Math.round(width));
  const outputHeight = Math.max(180, Math.round(height));
  const source = cv.imread(canvas);
  const destination = new cv.Mat();
  const sourcePoints = cv.matFromArray(4, 1, cv.CV_32FC2, ordered.flatMap((point) => [point.x, point.y]));
  const destinationPoints = cv.matFromArray(4, 1, cv.CV_32FC2, [
    0, 0, outputWidth - 1, 0, outputWidth - 1, outputHeight - 1, 0, outputHeight - 1,
  ]);
  const transform = cv.getPerspectiveTransform(sourcePoints, destinationPoints);
  const output = document.createElement('canvas');
  output.width = outputWidth;
  output.height = outputHeight;

  try {
    cv.warpPerspective(
      source,
      destination,
      transform,
      new cv.Size(outputWidth, outputHeight),
      cv.INTER_LINEAR,
      cv.BORDER_CONSTANT,
      new cv.Scalar(255, 255, 255, 255),
    );
    cv.imshow(output, destination);
  } finally {
    source.delete();
    destination.delete();
    sourcePoints.delete();
    destinationPoints.delete();
    transform.delete();
  }
  return output;
}

export async function recognizeDocument(canvas: HTMLCanvasElement): Promise<DetectedToken[]> {
  const [cv, templates] = await Promise.all([getOpenCv(), getTemplates()]);
  const source = cv.imread(canvas);
  const gray = new cv.Mat();
  const dark = new cv.Mat();
  const grayTone = new cv.Mat();
  const combined = new cv.Mat();
  const kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(3, 3));
  let darkBounds: Bounds[] = [];
  let grayBounds: Bounds[] = [];

  try {
    cv.cvtColor(source, gray, cv.COLOR_RGBA2GRAY);
    cv.GaussianBlur(gray, gray, new cv.Size(3, 3), 0);
    cv.threshold(gray, dark, 142, 255, cv.THRESH_BINARY_INV);
    cv.threshold(gray, combined, 238, 255, cv.THRESH_BINARY_INV);
    const imageArea = canvas.width * canvas.height;
    cv.subtract(combined, dark, grayTone);
    cv.morphologyEx(grayTone, grayTone, cv.MORPH_OPEN, kernel);
    darkBounds = contourBounds(cv, dark, imageArea, 0.00001);
    grayBounds = contourBounds(cv, grayTone, imageArea, 0.00004);
  } finally {
    source.delete();
    gray.delete();
    dark.delete();
    grayTone.delete();
    combined.delete();
    kernel.delete();
  }

  const grayRegion = grayBounds.length >= 3
    ? denseRegion(grayBounds, canvas.width * 0.15, canvas.height * 0.22)
    : null;
  const grayScale = median(grayBounds.map((bounds) => Math.max(bounds.width, bounds.height))) || canvas.height * 0.08;
  const symbolRegion = grayRegion
    ? clampBounds(expandBounds(grayRegion, grayScale * 1.05), canvas.width, canvas.height)
    : { x: 0, y: 0, width: canvas.width, height: canvas.height };
  darkBounds = darkBounds.filter((bounds) => centerInside(bounds, symbolRegion));
  grayBounds = grayBounds.filter((bounds) => centerInside(bounds, symbolRegion));
  const grayGroups = mergeNearbyBounds(grayBounds, 0.25);

  const typicalDarkArea = median(darkBounds.map((bounds) => bounds.width * bounds.height));
  const anchors = darkBounds.filter((bounds) => {
    const area = bounds.width * bounds.height;
    return area >= typicalDarkArea * 0.58 && bounds.width >= Math.sqrt(typicalDarkArea) * 0.65;
  });
  const anchorBounds = anchors.map((anchor) => {
    const relatedGray = grayGroups.filter((background) => nearestBounds(background, anchors) === anchor);
    return relatedGray.reduce(unionBounds, anchor);
  });
  const leftovers = darkBounds.filter((bounds) => !anchors.includes(bounds));
  const extraBounds = mergeVerticalParts(leftovers)
    .filter((bounds) => bounds.width * bounds.height >= typicalDarkArea * 0.045)
    .filter((bounds) => bounds.width / bounds.height < 1.8);
  const candidates = [
    ...anchorBounds.map((bounds) => ({ bounds, anchor: true })),
    ...extraBounds.map((bounds) => ({ bounds, anchor: false })),
  ];
  const context = canvas.getContext('2d', { willReadFrequently: true })!;
  const classifyBounds = (bounds: Bounds, index: number, exclusions: Bounds[] = []) => {
    const padding = Math.max(3, Math.round(Math.min(bounds.width, bounds.height) * 0.08));
    const padded = clampBounds({
      x: bounds.x - padding,
      y: bounds.y - padding,
      width: bounds.width + padding * 2,
      height: bounds.height + padding * 2,
    }, canvas.width, canvas.height);
    const image = context.getImageData(padded.x, padded.y, padded.width, padded.height);
    const foregroundImage = new ImageData(
      new Uint8ClampedArray(image.data),
      image.width,
      image.height,
    );
    eraseRegions(foregroundImage, padded, exclusions);
    return classifyToken(foregroundImage, padded, 0, index, templates, image);
  };
  const extraTokens = candidates
    .filter(({ anchor }) => !anchor)
    .map(({ bounds }, index) => classifyBounds(bounds, index));
  const modifierBounds = extraTokens.filter(({ kind }) => kind === 'modifier').map(({ bounds }) => bounds);
  const anchorTokens = candidates
    .filter(({ anchor }) => anchor)
    .map(({ bounds }, index) => classifyBounds(bounds, extraTokens.length + index, modifierBounds));
  const classified = [
    ...anchorTokens.map((token) => ({ token, anchor: true })),
    ...extraTokens.map((token) => ({ token, anchor: false })),
  ];
  const kept = classified
    .filter(({ token, anchor }) => anchor || token.kind === 'modifier' || token.kind === 'question')
    .map(({ token }) => token);
  return assignTokenLines(kept);
}

export async function recognizeOrientedDocument(canvas: HTMLCanvasElement) {
  if (canvas.width >= canvas.height) {
    return { canvas, tokens: await recognizeDocument(canvas) };
  }

  const candidates = [rotateCanvas(canvas, -1), rotateCanvas(canvas, 1)];
  const results = [];
  for (const candidate of candidates) {
    results.push({ canvas: candidate, tokens: await recognizeDocument(candidate) });
  }
  return results.sort((a, b) => recognitionScore(b.tokens) - recognitionScore(a.tokens))[0];
}

function rotateCanvas(source: HTMLCanvasElement, quarterTurns: -1 | 1) {
  const output = document.createElement('canvas');
  output.width = source.height;
  output.height = source.width;
  const context = output.getContext('2d')!;
  if (quarterTurns === 1) {
    context.translate(output.width, 0);
    context.rotate(Math.PI / 2);
  } else {
    context.translate(0, output.height);
    context.rotate(-Math.PI / 2);
  }
  context.drawImage(source, 0, 0);
  return output;
}

function recognitionScore(tokens: DetectedToken[]) {
  return tokens.reduce((score, token) => (
    token.kind === 'unknown' ? score : score + 1 + token.confidence
  ), 0);
}

function classifyToken(
  image: ImageData,
  bounds: Bounds,
  line: number,
  index: number,
  templates: TemplateSet,
  backgroundImage = image,
): DetectedToken {
  const darkMask = normalizedMask(image, (value) => value < 142);
  const grayMask = normalizedGrayMask(backgroundImage);
  const foregroundScores = scoreTemplates(darkMask, templates.foregrounds);
  const backgroundScores = [
    { id: 'none', score: inkRatio(grayMask) },
    ...scoreTemplates(grayMask, templates.backgrounds),
  ].sort((a, b) => a.score - b.score);
  const modifierScores = scoreTemplates(darkMask, templates.modifiers);
  const questionScore = maskDistance(darkMask, templates.question);

  const kanaCandidates = ALL_KANA.map((kana) => {
    const parts = partsFromKana(kana)!;
    const foreground = foregroundScores.find((score) => score.id === parts.foreground)?.score ?? 1;
    const background = backgroundScores.find((score) => score.id === parts.background)?.score ?? 1;
    return { kana, score: foreground * 0.68 + background * 0.32 };
  }).sort((a, b) => a.score - b.score);
  const bestKana = kanaCandidates[0];
  const bestModifier = modifierScores[0];
  const tokenBase = { id: `token-${index}`, bounds, line };

  if (bestModifier && bestModifier.score < Math.min(0.45, bestKana.score - 0.04)) {
    return {
      ...tokenBase,
      kind: 'modifier',
      modifier: bestModifier.id as Modifier,
      confidence: confidenceFromScores(modifierScores.map(({ score }) => score)),
      candidates: [],
    };
  }
  if (questionScore < 0.7) {
    return { ...tokenBase, kind: 'question', confidence: 1 - questionScore, candidates: [] };
  }
  if (bestKana.score > 0.52) {
    return { ...tokenBase, kind: 'unknown', confidence: 0, candidates: [] };
  }

  const parts = partsFromKana(bestKana.kana)!;
  return {
    ...tokenBase,
    kind: 'glyph',
    kana: bestKana.kana,
    foreground: parts.foreground,
    background: parts.background,
    confidence: confidenceFromScores(kanaCandidates.map(({ score }) => score)),
    candidates: kanaCandidates.slice(0, 4).map(({ kana, score }) => ({ kana, confidence: 1 - score })),
  };
}

async function getTemplates(): Promise<TemplateSet> {
  if (!templatesPromise) {
    templatesPromise = buildTemplates().catch((error) => {
      templatesPromise = null;
      throw error;
    });
  }
  return templatesPromise;
}

async function buildTemplates(): Promise<TemplateSet> {
  const [image, problemImage] = await Promise.all([loadImage(referenceUrl), loadImage(problemUrl)]);
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext('2d', { willReadFrequently: true })!;
  context.drawImage(image, 0, 0);

  const foregrounds = Object.entries(FOREGROUND_CROPS).map(([id, crop]) => ({
    id,
    mask: normalizedMask(context.getImageData(crop.x, crop.y, crop.width, crop.height), (value) => value < 142),
  }));
  const backgrounds = Object.entries(BACKGROUND_CROPS).map(([id, crop]) => ({
    id,
    mask: normalizedGrayMask(context.getImageData(crop.x, crop.y, crop.width, crop.height)),
  }));
  const modifiers = Object.entries(MODIFIER_CROPS).map(([id, crop]) => ({
    id,
    mask: normalizedMask(context.getImageData(crop.x, crop.y, crop.width, crop.height), (value) => value < 142),
  }));
  const problemCanvas = document.createElement('canvas');
  problemCanvas.width = problemImage.naturalWidth;
  problemCanvas.height = problemImage.naturalHeight;
  problemCanvas.getContext('2d')!.drawImage(problemImage, 0, 0);
  const calibratedProblem = await warpDocument(
    problemCanvas,
    insetCorners(problemCanvas.width, problemCanvas.height),
  );
  const problemContext = calibratedProblem.getContext('2d', { willReadFrequently: true })!;
  foregrounds.push(...SAMPLE_FOREGROUND_CROPS.map(({ id, bounds }) => ({
    id,
    mask: normalizedMask(
      problemContext.getImageData(bounds.x, bounds.y, bounds.width, bounds.height),
      (value) => value < 142,
    ),
  })));
  backgrounds.push(...SAMPLE_BACKGROUND_CROPS.map(({ id, bounds }) => ({
    id,
    mask: normalizedGrayMask(problemContext.getImageData(bounds.x, bounds.y, bounds.width, bounds.height)),
  })));
  modifiers.push(...SAMPLE_MODIFIER_CROPS.map(({ id, bounds }) => ({
    id,
    mask: normalizedMask(
      problemContext.getImageData(bounds.x, bounds.y, bounds.width, bounds.height),
      (value) => value < 142,
    ),
  })));
  const questionImage = problemContext.getImageData(
    SAMPLE_QUESTION_CROP.x,
    SAMPLE_QUESTION_CROP.y,
    SAMPLE_QUESTION_CROP.width,
    SAMPLE_QUESTION_CROP.height,
  );
  const question = normalizedMask(
    questionImage,
    (value) => value < 142,
  );
  return { foregrounds, backgrounds, modifiers, question };
}

function normalizedMask(
  image: ImageData,
  includes: (brightness: number, x: number, y: number) => boolean,
  frameIncludes = includes,
  framePaddingRatio = 0,
) {
  const binary = new Uint8Array(image.width * image.height);
  let minX = image.width;
  let minY = image.height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const offset = (y * image.width + x) * 4;
      const brightness = image.data[offset] * 0.299 + image.data[offset + 1] * 0.587 + image.data[offset + 2] * 0.114;
      if (includes(brightness, x, y)) binary[y * image.width + x] = 255;
      if (!frameIncludes(brightness, x, y)) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  if (maxX < minX || maxY < minY) return new Uint8Array(MASK_SIZE * MASK_SIZE);

  const framePadding = Math.round(Math.max(maxX - minX + 1, maxY - minY + 1) * framePaddingRatio);
  minX = Math.max(0, minX - framePadding);
  minY = Math.max(0, minY - framePadding);
  maxX = Math.min(image.width - 1, maxX + framePadding);
  maxY = Math.min(image.height - 1, maxY + framePadding);

  const output = new Uint8Array(MASK_SIZE * MASK_SIZE);
  const sourceWidth = maxX - minX + 1;
  const sourceHeight = maxY - minY + 1;
  const scale = Math.min((MASK_SIZE - 10) / sourceWidth, (MASK_SIZE - 10) / sourceHeight);
  const targetWidth = Math.max(1, Math.round(sourceWidth * scale));
  const targetHeight = Math.max(1, Math.round(sourceHeight * scale));
  const offsetX = Math.floor((MASK_SIZE - targetWidth) / 2);
  const offsetY = Math.floor((MASK_SIZE - targetHeight) / 2);

  for (let y = 0; y < targetHeight; y += 1) {
    for (let x = 0; x < targetWidth; x += 1) {
      const sourceX = minX + Math.min(sourceWidth - 1, Math.floor(x / scale));
      const sourceY = minY + Math.min(sourceHeight - 1, Math.floor(y / scale));
      output[(offsetY + y) * MASK_SIZE + offsetX + x] = binary[sourceY * image.width + sourceX];
    }
  }
  return output;
}

function normalizedGrayMask(image: ImageData) {
  const brightness = new Float32Array(image.width * image.height);
  for (let index = 0; index < brightness.length; index += 1) {
    const offset = index * 4;
    brightness[index] = image.data[offset] * 0.299 + image.data[offset + 1] * 0.587 + image.data[offset + 2] * 0.114;
  }
  const includesGray = (value: number, x: number, y: number) => {
    if (value < 155 || value >= 238) return false;
    for (let offsetY = -2; offsetY <= 2; offsetY += 1) {
      for (let offsetX = -2; offsetX <= 2; offsetX += 1) {
        const targetX = x + offsetX;
        const targetY = y + offsetY;
        if (targetX < 0 || targetY < 0 || targetX >= image.width || targetY >= image.height) continue;
        if (brightness[targetY * image.width + targetX] < 142) return false;
      }
    }
    return true;
  };
  return normalizedMask(image, includesGray);
}

function scoreTemplates(mask: Uint8Array, templates: BinaryTemplate[]) {
  return templates
    .map((template) => ({ id: template.id, score: maskDistance(mask, template.mask) }))
    .sort((a, b) => a.score - b.score);
}

function inkRatio(mask: Uint8Array) {
  let ink = 0;
  for (const value of mask) if (value) ink += 1;
  return Math.min(1, (ink / mask.length) * 2.5);
}

function contourBounds(cv: any, mask: any, imageArea: number, minContourRatio: number): Bounds[] {
  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();
  const result: Bounds[] = [];
  try {
    cv.findContours(mask, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
    for (let index = 0; index < contours.size(); index += 1) {
      const contour = contours.get(index);
      try {
        if (Math.abs(cv.contourArea(contour)) < imageArea * minContourRatio) continue;
        const rect = cv.boundingRect(contour);
        if (rect.width < 3 || rect.height < 3) continue;
        if (rect.width * rect.height > imageArea * 0.08) continue;
        result.push({ x: rect.x, y: rect.y, width: rect.width, height: rect.height });
      } finally {
        contour.delete();
      }
    }
  } finally {
    contours.delete();
    hierarchy.delete();
  }
  return result;
}

function eraseRegions(image: ImageData, imageBounds: Bounds, exclusions: Bounds[]) {
  for (const exclusion of exclusions) {
    const startX = Math.max(0, Math.floor(exclusion.x - imageBounds.x));
    const startY = Math.max(0, Math.floor(exclusion.y - imageBounds.y));
    const endX = Math.min(image.width, Math.ceil(exclusion.x + exclusion.width - imageBounds.x));
    const endY = Math.min(image.height, Math.ceil(exclusion.y + exclusion.height - imageBounds.y));
    for (let y = startY; y < endY; y += 1) {
      for (let x = startX; x < endX; x += 1) {
        const offset = (y * image.width + x) * 4;
        const brightness = image.data[offset] * 0.299 + image.data[offset + 1] * 0.587 + image.data[offset + 2] * 0.114;
        if (brightness >= 142) continue;
        image.data[offset] = 255;
        image.data[offset + 1] = 255;
        image.data[offset + 2] = 255;
        image.data[offset + 3] = 255;
      }
    }
  }
}

function nearestBounds(target: Bounds, candidates: Bounds[]) {
  return candidates.reduce<Bounds | null>((best, candidate) => {
    if (!best) return candidate;
    return boundsDistance(target, candidate) < boundsDistance(target, best) ? candidate : best;
  }, null);
}

function boundsDistance(a: Bounds, b: Bounds) {
  const aX = a.x + a.width / 2;
  const aY = a.y + a.height / 2;
  const bX = b.x + b.width / 2;
  const bY = b.y + b.height / 2;
  return Math.hypot(aX - bX, aY - bY);
}

function mergeVerticalParts(bounds: Bounds[]) {
  const pending = bounds.map((item) => ({ ...item }));
  const merged: Bounds[] = [];
  while (pending.length) {
    let current = pending.shift()!;
    for (let index = pending.length - 1; index >= 0; index -= 1) {
      const candidate = pending[index];
      const overlap = Math.min(current.x + current.width, candidate.x + candidate.width) - Math.max(current.x, candidate.x);
      const verticalGap = Math.max(current.y, candidate.y) - Math.min(current.y + current.height, candidate.y + candidate.height);
      if (overlap < Math.min(current.width, candidate.width) * 0.45) continue;
      if (verticalGap > Math.max(current.height, candidate.height) * 0.5) continue;
      current = unionBounds(current, candidate);
      pending.splice(index, 1);
    }
    merged.push(current);
  }
  return mergeNearbyBounds(merged, 0.02);
}

function unionBounds(a: Bounds, b: Bounds): Bounds {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    width: Math.max(a.x + a.width, b.x + b.width) - x,
    height: Math.max(a.y + a.height, b.y + b.height) - y,
  };
}

function expandBounds(bounds: Bounds, amount: number): Bounds {
  return {
    x: bounds.x - amount,
    y: bounds.y - amount,
    width: bounds.width + amount * 2,
    height: bounds.height + amount * 2,
  };
}

function centerInside(bounds: Bounds, region: Bounds) {
  const x = bounds.x + bounds.width / 2;
  const y = bounds.y + bounds.height / 2;
  return x >= region.x && x <= region.x + region.width && y >= region.y && y <= region.y + region.height;
}

function median(values: number[]) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

async function getOpenCv(): Promise<any> {
  if (!openCvPromise) {
    openCvPromise = (async () => {
      const imported = await import('@techstark/opencv-js');
      const module = imported.default;
      const cv = module instanceof Promise ? await module : module;
      if (cv.Mat) return cv;
      await new Promise<void>((resolve) => { cv.onRuntimeInitialized = resolve; });
      return cv;
    })().catch((error) => {
      openCvPromise = null;
      throw error;
    });
  }
  return openCvPromise;
}

function loadImage(url: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('対応表画像を読み込めませんでした。'));
    image.src = url;
  });
}

export function orderCorners(points: Point[]) {
  const center = {
    x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
    y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
  };
  const cyclic = [...points].sort(
    (a, b) => Math.atan2(a.y - center.y, a.x - center.x) - Math.atan2(b.y - center.y, b.x - center.x),
  );
  const start = cyclic.reduce((bestIndex, point, index) => {
    const best = cyclic[bestIndex];
    return point.y < best.y || (point.y === best.y && point.x < best.x) ? index : bestIndex;
  }, 0);
  return [...cyclic.slice(start), ...cyclic.slice(0, start)];
}

function insetCorners(width: number, height: number) {
  const x = width * 0.03;
  const y = height * 0.03;
  return [
    { x, y },
    { x: width - x, y },
    { x: width - x, y: height - y },
    { x, y: height - y },
  ];
}

function clampBounds(bounds: Bounds, width: number, height: number): Bounds {
  const x = Math.max(0, Math.floor(bounds.x));
  const y = Math.max(0, Math.floor(bounds.y));
  return {
    x,
    y,
    width: Math.max(1, Math.min(width - x, Math.ceil(bounds.width))),
    height: Math.max(1, Math.min(height - y, Math.ceil(bounds.height))),
  };
}

function distance(a: Point, b: Point) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function partsToKana(foreground: ForegroundId, background: BackgroundId) {
  return kanaFromParts(foreground, background);
}
