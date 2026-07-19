import {
  Camera,
  Copy,
  Crop,
  ImagePlus,
  MousePointerClick,
  Plus,
  ScanLine,
  ShieldCheck,
  Sparkles,
  Table2,
  Trash2,
  X,
  ArrowLeft,
  createIcons,
} from 'lucide';
import './style.css';
import { ALL_KANA, applyModifier, tokensToText, type DetectedToken } from './domain';
import {
  detectDocumentCorners,
  fileToCanvas,
  recognizeDocument,
  warpDocument,
  type Point,
} from './vision/engine';

const icons = { Camera, Copy, Crop, ImagePlus, MousePointerClick, Plus, ScanLine, ShieldCheck, Sparkles, Table2, Trash2, X, ArrowLeft };
createIcons({ icons });

const uploadPhase = element<HTMLElement>('upload-phase');
const cropPhase = element<HTMLElement>('crop-phase');
const resultPhase = element<HTMLElement>('result-phase');
const imageInput = element<HTMLInputElement>('image-input');
const cropCanvas = element<HTMLCanvasElement>('crop-canvas');
const resultCanvas = element<HTMLCanvasElement>('result-canvas');
const cornerLoading = element<HTMLElement>('corner-loading');
const analysisLoading = element<HTMLElement>('analysis-loading');
const outputText = element<HTMLTextAreaElement>('output-text');
const tokenEditor = element<HTMLElement>('token-editor');
const emptyEditor = element<HTMLElement>('empty-editor');
const selectedKana = element<HTMLElement>('selected-kana');
const candidateRow = element<HTMLElement>('candidate-row');
const kanaGrid = element<HTMLElement>('kana-grid');
const confidenceSummary = element<HTMLElement>('confidence-summary');
const tokenList = element<HTMLElement>('token-list');
const referenceDialog = element<HTMLDialogElement>('reference-dialog');
const toast = element<HTMLElement>('toast');

let sourceCanvas: HTMLCanvasElement | null = null;
let correctedCanvas: HTMLCanvasElement | null = null;
let corners: Point[] = [];
let tokens: DetectedToken[] = [];
let selectedTokenId: string | null = null;
let draggedCorner: number | null = null;
let activeCorner = 0;
let operationGeneration = 0;

for (const kana of ALL_KANA) {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = kana;
  button.addEventListener('click', () => setSelectedKana(kana));
  kanaGrid.append(button);
}

imageInput.addEventListener('change', async () => {
  const file = imageInput.files?.[0];
  if (!file) return;
  const generation = ++operationGeneration;
  try {
    setPhase('crop');
    cornerLoading.hidden = false;
    const nextCanvas = await fileToCanvas(file);
    if (generation !== operationGeneration) return;
    const nextCorners = await detectDocumentCorners(nextCanvas);
    if (generation !== operationGeneration) return;
    sourceCanvas = nextCanvas;
    corners = nextCorners;
    activeCorner = 0;
    drawCropEditor();
  } catch (error) {
    if (generation !== operationGeneration) return;
    showToast(error instanceof Error ? error.message : '画像を読み込めませんでした。', true);
    resetApp();
  } finally {
    if (generation === operationGeneration) cornerLoading.hidden = true;
  }
});

element<HTMLButtonElement>('crop-back').addEventListener('click', resetApp);
element<HTMLButtonElement>('new-image-button').addEventListener('click', resetApp);
element<HTMLButtonElement>('recrop-button').addEventListener('click', () => {
  operationGeneration += 1;
  setPhase('crop');
  drawCropEditor();
});

element<HTMLButtonElement>('analyze-button').addEventListener('click', async () => {
  if (!sourceCanvas || corners.length !== 4) return;
  const generation = ++operationGeneration;
  correctedCanvas = null;
  tokens = [];
  selectedTokenId = null;
  resultCanvas.width = 1;
  resultCanvas.height = 1;
  outputText.value = '';
  setPhase('result');
  analysisLoading.hidden = false;
  try {
    const nextCanvas = await warpDocument(sourceCanvas, corners);
    if (generation !== operationGeneration) return;
    const nextTokens = await recognizeDocument(nextCanvas);
    if (generation !== operationGeneration) return;
    correctedCanvas = nextCanvas;
    tokens = nextTokens;
    selectedTokenId = tokens[0]?.id ?? null;
    renderResult();
    if (tokens.length === 0) showToast('記号を検出できませんでした。範囲を調整してください。', true);
  } catch (error) {
    if (generation !== operationGeneration) return;
    showToast(error instanceof Error ? error.message : '解析に失敗しました。', true);
    setPhase('crop');
    drawCropEditor();
  } finally {
    if (generation === operationGeneration) analysisLoading.hidden = true;
  }
});

cropCanvas.addEventListener('pointerdown', (event) => {
  if (!sourceCanvas) return;
  const point = canvasPoint(event, cropCanvas);
  const threshold = Math.max(sourceCanvas.width, sourceCanvas.height) * 0.045;
  draggedCorner = corners.findIndex((corner) => distance(corner, point) < threshold);
  if (draggedCorner >= 0) {
    activeCorner = draggedCorner;
    updateCornerButtons();
    cropCanvas.setPointerCapture(event.pointerId);
  }
});

cropCanvas.addEventListener('pointermove', (event) => {
  if (draggedCorner === null || draggedCorner < 0 || !sourceCanvas) return;
  const point = canvasPoint(event, cropCanvas);
  corners[draggedCorner] = {
    x: Math.max(0, Math.min(sourceCanvas.width, point.x)),
    y: Math.max(0, Math.min(sourceCanvas.height, point.y)),
  };
  drawCropEditor();
});

cropCanvas.addEventListener('pointerup', () => { draggedCorner = null; });
cropCanvas.addEventListener('pointercancel', () => { draggedCorner = null; });

for (const button of document.querySelectorAll<HTMLButtonElement>('.corner-button')) {
  const cornerIndex = Number(button.dataset.corner);
  button.addEventListener('click', () => {
    activeCorner = cornerIndex;
    updateCornerButtons();
    drawCropEditor();
  });
  button.addEventListener('keydown', (event) => {
    const movement: Record<string, Point> = {
      ArrowLeft: { x: -1, y: 0 }, ArrowRight: { x: 1, y: 0 },
      ArrowUp: { x: 0, y: -1 }, ArrowDown: { x: 0, y: 1 },
    };
    const direction = movement[event.key];
    if (!direction || !sourceCanvas) return;
    event.preventDefault();
    const amount = event.shiftKey ? 10 : 2;
    corners[cornerIndex] = {
      x: Math.max(0, Math.min(sourceCanvas.width, corners[cornerIndex].x + direction.x * amount)),
      y: Math.max(0, Math.min(sourceCanvas.height, corners[cornerIndex].y + direction.y * amount)),
    };
    drawCropEditor();
  });
}

resultCanvas.addEventListener('click', (event) => {
  const point = canvasPoint(event, resultCanvas);
  const selected = [...tokens].reverse().find((token) => contains(token.bounds, point));
  if (!selected) return;
  selectedTokenId = selected.id;
  renderResult();
});

element<HTMLButtonElement>('delete-token').addEventListener('click', () => {
  const index = tokens.findIndex(({ id }) => id === selectedTokenId);
  if (index < 0) return;
  tokens.splice(index, 1);
  selectedTokenId = tokens[Math.min(index, tokens.length - 1)]?.id ?? null;
  renderResult();
});

element<HTMLButtonElement>('dakuten-button').addEventListener('click', () => modifySelected('dakuten'));
element<HTMLButtonElement>('handakuten-button').addEventListener('click', () => modifySelected('handakuten'));
element<HTMLButtonElement>('question-button').addEventListener('click', () => {
  const token = selectedToken();
  if (!token) return;
  token.kind = 'question';
  token.kana = undefined;
  token.confidence = 1;
  renderResult();
});
element<HTMLButtonElement>('insert-before').addEventListener('click', () => insertNearSelected(-1));
element<HTMLButtonElement>('insert-after').addEventListener('click', () => insertNearSelected(1));

element<HTMLButtonElement>('copy-button').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(outputText.value);
    showToast('コピーしました');
  } catch {
    outputText.select();
    const copied = document.execCommand('copy');
    showToast(copied ? 'コピーしました' : 'コピーできませんでした。手動でコピーしてください。', !copied);
  }
});

element<HTMLButtonElement>('reference-open').addEventListener('click', () => referenceDialog.showModal());
element<HTMLButtonElement>('reference-close').addEventListener('click', () => referenceDialog.close());
referenceDialog.addEventListener('click', (event) => {
  if (event.target === referenceDialog) referenceDialog.close();
});

function setPhase(phase: 'upload' | 'crop' | 'result') {
  uploadPhase.hidden = phase !== 'upload';
  cropPhase.hidden = phase !== 'crop';
  resultPhase.hidden = phase !== 'result';
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  window.scrollTo({ top: 0, behavior: reducedMotion ? 'auto' : 'smooth' });
}

function resetApp() {
  operationGeneration += 1;
  sourceCanvas = null;
  correctedCanvas = null;
  corners = [];
  tokens = [];
  selectedTokenId = null;
  imageInput.value = '';
  setPhase('upload');
}

function drawCropEditor() {
  if (!sourceCanvas) return;
  copyCanvas(sourceCanvas, cropCanvas);
  const context = cropCanvas.getContext('2d')!;
  context.save();
  context.fillStyle = 'rgba(17, 19, 20, 0.42)';
  context.fillRect(0, 0, cropCanvas.width, cropCanvas.height);
  context.globalCompositeOperation = 'destination-out';
  context.beginPath();
  corners.forEach((point, index) => index ? context.lineTo(point.x, point.y) : context.moveTo(point.x, point.y));
  context.closePath();
  context.fill();
  context.globalCompositeOperation = 'source-over';
  context.strokeStyle = '#ff5b45';
  context.lineWidth = Math.max(4, cropCanvas.width / 350);
  context.stroke();
  const radius = Math.max(12, cropCanvas.width / 85);
  corners.forEach((point, index) => {
    context.beginPath();
    context.fillStyle = index === activeCorner ? '#ff5b45' : '#fff';
    context.strokeStyle = '#ff5b45';
    context.lineWidth = Math.max(4, radius / 4);
    context.arc(point.x, point.y, radius, 0, Math.PI * 2);
    context.fill();
    context.stroke();
  });
  context.restore();
}

function renderResult() {
  if (!correctedCanvas) return;
  copyCanvas(correctedCanvas, resultCanvas);
  const context = resultCanvas.getContext('2d')!;
  const lineWidth = Math.max(2, resultCanvas.width / 500);
  context.font = `600 ${Math.max(16, resultCanvas.width / 42)}px sans-serif`;
  context.textBaseline = 'bottom';

  for (const token of tokens) {
    const active = token.id === selectedTokenId;
    const uncertain = token.confidence < 0.55 || token.kind === 'unknown';
    context.strokeStyle = active ? '#ff5b45' : uncertain ? '#d38a00' : '#168463';
    context.lineWidth = active ? lineWidth * 2 : lineWidth;
    context.strokeRect(token.bounds.x, token.bounds.y, token.bounds.width, token.bounds.height);
    const label = token.kind === 'modifier' ? (token.modifier === 'dakuten' ? '濁' : '半')
      : token.kind === 'question' ? '？' : token.kana ?? '未';
    const metrics = context.measureText(label);
    const labelHeight = Math.max(20, resultCanvas.width / 34);
    context.fillStyle = active ? '#ff5b45' : uncertain ? '#d38a00' : '#168463';
    context.fillRect(token.bounds.x, Math.max(0, token.bounds.y - labelHeight), metrics.width + 10, labelHeight);
    context.fillStyle = '#fff';
    context.fillText(label, token.bounds.x + 5, token.bounds.y - 2);
  }

  outputText.value = tokensToText(tokens);
  const uncertainCount = tokens.filter((token) => token.confidence < 0.55 || token.kind === 'unknown').length;
  confidenceSummary.textContent = uncertainCount ? `${uncertainCount}文字を確認してください` : `${tokens.length}記号を読み取りました`;
  renderTokenList();
  renderEditor();
}

function renderTokenList() {
  tokenList.replaceChildren();
  tokenList.hidden = tokens.length === 0;
  for (const [index, token] of tokens.entries()) {
    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('role', 'option');
    button.setAttribute('aria-selected', String(token.id === selectedTokenId));
    button.className = token.id === selectedTokenId ? 'active' : '';
    button.textContent = token.kind === 'modifier' ? (token.modifier === 'dakuten' ? '濁' : '半')
      : token.kind === 'question' ? '？' : token.kana ?? '未';
    button.setAttribute('aria-label', `${index + 1}文字目 ${button.textContent}`);
    button.addEventListener('click', () => {
      selectedTokenId = token.id;
      renderResult();
    });
    tokenList.append(button);
  }
}

function renderEditor() {
  const token = selectedToken();
  emptyEditor.hidden = Boolean(token);
  tokenEditor.hidden = !token;
  if (!token) return;
  selectedKana.textContent = token.kind === 'modifier' ? (token.modifier === 'dakuten' ? '濁点' : '半濁点')
    : token.kind === 'question' ? '？' : token.kana ?? '未確定';
  candidateRow.replaceChildren();
  const candidates = token.candidates.length ? token.candidates : token.kana ? [{ kana: token.kana, confidence: 1 }] : [];
  for (const candidate of candidates) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `candidate-button${candidate.kana === token.kana ? ' active' : ''}`;
    button.innerHTML = `<strong>${candidate.kana}</strong><span>${Math.round(candidate.confidence * 100)}%</span>`;
    button.addEventListener('click', () => setSelectedKana(candidate.kana));
    candidateRow.append(button);
  }
}

function setSelectedKana(kana: string) {
  const token = selectedToken();
  if (!token) return;
  token.kind = 'glyph';
  token.kana = kana;
  token.modifier = undefined;
  token.confidence = 1;
  token.candidates = [{ kana, confidence: 1 }];
  renderResult();
}

function modifySelected(modifier: 'dakuten' | 'handakuten') {
  const token = selectedToken();
  if (!token?.kana) return;
  const modified = applyModifier(token.kana, modifier);
  if (modified === token.kana) {
    showToast('この文字には適用できません。', true);
    return;
  }
  setSelectedKana(modified);
}

function insertNearSelected(direction: -1 | 1) {
  const selected = selectedToken();
  if (!selected) return;
  const width = selected.bounds.width;
  const inserted: DetectedToken = {
    id: `manual-${Date.now()}`,
    kind: 'glyph',
    bounds: { ...selected.bounds, x: selected.bounds.x + direction * width * 0.75 },
    line: selected.line,
    kana: 'あ',
    confidence: 1,
    candidates: [{ kana: 'あ', confidence: 1 }],
  };
  tokens.push(inserted);
  selectedTokenId = inserted.id;
  renderResult();
}

function selectedToken() {
  return tokens.find(({ id }) => id === selectedTokenId) ?? null;
}

function copyCanvas(source: HTMLCanvasElement, destination: HTMLCanvasElement) {
  destination.width = source.width;
  destination.height = source.height;
  destination.getContext('2d')!.drawImage(source, 0, 0);
}

function canvasPoint(event: PointerEvent | MouseEvent, canvas: HTMLCanvasElement): Point {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (event.clientX - rect.left) * canvas.width / rect.width,
    y: (event.clientY - rect.top) * canvas.height / rect.height,
  };
}

function contains(bounds: DetectedToken['bounds'], point: Point) {
  return point.x >= bounds.x && point.x <= bounds.x + bounds.width && point.y >= bounds.y && point.y <= bounds.y + bounds.height;
}

function distance(a: Point, b: Point) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function showToast(message: string, isError = false) {
  toast.textContent = message;
  toast.classList.toggle('error', isError);
  toast.hidden = false;
  window.setTimeout(() => { toast.hidden = true; }, 2800);
}

function updateCornerButtons() {
  for (const button of document.querySelectorAll<HTMLButtonElement>('.corner-button')) {
    button.classList.toggle('active', Number(button.dataset.corner) === activeCorner);
  }
}

function element<T extends HTMLElement>(id: string) {
  const value = document.getElementById(id);
  if (!value) throw new Error(`#${id} が見つかりません。`);
  return value as T;
}
