#!/usr/bin/env node
// sync-web.mjs — the LITE build, into the magmacrunch.com tree.
//
//   node scripts/sync-web.mjs [path-to-website]           copy, rewrite, stamp
//   node scripts/sync-web.mjs --check [path-to-website]   report only
//
// app/ is the shippable web tree as well as Tauri's frontendDist, so there is
// nothing to build — this is a copy with two transforms. Which half of the app
// a browser gets is core/tier.js's business, decided at runtime; this file only
// moves bytes.
//
// THE PAGE MOVES UP ONE LEVEL. app/ui/index.html sits two below app/;
// ware/sprite-forge/index.html sits one below ware/. So ../kit/ and ../core/
// become kit/ and core/ — and ../shell/ and ../utilities/ are left ALONE,
// because at the new depth they already point where they should, at the
// website's own ware/shell/ and ware/utilities/. That is the whole reason
// app/shell/fonts.css exists as a fork and is the one file not sent: it is the
// swapped copy for a bundle where the faces are one level up, and the website
// wants its own, whose ../../fonts/ is correct there.
//
// THE STAMPS ARE THE WEBSITE'S RULE, NOT OURS. Pages load assets as
// `editor.js?v=3f8ef237`, the first 8 hex of the file's SHA-256 over content
// with CRLF normalised to LF, and website/scripts/check-cache-busters.mjs
// fails CI if a stamp and its file disagree. digest() below is that rule
// verbatim; if it ever drifts, the sync passes here and the website's build
// goes red one repo away from the cause.
//
// BYTES GO THROUGH UNTOUCHED, AND COMPARISONS DO NOT. Both repos leave line
// endings to core.autocrlf
// (see .gitattributes, which names this script), so the same committed blob is
// LF in one working tree and CRLF in the other — git materialises whatever the
// local config says and reports neither as a change. Writing is therefore a
// straight byte copy: normalising on write would show every synced file as
// modified while `git diff` showed nothing, burying the one file that actually
// changed.
//
// But DECIDING whether to write has to normalise, or this reports the whole
// tree as behind every time the website is checked out on a machine whose
// autocrlf differs from this one. That is not drift, and it would make --check
// useless as a gate by crying wolf on all 33 files at once. sameText() is that
// comparison, and it normalises for the reason the digest does.

import { createHash } from 'node:crypto';
import {
    readFileSync, writeFileSync, readdirSync, statSync,
    mkdirSync, existsSync, rmSync, rmdirSync,
} from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve, relative, posix } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..');
const APP = join(REPO, 'app');

/* What goes across, and nothing else.
   - shell/ and fonts/ are the website's own; see the header.
   - kit/ goes as a unit, artstore.js included. It is unreferenced by
     index.html today, but kit/ is vendored wholesale — that is KIT.md's whole
     framing — and a glob cannot drift the way a hand-kept list can. Six
     kilobytes of never-fetched file on a static host costs nothing. */
const COPY = [
    { from: 'ui', to: '.', files: /\.(js|css|svg)$/ },
    { from: 'core', to: 'core', files: /\.js$/, deep: true },
    { from: 'kit', to: 'kit', files: /\.js$/ },
];

const PAGE = { from: join('ui', 'index.html'), to: 'index.html' };

/** The two prefixes that are deliberately the website's, not ours. */
const THEIRS = ['../shell/', '../utilities/'];

/** First 8 hex of sha256 over the content with newlines normalised to LF.
 *  Copied from website/scripts/check-cache-busters.mjs, which is the thing
 *  that grades the result. Do not "improve" it independently. */
const digest = (buf) => createHash('sha256')
    .update(buf.toString('utf8').replace(/\r\n/g, '\n'))
    .digest('hex')
    .slice(0, 8);

/** Same content, whatever each checkout's autocrlf made of the line endings.
 *  The NUL sniff is git's own text=auto heuristic: never strip a CR out of a
 *  binary, where it is data rather than a line ending. */
export function sameText(a, b) {
    if (a.includes(0) || b.includes(0)) return a.equals(b);
    const lf = (buf) => buf.toString('latin1').replace(/\r\n/g, '\n');
    return lf(a) === lf(b);
}

/**
 * The page, at its new depth.
 *
 * Exported so the suite can drive it without a website on disk. A plain global
 * replace is safe here rather than an attribute-aware parse: every ../kit/ and
 * ../core/ in index.html is inside a <script src>, and the quote in the match
 * keeps it that way if prose ever mentions one.
 */
export function rewrite(html) {
    return html
        .replaceAll('"../kit/', '"kit/')
        .replaceAll('"../core/', '"core/');
}

/** Local script/stylesheet references in a page, as [whole, prefix, url]. */
const LOCAL_ASSET = /(<(?:script|link)\b[^>]*?\b(?:src|href)=["'])([^"']+)(["'])/g;

/** Files under a directory, relative to it, posix-separated. */
function filesIn(dir, match, deep, prefix = '', out = []) {
    for (const entry of readdirSync(dir)) {
        const path = join(dir, entry);
        if (statSync(path).isDirectory()) {
            if (deep) filesIn(path, match, deep, posix.join(prefix, entry), out);
        } else if (match.test(entry)) {
            out.push(posix.join(prefix, entry));
        }
    }
    return out;
}

/**
 * Add `?v=<hash>` to every local .js/.css the page loads.
 *
 * .js and .css only, matching every other page under ware/: the site leaves
 * favicon.svg unstamped, and check-cache-busters only requires that an
 * unstamped reference exists.
 *
 * The drift guard is the important half. A reference that is neither ours nor
 * one of the two deliberate exemptions is a ui/ file someone added to
 * index.html without telling this script — which the website would report as a
 * MISSING asset, one repo away from the cause. Fail here instead, by name.
 *
 * Exported alongside rewrite() so the suite drives this guard rather than
 * a second copy of the rule that could agree with itself and not with us.
 */
export function stamp(html, files) {
    const missing = [];

    const stamped = html.replace(LOCAL_ASSET, (whole, pre, url, post) => {
        if (/^(https?:)?\/\/|^data:|^#/.test(url)) return whole;

        const clean = url.split('?')[0];
        if (THEIRS.some((p) => clean.startsWith(p))) return whole;

        const bytes = files.get(clean);
        if (!bytes) {
            // Not ours, and not one of theirs. Something is unaccounted for.
            if (/\.(js|css)$/.test(clean)) missing.push(clean);
            return whole;
        }
        if (!/\.(js|css)$/.test(clean)) return whole;
        return `${pre}${clean}?v=${digest(bytes)}${post}`;
    });

    if (missing.length) {
        throw new Error(
            'index.html loads files sync-web.mjs does not copy:\n  '
            + missing.join('\n  ')
            + '\nAdd them to COPY, or to THEIRS if the website owns them.');
    }
    return stamped;
}

/**
 * The whole sync, as data: destination path -> bytes. Nothing is written and
 * nothing is read from the target, so --check and the real run compute the
 * same thing and differ only in what they do with it.
 */
export function plan() {
    const out = new Map();

    for (const rule of COPY) {
        const dir = join(APP, rule.from);
        for (const rel of filesIn(dir, rule.files, rule.deep)) {
            const dest = rule.to === '.' ? rel : posix.join(rule.to, rel);
            out.set(dest, readFileSync(join(dir, ...rel.split('/'))));
        }
    }

    // The page last: it is stamped against the files above, which are the
    // bytes the site will actually serve.
    const html = rewrite(readFileSync(join(APP, PAGE.from), 'utf8'));
    out.set(PAGE.to, Buffer.from(stamp(html, out), 'utf8'));
    return out;
}

/** Every file currently under the target, relative and posix-separated. */
function existing(root) {
    if (!existsSync(root)) return [];
    return filesIn(root, /./, true);
}

/** Drop the directories a prune emptied, deepest first. */
function tidy(root) {
    const dirs = [];
    (function walk(dir, rel) {
        for (const entry of readdirSync(dir)) {
            const path = join(dir, entry);
            if (statSync(path).isDirectory()) {
                walk(path, posix.join(rel, entry));
                dirs.push([path, posix.join(rel, entry)]);
            }
        }
    }(root, ''));
    for (const [path, rel] of dirs.reverse()) {
        if (readdirSync(path).length === 0) {
            rmdirSync(path);
            console.log(`  rmdir   ${rel}/`);
        }
    }
}

function main() {
    const args = process.argv.slice(2);
    const check = args.includes('--check');
    const site = resolve(args.find((a) => !a.startsWith('--')) || join(REPO, '..', 'website'));
    const target = join(site, 'ware', 'sprite-forge');

    if (!existsSync(site)) {
        console.error(`no website checkout at ${site}`);
        console.error('pass the path, or check it out beside this repo.');
        process.exit(1);
    }

    const files = plan();
    const writes = [];
    const drops = [];

    for (const [rel, bytes] of files) {
        const dest = join(target, ...rel.split('/'));
        // Skipped when the CONTENT matches, not the bytes: see sameText.
        // That is what keeps a no-op run from bumping mtimes across the
        // website tree, and what keeps --check honest on a checkout whose
        // line endings differ from this one's.
        if (existsSync(dest) && sameText(readFileSync(dest), bytes)) continue;
        writes.push(rel);
        if (check) continue;
        mkdirSync(dirname(dest), { recursive: true });
        writeFileSync(dest, bytes);
    }

    /* Prune whatever this run did not write, rather than a hardcoded list of
       the old monolith's files (js/app.js, js/templates.js, css/style.css).
       That subsumes them and stays right when a ui/ file is renamed. The risk
       is a website-only file dropped into this directory, which --check shows
       you before anything happens. */
    for (const rel of existing(target)) {
        if (files.has(rel)) continue;
        drops.push(rel);
        if (!check) rmSync(join(target, ...rel.split('/')));
    }

    for (const r of writes) console.log(`  write   ${r}`);
    for (const r of drops) console.log(`  delete  ${r}`);
    if (!check) tidy(target);

    const where = relative(REPO, target).split('\\').join('/');
    if (!writes.length && !drops.length) {
        console.log(`${where} is current (${files.size} files).`);
        return;
    }
    if (check) {
        console.log(`\n${where} is behind: ${writes.length} to write, ${drops.length} to delete.`);
        console.log('run `npm run sync-web`, then commit in the website repo.');
        process.exit(1);
    }
    console.log(`\nsynced ${files.size} files to ${where}.`);
    console.log('commit them in the website repo; GitHub Pages serves the tree.');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
