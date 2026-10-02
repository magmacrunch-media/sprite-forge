#!/usr/bin/env node
// package-pwa.mjs — the PWA build, assembled into a tree of its own.
//
//   node scripts/package-pwa.mjs [out-dir]     assemble (default pwa/dist)
//   node scripts/package-pwa.mjs --check       validate coverage, write nothing
//
// WHY THIS IS A THIRD ASSEMBLER AND NOT A FLAG ON sync-web.mjs. app/ is the
// source of truth and each destination gets its own script, because each one
// resolves the shared parts differently and that difference is the whole job:
//
//   sync-web.mjs      -> magmacrunch.com/ware/sprite-forge/. Leaves ../shell/
//                        and ../utilities/ ALONE, because at that depth they
//                        already point at the website's own copies, and strips
//                        app/shell/fonts.css because the website wants its own.
//   this file          -> a standalone origin. CARRIES app/shell/ and app/fonts/
//                        and rewrites ../shell/ down a level, because there is
//                        no website underneath to point at.
//   desktop/ (Tauri)   -> app/ verbatim as frontendDist, shell and fonts
//                        included. This bundle is that same self-contained tree
//                        with the page lifted to the root.
//
// So the PWA is much closer to the Tauri bundle than to the website page, which
// is why it needs no cache-buster stamps: there is no website CI grading the
// `?v=` on these files, and the service worker's cache name carries a digest of
// the whole tree instead. Do not add stamping here to match sync-web.mjs. The
// two destinations genuinely disagree about whose job invalidation is.
//
// NOTHING IN app/ IS MODIFIED OR READ FOR WRITING. This script only reads it.
// That matters because app/ is simultaneously Tauri's frontendDist and the
// website's source, so a transform applied in place would land in two products
// nobody was building.

import { createHash } from 'node:crypto';
import {
    existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync,
} from 'node:fs';
import { dirname, join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..');

/* The prefixes that lose a level when the page moves from app/ui/index.html to
   the bundle root. ../utilities/ is deliberately NOT here: it is the website's
   index, it has no counterpart on a standalone origin, and pwa.css hides the
   one link that names it. Rewriting it would invent a path; dropping it would
   mean editing the shell. */
const LIFT = ['../kit/', '../core/', '../shell/'];

/* What goes across, and nothing else. Mirrors sync-web.mjs's COPY, plus the
   two directories that script leaves behind: shell/ and fonts/ are the
   website's there and ours here. */
const COPY = [
    { from: join('app', 'ui'), to: '.', files: /\.(js|css|svg)$/ },
    { from: join('app', 'core'), to: 'core', files: /\.js$/, deep: true },
    { from: join('app', 'kit'), to: 'kit', files: /\.js$/ },
    { from: join('app', 'shell'), to: 'shell', files: /\.(js|css)$/ },
    { from: join('app', 'fonts'), to: 'fonts', files: /\.(woff2|ttf|txt)$/ },
    { from: 'pwa', to: '.', files: /^(manifest\.json|pwa\.css|register\.js)$/ },
];

const PAGE = { from: join('app', 'ui', 'index.html'), to: 'index.html' };
const WORKER = { from: join('pwa', 'sw.js'), to: 'sw.js' };

/* Two sizes, both at or above the 192px a browser wants before it will offer
   to install. Taken from the Tauri icon set rather than duplicated, so the
   installed PWA and the installed desktop app cannot end up wearing different
   faces. Neither is declared `maskable`: these have no safe-zone padding, and
   claiming maskable on an unpadded icon gets it cropped on Android. */
const ICONS = {
    'icons/icon-256.png': join('desktop', 'src-tauri', 'icons', '128x128@2x.png'),
    'icons/icon-512.png': join('desktop', 'src-tauri', 'icons', 'icon.png'),
};

/** Lift the three prefixes a level. Anything already correct is untouched. */
export function rewrite(html) {
    return html.replace(/((?:src|href)=["'])([^"']+)(["'])/g, (m, pre, url, post) => {
        const hit = LIFT.find((p) => url.startsWith(p));
        return hit ? pre + url.slice(3) + post : m;
    });
}

/** The PWA's own tags, added to the page's <head> and <body>. `theme` comes
 *  from manifest.json rather than being written here twice: a <meta
 *  theme-color> that disagrees with the manifest is a browser-dependent
 *  colour, which is worse than either value. */
export function inject(html, theme) {
    const head = [
        '    <link rel="manifest" href="manifest.json">',
        `    <meta name="theme-color" content="${theme}">`,
        '    <link rel="apple-touch-icon" href="icons/icon-256.png">',
        '    <meta name="mobile-web-app-capable" content="yes">',
        /* Last, so it beats ui/style.css on equal specificity. */
        '    <link rel="stylesheet" href="pwa.css">',
    ].join('\n');

    const out = html.replace('</head>', `${head}\n</head>`);
    if (out === html) throw new Error('index.html has no </head> to inject into');

    const body = '    <script src="register.js" defer></script>';
    const done = out.replace('</body>', `${body}\n</body>`);
    if (done === out) throw new Error('index.html has no </body> to inject into');
    return done;
}

const walk = (dir, deep) => {
    const out = [];
    for (const e of readdirSync(dir, { withFileTypes: true })) {
        if (e.isDirectory()) {
            if (deep) out.push(...walk(join(dir, e.name), deep).map((f) => posix.join(e.name, f)));
        } else out.push(e.name);
    }
    return out;
};

/** destination path (posix, bundle-relative) -> absolute source path. */
export function plan() {
    const files = new Map();
    const put = (to, from) => files.set(to, from);

    for (const { from, to, files: re, deep } of COPY) {
        const base = join(REPO, from);
        if (!existsSync(base)) continue;
        for (const f of walk(base, deep)) {
            if (!re.test(posix.basename(f))) continue;
            put(to === '.' ? f : posix.join(to, f), join(base, ...f.split('/')));
        }
    }
    put(PAGE.to, join(REPO, PAGE.from));
    put(WORKER.to, join(REPO, WORKER.from));
    for (const [to, from] of Object.entries(ICONS)) put(to, join(REPO, from));
    return files;
}

/** What the worker precaches: everything in the bundle except the worker,
 *  which must not cache itself. Sorted so the digest below is stable. */
export function precache(dests) {
    return [...dests].filter((d) => d !== WORKER.to).sort().map((d) => `./${d}`);
}

/** sha256 over the precached contents, which is what makes a changed build get
 *  a new cache name with nothing bumped by hand. CRLF is normalised so the same
 *  tree digests alike whatever each checkout's autocrlf made of it, matching the
 *  rule sync-web.mjs uses for the same reason. */
export function cacheName(entries) {
    const h = createHash('sha256');
    for (const [dest, buf] of entries) {
        h.update(dest);
        h.update(buf.includes(0) ? buf : Buffer.from(buf.toString('utf8').replace(/\r\n/g, '\n')));
    }
    return `sprite-forge-${h.digest('hex').slice(0, 8)}`;
}

/** Substitute the worker's two generated fields.
 *
 *  ANCHORED TO THE ASSIGNMENT LINES, AND ASSERTED, because the obvious spelling
 *  is wrong in a way that still produces a file. A string argument to .replace()
 *  hits only the FIRST occurrence, and sw.js names both tokens in its own header
 *  comment before it uses them, so `.replace('__PRECACHE__', json)` pasted the
 *  precache array into the prose and left `var PRECACHE = __PRECACHE__;` intact.
 *  The build reported success and the worker threw on its first install, where
 *  nothing in this repo would have seen it. Hence the regexes, and hence the
 *  throw: a token that did not get replaced must stop the build, not ship. */
export function fill(src, name, list) {
    const subs = [
        [/^var CACHE = "__CACHE__";$/m, `var CACHE = ${JSON.stringify(name)};`],
        [/^var PRECACHE = __PRECACHE__;$/m, `var PRECACHE = ${JSON.stringify(list, null, 2)};`],
    ];
    let out = src;
    for (const [re, to] of subs) {
        if (!re.test(out)) throw new Error(`sw.js no longer carries the line ${re} expects`);
        out = out.replace(re, () => to);
    }
    return out;
}

/** Every local asset the page asks for, as it will be spelled in the bundle.
 *  The coverage check below is the one that earns its keep: a <script> added to
 *  index.html and not to COPY is a bundle that 404s in a window with no
 *  devtools, and this turns that into a build failure instead. */
export function referenced(html) {
    const out = [];
    for (const m of html.matchAll(/(?:src|href)=["']([^"']+)["']/g)) {
        const url = m[1].split('?')[0];
        if (/^(https?:|data:|mailto:|#|\/)/.test(url)) continue;
        if (url.startsWith('../')) continue;   // left to the website, see LIFT
        if (url.endsWith('/')) continue;       // a directory link, not an asset
        out.push(url);
    }
    return out;
}

function build(outDir, { write }) {
    const files = plan();
    const problems = [];

    for (const [to, from] of files) if (!existsSync(from)) problems.push(`missing source: ${from} (for ${to})`);

    const manifest = JSON.parse(readFileSync(join(REPO, 'pwa', 'manifest.json'), 'utf8'));
    const page = inject(rewrite(readFileSync(join(REPO, PAGE.from), 'utf8')), manifest.theme_color);

    for (const ref of referenced(page)) {
        if (!files.has(ref)) problems.push(`index.html loads ${ref}, which nothing copies`);
    }
    for (const icon of manifest.icons.map((i) => i.src)) {
        if (!files.has(icon)) problems.push(`manifest names icon ${icon}, which nothing copies`);
    }

    if (problems.length) {
        console.error('PWA build refused:\n' + problems.map((p) => `  ${p}`).join('\n'));
        process.exit(1);
    }

    /* Contents first, so the cache name covers the transformed page rather than
       the source one. The worker is excluded from its own digest by precache(). */
    const built = new Map();
    for (const [to, from] of files) {
        if (to === PAGE.to) built.set(to, Buffer.from(page, 'utf8'));
        else if (to !== WORKER.to) built.set(to, readFileSync(from));
    }
    const list = precache([...built.keys()]);
    const name = cacheName([...built].sort(([a], [b]) => (a < b ? -1 : 1)));
    built.set(WORKER.to, Buffer.from(fill(readFileSync(join(REPO, WORKER.from), 'utf8'), name, list), 'utf8'));

    if (!write) {
        console.log(`PWA build OK: ${built.size} files, cache ${name}`);
        console.log(`  ${list.length} precached, ${[...built.keys()].filter((f) => f.startsWith('core/')).length} in core/`);
        return;
    }

    /* EMPTIED, NOT REMOVED. Deleting outDir itself fails with EPERM whenever
       anything holds a handle to it, and on Windows a process's current working
       directory is such a handle: one shell sitting in pwa/dist is enough to
       break every subsequent build. Clearing the contents needs no handle on the
       directory and works in that case. Same wording hypnopompia's pipeline
       uses for the iOS bundle, and for the same reason. */
    mkdirSync(outDir, { recursive: true });
    for (const e of readdirSync(outDir)) rmSync(join(outDir, e), { recursive: true, force: true });
    for (const [to, buf] of built) {
        const dest = join(outDir, ...to.split('/'));
        mkdirSync(dirname(dest), { recursive: true });
        writeFileSync(dest, buf);
    }
    console.log(`PWA build -> ${outDir}`);
    console.log(`  ${built.size} files, cache ${name}, ${list.length} precached`);
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
    const args = process.argv.slice(2);
    const check = args.includes('--check');
    const rest = args.filter((a) => !a.startsWith('--'));
    build(rest[0] ? join(process.cwd(), rest[0]) : join(REPO, 'pwa', 'dist'), { write: !check });
}
