#!/usr/bin/env node
// import-moonlight-drift.mjs — Moonlight Drift's Wii sprites -> .forge projects.
//
//   node scripts/import-moonlight-drift.mjs [--drift ../moonlight-drift] [--out <dir>]
//                                           [--colors 32] [--alpha 128] [--only <key>]
//                                           [--add-target]
//
// moonlight-drift/wii/sprites/ holds 48 PNGs: 128x128 RGBA, one -idle and one
// -thrust per character. They were pre-rendered from the browser build's canvas
// draw() calls, so they are antialiased full-colour images rather than pixel
// art. Opening one by hand means the import dialog, the frame size typed in,
// the sprite renamed to match the file it has to go back to, and the origin
// looked up in wii/source/characters.c — twice per character, 24 times over.
// This does that once and leaves projects that open and export straight back
// over the files they came from.
//
// TWO THINGS ARE LOSSY AND BOTH ARE REPORTED PER CHARACTER, because neither is
// this script's decision to make quietly:
//
//   1. A .forge grid has no partial alpha. core/sheet.js drops anything under
//      50% alpha and hardens the rest, so a round trip changes these sprites
//      before anyone edits a pixel — and the thrust frames, which are mostly
//      soft plume, lose the most. At the editor's own 50% that is 13% of
//      Backpack Man's drawn pixels and 98% of Forester's Soul, who is a
//      translucent ghost with no fully opaque pixel anywhere in him.
//
//      Hence --alpha. It hardens the image to on-or-off at a chosen cutoff
//      before the slice sees it, so core/sheet.js's own test agrees with it
//      exactly. The default is 128 because that is what the editor's File >
//      Import does to the same PNG, and a tool feeding the app should not
//      quietly disagree with it; the soft-drawn characters want it lower.
//      (moonlight-drift's own tui/tools/make_portraits.py hit this and chose
//      96, "generous, because these sprites are anti-aliased against nothing".)
//   2. The .forge key holds 89 colours (core/project.js ALPHABET) and 15 of the
//      24 characters have more; Carl has 471. So the colours are reduced, and
//      by default to 32 — the editor's MAX_SWATCHES, which is what makes the
//      palette panel show every colour the project actually contains.
//
// The slicing itself is core/sheet.js's, not a copy: the alpha rule and the
// count-ordered palette have to be the app's, or a project this writes would
// not be one the editor would have made.
//
// Editing these PNGs makes the Wii and TUI builds diverge from web/, which
// moonlight-drift's README names the source of truth. That is inherent to
// editing a pre-render and is printed at the end rather than solved here.

import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve, basename } from 'node:path';
import { homedir } from 'node:os';

import { decodePng } from './png-decode.mjs';
import { loadCore, canvas } from '../tests/harness.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..');

// The editor will not open a frame bigger than this (MAX_SIZE in ui/editor.js),
// so writing one would produce a project that cannot be edited.
const MAX_SIZE = 128;
// core/project.js's ALPHABET is one character per colour, and every colour in
// the project needs one.
const MAX_KEY_COLORS = 89;
const DEFAULT_COLORS = 32;                 // MAX_SWATCHES in ui/editor.js
// core/sheet.js's own cut: below half alpha is transparent. Matching it means
// the default import is what the editor would have made of the same file.
const DEFAULT_ALPHA = 128;

const TAURI_IDENTIFIER = 'com.magmacrunch.sprite-forge';

// ── arguments ───────────────────────────────────────────

function parseArgs(argv) {
    const opts = {
        drift: null, out: null, colors: DEFAULT_COLORS, alpha: DEFAULT_ALPHA, only: null,
        addTarget: false, help: false,
    };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        const value = () => {
            const v = argv[++i];
            if (v === undefined) throw new Error(`${a} needs a value`);
            return v;
        };
        switch (a) {
            case '--drift': opts.drift = value(); break;
            case '--out': opts.out = value(); break;
            case '--only': opts.only = value(); break;
            case '--add-target': opts.addTarget = true; break;
            case '--help': case '-h': opts.help = true; break;
            case '--colors': {
                const n = parseInt(value(), 10);
                if (!Number.isInteger(n) || n < 2 || n > MAX_KEY_COLORS)
                    throw new Error(`--colors must be between 2 and ${MAX_KEY_COLORS} (the .forge key's width)`);
                opts.colors = n;
                break;
            }
            case '--alpha': {
                const n = parseInt(value(), 10);
                if (!Number.isInteger(n) || n < 1 || n > 255)
                    throw new Error('--alpha must be between 1 and 255');
                opts.alpha = n;
                break;
            }
            default: throw new Error(`unknown option ${a}`);
        }
    }
    return opts;
}

const USAGE = `
  node scripts/import-moonlight-drift.mjs [options]

    --drift <path>   the moonlight-drift checkout   (default: ../moonlight-drift)
    --out <dir>      where the .forge files go      (default: <drift>/wii/forge)
    --colors <n>     palette size, 2-${MAX_KEY_COLORS}          (default: ${DEFAULT_COLORS})
    --alpha <n>      a pixel this opaque is kept    (default: ${DEFAULT_ALPHA}, the editor's own cut)
                     lower it for the soft-drawn ones — Forester's Soul has no
                     pixel above ${DEFAULT_ALPHA} at all and imports nearly empty
    --only <key>     one character, e.g. elektra
    --add-target     also add <drift>/wii to targets.json as a magnolia target
`;

// ── the sprites ─────────────────────────────────────────

/** { key -> { idle, thrust } } for every complete pair in sprites/. */
function findSprites(dir) {
    let entries;
    try {
        entries = readdirSync(dir);
    } catch (e) {
        if (e.code === 'ENOENT') throw new Error(`${dir}: not found — is --drift pointing at a moonlight-drift checkout?`);
        throw e;
    }

    const pairs = new Map();
    for (const name of entries) {
        const m = /^(.+)-(idle|thrust)\.png$/.exec(name);
        if (!m) continue;
        const [, key, state] = m;
        if (!pairs.has(key)) pairs.set(key, {});
        pairs.get(key)[state] = join(dir, name);
    }

    // A character with only one of its two states is a rename half done, and
    // exporting the project would leave the other file stale.
    const half = [...pairs].filter(([, p]) => !p.idle || !p.thrust).map(([k]) => k);
    if (half.length) throw new Error(`${dir}: no -idle/-thrust pair for ${half.join(', ')}`);
    if (!pairs.size) throw new Error(`${dir}: no <key>-idle.png / <key>-thrust.png pairs found`);
    return pairs;
}

/**
 * sprite_origin_x/y per character, out of the generated table in characters.c.
 *
 * The field order is characters.h's CharacterData: id, name, the two PNG
 * symbols, four hitbox ints, then the two origin ints. Read only — that file
 * is stamped GENERATED and is not ours to write.
 */
function readOrigins(path) {
    let src;
    try {
        src = readFileSync(path, 'utf8');
    } catch (e) {
        if (e.code === 'ENOENT') throw new Error(`${path}: not found`);
        throw e;
    }

    const entry = /\{\s*"([A-Za-z0-9_-]+)"\s*,\s*"[^"]*"\s*,\s*[A-Za-z0-9_]+\s*,\s*[A-Za-z0-9_]+\s*,\s*(-?\d+)\s*,\s*(-?\d+)\s*,\s*(-?\d+)\s*,\s*(-?\d+)\s*,\s*(-?\d+)\s*,\s*(-?\d+)\s*,/g;
    const origins = new Map();
    for (const m of src.matchAll(entry)) origins.set(m[1], { x: +m[6], y: +m[7] });

    // Matching nothing means the struct's shape moved and every origin would
    // silently become (0,0) — a sprite whose feet are in the wrong place.
    if (!origins.size)
        throw new Error(`${path}: matched no character entries — has CharacterData changed shape?`);
    return origins;
}

// ── pixels ──────────────────────────────────────────────

/** One PNG file -> one frame, sliced by core/sheet.js's own rules. */
function readFrame(SF, path, colors, alpha) {
    const img = decodePng(readFileSync(path));

    if (img.width > MAX_SIZE || img.height > MAX_SIZE)
        throw new Error(`${basename(path)}: ${img.width}x${img.height} is past the editor's ${MAX_SIZE}px limit`);

    // Harden to on-or-off here rather than leaving it to the slice. Both cuts
    // are the same one at the default, but below it this is what lets a soft
    // plume survive as solid pixels instead of vanishing — and having done it,
    // core/sheet.js's own <128 test sees only 0 and 255 and cannot disagree.
    let drawn = 0, dropped = 0;
    for (let i = 3; i < img.data.length; i += 4) {
        const a = img.data[i];
        if (a === 0) continue;
        drawn++;
        if (a < alpha) { dropped++; img.data[i] = 0; } else img.data[i] = 255;
    }

    const c = canvas(img.width, img.height);
    const ctx = c.getContext('2d');
    ctx.putImageData({ width: img.width, height: img.height, data: img.data }, 0, 0);

    // One file is one frame, so the frame size is the image size. maxFrames 1
    // says so; a sheet would slice into more.
    const sliced = SF.sheet.sheetToFrames(ctx, img.width, img.height, img.width, img.height, 1, colors);
    if (!sliced || !sliced.frames.length) throw new Error(`${basename(path)}: sliced to no frames`);

    return { frame: sliced.frames[0], w: img.width, h: img.height, drawn, dropped };
}

/** hex -> how many pixels use it, across every frame given. */
function countColors(frames) {
    const counts = new Map();
    for (const f of frames)
        for (const row of f)
            for (const px of row) if (px) counts.set(px, (counts.get(px) || 0) + 1);
    return counts;
}

/**
 * Reduces the frames to at most `limit` colours, shared across all of them.
 *
 * The palette is the most-used colours — the same ordering core/sheet.js
 * already returns — and everything else snaps to its nearest survivor by
 * squared RGB distance. That ordering is what makes this the right reduction
 * for these particular sprites rather than a generic one: they are flat fills
 * with antialiased edges, so the fills win on pixel count and the edges land
 * back on the fill they were fading into.
 *
 * Ties break on the hex string so two runs cannot disagree.
 */
function quantize(SF, frames, limit) {
    const counts = countColors(frames);
    const ordered = [...counts.keys()].sort((a, b) => (counts.get(b) - counts.get(a)) || (a < b ? -1 : 1));
    if (ordered.length <= limit) return { palette: ordered, frames, before: ordered.length };

    const palette = ordered.slice(0, limit);
    const rgb = palette.map(hex => SF.color.hexToRgb(hex));

    const nearest = new Map(palette.map(hex => [hex, hex]));
    for (const hex of ordered.slice(limit)) {
        const [r, g, b] = SF.color.hexToRgb(hex);
        let best = 0, bestD = Infinity;
        for (let i = 0; i < rgb.length; i++) {
            const dr = r - rgb[i][0], dg = g - rgb[i][1], db = b - rgb[i][2];
            const d = dr * dr + dg * dg + db * db;
            if (d < bestD) { bestD = d; best = i; }
        }
        nearest.set(hex, palette[best]);
    }

    return {
        palette,
        frames: frames.map(f => f.map(row => row.map(px => (px ? nearest.get(px) : null)))),
        before: ordered.length,
    };
}

// ── targets.json ────────────────────────────────────────

/** Where Tauri's app_config_dir() lands, per platform. */
function configDir() {
    if (process.platform === 'win32') {
        const appData = process.env.APPDATA || join(homedir(), 'AppData', 'Roaming');
        return join(appData, TAURI_IDENTIFIER);
    }
    if (process.platform === 'darwin')
        return join(homedir(), 'Library', 'Application Support', TAURI_IDENTIFIER);
    return join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), TAURI_IDENTIFIER);
}

function addTarget(SF, root) {
    const S = SF.targets.store;
    const dir = configDir();
    const path = join(dir, 'targets.json');

    const store = existsSync(path) ? S.parse(readFileSync(path, 'utf8')) : S.blank();
    let next;
    try {
        next = S.add(store, { label: 'moonlight-drift (wii)', kind: 'magnolia', root });
    } catch (e) {
        // add() refuses a duplicate rather than deduplicating, which is the
        // right call for a folder picker and the wrong one to die on here.
        console.log(`  targets.json: ${e.message.replace(/^targets\[\d+\]:\s*/, '')}`);
        return;
    }

    mkdirSync(dir, { recursive: true });
    writeFileSync(path, S.stringify(next));
    console.log(`  targets.json: added magnolia -> ${S.normalizeRoot(root)}`);
}

// ── main ────────────────────────────────────────────────

try {
    const opts = parseArgs(process.argv.slice(2));
    if (opts.help) {
        console.log(USAGE);
        process.exit(0);
    }

    const DRIFT = resolve(opts.drift || join(REPO, '..', 'moonlight-drift'));
    const WII = join(DRIFT, 'wii');
    const OUT = resolve(opts.out || join(WII, 'forge'));

    const SF = loadCore();
    const P = SF.project;

    const sprites = findSprites(join(WII, 'sprites'));
    const origins = readOrigins(join(WII, 'source', 'characters.c'));

    // Both directions. A sprite with no entry has no origin; an entry with no
    // sprite is a character this would silently skip.
    const missingOrigin = [...sprites.keys()].filter(k => !origins.has(k));
    const missingSprite = [...origins.keys()].filter(k => !sprites.has(k));
    if (missingOrigin.length)
        throw new Error(`no entry in characters.c for ${missingOrigin.join(', ')}`);
    if (missingSprite.length)
        throw new Error(`characters.c lists ${missingSprite.join(', ')}, which has no sprite PNGs`);

    let keys = [...sprites.keys()].sort();
    if (opts.only) {
        if (!sprites.has(opts.only))
            throw new Error(`no character "${opts.only}" — try one of: ${keys.join(', ')}`);
        keys = [opts.only];
    }

    mkdirSync(OUT, { recursive: true });

    console.log(`sprite//forge <- ${WII}`);
    console.log(`${keys.length} character${keys.length === 1 ? '' : 's'}, at most ${opts.colors} colours, keeping pixels at alpha ${opts.alpha} and up\n`);

    let reduced = 0;
    const faded = [];

    for (const key of keys) {
        const pair = sprites.get(key);
        const idle = readFrame(SF, pair.idle, opts.colors, opts.alpha);
        const thrust = readFrame(SF, pair.thrust, opts.colors, opts.alpha);

        // One origin covers both states (game_render.c draws whichever is active at
        // the same point), so the two frames have to be the same size for it to
        // mean the same thing in each.
        if (idle.w !== thrust.w || idle.h !== thrust.h)
            throw new Error(`${key}: idle is ${idle.w}x${idle.h} but thrust is ${thrust.w}x${thrust.h}`);

        const q = quantize(SF, [idle.frame, thrust.frame], opts.colors);
        const origin = origins.get(key);

        const project = {
            palette: q.palette,
            slots: null,
            template: null,
            sprites: [`${key}-idle`, `${key}-thrust`].map((name, i) => {
                const s = P.newSprite(name, idle.w, idle.h);
                s.frames = [q.frames[i]];
                s.origin = { x: origin.x, y: origin.y };
                return s;
            }),
        };

        const text = P.stringify(project);
        const path = join(OUT, `${key}.forge`);
        writeFileSync(path, text);

        // Never claim a file the editor could not open. parse() runs the same
        // validate() the app's File > Open does, and the pixels are compared back
        // so a key that dropped a colour would show up here rather than as a hole
        // in a sprite.
        const back = P.parse(readFileSync(path, 'utf8'));
        for (const [i, s] of back.sprites.entries()) {
            const want = project.sprites[i];
            if (s.name !== want.name || s.w !== want.w || s.h !== want.h)
                throw new Error(`${path}: read back as ${s.name} ${s.w}x${s.h}, wrote ${want.name} ${want.w}x${want.h}`);
            if (s.origin.x !== want.origin.x || s.origin.y !== want.origin.y)
                throw new Error(`${path}: origin read back as (${s.origin.x},${s.origin.y})`);
            if (JSON.stringify(s.frames) !== JSON.stringify(want.frames))
                throw new Error(`${path}: pixels do not survive a round trip`);
        }

        const drawn = idle.drawn + thrust.drawn;
        const dropped = idle.dropped + thrust.dropped;
        const share = drawn ? Math.round((dropped / drawn) * 100) : 0;
        if (q.before > opts.colors) reduced++;
        if (share >= 50) faded.push(key);

        const colours = q.before > opts.colors
            ? `${String(q.before).padStart(3)} -> ${q.palette.length} colours`
            : `${String(q.before).padStart(3)} colours`.padEnd(18);
        console.log(`  ${key.padEnd(18)} ${colours}   ${String(dropped).padStart(4)} of ${drawn} drawn pixels fell below alpha ${opts.alpha} (${share}%)`);
    }

    console.log(`\n${keys.length} project${keys.length === 1 ? '' : 's'} -> ${OUT}`);
    if (reduced) console.log(`${reduced} needed their colours reduced to fit ${opts.colors}`);

    // Half a character's pixels gone is not a rounding error, it is a thrust plume
    // or a ghost drawn faint on purpose. Say which ones and say what to do, rather
    // than leaving a nearly empty sprite to be discovered in the editor.
    if (faded.length) {
        console.log(`\nlost half their pixels or more at alpha ${opts.alpha}:`);
        console.log(`  ${faded.join(', ')}`);
        console.log(`these are drawn soft — mostly thrust plume. Re-run them lower, e.g.`);
        console.log(`  node scripts/import-moonlight-drift.mjs --alpha 24 --only ${faded[0]}`);
    }

    if (opts.addTarget) addTarget(SF, WII);

    console.log(`
Open one in the desktop build, edit, and Export to the magnolia target: the
sprite names are the filenames, so it lands back on ${join('wii', 'sprites')}.

Afterwards, in ${DRIFT}:
  python tui/tools/make_portraits.py     regenerates the terminal portraits
                                         from the sprites you just changed
The browser build draws its characters in web/js/characters/*.js and will not
follow — that folder is the game's source of truth for the art.`);
} catch (e) {
    // Every throw above names a path, a flag or a character. A stack trace on
    // top of that is noise: nothing here fails for a reason the caller cannot
    // read and act on.
    console.error(`
  ${e.message}
`);
    process.exit(1);
}
