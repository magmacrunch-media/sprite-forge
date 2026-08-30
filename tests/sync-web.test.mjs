import { test, eq, ok, throws } from './assert.mjs';
import { rewrite, plan, stamp } from '../scripts/sync-web.mjs';
import { createHash } from 'node:crypto';

/* The sync writes into a repo that is not this one, so the useful tests are
   the ones that need neither a website checkout nor a network: the path
   rewrite, the stamp rule the website grades us on, and — the one that earns
   its keep — that the copy manifest still covers every file the page loads. */

export default function () {
    test('the page moves up a level, so ../kit/ and ../core/ lose the ..', () => {
        eq(rewrite('<script src="../kit/boot.js"></script>'),
            '<script src="kit/boot.js"></script>', 'kit');
        eq(rewrite('<script src="../core/targets/store.js"></script>'),
            '<script src="core/targets/store.js"></script>', 'a nested core file');
    });

    /* At ware/sprite-forge/ these already point at ware/shell/ and
       ware/utilities/, which is why app/shell/fonts.css is a fork and is the
       one file not sent. Rewriting them would break the page. */
    test('../shell/ and ../utilities/ are left exactly alone', () => {
        const keep = [
            '<link rel="stylesheet" href="../shell/fonts.css">',
            '<link rel="stylesheet" href="../shell/app-shell.css">',
            '<script src="../shell/toast.js"></script>',
            '<a href="../utilities/" class="back-link chip">',
        ];
        for (const s of keep) eq(rewrite(s), s, s);
    });

    test('paths that were already right are untouched', () => {
        for (const s of ['<script src="editor.js"></script>',
            '<link rel="stylesheet" href="style.css">',
            '<link rel="icon" href="favicon.svg">']) eq(rewrite(s), s, s);
    });

    const files = plan();

    test('the manifest carries the page, core/, kit/ and the ui/ assets', () => {
        ok(files.has('index.html'), 'the page');
        ok(files.has('style.css'), 'the stylesheet, flat rather than under css/');
        ok(files.has('favicon.svg'), 'the icon');
        ok(files.has('core/tier.js'), 'core/');
        ok(files.has('core/targets/store.js'), 'core/ recursively');
        ok(files.has('kit/boot.js'), 'kit/');
        ok(files.has('platform.js'), 'the newest ui/ file');
    });

    /* app/shell/fonts.css says in its own header that it must not be sent —
       it is the swapped copy for a bundle whose faces are one level up, and
       the website wants its own. Pinning the decision the file depends on. */
    test('the shell and the fonts are not sent; the website owns both', () => {
        for (const rel of [...files.keys()]) {
            ok(!rel.startsWith('shell/'), `${rel} is not shell/`);
            ok(!rel.startsWith('fonts/'), `${rel} is not fonts/`);
        }
        ok(!files.has('fonts.css'), 'not flattened into place either');
    });

    test('KIT.md is documentation and stays here', () => {
        ok(!files.has('kit/KIT.md'), 'it names this repo’s vendoring contract');
    });

    /* THE ONE THAT EARNS ITS KEEP. plan() throws if index.html loads anything
       that is neither copied nor one of the two deliberate exemptions, so
       adding a ui/ file and forgetting the sync is a red build HERE rather
       than a MISSING asset in the website's CI, one repo away from the cause.
       plan() ran above without throwing; this states what that proved. */
    test('every asset the page loads is either copied or deliberately theirs', () => {
        const html = files.get('index.html').toString('utf8');
        const refs = [...html.matchAll(/(?:src|href)=["']([^"']+)["']/g)].map((m) => m[1]);
        ok(refs.length > 20, `${refs.length} references in the page`);
        for (const ref of refs) {
            if (/^(https?:)?\/\/|^data:|^#/.test(ref)) continue;
            const clean = ref.split('?')[0];
            if (clean.startsWith('../shell/') || clean.startsWith('../utilities/')) continue;
            ok(files.has(clean), `${clean} is copied by the sync`);
        }
        ok(!html.includes('"../core/'), 'no ../core/ survived the rewrite');
        ok(!html.includes('"../kit/'), 'no ../kit/ survived the rewrite');
    });

    /* The stamp is website/scripts/check-cache-busters.mjs's rule, and that
       script is what fails if we get it wrong. Recomputed here the way the
       checker does, against the bytes the sync actually ships. */
    test('every stamp matches the file it stamps, by the website’s rule', () => {
        const html = files.get('index.html').toString('utf8');
        const stamped = [...html.matchAll(/(?:src|href)=["']([^"'?]+)\?v=([0-9a-f]+)["']/g)];
        ok(stamped.length >= 20, `${stamped.length} stamped references`);
        for (const [, url, v] of stamped) {
            eq(v.length, 8, `${url} carries an 8-hex stamp`);
            const want = createHash('sha256')
                .update(files.get(url).toString('utf8').replace(/\r\n/g, '\n'))
                .digest('hex').slice(0, 8);
            eq(v, want, `${url} stamp agrees with its content`);
        }
    });

    test('scripts and stylesheets are stamped; the favicon is not', () => {
        const html = files.get('index.html').toString('utf8');
        ok(/<script src="editor\.js\?v=[0-9a-f]{8}"/.test(html), 'a ui/ script');
        ok(/<script src="core\/tier\.js\?v=[0-9a-f]{8}"/.test(html), 'a core/ script');
        ok(/<script src="kit\/boot\.js\?v=[0-9a-f]{8}"/.test(html), 'a kit/ script');
        ok(/href="style\.css\?v=[0-9a-f]{8}"/.test(html), 'the stylesheet');
        // Matching every other page under ware/, which leaves it bare.
        ok(/href="favicon\.svg"/.test(html), 'the favicon is left unstamped');
        // Theirs: the website stamps its own shell on its own build.
        ok(/href="\.\.\/shell\/app-shell\.css"/.test(html), 'the shell is not ours to stamp');
    });

    /* A stamp has to be the same on every machine or it flips back and forth
       with whoever ran last, which is why the rule normalises first — both
       repos leave line endings to core.autocrlf. */
    test('the stamp does not move when the line endings do', () => {
        const lf = 'a\nb\nc\n';
        const hash = (s) => createHash('sha256')
            .update(s.replace(/\r\n/g, '\n')).digest('hex').slice(0, 8);
        eq(hash(lf.replace(/\n/g, '\r\n')), hash(lf), 'CRLF and LF stamp alike');
    });

    test('an unaccounted-for asset is refused by name, not shipped', () => {
        throws(() => stamp('<script src="ghost.js"></script>', files),
            'ghost.js', 'named, so the fix is obvious');
        throws(() => stamp('<script src="ghost.js"></script>', files),
            'Add them to COPY', 'and says what to do about it');
    });

    test('the guard does not fire on the website’s own assets', () => {
        const theirs = '<link rel="stylesheet" href="../shell/app-shell.css">';
        eq(stamp(theirs, files), theirs, 'left alone, not reported missing');
    });
}
