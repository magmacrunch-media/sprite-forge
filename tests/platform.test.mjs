import { test, eq, ok } from './assert.mjs';
import { coreSandbox, loadUI } from './harness.mjs';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(ROOT, 'app', 'ui', 'index.html'), 'utf8');

/* The relabeller is a pure string transform wrapped in a DOM pass, so the
   transform is what gets tested and the DOM pass is left to the browser. The
   sandbox gets a navigator, because detecting the platform is the one thing
   this module does before anything asks it a question. */
function load(ua) {
    const sandbox = coreSandbox({
        navigator: { userAgent: ua, userAgentData: undefined },
        document: { querySelectorAll: () => [] },
    });
    loadUI(sandbox, 'platform.js');
    return sandbox.SpriteForge.platform;
}

const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15';
const WIN = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

export default function () {
    test('a Mac is detected, and Windows is not', () => {
        ok(load(MAC).isMac, 'macOS');
        ok(!load(WIN).isMac, 'Windows');
    });

    test('userAgentData wins over the userAgent when it is there', () => {
        const sandbox = coreSandbox({
            navigator: { userAgent: WIN, userAgentData: { platform: 'macOS' } },
            document: { querySelectorAll: () => [] },
        });
        loadUI(sandbox, 'platform.js');
        ok(sandbox.SpriteForge.platform.isMac, 'the modern API is asked first');
    });

    test('on Windows every label is left exactly alone', () => {
        const P = load(WIN);
        for (const s of ['Ctrl+S', 'Ctrl+Shift+S', 'Alt+F4', 'Del']) eq(P.label(s), s, s);
    });

    test('on a Mac the modifiers become glyphs', () => {
        const P = load(MAC);
        eq(P.label('Ctrl+S'), '⌘S', 'command');
        eq(P.label('Ctrl+N'), '⌘N', 'command');
        eq(P.label('Del'), '⌫', 'delete');
    });

    /* Ctrl+Shift+S has to come out as ONE glyph run with shift first — ⇧⌘S is
       what every Mac menu shows. Consuming the modifiers one at a time would
       give ⌘⇧S, which is backwards, and is the reason the replace order is
       what it is. */
    test('a two-modifier chord comes out in the Mac order, shift first', () => {
        const P = load(MAC);
        eq(P.label('Ctrl+Shift+S'), '⇧⌘S', 'save as');
        eq(P.label('Ctrl+Shift+Z'), '⇧⌘Z', 'redo');
        ok(!P.label('Ctrl+Shift+S').includes('⌘⇧'), 'never command-then-shift');
    });

    /* Alt+F4 is not a chord that exists on a Mac. It is not translated, it is
       replaced by the thing that actually quits. */
    test('Alt+F4 becomes the Mac way to quit', () => {
        eq(load(MAC).label('Alt+F4'), '⌘Q', 'quit');
    });

    test('prose containing a chord is relabelled too', () => {
        const P = load(MAC);
        eq(P.label('Undo (Ctrl+Z)'), 'Undo (⌘Z)', 'a tooltip');
    });

    test('a label with nothing to translate survives untouched', () => {
        const P = load(MAC);
        eq(P.label('F1'), 'F1', 'function keys are the same everywhere');
        eq(P.label('Templates'), 'Templates', 'plain words');
    });

    /* The markup carries the Windows spelling, which is what the relabeller
       expects to find. Single-key hints — T, =, D — are left alone by design;
       label() only touches modifier chords. What matters is that every hint
       which NAMES a modifier is spelled the way the relabeller reads it, or
       the Mac build would show a Ctrl chord. */
    test('the markup spells its shortcuts the way the relabeller reads them', () => {
        const hints = [...html.matchAll(/<i>([^<]+)<\/i>/g)].map((m) => m[1]);
        ok(hints.length >= 10, `${hints.length} shortcut hints in the menu`);
        for (const h of hints) {
            if (!/Ctrl|Alt|Shift|Del/.test(h)) continue;
            ok(/^(Ctrl\+|Alt\+|Shift\+|Del)/.test(h),
                `"${h}" is in a form label() understands`);
        }
    });

    test('the quit item is the one carrying Alt+F4', () => {
        ok(/data-action="app:quit"[^>]*>Exit<i>Alt\+F4<\/i>/.test(html),
            'so the Mac pass finds both the word and the chord');
    });

    /* The Reference card spells chords as separate <kbd> elements, which the
       <i> pass cannot reach. If these stopped being whole-word caps the Mac
       build would say ⌘N in the menu and Ctrl+N in the reference. */
    test('the reference card spells its modifiers as whole-word keycaps', () => {
        const caps = [...html.matchAll(/<kbd>([^<]+)<\/kbd>/g)].map((m) => m[1]);
        ok(caps.includes('Ctrl'), 'a bare Ctrl cap, which KEYCAPS maps');
        ok(caps.includes('Shift'), 'a bare Shift cap');
        for (const c of caps) {
            ok(!/\+/.test(c), `"${c}" is one key, not a chord in a single cap`);
        }
    });
}
