import zlib from 'node:zlib';
import { test, eq, throws } from './assert.mjs';
import { decodePng } from '../scripts/png-decode.mjs';

// scripts/png-decode.mjs is the only image decoder in the repo, and its failure
// mode is silence: a wrong inverse filter does not throw, it smears the art and
// the first anyone knows is a sprite that looks wrong on a Wii. So these build
// PNGs the other way round — real deflate, real CRCs, the forward filter of
// each type written out independently here — and assert the exact bytes come
// back. The predictors are deliberately a second implementation rather than an
// import; sharing one would let a wrong Paeth agree with itself.

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

const CRC_TABLE = (() => {
    const t = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
        t[n] = c;
    }
    return t;
})();

function crc32(buf) {
    let c = 0xffffffff;
    for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
    const d = Buffer.from(data);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), d]);
    const head = Buffer.alloc(4); head.writeUInt32BE(d.length, 0);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body), 0);
    return Buffer.concat([head, body, crc]);
}

function paeth(a, b, c) {
    const p = a + b - c;
    const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
    if (pa <= pb && pa <= pc) return a;
    return pb <= pc ? b : c;
}

/** The encoder's side of the five filters: subtract the prediction. */
function filterRow(type, raw, prev, bpp) {
    const out = Buffer.alloc(raw.length);
    for (let x = 0; x < raw.length; x++) {
        const a = x >= bpp ? raw[x - bpp] : 0;
        const b = prev ? prev[x] : 0;
        const c = (x >= bpp && prev) ? prev[x - bpp] : 0;
        let pred;
        switch (type) {
            case 0: pred = 0; break;
            case 1: pred = a; break;
            case 2: pred = b; break;
            case 3: pred = (a + b) >> 1; break;
            case 4: pred = paeth(a, b, c); break;
            default: throw new Error(`no filter ${type}`);
        }
        out[x] = (raw[x] - pred) & 0xff;
    }
    return out;
}

/** rows are raw sample bytes, one Buffer per scanline; filters is one per row. */
function png({ width, height, colorType, rows, filters, bitDepth = 8, interlace = 0,
    palette = null, trns = null, idatParts = 1 }) {
    const bpp = CHANNELS[colorType];
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(width, 0);
    ihdr.writeUInt32BE(height, 4);
    ihdr[8] = bitDepth; ihdr[9] = colorType; ihdr[12] = interlace;

    const scanlines = [];
    let prev = null;
    for (let y = 0; y < height; y++) {
        scanlines.push(Buffer.from([filters[y]]), filterRow(filters[y], rows[y], prev, bpp));
        prev = rows[y];
    }
    const z = zlib.deflateSync(Buffer.concat(scanlines));

    const out = [SIGNATURE, chunk('IHDR', ihdr)];
    if (palette) out.push(chunk('PLTE', Buffer.from(palette)));
    if (trns) out.push(chunk('tRNS', Buffer.from(trns)));
    const step = Math.ceil(z.length / idatParts);
    for (let i = 0; i < z.length; i += step) out.push(chunk('IDAT', z.subarray(i, i + step)));
    out.push(chunk('IEND', Buffer.alloc(0)));
    return Buffer.concat(out);
}

// 4x3 RGBA with values that move in both directions, so a filter that reaches
// the wrong way for its left or upper neighbour lands on the wrong number
// rather than coincidentally on the right one.
const W = 4, H = 3;
const RGBA = [
    [0, 0, 0, 255, 10, 40, 90, 255, 20, 80, 180, 128, 30, 120, 255, 0],
    [90, 40, 10, 255, 100, 80, 100, 200, 110, 120, 190, 64, 120, 160, 255, 255],
    [255, 250, 245, 1, 200, 150, 100, 255, 145, 50, 0, 255, 90, 200, 10, 255],
];
const rgbaRows = RGBA.map(r => Buffer.from(r));
const flat = RGBA.flat();

export default function () {

    test('every inverse filter reconstructs the scanline', () => {
        for (let f = 0; f <= 4; f++) {
            const img = decodePng(png({
                width: W, height: H, colorType: 6, rows: rgbaRows, filters: [f, f, f],
            }));
            eq([img.width, img.height], [W, H], `filter ${f} dimensions`);
            eq(Array.from(img.data), flat, `filter ${f} pixels`);
        }
    });

    // Real encoders pick a filter per row, so a decoder that only ever sees one
    // type per file can carry a bug for a long time. The moonlight-drift
    // sprites are mixed.
    test('filters mixed row by row', () => {
        const img = decodePng(png({
            width: W, height: H, colorType: 6, rows: rgbaRows, filters: [1, 4, 3],
        }));
        eq(Array.from(img.data), flat, 'pixels');
    });

    test('image data split across several IDAT chunks is concatenated', () => {
        const img = decodePng(png({
            width: W, height: H, colorType: 6, rows: rgbaRows, filters: [0, 2, 4], idatParts: 4,
        }));
        eq(Array.from(img.data), flat, 'pixels');
    });

    test('truecolour with no alpha channel comes back opaque', () => {
        const rows = [Buffer.from([1, 2, 3, 4, 5, 6]), Buffer.from([7, 8, 9, 250, 251, 252])];
        const img = decodePng(png({ width: 2, height: 2, colorType: 2, rows, filters: [0, 4] }));
        eq(Array.from(img.data),
            [1, 2, 3, 255, 4, 5, 6, 255, 7, 8, 9, 255, 250, 251, 252, 255], 'pixels');
    });

    test('greyscale spreads one sample across the three channels', () => {
        const img = decodePng(png({
            width: 3, height: 1, colorType: 0, rows: [Buffer.from([0, 128, 255])], filters: [1],
        }));
        eq(Array.from(img.data), [0, 0, 0, 255, 128, 128, 128, 255, 255, 255, 255, 255], 'pixels');
    });

    test('greyscale+alpha keeps its alpha', () => {
        const img = decodePng(png({
            width: 2, height: 1, colorType: 4, rows: [Buffer.from([200, 0, 60, 128])], filters: [0],
        }));
        eq(Array.from(img.data), [200, 200, 200, 0, 60, 60, 60, 128], 'pixels');
    });

    // tRNS is allowed to be shorter than the palette; the entries it does not
    // reach are opaque, and reading past its end would be an undefined alpha.
    test('indexed reads PLTE, and a short tRNS leaves the rest opaque', () => {
        const img = decodePng(png({
            width: 3, height: 1, colorType: 3, rows: [Buffer.from([0, 1, 2])], filters: [0],
            palette: [255, 0, 0, 0, 255, 0, 0, 0, 255],
            trns: [0, 128],
        }));
        eq(Array.from(img.data), [255, 0, 0, 0, 0, 255, 0, 128, 0, 0, 255, 255], 'pixels');
    });

    test('what it cannot read, it names', () => {
        throws(() => decodePng(Buffer.from('not a png at all, really')), 'bad signature', 'signature');
        throws(() => decodePng(png({
            width: 1, height: 1, colorType: 6, bitDepth: 16, rows: [Buffer.alloc(8)], filters: [0],
        })), '16-bit', 'bit depth');
        throws(() => decodePng(png({
            width: 4, height: 3, colorType: 6, rows: rgbaRows, filters: [0, 0, 0], interlace: 1,
        })), 'interlaced', 'interlace');
        throws(() => decodePng(Buffer.concat([SIGNATURE])), 'no IHDR', 'header');
    });
}
