// png-decode.mjs — a PNG in, RGBA bytes out. No dependencies.
//
// Node has no image decoding and this repo has no build step, so reading a PNG
// outside a browser means doing it here. The browser build never calls this:
// there, `new Image()` and a canvas already do the job, which is why this lives
// in scripts/ rather than app/core/ and never ships inside the binary.
//
// Deliberately narrow. It reads what the tools in this repo actually meet —
// 8-bit, non-interlaced — and throws by name at everything else rather than
// half-decoding it. A decoder that quietly mangles 16-bit samples is worse than
// one that says it cannot read them, because the mangling reaches a sprite.
//
// The inverse filters are the part worth being careful about: get one wrong and
// nothing errors, the art just comes out smeared. tests/png-decode.test.mjs
// exercises all five against scanlines filtered the other way.

import zlib from 'node:zlib';

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

// Samples per pixel, by PNG colour type. 3 is one byte of palette index.
const CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
const TYPE_NAME = { 0: 'greyscale', 2: 'truecolour', 3: 'indexed', 4: 'greyscale+alpha', 6: 'truecolour+alpha' };

/** The Paeth predictor, PNG spec 9.4. a = left, b = above, c = upper left. */
function paeth(a, b, c) {
    const p = a + b - c;
    const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
    if (pa <= pb && pa <= pc) return a;
    return pb <= pc ? b : c;
}

/**
 * Undoes the per-scanline filters over the inflated stream.
 *
 * `bpp` is the filter's idea of a pixel: bytes per pixel, minimum 1. It is the
 * distance back to the "left" byte, so it must be the real sample width and not
 * the 4 that the output happens to be.
 */
function unfilter(raw, width, height, bpp) {
    const stride = width * bpp;
    const out = new Uint8Array(stride * height);
    let src = 0;

    for (let y = 0; y < height; y++) {
        const filter = raw[src++];
        const row = y * stride, prev = row - stride;

        for (let x = 0; x < stride; x++) {
            const value = raw[src + x];
            const a = x >= bpp ? out[row + x - bpp] : 0;
            const b = y > 0 ? out[prev + x] : 0;
            const c = (x >= bpp && y > 0) ? out[prev + x - bpp] : 0;

            let recon;
            switch (filter) {
                case 0: recon = value; break;
                case 1: recon = value + a; break;
                case 2: recon = value + b; break;
                case 3: recon = value + ((a + b) >> 1); break;
                case 4: recon = value + paeth(a, b, c); break;
                default: throw new Error(`PNG: row ${y} uses filter ${filter}, which is not one of 0-4`);
            }
            out[row + x] = recon & 0xff;
        }
        src += stride;
    }

    if (src !== raw.length)
        throw new Error(`PNG: image data is ${raw.length} bytes, expected ${src}`);
    return out;
}

/** One decoded scanline buffer -> straight RGBA, whatever the colour type was. */
function toRgba(pixels, width, height, colorType, palette, transparency) {
    const out = new Uint8ClampedArray(width * height * 4);
    const n = width * height;
    const bpp = CHANNELS[colorType];

    for (let i = 0; i < n; i++) {
        const s = i * bpp, d = i * 4;
        let r, g, b, a = 255;

        switch (colorType) {
            case 0: r = g = b = pixels[s]; break;
            case 2: r = pixels[s]; g = pixels[s + 1]; b = pixels[s + 2]; break;
            case 4: r = g = b = pixels[s]; a = pixels[s + 1]; break;
            case 6: r = pixels[s]; g = pixels[s + 1]; b = pixels[s + 2]; a = pixels[s + 3]; break;
            case 3: {
                const idx = pixels[s];
                if (idx * 3 + 2 >= palette.length)
                    throw new Error(`PNG: palette index ${idx} is past the end of PLTE`);
                r = palette[idx * 3]; g = palette[idx * 3 + 1]; b = palette[idx * 3 + 2];
                // tRNS on an indexed image is an alpha per palette entry, and it
                // is allowed to be shorter than the palette: the entries it does
                // not reach are opaque.
                if (transparency && idx < transparency.length) a = transparency[idx];
                break;
            }
        }

        out[d] = r; out[d + 1] = g; out[d + 2] = b; out[d + 3] = a;
    }
    return out;
}

/**
 * @param bytes a whole PNG file
 * @returns {{ width: number, height: number, data: Uint8ClampedArray }} RGBA,
 *          four bytes per pixel, in the order a canvas ImageData is.
 */
export function decodePng(bytes) {
    const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    if (b.length < 8) throw new Error('PNG: file is too short to hold a signature');
    for (let i = 0; i < 8; i++)
        if (b[i] !== SIGNATURE[i]) throw new Error('PNG: bad signature - this is not a PNG file');

    const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
    const idat = [];
    let header = null, palette = null, transparency = null, sawEnd = false;
    let p = 8;

    while (p + 8 <= b.length) {
        const length = view.getUint32(p);
        const type = String.fromCharCode(b[p + 4], b[p + 5], b[p + 6], b[p + 7]);
        const start = p + 8;
        if (start + length + 4 > b.length)
            throw new Error(`PNG: ${type} chunk claims ${length} bytes, past the end of the file`);
        const data = b.subarray(start, start + length);

        switch (type) {
            case 'IHDR':
                header = {
                    width: view.getUint32(start),
                    height: view.getUint32(start + 4),
                    bitDepth: data[8],
                    colorType: data[9],
                    interlace: data[12],
                };
                break;
            case 'PLTE': palette = data; break;
            case 'tRNS': transparency = data; break;
            case 'IDAT': idat.push(data); break;
            case 'IEND': sawEnd = true; break;
            default: break;                        // ancillary; nothing here needs them
        }

        p = start + length + 4;                    // + the chunk's CRC
        if (sawEnd) break;
    }

    if (!header) throw new Error('PNG: no IHDR chunk');
    const { width, height, bitDepth, colorType, interlace } = header;
    if (!width || !height) throw new Error(`PNG: dimensions are ${width}x${height}`);
    if (!(colorType in CHANNELS)) throw new Error(`PNG: unknown colour type ${colorType}`);
    if (bitDepth !== 8)
        throw new Error(`PNG: ${bitDepth}-bit ${TYPE_NAME[colorType]} - this decoder reads 8-bit only`);
    if (interlace) throw new Error('PNG: interlaced (Adam7) images are not supported');
    if (colorType === 3 && !palette) throw new Error('PNG: indexed image with no PLTE chunk');
    if (!idat.length) throw new Error('PNG: no IDAT chunk');

    let raw;
    try {
        raw = zlib.inflateSync(Buffer.concat(idat));
    } catch (e) {
        throw new Error(`PNG: image data would not inflate (${e.message})`);
    }

    const bpp = CHANNELS[colorType];               // bitDepth is 8, so one byte per sample
    const expected = (width * bpp + 1) * height;
    if (raw.length !== expected)
        throw new Error(`PNG: inflated to ${raw.length} bytes, expected ${expected} for ${width}x${height}`);

    const pixels = unfilter(raw, width, height, bpp);
    return { width, height, data: toRgba(pixels, width, height, colorType, palette, transparency) };
}
