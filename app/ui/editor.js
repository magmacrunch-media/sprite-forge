// editor.js — SPRITE//FORGE, the DOM layer.
//
// Pixel-art sprite editor. Exports a uniform-grid PNG sheet: frames in a
// single row, so a frame's index and its column are the same number. That is
// the format magnolia reads out of a game's sprites/ directory and the one
// texastoast's SpriteSheet(path, w, h) slices, so one sheet feeds both.
//
// Everything that only transforms data now lives in core/ — colour and the
// shade ramp, shape rasterisation and flood fill, and the sheet codec. This
// file owns the canvas, the widgets and the mutable editor state, and nothing
// else. core/ never reaches back into it.
//
// No dependencies, no build step — classic scripts, like the other ware apps.
// Deliberately not ES modules: the website is buildless and busts caches by
// stamping ?v=<hash> onto <script src> tags, and an import specifier inside a
// .js file is invisible to that stamper, so a core/ fix would sit behind stale
// caches with no way to force a refresh.

// ── core bridge ─────────────────────────────────────────
// Bound once, by the name the call sites already used, so extracting them cost
// no churn at the ~14 places that call them.
const { shadeHex } = window.SpriteForge.color;
const { bresenham, shapePixels } = window.SpriteForge.draw;
const { framesToSheet, sheetToFrames } = window.SpriteForge.sheet;

// The two that lost their globals. core/ takes the grid and its size as
// arguments; these re-supply the editor's current ones so the call sites read
// exactly as before.
const frameToImageData = (f, w, h) =>
  window.SpriteForge.sheet.frameToImageData(f, w ?? frameW, h ?? frameH);
const floodFill = (x, y, from, to) =>
  window.SpriteForge.draw.floodFill(frame(), x, y, from, to);

const DEFAULT_COLORS = [
  '#7cb342', '#5d4037', '#e53935', '#1e88e5',
  '#fdd835', '#8e24aa', '#00897b', '#ff6ec7',
  '#f4511e', '#3949ab', '#43a047', '#757575',
  '#000000', '#ffffff',
];
const MIN_SIZE = 1, MAX_SIZE = 128, MAX_FRAMES = 64, MAX_SWATCHES = 32;
const ZOOM_STEPS = [2, 3, 4, 6, 8, 12, 16, 24, 32, 48];
const SHAPE_TOOLS = new Set(['line', 'rect', 'ellipse']);
const ANIM_SCALES = [1, 2, 4, 8];
const SECTION_KEY = 'sprite-forge-sections';
const VIEW_KEY = 'sprite-forge-view';
const SIDEBAR_MIN = 200, SIDEBAR_MAX = 420;
const TOOL_META = {
  pencil: ['Pencil', 'B'], erase: ['Erase', 'E'], fill: ['Fill', 'G'], line: ['Line', 'L'],
  rect: ['Rect', 'U'], ellipse: ['Ellipse', 'C'], pick: ['Pick', 'I'], origin: ['Origin', 'O'],
};

let frameW = 32, frameH = 32;
let frames = [];                // frames[i][y][x] = '#rrggbb' | null
let frameIndex = 0;
let origin = { x: 0, y: 0 };
let palette = [...DEFAULT_COLORS];
let selectedColor = palette[0], selectedSwatch = 0;
let tool = 'pencil';
let zoom = 16;
let mirrorX = false, onionSkin = false, gridOn = true;
let undoStack = [], redoStack = [], painting = false, pendingSnap = null;
let lastPos = null;             // previous pencil/erase position, for stroke interpolation
let shapeStart = null, shapeEnd = null;
let anim = { playing: false, fps: 8, scale: 4, index: 0, timer: null };
let frameCache = [];            // 1:1 offscreen canvas per frame, for previews
// Set when a character template is loaded: { id, slots: {name: baseHex},
// steps: {name: [shadeSteps]} }. Slot identity is not stored per pixel, so this
// is how a recolour knows which hexes belong to which part of the character.
let activeTemplate = null;

const canvas = document.getElementById('frame-canvas');
const ctx = canvas.getContext('2d');
const sheetCanvas = document.getElementById('sheet-canvas');
const sheetCtx = sheetCanvas.getContext('2d');
const animCanvas = document.getElementById('anim-canvas');
const animCtx = animCanvas.getContext('2d');
const paletteEl = document.getElementById('palette');
const colorChip = document.getElementById('color-chip');
const colorLabel = document.getElementById('color-label');
const wInput = document.getElementById('frame-w');
const hInput = document.getElementById('frame-h');
const oxInput = document.getElementById('origin-x');
const oyInput = document.getElementById('origin-y');
const zoomLabel = document.getElementById('zoom-label');
const frameLabel = document.getElementById('frame-label');
const toolReadout = document.getElementById('tool-readout');
const canvasDims = document.getElementById('canvas-dims');
const dimStat = document.getElementById('dimStat');
const frameStat = document.getElementById('frameStat');
const sidebar = document.getElementById('sidebar');
const resizer = document.getElementById('sidebar-resizer');
const animPlayBtn = document.getElementById('anim-play');
const animFpsInput = document.getElementById('anim-fps');
const animScaleBtn = document.getElementById('anim-scale');
const exportOutput = document.getElementById('export-output');
const importModal = document.getElementById('import-modal');
const importFile = document.getElementById('import-file');
const importW = document.getElementById('import-w');
const importH = document.getElementById('import-h');

// ── Frames ──────────────────────────────────────────────

function blankFrame() {
  return Array.from({ length: frameH }, () => Array(frameW).fill(null));
}

function frame() { return frames[frameIndex]; }

function updateFrameLabel() {
  frameLabel.textContent = `${frameIndex + 1} / ${frames.length}`;
  frameStat.textContent = `${frames.length} FRAME${frames.length === 1 ? '' : 'S'}`;
}

// ── Undo / Redo ─────────────────────────────────────────

// Carries the palette as well as the pixels: recolouring changes both together,
// and an undo that restored one without the other would leave the swatches
// describing art that is no longer there.
function currentState() {
  return JSON.parse(JSON.stringify({
    frames, frameIndex, origin, frameW, frameH,
    palette, selectedSwatch, selectedColor, activeTemplate,
  }));
}

function pushUndo(state) {
  undoStack.push(state);
  if (undoStack.length > 100) undoStack.shift();
  redoStack.length = 0;
}

function snapshot() { pushUndo(currentState()); }

// Strokes snapshot once on mousedown and commit only if a pixel changed,
// so Ctrl+Z undoes the whole stroke and no-op clicks don't pollute the stack.
function beginStroke() { pendingSnap = currentState(); }
function commitStroke() { if (pendingSnap) { pushUndo(pendingSnap); pendingSnap = null; } }

function restore(s) {
  frames = s.frames; frameIndex = s.frameIndex; origin = s.origin;
  frameW = s.frameW; frameH = s.frameH;
  palette = s.palette; selectedSwatch = s.selectedSwatch; selectedColor = s.selectedColor;
  activeTemplate = s.activeTemplate;
  wInput.value = frameW; hInput.value = frameH;
  frameCache = [];
  syncOriginInputs(); sizeCanvas(); render(); renderSheet(); updateFrameLabel();
  renderPalette(); updatePaletteActive(); renderSlots();
}

function undo() {
  if (!undoStack.length) return;
  const s = undoStack.pop();
  redoStack.push(currentState());
  restore(s);
}

function redo() {
  if (!redoStack.length) return;
  const s = redoStack.pop();
  undoStack.push(currentState());
  restore(s);
}

// ── Canvas rendering ────────────────────────────────────

function sizeCanvas() {
  canvas.width = frameW * zoom;
  canvas.height = frameH * zoom;
  canvasDims.innerHTML = `${frameW} &times; ${frameH}`;
  dimStat.innerHTML = `${frameW}&times;${frameH}`;
}

function render() {
  const f = frame(), half = zoom / 2;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  for (let y = 0; y < frameH; y++) {
    for (let x = 0; x < frameW; x++) {
      const px = x * zoom, py = y * zoom;
      ctx.fillStyle = '#2c2c38'; ctx.fillRect(px, py, zoom, zoom);
      ctx.fillStyle = '#3a3a46';
      ctx.fillRect(px + half, py, half, half); ctx.fillRect(px, py + half, half, half);
    }
  }
  if (onionSkin && frames.length > 1) {
    const prev = (frameIndex - 1 + frames.length) % frames.length;
    ctx.globalAlpha = 0.3;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(cachedFrame(prev), 0, 0, canvas.width, canvas.height);
    ctx.globalAlpha = 1;
  }
  for (let y = 0; y < frameH; y++)
    for (let x = 0; x < frameW; x++)
      if (f[y][x]) { ctx.fillStyle = f[y][x]; ctx.fillRect(x * zoom, y * zoom, zoom, zoom); }
  if (shapeStart && shapeEnd) {
    ctx.globalAlpha = 0.6; ctx.fillStyle = selectedColor;
    for (const [x, y] of shapePixels(tool, shapeStart.x, shapeStart.y, shapeEnd.x, shapeEnd.y)) {
      if (x < 0 || x >= frameW || y < 0 || y >= frameH) continue;
      ctx.fillRect(x * zoom, y * zoom, zoom, zoom);
      if (mirrorX) ctx.fillRect((frameW - 1 - x) * zoom, y * zoom, zoom, zoom);
    }
    ctx.globalAlpha = 1;
  }
  if (gridOn && zoom >= 6) {
    ctx.strokeStyle = '#33304a'; ctx.lineWidth = 1;
    ctx.globalAlpha = 0.4;
    ctx.beginPath();
    for (let x = 1; x < frameW; x++) { ctx.moveTo(x * zoom + .5, 0); ctx.lineTo(x * zoom + .5, canvas.height); }
    for (let y = 1; y < frameH; y++) { ctx.moveTo(0, y * zoom + .5); ctx.lineTo(canvas.width, y * zoom + .5); }
    ctx.stroke();
    ctx.globalAlpha = 0.9;
    ctx.beginPath();
    for (let x = 8; x < frameW; x += 8) { ctx.moveTo(x * zoom + .5, 0); ctx.lineTo(x * zoom + .5, canvas.height); }
    for (let y = 8; y < frameH; y += 8) { ctx.moveTo(0, y * zoom + .5); ctx.lineTo(canvas.width, y * zoom + .5); }
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  if (mirrorX) {
    ctx.strokeStyle = '#7cc7ff'; ctx.lineWidth = 1; ctx.globalAlpha = 0.6;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(canvas.width / 2 + .5, 0); ctx.lineTo(canvas.width / 2 + .5, canvas.height);
    ctx.stroke();
    ctx.setLineDash([]); ctx.globalAlpha = 1;
  }
  const ox = origin.x * zoom, oy = origin.y * zoom;
  ctx.strokeStyle = '#ff6ec7'; ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(ox + .5, 0); ctx.lineTo(ox + .5, canvas.height);
  ctx.moveTo(0, oy + .5); ctx.lineTo(canvas.width, oy + .5);
  ctx.stroke();
  ctx.strokeRect(ox - 3.5, oy - 3.5, 8, 8);
}

// ── Frame previews (sheet strip + animation) ────────────



function cachedFrame(i) {
  if (!frameCache[i]) {
    const c = document.createElement('canvas');
    c.width = frameW; c.height = frameH;
    c.getContext('2d').putImageData(frameToImageData(frames[i]), 0, 0);
    frameCache[i] = c;
  }
  return frameCache[i];
}

function renderSheet() {
  const scale = 2;
  sheetCanvas.width = frames.length * frameW * scale;
  sheetCanvas.height = frameH * scale;
  sheetCtx.imageSmoothingEnabled = false;
  for (let i = 0; i < frames.length; i++)
    sheetCtx.drawImage(cachedFrame(i), i * frameW * scale, 0, frameW * scale, frameH * scale);
  sheetCtx.strokeStyle = '#3b82f6'; sheetCtx.lineWidth = 2;
  sheetCtx.strokeRect(frameIndex * frameW * scale + 1, 1, frameW * scale - 2, frameH * scale - 2);
  renderAnim();
}

sheetCanvas.addEventListener('click', (e) => {
  const r = sheetCanvas.getBoundingClientRect();
  const i = Math.floor((e.clientX - r.left) / (r.width / frames.length));
  frameIndex = Math.max(0, Math.min(frames.length - 1, i));
  render(); renderSheet(); updateFrameLabel();
});

// ── Animation preview ───────────────────────────────────

function renderAnim() {
  const w = frameW * anim.scale, h = frameH * anim.scale;
  if (animCanvas.width !== w) animCanvas.width = w;
  if (animCanvas.height !== h) animCanvas.height = h;
  animCtx.imageSmoothingEnabled = false;
  animCtx.clearRect(0, 0, w, h);
  const i = anim.playing ? anim.index % frames.length : frameIndex;
  animCtx.drawImage(cachedFrame(i), 0, 0, w, h);
}

function setPlaying(p) {
  anim.playing = p;
  animPlayBtn.innerHTML = p ? '&#10074;&#10074;' : '&#9654;';
  clearInterval(anim.timer); anim.timer = null;
  if (p) {
    anim.index = frameIndex;
    anim.timer = setInterval(() => {
      anim.index = (anim.index + 1) % frames.length;
      renderAnim();
    }, 1000 / anim.fps);
  }
  renderAnim();
}

animPlayBtn.addEventListener('click', () => setPlaying(!anim.playing));

animFpsInput.addEventListener('change', () => {
  anim.fps = Math.max(1, Math.min(30, parseInt(animFpsInput.value, 10) || 8));
  animFpsInput.value = anim.fps;
  if (anim.playing) setPlaying(true);
});

animScaleBtn.addEventListener('click', () => {
  anim.scale = ANIM_SCALES[(ANIM_SCALES.indexOf(anim.scale) + 1) % ANIM_SCALES.length];
  animScaleBtn.innerHTML = `${anim.scale}&times;`;
  renderAnim();
});

// ── Mouse interaction ───────────────────────────────────

function pixelAt(e) {
  const r = canvas.getBoundingClientRect();
  return {
    x: Math.max(0, Math.min(frameW - 1, Math.floor((e.clientX - r.left) / zoom))),
    y: Math.max(0, Math.min(frameH - 1, Math.floor((e.clientY - r.top) / zoom))),
  };
}

// Writes one pixel (and its mirror twin when mirroring); returns whether anything changed.
function writePixel(f, x, y, val) {
  let changed = false;
  if (f[y][x] !== val) { commitStroke(); f[y][x] = val; changed = true; }
  if (mirrorX) {
    const mx = frameW - 1 - x;
    if (f[y][mx] !== val) { commitStroke(); f[y][mx] = val; changed = true; }
  }
  if (changed) frameCache[frameIndex] = null;
  return changed;
}

function paintAt(x, y, val) {
  // interpolate from the previous stroke position so fast drags leave no gaps
  const pts = lastPos ? bresenham(lastPos.x, lastPos.y, x, y) : [[x, y]];
  let changed = false;
  for (const [px, py] of pts) changed = writePixel(frame(), px, py, val) || changed;
  lastPos = { x, y };
  if (changed) { render(); renderSheet(); }
}

function pickColor(x, y) {
  const c = frame()[y][x];
  if (!c) return;
  selectedColor = c; selectedSwatch = palette.indexOf(c);
  updatePaletteActive(); updateColorChip();
}

canvas.addEventListener('mousedown', (e) => {
  e.preventDefault();
  if (e.button === 2) return;
  const c = pixelAt(e);
  if (e.altKey) { pickColor(c.x, c.y); return; }
  if (SHAPE_TOOLS.has(tool)) {
    beginStroke(); shapeStart = c; shapeEnd = c; painting = true;
    render();
    return;
  }
  beginStroke();
  painting = true; lastPos = null;
  if (tool === 'pencil') paintAt(c.x, c.y, selectedColor);
  else if (tool === 'erase') paintAt(c.x, c.y, null);
  else if (tool === 'fill') {
    const from = frame()[c.y][c.x];
    if (from !== selectedColor) {
      commitStroke(); floodFill(c.x, c.y, from, selectedColor);
      frameCache[frameIndex] = null; render(); renderSheet();
    }
  } else if (tool === 'pick') pickColor(c.x, c.y);
  else if (tool === 'origin') {
    if (origin.x !== c.x || origin.y !== c.y) {
      commitStroke(); origin = { x: c.x, y: c.y }; syncOriginInputs(); render();
    }
  }
});

canvas.addEventListener('mousemove', (e) => {
  if (!painting) return;
  const c = pixelAt(e);
  if (shapeStart) { shapeEnd = c; render(); }
  else if (tool === 'pencil') paintAt(c.x, c.y, selectedColor);
  else if (tool === 'erase') paintAt(c.x, c.y, null);
});

canvas.addEventListener('mouseup', () => {
  if (shapeStart && shapeEnd) {
    const pts = shapePixels(tool, shapeStart.x, shapeStart.y, shapeEnd.x, shapeEnd.y);
    let changed = false;
    for (const [x, y] of pts) {
      if (x < 0 || x >= frameW || y < 0 || y >= frameH) continue;
      changed = writePixel(frame(), x, y, selectedColor) || changed;
    }
    shapeStart = null; shapeEnd = null;
    render(); if (changed) renderSheet();
  }
  painting = false; lastPos = null; pendingSnap = null;
});

canvas.addEventListener('mouseleave', () => {
  if (shapeStart) { shapeStart = null; shapeEnd = null; render(); }
  painting = false; lastPos = null; pendingSnap = null;
});

canvas.addEventListener('contextmenu', (e) => {
  e.preventDefault(); const c = pixelAt(e);
  beginStroke();
  if (writePixel(frame(), c.x, c.y, null)) { render(); renderSheet(); }
  pendingSnap = null;
});

// ── Shape + line plotting ───────────────────────────────



// ── Flood fill ──────────────────────────────────────────


// ── Frame ops ───────────────────────────────────────────

function mutateFrame(fn) {
  snapshot();
  frames[frameIndex] = fn(frame());
  frameCache[frameIndex] = null;
  render(); renderSheet();
}

document.getElementById('flip-h').addEventListener('click', () =>
  mutateFrame(f => f.map(row => [...row].reverse())));

document.getElementById('flip-v').addEventListener('click', () =>
  mutateFrame(f => [...f].reverse().map(row => [...row])));

document.getElementById('rot-90').addEventListener('click', () => {
  if (frameW !== frameH) return;
  mutateFrame(f => Array.from({ length: frameH }, (_, y) =>
    Array.from({ length: frameW }, (_, x) => f[frameH - 1 - x][y])));
});

function shiftFrame(dx, dy) {
  mutateFrame(f => Array.from({ length: frameH }, (_, y) =>
    Array.from({ length: frameW }, (_, x) =>
      f[(y - dy + frameH) % frameH][(x - dx + frameW) % frameW])));
}

document.getElementById('shift-left').addEventListener('click', () => shiftFrame(-1, 0));
document.getElementById('shift-right').addEventListener('click', () => shiftFrame(1, 0));
document.getElementById('shift-up').addEventListener('click', () => shiftFrame(0, -1));
document.getElementById('shift-down').addEventListener('click', () => shiftFrame(0, 1));

// ── Palette ─────────────────────────────────────────────

function renderPalette() {
  paletteEl.innerHTML = '';
  for (let i = 0; i < palette.length; i++) {
    const idx = i;
    const div = document.createElement('div');
    div.className = 'swatch' + (idx === selectedSwatch ? ' active' : '');
    div.dataset.idx = idx;
    const ci = document.createElement('input');
    ci.type = 'color'; ci.value = palette[i];
    ci.addEventListener('input', (e) => {
      e.stopPropagation(); palette[idx] = e.target.value;
      div.style.backgroundColor = e.target.value;
      if (idx === selectedSwatch) { selectedColor = e.target.value; updateColorChip(); }
    });
    ci.addEventListener('click', (e) => e.stopPropagation());
    div.addEventListener('click', () => {
      selectedSwatch = idx; selectedColor = palette[idx];
      if (!['pencil', 'fill', 'line', 'rect', 'ellipse'].includes(tool)) { tool = 'pencil'; updateToolActive(); }
      updatePaletteActive(); updateColorChip();
    });
    div.style.backgroundColor = palette[i];
    div.appendChild(ci); paletteEl.appendChild(div);
  }
  updateColorChip();
}

function updatePaletteActive() {
  paletteEl.querySelectorAll('.swatch').forEach(s => s.classList.toggle('active', Number(s.dataset.idx) === selectedSwatch));
}

function updateColorChip() {
  colorChip.style.backgroundColor = selectedColor;
  colorLabel.textContent = selectedColor;
}

document.getElementById('add-color-btn').addEventListener('click', () => {
  if (palette.length >= MAX_SWATCHES) return;
  palette.push(selectedColor); selectedSwatch = palette.length - 1;
  renderPalette();
});

// ── Shade ramp ──────────────────────────────────────────




document.getElementById('ramp-btn').addEventListener('click', () => {
  const shades = [-2, -1, 1, 2].map(step => shadeHex(selectedColor, step));
  for (const c of shades)
    if (palette.length < MAX_SWATCHES && !palette.includes(c)) palette.push(c);
  renderPalette(); updatePaletteActive();
});

// ── Recolour ────────────────────────────────────────────

// Rewrites a set of colours across every frame and the palette in one pass and
// one undo step, so a slot recolour that touches several shades is still a
// single Ctrl+Z. Returns whether anything actually changed.
function applyColorMap(map) {
  const pairs = Object.entries(map).filter(([from, to]) => from !== to);
  if (!pairs.length) return false;
  const lookup = Object.fromEntries(pairs);

  const hits = frames.some(f => f.some(row => row.some(px => px && lookup[px])));
  const inPalette = palette.some(c => lookup[c]);
  if (!hits && !inPalette) return false;

  snapshot();
  frames = frames.map(f => f.map(row => row.map(px => (px && lookup[px]) || px)));
  palette = palette.map(c => lookup[c] || c);
  selectedColor = lookup[selectedColor] || selectedColor;
  frameCache = [];
  render(); renderSheet(); renderPalette(); updatePaletteActive(); updateColorChip();
  return true;
}

// ── Tool buttons + toggles ──────────────────────────────

function updateToolActive() {
  document.querySelectorAll('.tool-btn[data-tool]').forEach(b => b.classList.toggle('active', b.dataset.tool === tool));
  const [name, key] = TOOL_META[tool] || [tool, ''];
  toolReadout.innerHTML = '';
  const label = document.createElement('strong'); label.textContent = name;
  const kbd = document.createElement('kbd'); kbd.textContent = key;
  toolReadout.append(label, kbd);
}

document.querySelectorAll('.tool-btn[data-tool]').forEach(btn =>
  btn.addEventListener('click', () => { tool = btn.dataset.tool; updateToolActive(); }));

const mirrorToggle = document.getElementById('mirror-toggle');
const onionToggle = document.getElementById('onion-toggle');
const gridToggle = document.getElementById('grid-toggle');

function setMirror(v) { mirrorX = v; mirrorToggle.classList.toggle('active', v); render(); saveViewPrefs(); }
function setOnion(v) { onionSkin = v; onionToggle.classList.toggle('active', v); render(); saveViewPrefs(); }
function setGrid(v) { gridOn = v; gridToggle.classList.toggle('active', v); render(); saveViewPrefs(); }

mirrorToggle.addEventListener('click', () => setMirror(!mirrorX));
onionToggle.addEventListener('click', () => setOnion(!onionSkin));
gridToggle.addEventListener('click', () => setGrid(!gridOn));

// ── Frame size ──────────────────────────────────────────

function resizeTo(w, h) {
  if (w === frameW && h === frameH) return;
  snapshot();
  const prev = frames;
  frameW = w; frameH = h;
  frames = prev.map(f => Array.from({ length: h }, (_, y) =>
    Array.from({ length: w }, (_, x) => (f[y] && f[y][x]) || null)));
  origin.x = Math.min(origin.x, w); origin.y = Math.min(origin.y, h);
  wInput.value = w; hInput.value = h;
  frameCache = [];
  syncOriginInputs(); sizeCanvas(); render(); renderSheet();
}

document.getElementById('resize-btn').addEventListener('click', () => {
  const w = Math.max(MIN_SIZE, Math.min(MAX_SIZE, parseInt(wInput.value, 10) || 32));
  const h = Math.max(MIN_SIZE, Math.min(MAX_SIZE, parseInt(hInput.value, 10) || 32));
  wInput.value = w; hInput.value = h;
  resizeTo(w, h);
});

document.querySelectorAll('.preset-btn').forEach(btn =>
  btn.addEventListener('click', () => {
    const s = parseInt(btn.dataset.size, 10);
    resizeTo(s, s);
  }));

// ── Origin inputs ───────────────────────────────────────

function syncOriginInputs() {
  oxInput.value = origin.x; oyInput.value = origin.y;
  oxInput.max = frameW; oyInput.max = frameH;
}

for (const [input, axis, max] of [[oxInput, 'x', () => frameW], [oyInput, 'y', () => frameH]]) {
  input.addEventListener('change', () => {
    const v = Math.max(0, Math.min(max(), parseInt(input.value, 10) || 0));
    input.value = v;
    if (origin[axis] !== v) { snapshot(); origin[axis] = v; render(); }
  });
}

// ── Frame buttons ───────────────────────────────────────

document.getElementById('frame-prev').addEventListener('click', () => stepFrame(-1));
document.getElementById('frame-next').addEventListener('click', () => stepFrame(1));

function stepFrame(d) {
  frameIndex = Math.max(0, Math.min(frames.length - 1, frameIndex + d));
  render(); renderSheet(); updateFrameLabel();
}

document.getElementById('frame-add').addEventListener('click', () => {
  if (frames.length >= MAX_FRAMES) return;
  snapshot();
  frames.splice(frameIndex + 1, 0, blankFrame());
  frameIndex++; frameCache = [];
  render(); renderSheet(); updateFrameLabel();
});

document.getElementById('frame-dup').addEventListener('click', () => {
  if (frames.length >= MAX_FRAMES) return;
  snapshot();
  frames.splice(frameIndex + 1, 0, JSON.parse(JSON.stringify(frame())));
  frameIndex++; frameCache = [];
  render(); renderSheet(); updateFrameLabel();
});

document.getElementById('frame-del').addEventListener('click', () => {
  if (frames.length <= 1) return;
  snapshot();
  frames.splice(frameIndex, 1);
  frameIndex = Math.min(frameIndex, frames.length - 1); frameCache = [];
  render(); renderSheet(); updateFrameLabel();
});

// ── Zoom ────────────────────────────────────────────────

document.getElementById('zoom-out').addEventListener('click', () =>
  setZoom([...ZOOM_STEPS].reverse().find(s => s < zoom) ?? zoom));
document.getElementById('zoom-in').addEventListener('click', () =>
  setZoom(ZOOM_STEPS.find(s => s > zoom) ?? zoom));

function setZoom(z) {
  zoom = z;
  zoomLabel.innerHTML = `${zoom}&times;`;
  sizeCanvas(); render(); saveViewPrefs();
}

// ── Export ──────────────────────────────────────────────

document.getElementById('export-btn').addEventListener('click', () => {
  const sheet = framesToSheet(frames, frameW, frameH);
  const name = `sprite_${frameW}x${frameH}.png`;
  const a = document.createElement('a');
  a.download = name; a.href = sheet.toDataURL('image/png'); a.click();
  exportOutput.value = [
    `// sprite//forge — ${frames.length} frame${frames.length === 1 ? '' : 's'}, ${frameW}×${frameH}, sheet ${sheet.width}×${sheet.height}`,
    `// origin: (${origin.x}, ${origin.y})   (not stored in the PNG — pass it at load time)`,
    `// texastoast:  SpriteSheet('${name}', ${frameW}, ${frameH})   frame i = (i, 0)`,
    `// magnolia:    sprite_load(&s, "${name}", ${origin.x}, ${origin.y});`,
  ].join('\n');
});

// ── Copy ────────────────────────────────────────────────

document.getElementById('copy-btn').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(exportOutput.value);
    Toast.show('COPIED');
  } catch {
    Toast.show('COULD NOT COPY');
  }
});

// ── Character templates ─────────────────────────────────

const templateModal = document.getElementById('template-modal');
const tplGrid = document.getElementById('tpl-grid');
const slotList = document.getElementById('slot-list');

// Replaces every frame, the size and the palette — the same wholesale swap the
// PNG import performs, so it follows that routine's order and is one undo step.
function loadTemplate(tpl) {
  const dec = CharacterTemplates.decode(tpl, shadeHex);
  snapshot();
  frameW = dec.w; frameH = dec.h;
  wInput.value = frameW; hInput.value = frameH;
  frames = dec.frames.slice(0, MAX_FRAMES);
  palette = dec.palette.slice(0, MAX_SWATCHES);
  selectedSwatch = 0; selectedColor = palette[0];
  frameIndex = 0; frameCache = [];
  origin = { x: Math.min(dec.origin.x, frameW), y: Math.min(dec.origin.y, frameH) };
  activeTemplate = { id: tpl.id, label: tpl.label, slots: dec.slots, steps: dec.steps };
  exportOutput.value = `// ${tpl.label} — ${frames.length} frame${frames.length === 1 ? '' : 's'} of ${frameW}×${frameH}, origin (${origin.x}, ${origin.y})`;
  syncOriginInputs(); sizeCanvas(); render(); renderSheet(); updateFrameLabel();
  renderPalette(); updatePaletteActive(); renderSlots();
  templateModal.close();
}

function loadBlank() {
  snapshot();
  frameW = 32; frameH = 32;
  wInput.value = frameW; hInput.value = frameH;
  frames = [blankFrame()];
  palette = [...DEFAULT_COLORS];
  selectedSwatch = 0; selectedColor = palette[0];
  frameIndex = 0; frameCache = [];
  origin = { x: 0, y: 0 };
  activeTemplate = null;
  exportOutput.value = '';
  syncOriginInputs(); sizeCanvas(); render(); renderSheet(); updateFrameLabel();
  renderPalette(); updatePaletteActive(); renderSlots();
  templateModal.close();
}

// A template carries its own size rather than the editor's, which is why this
// passes w/h explicitly instead of letting frameToImageData default them.
function thumbCanvas(pixels, w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  c.getContext('2d').putImageData(frameToImageData(pixels, w, h), 0, 0);
  c.className = 'tpl-thumb';
  return c;
}

function tplCard(label, blurb, thumb, onPick) {
  const btn = document.createElement('button');
  btn.className = 'tpl-card';
  if (thumb) btn.appendChild(thumb);
  else {
    const empty = document.createElement('div');
    empty.className = 'tpl-thumb tpl-thumb-blank';
    btn.appendChild(empty);
  }
  const name = document.createElement('span');
  name.className = 'tpl-name'; name.textContent = label;
  const sub = document.createElement('span');
  sub.className = 'tpl-blurb'; sub.textContent = blurb;
  btn.append(name, sub);
  btn.addEventListener('click', onPick);
  return btn;
}

function renderTemplateGrid() {
  tplGrid.innerHTML = '';
  tplGrid.appendChild(tplCard('BLANK', 'empty · 32×32', null, loadBlank));
  if (!window.CharacterTemplates) return;
  for (const tpl of CharacterTemplates.list()) {
    const errs = CharacterTemplates.validate(tpl, shadeHex);
    if (errs.length) { console.error(`template "${tpl.id}":`, errs); continue; }
    const dec = CharacterTemplates.decode(tpl, shadeHex);
    tplGrid.appendChild(tplCard(tpl.label, tpl.blurb,
      thumbCanvas(dec.frames[0], dec.w, dec.h), () => loadTemplate(tpl)));
  }
}

// Slot swatches: recolouring one rewrites every shade it uses across all frames.
function renderSlots() {
  slotList.innerHTML = '';
  if (!activeTemplate) {
    const hint = document.createElement('div');
    hint.className = 'hint';
    hint.textContent = 'Load a template to recolor its parts by name.';
    slotList.appendChild(hint);
    return;
  }
  for (const [name, base] of Object.entries(activeTemplate.slots)) {
    const row = document.createElement('label');
    row.className = 'slot-row';
    const sw = document.createElement('span');
    sw.className = 'slot-swatch';
    sw.style.backgroundColor = base;
    const input = document.createElement('input');
    input.type = 'color'; input.value = base;
    input.addEventListener('input', (e) => {
      sw.style.backgroundColor = e.target.value;
    });
    input.addEventListener('change', (e) => recolorSlot(name, e.target.value.toLowerCase()));
    const label = document.createElement('span');
    label.className = 'slot-name'; label.textContent = name;
    sw.appendChild(input);
    row.append(sw, label);
    slotList.appendChild(row);
  }
  const hint = document.createElement('div');
  hint.className = 'hint';
  hint.textContent = 'Recolors every pixel of that shade, including any you painted in the same color.';
  slotList.appendChild(hint);
}

function recolorSlot(name, newBase) {
  if (!activeTemplate) return;
  const oldBase = activeTemplate.slots[name];
  if (!oldBase || oldBase === newBase) return;
  const map = {};
  for (const step of activeTemplate.steps[name] || [0])
    map[shadeHex(oldBase, step).toLowerCase()] = shadeHex(newBase, step).toLowerCase();
  // applyColorMap snapshots before it writes, so the slot must still hold the
  // old base at that moment — record the new one only once the pixels are
  // actually changed, or undo restores old pixels beside a new swatch.
  if (applyColorMap(map)) activeTemplate.slots[name] = newBase;
  renderSlots();
}

document.getElementById('template-btn').addEventListener('click', () => {
  renderTemplateGrid();
  templateModal.showModal();
});
document.getElementById('template-cancel').addEventListener('click', () => templateModal.close());
templateModal.querySelector('.modal-close').addEventListener('click', () => templateModal.close());
templateModal.addEventListener('click', (e) => { if (e.target === templateModal) templateModal.close(); });

// ── Replace colour ──────────────────────────────────────

document.getElementById('replace-btn').addEventListener('click', () => {
  const to = document.getElementById('replace-color').value.toLowerCase();
  applyColorMap({ [selectedColor]: to });
});

// ── Import ──────────────────────────────────────────────

document.getElementById('import-btn').addEventListener('click', () => {
  importFile.value = ''; importW.value = frameW; importH.value = frameH;
  importModal.showModal();
});
document.getElementById('import-cancel').addEventListener('click', () => importModal.close());
importModal.querySelector('.modal-close').addEventListener('click', () => importModal.close());
importModal.addEventListener('click', (e) => { if (e.target === importModal) importModal.close(); });

// The toast carries the message and the border says which field it is about —
// the import form has two, so "smaller than one 32×32 frame" needs to point at
// the size input rather than the file. A title alone only appears on hover,
// which is no use to anyone whose pointer has left the dialog.
function importError(el, msg) {
  el.style.borderColor = '#e53935'; el.title = msg;
  Toast.show(msg.toUpperCase());
  setTimeout(() => { el.style.borderColor = ''; el.title = ''; }, 1500);
}

document.getElementById('import-confirm').addEventListener('click', () => {
  const file = importFile.files[0];
  if (!file) { importError(importFile, 'Pick a PNG file'); return; }
  const w = Math.max(MIN_SIZE, Math.min(MAX_SIZE, parseInt(importW.value, 10) || 32));
  const h = Math.max(MIN_SIZE, Math.min(MAX_SIZE, parseInt(importH.value, 10) || 32));
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    URL.revokeObjectURL(url);
    const src = document.createElement('canvas');
    src.width = img.naturalWidth; src.height = img.naturalHeight;
    const sctx = src.getContext('2d');
    sctx.drawImage(img, 0, 0);

    const sliced = sheetToFrames(sctx, img.naturalWidth, img.naturalHeight,
      w, h, MAX_FRAMES, MAX_SWATCHES);
    if (!sliced) { importError(importW, `Image is smaller than one ${w}×${h} frame`); return; }

    snapshot();
    frameW = w; frameH = h;
    wInput.value = w; hInput.value = h;
    frames = sliced.frames;
    if (sliced.palette.length) {
      palette = sliced.palette; selectedSwatch = 0; selectedColor = palette[0];
      renderPalette(); updatePaletteActive();
    }
    frameIndex = 0; frameCache = [];
    // The imported pixels are not the template's any more, so slot identity is
    // gone; keeping it would let a recolour rewrite unrelated colours.
    activeTemplate = null; renderSlots();
    origin.x = Math.min(origin.x, w); origin.y = Math.min(origin.y, h);
    const truncated = sliced.truncated
      ? ` (image not evenly divisible by ${w}×${h} — trailing pixels dropped)` : '';
    exportOutput.value = `// imported ${frames.length} frame${frames.length === 1 ? '' : 's'} of ${w}×${h} from ${file.name}${truncated}`;
    syncOriginInputs(); sizeCanvas(); render(); renderSheet(); updateFrameLabel();
    importModal.close();
  };
  img.onerror = () => { URL.revokeObjectURL(url); importError(importFile, 'Could not read that file as an image'); };
  img.src = url;
});

// ── Clear ───────────────────────────────────────────────

document.getElementById('clear-btn').addEventListener('click', () => {
  if (!frame().some(row => row.some(px => px !== null))) return;
  snapshot();
  frames[frameIndex] = blankFrame();
  frameCache[frameIndex] = null;
  render(); renderSheet();
});

// ── Keyboard shortcuts ──────────────────────────────────

document.addEventListener('keydown', (e) => {
  if ((e.target.matches && e.target.matches('input, textarea'))
      || importModal.open || templateModal.open) return;
  const m = e.metaKey || e.ctrlKey;
  if (m && e.key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); return; }
  if (m && e.key === 'z' && e.shiftKey)  { e.preventDefault(); redo(); return; }
  if (m && e.key === 'y')                { e.preventDefault(); redo(); return; }
  if (m) return;
  const tools = { b: 'pencil', e: 'erase', g: 'fill', l: 'line', u: 'rect', c: 'ellipse', i: 'pick', o: 'origin' };
  if (tools[e.key]) { tool = tools[e.key]; updateToolActive(); }
  else if (e.key === 't') document.getElementById('template-btn').click();
  else if (e.key === 'm') setMirror(!mirrorX);
  else if (e.key === 'n') setOnion(!onionSkin);
  else if (e.key === 'd') setGrid(!gridOn);
  else if (e.key === 'h') document.getElementById('flip-h').click();
  else if (e.key === 'v') document.getElementById('flip-v').click();
  else if (e.key === 'r') document.getElementById('rot-90').click();
  else if (e.key === ' ') { e.preventDefault(); setPlaying(!anim.playing); }
  else if (e.key === 'ArrowLeft')  { e.preventDefault(); shiftFrame(-1, 0); }
  else if (e.key === 'ArrowRight') { e.preventDefault(); shiftFrame(1, 0); }
  else if (e.key === 'ArrowUp')    { e.preventDefault(); shiftFrame(0, -1); }
  else if (e.key === 'ArrowDown')  { e.preventDefault(); shiftFrame(0, 1); }
  else if (e.key === '[') stepFrame(-1);
  else if (e.key === ']') stepFrame(1);
  else if (e.key === '-') setZoom([...ZOOM_STEPS].reverse().find(s => s < zoom) ?? zoom);
  else if (e.key === '=') setZoom(ZOOM_STEPS.find(s => s > zoom) ?? zoom);
});

// ── Sidebar sections ────────────────────────────────────

const sections = [...document.querySelectorAll('#sidebar details[data-section]')];

function readPrefs(key) {
  try { return JSON.parse(localStorage.getItem(key)) || null; } catch { return null; }
}

function writePrefs(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
}

function loadSectionPrefs() {
  const prefs = readPrefs(SECTION_KEY);
  if (!prefs) return;
  for (const d of sections)
    if (d.dataset.section in prefs) d.open = !!prefs[d.dataset.section];
}

function saveSectionPrefs() {
  const prefs = {};
  for (const d of sections) prefs[d.dataset.section] = d.open;
  writePrefs(SECTION_KEY, prefs);
}

sections.forEach(d => d.addEventListener('toggle', saveSectionPrefs));

// ── View preferences ────────────────────────────────────

function saveViewPrefs() {
  writePrefs(VIEW_KEY, { zoom, gridOn, mirrorX, onionSkin, sidebarW: sidebar.offsetWidth });
}

function loadViewPrefs() {
  const p = readPrefs(VIEW_KEY);
  if (!p) return;
  if (ZOOM_STEPS.includes(p.zoom)) zoom = p.zoom;
  if (typeof p.gridOn === 'boolean') gridOn = p.gridOn;
  if (typeof p.mirrorX === 'boolean') mirrorX = p.mirrorX;
  if (typeof p.onionSkin === 'boolean') onionSkin = p.onionSkin;
  if (p.sidebarW) setSidebarWidth(p.sidebarW);
  zoomLabel.innerHTML = `${zoom}&times;`;
  gridToggle.classList.toggle('active', gridOn);
  mirrorToggle.classList.toggle('active', mirrorX);
  onionToggle.classList.toggle('active', onionSkin);
}

// ── Sidebar resizing ────────────────────────────────────

function setSidebarWidth(px) {
  sidebar.style.width = `${Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, px))}px`;
}

resizer.addEventListener('mousedown', (e) => {
  e.preventDefault();
  resizer.classList.add('dragging');
  document.body.classList.add('resizing');
  // width grows as the pointer moves left, so measure from the window's right edge
  const move = (ev) => setSidebarWidth(window.innerWidth - ev.clientX);
  const up = () => {
    resizer.classList.remove('dragging');
    document.body.classList.remove('resizing');
    document.removeEventListener('mousemove', move);
    document.removeEventListener('mouseup', up);
    saveViewPrefs();
  };
  document.addEventListener('mousemove', move);
  document.addEventListener('mouseup', up);
});

resizer.addEventListener('dblclick', () => { setSidebarWidth(240); saveViewPrefs(); });

// ── State accessor ──────────────────────────────────────
//
// The one door into the editor's mutable state, for the parts of the UI that
// live in their own files — project-ui.js today, the sprite list and the export
// targets next. Everything above still touches the globals directly; this is
// not an attempt to encapsulate them, it is a single named seam so that new
// code does not add a second way in.
//
// getSprite/setSprite speak the shape core/project.js uses, so a save is a read
// and a load is a write, with no translation layer in between to drift.

window.SpriteForge = window.SpriteForge || {};
window.SpriteForge.editor = {
  /** The editor's contents as one project sprite. */
  getSprite(name) {
    return {
      name: name || 'sprite',
      w: frameW, h: frameH,
      origin: { x: origin.x, y: origin.y },
      fps: anim.fps,
      frames: frames.map(f => f.map(row => [...row])),
    };
  },

  getPalette() { return [...palette]; },
  getTemplate() { return activeTemplate ? activeTemplate.id : null; },
  getSlots() { return activeTemplate ? { ...activeTemplate.slots } : null; },

  /**
   * Replaces everything the editor is showing. Follows the same order as
   * loadTemplate and the PNG import so it lands as one undo step, and so the
   * three wholesale-replacement paths cannot drift apart.
   */
  setSprite(sprite, newPalette, slots, templateId) {
    snapshot();
    frameW = sprite.w; frameH = sprite.h;
    wInput.value = frameW; hInput.value = frameH;
    frames = sprite.frames.map(f => f.map(row => [...row]));
    if (newPalette && newPalette.length) {
      palette = newPalette.slice(0, MAX_SWATCHES);
      selectedSwatch = 0; selectedColor = palette[0];
    }
    frameIndex = 0; frameCache = [];
    origin = { x: Math.min(sprite.origin.x, frameW), y: Math.min(sprite.origin.y, frameH) };
    if (sprite.fps) { anim.fps = sprite.fps; animFpsInput.value = sprite.fps; }
    // Slot identity only survives when the file carried it. Inventing one would
    // let a recolour rewrite colours that never belonged to that slot.
    activeTemplate = slots ? { id: templateId, label: templateId || 'project', slots, steps: {} } : null;
    syncOriginInputs(); sizeCanvas(); render(); renderSheet(); updateFrameLabel();
    renderPalette(); updatePaletteActive(); renderSlots();
  },

  /** Bumped on every undoable change, so project-ui can tell dirty from saved. */
  revision() { return undoStack.length; },

  // The Edit menu drives the same two functions Ctrl+Z and Ctrl+Y do. They go
  // through this seam rather than the menu reaching for the module scope,
  // which is the point of having one door. canUndo/canRedo are what let the
  // menu grey its own items out instead of offering a no-op.
  undo, redo,
  canUndo() { return undoStack.length > 0; },
  canRedo() { return redoStack.length > 0; },
};

// ── Init ────────────────────────────────────────────────
loadSectionPrefs();
loadViewPrefs();
frames = [blankFrame()];
sizeCanvas();
render();
renderSheet();
renderPalette();
updateToolActive();
updateFrameLabel();
syncOriginInputs();
renderSlots();
