// Loads core/ into a fake window so the browser IIFEs can be tested in Node.
//
// core/ is plain classic scripts by design (see AGENTS.md), so there is nothing
// to import. This evaluates them in order against a stub global, which also
// proves the load order in ui/index.html is the real dependency order: drop a
// file and the next one throws here before it ever reaches a browser.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ORDER = ['color.js', 'draw.js', 'sheet.js', 'templates.js', 'project.js',
    'targets/gamemaker.js', 'targets/engines.js'];

// core/sheet.js is the only module that touches browser drawing APIs, and only
// to compose or read back a bitmap. These shims are just enough for that: a
// flat RGBA buffer and a 2D context that blits into it. They are not a canvas
// implementation and are not trying to be — they exist so the module carrying
// the four-repo sheet contract can be tested without a browser.
class ImageData {
    constructor(w, h) {
        this.width = w; this.height = h;
        this.data = new Uint8ClampedArray(w * h * 4);
    }
}

class Ctx {
    constructor(canvas) { this.canvas = canvas; }
    _buf() {
        const c = this.canvas;
        if (!c._data || c._w !== c.width || c._h !== c.height) {
            c._data = new Uint8ClampedArray(c.width * c.height * 4);
            c._w = c.width; c._h = c.height;
        }
        return c._data;
    }
    putImageData(img, dx, dy) {
        const buf = this._buf(), W = this.canvas.width;
        for (let y = 0; y < img.height; y++)
            for (let x = 0; x < img.width; x++) {
                const s = (y * img.width + x) * 4, d = ((dy + y) * W + (dx + x)) * 4;
                for (let i = 0; i < 4; i++) buf[d + i] = img.data[s + i];
            }
    }
    getImageData(sx, sy, w, h) {
        const buf = this._buf(), W = this.canvas.width, out = new ImageData(w, h);
        for (let y = 0; y < h; y++)
            for (let x = 0; x < w; x++) {
                const s = ((sy + y) * W + (sx + x)) * 4, d = (y * w + x) * 4;
                for (let i = 0; i < 4; i++) out.data[d + i] = buf[s + i];
            }
        return out;
    }
}

function fakeDocument() {
    return {
        createElement(tag) {
            if (tag !== 'canvas') throw new Error(`test shim only makes canvases, not <${tag}>`);
            const c = { width: 0, height: 0 };
            const ctx = new Ctx(c);
            c.getContext = () => ctx;
            return c;
        },
    };
}

export function loadCore() {
    const sandbox = { console, ImageData, document: fakeDocument() };
    sandbox.window = sandbox;
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);
    for (const f of ORDER) {
        const src = readFileSync(join(ROOT, 'core', f), 'utf8');
        vm.runInContext(src, sandbox, { filename: `core/${f}` });
    }
    return sandbox.SpriteForge;
}
