import { test, eq, ok, throws } from './assert.mjs';

/* The LITE/FULL split is a product decision, so the thing worth asserting is
   the decision, not the mechanism: that LITE is a strict subset, that the
   table lists exceptions rather than members, and above all that nothing the
   web tool can already do has quietly become desktop-only. */

export default function (SF) {
    const T = SF.tier;

    const lite = T.create(false);
    const full = T.create(true);
    const disk = T.create('disk');

    test('the tier is decided by whether there is a filesystem behind it', () => {
        eq(full.name, 'full', 'a backed build is FULL');
        eq(lite.name, 'lite', 'an unbacked build is LITE');
        ok(full.isFull && !full.isLite, 'full is not also lite');
        ok(lite.isLite && !lite.isFull, 'lite is not also full');
    });

    /* The booleans predate the middle tier and still mean what they meant, so
       every call site and suite written against them keeps working. */
    test('a tier can be named, and the old booleans still answer', () => {
        eq(T.create('lite').name, 'lite', 'named lite');
        eq(T.create('full').name, 'full', 'named full');
        eq(disk.name, 'disk', 'named disk');
        ok(disk.isDisk && !disk.isLite && !disk.isFull, 'disk is only disk');
    });

    /* A tier nobody defined answering `false` to every `has` would read on
       screen as a build that had lost its features, not as a typo. */
    test('an unknown tier is refused rather than answered', () => {
        throws(() => T.create('deluxe'), 'unknown tier', 'a tier that does not exist');
    });

    test('the tiers are a ladder: LITE then DISK then FULL', () => {
        for (const cap of Object.keys(T.CAPABILITIES)) {
            ok(!lite.has(cap) || disk.has(cap), `disk has ${cap} if lite does`);
            ok(!disk.has(cap) || full.has(cap), `full has ${cap} if disk does`);
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

    /* THE MIDDLE TIER'S WHOLE CLAIM, ASSERTED. A browser with picked handles
       can write back to the file it opened and cannot do the other two: TARGETS
       wants a directory it can hold across sessions plus a per-machine config
       file, and the menu bar wants a window. ui/fsa.js provides the methods for
       `projects` and deliberately omits the rest, so if `targets` ever moved
       down to 'disk' the panel would appear and then fail on its first call to
       a method that is not there. This is where that gets caught. */
    test('DISK is projects, and is not TARGETS or the menu bar', () => {
        ok(disk.has('projects'), 'a picked handle is enough to save back to a file');
        ok(!disk.has('targets'), 'no directory handle and no per-machine config');
        ok(!disk.has('menubar'), 'no window');
    });

    /* The same rule the LITE row is held to, one tier up: the middle tier was
       added to GIVE the browser something, never to take anything away. */
    test('DISK never regresses from LITE', () => {
        const LIVE_TODAY = ['draw', 'tools', 'frames', 'onion', 'animation',
            'templates', 'palette', 'replace', 'transform', 'origin',
            'canvasSize', 'undo', 'export', 'import', 'sprites', 'themes'];
        for (const cap of LIVE_TODAY) ok(disk.has(cap), `DISK keeps ${cap}`);
    });
}
