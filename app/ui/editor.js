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

// The two ui/ modules that load after this one, read at call time and never
// captured: they do not exist yet while this file is being evaluated. Both are
// the project rather than the sprite — sprites-ui holds every sprite that is
// not on the canvas, project-ui owns the dialogs — and a recolour or a theme is
// a project's business. Absent in a build without them, and every caller here
// falls back to doing its own half alone.
const spritesUI = () => window.SpriteForge.spritesUI;
const projectUI = () => window.SpriteForge.projectUI;

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
// Breathing room so a fitted sprite is not flush against the stage's edges.
const FIT_MARGIN = 16;
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
// The sprite size the zoom was last fitted for, so a fit happens on open and
// on resize but not on every repaint. null until the stage has a height.
let fittedFor = null;
let mirrorX = false, onionSkin = false, gridOn = true, dockOn = true;
let painting = false;
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
const canvasStage = document.getElementById('canvas-stage');
const dock = document.getElementById('dock');
const dockToggle = document.getElementById('dock-toggle');
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

function restore(s) {
  frames = s.frames; frameIndex = s.frameIndex; origin = s.origin;
  frameW = s.frameW; frameH = s.frameH;
  palette = s.palette; selectedSwatch = s.selectedSwatch; selectedColor = s.selectedColor;
  activeTemplate = s.activeTemplate;
  if (s.sprites && spritesUI()) spritesUI().restoreAll(s.sprites);
  wInput.value = frameW; hInput.value = frameH;
  frameCache = [];
  syncOriginInputs(); sizeCanvas(); render(); renderSheet(); updateFrameLabel();
  renderPalette(); updatePaletteActive(); renderSlots();
}

// The stack itself is the kit's (kit/history.js). What stays here is what only
// this app knows: what a state IS, how to put one back, and the one case where
// the state being left has to carry more than a plain snapshot.
const history = MagmaKit.history.create({
  cap: 100,
  snapshot: currentState,
  restore,
  // The state being left has to carry the sprite list whenever the state being
  // entered does, or undoing a recolour would strand redo with no way back to
  // it.
  leaving: (s) => {
    const now = currentState();
    const su = spritesUI();
    if (s.sprites && su) now.sprites = su.capture();
    return now;
  },
});

function snapshot() { history.push(); }

// A recolour reaches every sprite, so its undo entry has to carry every sprite.
// Only these entries do: a stroke changes one sprite and snapshotting the rest
// on every mousedown would put the whole project on the stack a hundred times
// over. The cost is paid by the operations that earn it.
function snapshotProject() {
  const s = currentState();
  const su = spritesUI();
  if (su) s.sprites = su.capture();
  history.push(s);
}

// Strokes snapshot once on mousedown and commit only if a pixel changed, so
// Ctrl+Z undoes the whole stroke and no-op clicks don't pollute the stack.
const beginStroke = () => history.beginStroke();
const commitStroke = () => history.commitStroke();

const undo = () => history.undo();
const redo = () => history.redo();

// ── Canvas rendering ────────────────────────────────────

function sizeCanvas() {
  // Shrink to fit the first time a given sprite size is drawn, and only ever
  // downward. Opening a 128x128 project at the default 16x asked for a 2048px
  // canvas in a 900px stage; growing to fit instead would fight anyone who has
  // zoomed in on purpose, and zooming in past the window is how you draw a
  // pixel. setZoom leaves the size alone, so manual zoom survives.
  const size = `${frameW}x${frameH}`;
  if (size !== fittedFor) {
    const best = bestFitZoom();
    if (best !== null) {
      if (best < zoom) { zoom = best; zoomLabel.innerHTML = `${zoom}&times;`; }
      fittedFor = size;
    }
  }
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
  painting = false; lastPos = null; history.cancelStroke();
});

canvas.addEventListener('mouseleave', () => {
  if (shapeStart) { shapeStart = null; shapeEnd = null; render(); }
  painting = false; lastPos = null; history.cancelStroke();
});

canvas.addEventListener('contextmenu', (e) => {
  e.preventDefault(); const c = pixelAt(e);
  beginStroke();
  if (writePixel(frame(), c.x, c.y, null)) { render(); renderSheet(); }
  history.cancelStroke();
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
      palette[idx] = e.target.value;
      div.style.backgroundColor = e.target.value;
      if (idx === selectedSwatch) { selectedColor = e.target.value; updateColorChip(); }
    });
    // Click chooses the colour to draw with; double-click opens the picker to
    // change what the swatch is. They were the same gesture and the picker won
    // every time, so the palette could be edited but not used.
    div.title = 'Click to draw with this colour — double-click to change it';
    div.addEventListener('click', () => {
      selectedSwatch = idx; selectedColor = palette[idx];
      if (!['pencil', 'fill', 'line', 'rect', 'ellipse'].includes(tool)) { tool = 'pencil'; updateToolActive(); }
      updatePaletteActive(); updateColorChip();
    });
    div.addEventListener('dblclick', () => ci.click());
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

// Rewrites a set of colours across the whole project and the palette in one
// pass and one undo step, so a slot recolour that touches several shades is
// still a single Ctrl+Z. Returns whether anything actually changed.
//
// Every sprite, not just the one on screen. The palette is the project's — one
// set of swatches across every sprite is the point of the format's shared key —
// so a REPLACE that stopped at the live sprite would leave the others drawn in
// a colour the palette no longer has, and the project carrying both.
//
// It does not ask, the way applying a theme does, because this is a tool aimed
// at one colour and used over and over while drawing, and a dialog every time
// would be unusable. It does not need to: the undo entry carries the other
// sprites, so Ctrl+Z takes all of it back.
function applyColorMap(map) {
  const pairs = Object.entries(map).filter(([from, to]) => from !== to);
  if (!pairs.length) return false;
  const lookup = Object.fromEntries(pairs);
  const su = spritesUI();

  const hits = frames.some(f => f.some(row => row.some(px => px && lookup[px])));
  const inPalette = palette.some(c => lookup[c]);
  // Asked as well, because the colour may live only in a sprite that is not on
  // screen: picking it off this canvas is not the one way to select it.
  const elsewhere = !!su && su.usesAny(lookup);
  if (!hits && !inPalette && !elsewhere) return false;

  snapshotProject();
  frames = frames.map(f => f.map(row => row.map(px => (px && lookup[px]) || px)));
  palette = palette.map(c => lookup[c] || c);
  selectedColor = lookup[selectedColor] || selectedColor;
  frameCache = [];
  const others = su ? su.remapAll(lookup) : 0;
  render(); renderSheet(); renderPalette(); updatePaletteActive(); updateColorChip();
  // Said only when it reached past the canvas, where the change is not visible.
  if (others) Toast.show(`REPLACED IN ${others + 1} SPRITES`);
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

function setDock(v) { dockOn = v; dock.hidden = !v; dockToggle.classList.toggle('active', v); saveViewPrefs(); }

mirrorToggle.addEventListener('click', () => setMirror(!mirrorX));
onionToggle.addEventListener('click', () => setOnion(!onionSkin));
gridToggle.addEventListener('click', () => setGrid(!gridOn));
dockToggle.addEventListener('click', () => setDock(!dockOn));

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

/**
 * The biggest step that fits the sprite in the stage, or null if the stage has
 * not been laid out yet — at first paint it has no height, and a fit computed
 * against zero would pin every sprite to 2x.
 */
function bestFitZoom() {
  const availW = canvasStage.clientWidth - FIT_MARGIN;
  const availH = canvasStage.clientHeight - FIT_MARGIN;
  if (availW <= 0 || availH <= 0) return null;
  return [...ZOOM_STEPS].reverse()
    .find(s => frameW * s <= availW && frameH * s <= availH) ?? ZOOM_STEPS[0];
}

function fitToWindow() {
  const best = bestFitZoom();
  if (best !== null) setZoom(best);
}

document.getElementById('zoom-fit').addEventListener('click', fitToWindow);

// ── Export ──────────────────────────────────────────────

/**
 * Save the sheet, by whichever route the build has.
 *
 * The browser has exactly one: an <a download>, which lands the file in the
 * downloads folder with no say in the matter. The desktop has a Save dialog
 * and a real write, and fs.savePng existed for this from the day the bridge
 * was written — it just had no caller until now.
 *
 * @returns the path written, or null if the dialog was cancelled.
 */
async function saveSheet(canvas, name) {
  const f = window.SpriteForge.fs;
  if (!f) {
    const a = document.createElement('a');
    a.download = name; a.href = canvas.toDataURL('image/png'); a.click();
    return name;
  }
  const path = await f.savePng(name);
  if (!path) return null;
  await f.writeBytes(path.endsWith('.png') ? path : path + '.png', await window.SpriteForge.png.bytes(canvas));
  return path;
}

/**
 * The load call for every engine, from the one place that knows them.
 *
 * This panel used to hardcode two of the three, and the two it kept were not
 * the interesting ones: adenosine, whose call is the only one that carries
 * originX and originY as arguments, was the one missing. core/targets has held
 * a descriptor per engine all along, so read them from there and the list
 * cannot drift from the exporter again.
 */
function loadSnippets(file) {
  const T = window.SpriteForge.targets.engines;
  const out = [];
  for (const { id, label } of T.kinds()) {
    out.push(`// ${label}`);
    out.push(`//   ${T.ENGINES[id].snippet({
      file, w: frameW, h: frameH, ox: origin.x, oy: origin.y,
    })}`);
  }
  return out;
}

document.getElementById('export-btn').addEventListener('click', async () => {
  const sheet = framesToSheet(frames, frameW, frameH);
  const name = `sprite_${frameW}x${frameH}.png`;

  exportOutput.value = [
    `// sprite//forge — ${frames.length} frame${frames.length === 1 ? '' : 's'}, ${frameW}×${frameH}, sheet ${sheet.width}×${sheet.height}`,
    `// origin: (${origin.x}, ${origin.y})   (not stored in the PNG — pass it at load time)`,
    `//`,
    ...loadSnippets(name),
  ].join('\n');

  try {
    const path = await saveSheet(sheet, name);
    if (path) Toast.show('EXPORTED');
  } catch (e) {
    // Never say exported when nothing reached the disk.
    Toast.show('COULD NOT EXPORT');
    console.error('export failed:', e);
  }
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

// The three ways out — the ×, CANCEL, and a click on the backdrop — are the
// kit's (kit/modal.js). Four copies of that wiring used to live in this app.
const templateUI = MagmaKit.modal.wire(templateModal, { closers: ['template-cancel'] });

document.getElementById('template-btn').addEventListener('click', () => {
  renderTemplateGrid();
  templateUI.open();
});

// ── Replace colour ──────────────────────────────────────

document.getElementById('replace-btn').addEventListener('click', () => {
  const to = document.getElementById('replace-color').value.toLowerCase();
  applyColorMap({ [selectedColor]: to });
});

// ── Import ──────────────────────────────────────────────

const importUI = MagmaKit.modal.wire(importModal, { closers: ['import-cancel'] });

document.getElementById('import-btn').addEventListener('click', () => {
  importFile.value = ''; importW.value = frameW; importH.value = frameH;
  importUI.open();
});

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
    // sheet.js snaps the colours it could not keep onto the nearest one it
    // did, so this is a change to the pixels the user is now looking at and
    // has to be said out loud rather than left in the export header. A
    // full-colour photograph loses hundreds of colours here.
    const snapped = sliced.colors > sliced.palette.length
      ? ` (${sliced.colors} colours reduced to ${sliced.palette.length})` : '';
    if (snapped) Toast.show(`${sliced.colors} COLOURS SNAPPED TO ${sliced.palette.length}`);
    exportOutput.value = `// imported ${frames.length} frame${frames.length === 1 ? '' : 's'} of ${w}×${h} from ${file.name}${snapped}${truncated}`;
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

// What each action does. The names come from core/keybindings.js, which is the
// one table the whole app parses keys through; the menu reaches several of
// these by the same names through its own data-action strings.
const KEY_ACTIONS = {
  'edit:undo': () => undo(),
  'edit:redo': () => redo(),

  'tool:pencil': () => setTool('pencil'),
  'tool:erase': () => setTool('erase'),
  'tool:fill': () => setTool('fill'),
  'tool:line': () => setTool('line'),
  'tool:rect': () => setTool('rect'),
  'tool:ellipse': () => setTool('ellipse'),
  'tool:pick': () => setTool('pick'),
  'tool:origin': () => setTool('origin'),

  'view:zoom-fit': () => fitToWindow(),
  'view:grid': () => setGrid(!gridOn),
  'view:mirror': () => setMirror(!mirrorX),
  'view:onion': () => setOnion(!onionSkin),
  'view:dock': () => setDock(!dockOn),
  'view:zoom-out': () => setZoom([...ZOOM_STEPS].reverse().find(s => s < zoom) ?? zoom),
  'view:zoom-in': () => setZoom(ZOOM_STEPS.find(s => s > zoom) ?? zoom),

  'frame:prev': () => stepFrame(-1),
  'frame:next': () => stepFrame(1),
  'anim:play': () => setPlaying(!anim.playing),

  'transform:flip-h': () => document.getElementById('flip-h').click(),
  'transform:flip-v': () => document.getElementById('flip-v').click(),
  'transform:rot-90': () => document.getElementById('rot-90').click(),
  'shift:left': () => shiftFrame(-1, 0),
  'shift:right': () => shiftFrame(1, 0),
  'shift:up': () => shiftFrame(0, -1),
  'shift:down': () => shiftFrame(0, 1),

  'file:templates': () => document.getElementById('template-btn').click(),
};

function setTool(name) { tool = name; updateToolActive(); }

const KB = window.SpriteForge.keybindings;
const KEYS = MagmaKit.keys.create(KB.BINDINGS);
const EDITOR_ACTIONS = Object.keys(KEY_ACTIONS);

document.addEventListener('keydown', (e) => {
  // Any open dialog swallows the shortcuts, rather than the two named ones:
  // the GameMaker sprite picker is a third, and there will be a fourth. The
  // typing guard is the kit's, which counts a <select> as typing too — a
  // letter there is type-ahead, not a tool change.
  if (document.querySelector('dialog[open]')) return;
  const action = KEYS.resolve(e, EDITOR_ACTIONS);
  if (!action) return;
  if (KB.prevents(action)) e.preventDefault();
  KEY_ACTIONS[action]();
});

// ── Colour themes ───────────────────────────────────────
//
// A theme is a named list of colours: the set vendored from MAGMA//OPS in
// core/ops-themes.js, plus any you save here. Loading one swaps the swatches
// you draw *from* and leaves every placed pixel alone — recolouring what is
// already drawn is what REPLACE and the template slots do.
//
// Yours live in localStorage rather than the .forge file, because a palette
// you like is a fact about you and not about one sprite. The .forge file
// carries its own palette regardless, so opening a project still restores the
// colours it was drawn with.

const THEME_KEY = 'spriteforge.themes';
const PAL = window.SpriteForge.palettes;

const themeSelect = document.getElementById('palette-theme');
const themeName = document.getElementById('theme-name');
const themeSave = document.getElementById('theme-save');
const themeDelete = document.getElementById('theme-delete');

// Filtered through core rather than trusted: this is read during init, and a
// malformed entry here used to throw and take the rest of startup with it.
const myThemes = () => PAL.sane(readPrefs(THEME_KEY));

function renderThemes(selectId) {
  if (!themeSelect) return;
  themeSelect.innerHTML = '';

  const first = document.createElement('option');
  first.value = '';
  first.textContent = 'choose a theme...';
  themeSelect.append(first);

  for (const group of PAL.bySection(myThemes())) {
    const og = document.createElement('optgroup');
    og.label = group.section.replace(/-/g, ' ');
    for (const t of group.themes) {
      const opt = document.createElement('option');
      opt.value = t.id;
      // The count is the useful number at a glance: a four-colour Game Boy
      // theme and a twenty-seven colour Pop Art are different tools.
      opt.textContent = `${t.name} (${t.colors.length})`;
      og.append(opt);
    }
    themeSelect.append(og);
  }
  themeSelect.value = selectId || '';
  syncThemeButtons();
}

function syncThemeButtons() {
  const t = themeSelect ? PAL.find(themeSelect.value, myThemes()) : null;
  if (themeDelete) themeDelete.disabled = !(t && t.custom);
}

async function applyTheme(id) {
  const t = PAL.find(id, myThemes());
  if (!t) return;
  const colors = PAL.normalize(t.colors, MAX_SWATCHES);
  // Nothing usable is not a palette. Assigning it would leave selectedColor
  // undefined, and drawing would then write undefined into the frames and on
  // into the .forge file.
  if (!colors.length) { Toast.show('THAT THEME HAS NO USABLE COLOURS'); return; }

  // A theme is the project's, not this sprite's, so recolouring is answered
  // over in project-ui.js where the sprite list and the dialogs are. It comes
  // back false when it did not recolour — declined, nothing drawn, or no
  // project layer at all — and then this does what applying a theme has
  // always done and swaps the swatches on their own. When it did recolour it
  // has already put the new palette in through setSprite, and doing it again
  // here would cost a second undo step for nothing.
  const ui = projectUI();
  const recoloured = ui && ui.retheme ? await ui.retheme(colors, t.name) : false;
  if (!recoloured) {
    snapshot();
    palette = colors;
    selectedSwatch = 0;
    selectedColor = palette[0];
    renderPalette(); updatePaletteActive(); updateColorChip();
  }

  // Only one vendored theme is bigger than the palette, but saying so beats
  // handing over the first thirty-two of forty-nine without a word.
  Toast.show(PAL.truncates(t, MAX_SWATCHES)
    ? `${t.name} — first ${MAX_SWATCHES} of ${PAL.normalize(t.colors).length}`.toUpperCase()
    : t.name.toUpperCase());
}

if (themeSelect) themeSelect.addEventListener('change', () => {
  syncThemeButtons();
  if (themeSelect.value) applyTheme(themeSelect.value);
});

if (themeSave) themeSave.addEventListener('click', () => {
  try {
    const theme = PAL.custom(themeName.value || 'untitled', palette);
    // Saving over a name replaces it: list() lets the later one win, and
    // storing both would leave a copy nothing can ever reach.
    writePrefs(THEME_KEY, [...myThemes().filter(t => t.id !== theme.id), theme]);
    themeName.value = '';
    renderThemes(theme.id);
    Toast.show('THEME SAVED');
  } catch (e) {
    Toast.show(String(e.message).toUpperCase());
  }
});

if (themeDelete) themeDelete.addEventListener('click', () => {
  const id = themeSelect.value;
  const t = PAL.find(id, myThemes());
  if (!t || !t.custom) return;
  writePrefs(THEME_KEY, myThemes().filter(x => x.id !== id));
  renderThemes('');
  Toast.show('THEME DELETED');
});

// ── Sidebar sections ────────────────────────────────────

const sections = [...document.querySelectorAll('#sidebar details[data-section]')];

// localStorage with every failure swallowed — private mode throws on write, a
// corrupt value throws on parse, and neither is a reason to stop working. From
// the kit (kit/prefs.js).
const readPrefs = MagmaKit.prefs.read;
const writePrefs = MagmaKit.prefs.write;

function loadSectionPrefs() {
  const prefs = readPrefs(SECTION_KEY);
  if (!prefs) return;
  for (const d of sections)
    if (d.dataset.section in prefs) d.open = !!prefs[d.dataset.section];
  // A file written before the sidebar was an accordion can have every section
  // open, which is the state this replaced. Keep the first and close the rest —
  // skipping TARGETS when it is hidden, or the web build would restore a
  // desktop session by opening the one section it does not show and closing
  // everything it does.
  closeOthers(sections.find(d => d.open && !d.hidden));
}

function saveSectionPrefs() {
  const prefs = {};
  for (const d of sections) prefs[d.dataset.section] = d.open;
  writePrefs(SECTION_KEY, prefs);
}

/**
 * One section open at a time.
 *
 * The sections total about 1400px and the sidebar column is 600-960px, so
 * "all of them open" was never a state that fit on a screen — it just meant
 * everything below COLOR was reached by scrolling and easy to forget was
 * there. Closing the others costs nothing that the summaries do not still
 * show, and every tool has a single-key shortcut regardless of whether TOOLS
 * is open.
 */
let switching = false;

function closeOthers(keep) {
  if (!keep) return;
  switching = true;
  for (const d of sections) if (d !== keep && d.open) d.open = false;
  switching = false;
}

sections.forEach(d => d.addEventListener('toggle', () => {
  if (switching) return;
  if (d.open) closeOthers(d);
  saveSectionPrefs();
}));

// ── View preferences ────────────────────────────────────

function saveViewPrefs() {
  writePrefs(VIEW_KEY, { zoom, gridOn, mirrorX, onionSkin, dockOn, sidebarW: sidebar.offsetWidth });
}

function loadViewPrefs() {
  const p = readPrefs(VIEW_KEY);
  if (!p) return;
  if (ZOOM_STEPS.includes(p.zoom)) zoom = p.zoom;
  if (typeof p.gridOn === 'boolean') gridOn = p.gridOn;
  if (typeof p.mirrorX === 'boolean') mirrorX = p.mirrorX;
  if (typeof p.onionSkin === 'boolean') onionSkin = p.onionSkin;
  if (typeof p.dockOn === 'boolean') dockOn = p.dockOn;
  if (p.sidebarW) setSidebarWidth(p.sidebarW);
  zoomLabel.innerHTML = `${zoom}&times;`;
  gridToggle.classList.toggle('active', gridOn);
  mirrorToggle.classList.toggle('active', mirrorX);
  onionToggle.classList.toggle('active', onionSkin);
  dock.hidden = !dockOn;
  dockToggle.classList.toggle('active', dockOn);
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

/** A sprite's own state into the editor. Everything here belongs to one
 *  sprite; the palette and the template belong to the project and are not
 *  touched. */
function putSprite(sprite) {
  frameW = sprite.w; frameH = sprite.h;
  wInput.value = frameW; hInput.value = frameH;
  frames = sprite.frames.map(f => f.map(row => [...row]));
  frameIndex = 0; frameCache = [];
  origin = { x: Math.min(sprite.origin.x, frameW), y: Math.min(sprite.origin.y, frameH) };
  if (sprite.fps) { anim.fps = sprite.fps; animFpsInput.value = sprite.fps; }
}

function redrawEverything() {
  syncOriginInputs(); sizeCanvas(); render(); renderSheet(); updateFrameLabel();
  renderPalette(); updatePaletteActive(); renderSlots();
}

window.SpriteForge = window.SpriteForge || {};
window.SpriteForge.editor = {
  // How many swatches the palette has room for. Published because project-ui
  // has to trim a loaded palette to fit and should not keep its own copy of a
  // number that lives here.
  MAX_SWATCHES,

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
    putSprite(sprite);
    if (newPalette && newPalette.length) {
      palette = newPalette.slice(0, MAX_SWATCHES);
      selectedSwatch = 0; selectedColor = palette[0];
    }
    // Slot identity only survives when the file carried it. Inventing one would
    // let a recolour rewrite colours that never belonged to that slot.
    activeTemplate = slots ? { id: templateId, label: templateId || 'project', slots, steps: {} } : null;
    redrawEverything();
  },

  /**
   * Switch which sprite of the project is being edited.
   *
   * Not an undo step, and the history goes with it. The stack holds states of
   * the sprite being left; replaying one of those into this sprite would not
   * be an undo, it would be pasting another sprite's frames over yours. The
   * palette, the slots and the template are the project's rather than the
   * sprite's, so they stay exactly as they are.
   */
  swapSprite(sprite) {
    history.clear();
    putSprite(sprite);
    redrawEverything();
  },

  /**
   * Bumped on every change, so project-ui can tell dirty from saved.
   *
   * This is the dirty signal rather than the undo depth, because with more
   * than one sprite the depth is no longer a property of the project:
   * switching sprites clears the history, and an edit to the sprite you are
   * not looking at still has to count as unsaved work. So it never goes down,
   * and clear() above deliberately does not reset it.
   *
   * The cost is that undoing back to exactly the saved state no longer clears
   * the dirty marker. Overstating unsaved work is the safe direction to be
   * wrong in.
   */
  revision() { return history.revision(); },

  // The Edit menu drives the same two functions Ctrl+Z and Ctrl+Y do. They go
  // through this seam rather than the menu reaching for the module scope,
  // which is the point of having one door. canUndo/canRedo are what let the
  // menu grey its own items out instead of offering a no-op.
  undo, redo,
  canUndo() { return history.canUndo(); },
  canRedo() { return history.canRedo(); },
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
// Last, deliberately. The themes come from storage, and nothing that comes
// from storage should sit upstream of the canvas being drawn.
renderThemes();
