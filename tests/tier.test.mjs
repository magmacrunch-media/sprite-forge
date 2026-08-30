import { test, eq, ok } from './assert.mjs';

/* The LITE/FULL split is a product decision, so the thing worth asserting is
   the decision, not the mechanism: that LITE is a strict subset, that the
   table lists exceptions rather than members, and above all that nothing the
   web tool can already do has quietly become desktop-only. */

export default function (SF) {
    const T = SF.tier;

    const lite = T.create(false);
    const full = T.create(true);

    test('the tier is decided by whether there is a filesystem behind it', () => {
        eq(full.name, 'full', 'a backed build is FULL');
        eq(lite.name, 'lite', 'an unbacked build is LITE');
        ok(full.isFull && !full.isLite, 'full is not also lite');
        ok(lite.isLite && !lite.isFull, 'lite is not also full');
    });

    test('FULL has everything LITE has', () => {
        for (const cap of Object.keys(T.CAPABILITIES)) {
            ok(!lite.has(cap) || full.has(cap), `full has ${cap} if lite does`);
        }
    });

    test('the table lists exceptions, so an unlisted capability is in both', () => {
        ok(lite.has('draw'), 'LITE draws');
        ok(lite.has('frames'), 'LITE has frames');
        ok(lite.has('templates'), 'LITE has the character templates');
        ok(lite.has('themes'), 'LITE has the colour themes');
        ok(lite.has('export'), 'LITE exports a PNG sheet');
        ok(lite.has('import'), 'LITE imports a PNG sheet');
    });

    /* THE RULE, ASSERTED. Everything the tool live on magmacrunch.com can do
       today stays in LITE, and the sprite list and themes it never had are in
       there too. A capability may only be desktop-only when it is new work
       needing a filesystem or a window — never by taking something away from
       the web build to make the desktop one look better. If this list has to
       shrink, that is a product decision someone must make on purpose, and
       this is where they will be made to make it. */
    test('LITE never regresses from what is live today', () => {
        const LIVE_TODAY = ['draw', 'tools', 'frames', 'onion', 'animation',
            'templates', 'palette', 'replace', 'transform', 'origin',
            'canvasSize', 'undo', 'export', 'import', 'sprites', 'themes'];
        for (const cap of LIVE_TODAY) {
            ok(lite.has(cap), `LITE keeps ${cap}`);
        }
    });

    test('the desktop-only capabilities are the ones that need a desktop', () => {
        eq(Object.keys(T.CAPABILITIES).sort(),
            ['menubar', 'projects', 'targets'],
            'exactly three, and each needs a filesystem or a window');
        for (const cap of Object.keys(T.CAPABILITIES)) {
            ok(!lite.has(cap), `LITE does not have ${cap}`);
            ok(full.has(cap), `FULL has ${cap}`);
        }
    });
}
