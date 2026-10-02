import { test, eq, ok, throws } from './assert.mjs';
import { rewrite, inject, plan, precache, fill, referenced } from '../scripts/package-pwa.mjs';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST = JSON.parse(readFileSync(join(REPO, 'pwa', 'manifest.json'), 'utf8'));

/* The bundle is assembled into a gitignored tree, so the useful tests are the
   ones needing neither a build nor a browser: the path lift, the two injections,
   and the coverage check that is the whole reason this script refuses rather
   than warns. */

export default function () {
    test('the page moves to the bundle root, so kit/, core/ and shell/ lose the ..', () => {
        eq(rewrite('<script src="../kit/boot.js"></script>'),
            '<script src="kit/boot.js"></script>', 'kit');
        eq(rewrite('<script src="../core/targets/store.js"></script>'),
            '<script src="core/targets/store.js"></script>', 'a nested core file');
        eq(rewrite('<link rel="stylesheet" href="../shell/fonts.css">'),
            '<link rel="stylesheet" href="shell/fonts.css">', 'shell');
    });

    /* This is the one policy difference from sync-web.mjs, which leaves
       ../shell/ alone because the website has its own copy underneath. Asserted
       in both suites so the pair cannot quietly converge. */
    test('../utilities/ is left alone, because nothing replaces it here', () => {
        const link = '<a href="../utilities/" class="back-link chip">';
        eq(rewrite(link), link, 'the website back link survives rewriting');
    });

    test('paths that were already right are untouched', () => {
        for (const s of ['<script src="editor.js"></script>',
            '<link rel="stylesheet" href="style.css">',
            '<link rel="icon" href="favicon.svg">']) eq(rewrite(s), s, s);
    });

    const page = inject('<html><head>\n</head><body>\n</body></html>', '#ff3d6e');

    test('inject adds the manifest, the theme colour and the worker registration', () => {
        ok(page.includes('rel="manifest" href="manifest.json"'), 'the manifest link');
        ok(page.includes('content="#ff3d6e"'), 'the theme colour, passed in from the manifest');
        ok(page.includes('src="register.js"'), 'the registration script');
        ok(page.indexOf('register.js') > page.indexOf('</head>'), 'registration is in the body');
    });

    /* Equal specificity, so the later sheet wins. pwa.css hides the site chrome
       that ui/style.css lays out, and losing that race puts a dead link back on
       the page. */
    test('pwa.css is injected after the page own stylesheets', () => {
        const full = inject(readFileSync(join(REPO, 'app', 'ui', 'index.html'), 'utf8'), '#000');
        ok(full.indexOf('pwa.css') > full.indexOf('style.css'), 'pwa.css loads last');
    });

    test('inject refuses a page it cannot place its tags in', () => {
        throws(() => inject('<html><head></head>no body', '#000'), '</body>', 'missing body');
        throws(() => inject('<html>no head<body></body></html>', '#000'), '</head>', 'missing head');
    });

    const files = plan();

    test('the plan carries the page, core/, kit/, the shell and the fonts', () => {
        ok(files.has('index.html'), 'the page');
        ok(files.has('style.css'), 'the stylesheet');
        ok(files.has('core/tier.js'), 'core/');
        ok(files.has('core/targets/store.js'), 'core/ recursively');
        ok(files.has('kit/boot.js'), 'kit/');
        ok(files.has('shell/app-shell.css'), 'the shell, which the website build leaves behind');
        ok(files.has('fonts/PressStart2P-Regular.woff2'), 'the faces, likewise');
        ok(files.has('manifest.json') && files.has('sw.js') && files.has('register.js'), 'the PWA files');
    });

    /* THE ONE THAT EARNS ITS KEEP. A <script> added to index.html and not to
       COPY is a bundle that 404s in an installed window with no devtools open. */
    test('every local asset index.html loads is in the plan', () => {
        const html = inject(rewrite(readFileSync(join(REPO, 'app', 'ui', 'index.html'), 'utf8')),
            MANIFEST.theme_color);
        const missing = referenced(html).filter((r) => !files.has(r));
        eq(missing, [], 'assets the page loads that nothing copies');
    });

    test('every icon the manifest names is in the plan', () => {
        const missing = MANIFEST.icons.map((i) => i.src).filter((s) => !files.has(s));
        eq(missing, [], 'icons named but not copied');
    });

    test('the worker is not in its own precache list', () => {
        const list = precache(['index.html', 'sw.js', 'style.css']);
        ok(!list.includes('./sw.js'), 'a worker that cached itself could never be replaced');
        ok(list.includes('./index.html'), 'the page is precached, so a navigation works offline');
    });

    /* REGRESSION. sw.js names both tokens in its header comment before it uses
       them, so `.replace('__PRECACHE__', json)` replaced the PROSE and left the
       code untouched, producing a worker that threw on install while the build
       reported success. Anchoring to the assignment lines is the fix; this is
       the test that would have caught it. */
    test('fill substitutes the code, not the comment that names the tokens', () => {
        const src = [
            '/* replaced: __CACHE__ and __PRECACHE__ are filled in at build time. */',
            'var CACHE = "__CACHE__";',
            'var PRECACHE = __PRECACHE__;',
        ].join('\n');
        const out = fill(src, 'sprite-forge-abc12345', ['./index.html']);

        ok(out.includes('var CACHE = "sprite-forge-abc12345";'), 'the cache name');
        ok(out.includes('"./index.html"'), 'the precache list');
        ok(!/var PRECACHE = __PRECACHE__;/.test(out), 'no token left in the code');
        ok(out.split('\n')[0].includes('__CACHE__'), 'the comment is left as written');
    });

    test('fill refuses a worker whose assignments have moved', () => {
        throws(() => fill('var CACHE = "__CACHE__";', 'n', []), 'PRECACHE', 'missing precache line');
        throws(() => fill('nothing here', 'n', []), 'CACHE', 'missing cache line');
    });

    /* Origin-agnostic by construction, which is what lets the same bundle be
       served from a Store-bound origin and from a local preview. An absolute
       start_url or scope would pin it to one host. */
    test('the manifest is relative, so the bundle works on any origin', () => {
        ok(MANIFEST.start_url.startsWith('./'), `start_url ${MANIFEST.start_url} is relative`);
        ok(MANIFEST.scope.startsWith('./'), `scope ${MANIFEST.scope} is relative`);
        for (const i of MANIFEST.icons) ok(!i.src.startsWith('/'), `icon ${i.src} is relative`);
    });

    /* A browser will not offer to install without an icon of at least 192px. */
    test('the manifest carries an icon big enough to be installable', () => {
        const px = MANIFEST.icons
            .map((i) => parseInt(String(i.sizes).split('x')[0], 10))
            .filter((n) => Number.isFinite(n));
        ok(px.some((n) => n >= 192), `largest raster icon is ${Math.max(...px)}px, needs 192`);
    });
}
