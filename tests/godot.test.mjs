import { test, eq, ok, throws } from './assert.mjs';

// The Godot target writes C# rather than a PNG, so what these pin is different
// from the sheet targets': not "are the pixels in the right cell" but "will this
// compile, and does it still say what the .forge said". A generated file that is
// one character off is a build error in someone else's repo, which is a long way
// from here.
export default function (SF) {
    const G = SF.targets.godot;

    // A tiny sprite with a transparent hole, so the '.' path is always exercised.
    const grid = (rows, map) => rows.map(r => [...r].map(c => map[c] || null));
    const FRAME = grid(['#.#', '.#.'], { '#': '#ff0000' });
    const one = (over) => G.plan({ name: 'dag', frames: [FRAME], w: 3, h: 2, ...over });

    const cs = (p) => p.writes.find(w => w.path.endsWith('Dag.cs')).text;

    // ── names become identifiers ────────────────────────

    test('a sprite name becomes a C# class name', () => {
        eq(G.className('carl_face'), 'CarlFace', 'underscores separate words');
        eq(G.className('deck-chevron'), 'DeckChevron', 'so do hyphens');
        eq(G.className('spr player walk'), 'SprPlayerWalk', 'and spaces');
        eq(G.className('dag'), 'Dag', 'a single word is capitalised');
        eq(G.className('CarlFace'), 'CarlFace', 'already-cased names survive');
    });

    test('a name that cannot be an identifier is made into one', () => {
        // Sprite names are filenames everywhere else in this app; here they are
        // also identifiers, which is a stricter thing to be.
        eq(G.className('8bit'), 'Art8bit', 'a leading digit takes a prefix');
        eq(G.className('!!!'), 'Art', 'punctuation alone still yields something');
        eq(G.className(''), 'Art', 'and so does nothing at all');
    });

    // ── what lands on disk ──────────────────────────────

    test('the decoder is written too, and first', () => {
        // A project that got the art and not ForgeArt does not compile, and
        // "go and find the other file" is a worse failure than a rewrite.
        const p = one();
        eq(p.writes.length, 2, 'runtime plus the art');
        ok(p.writes[0].path.endsWith('ForgeArt.cs'), `runtime first, got ${p.writes[0].path}`);
        ok(p.writes[0].text.includes('public static class ForgeArt'), 'and it is the decoder');
        ok(p.writes[0].text.includes('FromRows'), 'with the entry point the art calls');
    });

    test('files land where the generated art goes', () => {
        eq(one().writes.map(w => w.path),
            ['Scripts/Art/ForgeArt.cs', 'Scripts/Art/Dag.cs'], 'default directory');
        ok(one({ dir: 'src/Gen' }).writes.every(w => w.path.startsWith('src/Gen/')),
            'and an override is honoured');
    });

    test('the rows are the picture, one character per texel', () => {
        const text = cs(one());
        ok(text.includes('"a.a",'), `row 0 is the drawing: ${text.match(/"[a-z.]+",/g)}`);
        ok(text.includes('".a.",'), 'row 1 too');
        eq((text.match(/^\s+"[^"]*",$/gm) || []).length, 2, 'two rows, for a 2-tall sprite');
    });

    test('transparent stays transparent, not black', () => {
        // A '.' the decoder turns into alpha 0. Writing it as a colour would
        // fill every hole in the art with whatever that colour happened to be.
        ok(cs(one()).includes('.'), "the reserved character is used");
        ok(!cs(one()).includes("['.']"), 'and it never gets a Color of its own');
    });

    test('the key holds the colours used, not the palette that was open', () => {
        // A .forge carries the whole editor palette whether the art touched it
        // or not; forty unused Color literals is noise in a generated file.
        const text = cs(one());
        eq((text.match(/\['.'\] = new Color/g) || []).length, 1, 'one colour, one entry');
        ok(text.includes('// #ff0000'), 'and the hex is kept beside it as a comment');
    });

    test('a colour round-trips back to the byte it came from', () => {
        const m = cs(one()).match(/new Color\(([0-9.]+)f, ([0-9.]+)f, ([0-9.]+)f\)/);
        ok(m, 'a Color literal was emitted');
        const back = m.slice(1, 4).map(v => Math.round(parseFloat(v) * 255));
        eq(back, [255, 0, 0], 'red survives the trip through a float literal');
    });

    test('the class is named after the sprite and reads its own rows', () => {
        const text = cs(one());
        ok(text.includes('public static class Dag'), 'named for the sprite');
        ok(text.includes('ForgeArt.FromRows(Rows, Key)'), 'and calls the decoder');
        ok(text.includes('dag.forge'), 'and names the file it was generated from');
    });

    // ── the one-frame rule ──────────────────────────────

    test('a texture is one image, and extra frames are said rather than dropped', () => {
        const p = G.plan({ name: 'dag', frames: [FRAME, FRAME, FRAME], w: 3, h: 2 });
        eq(p.writes.length, 2, 'still one class');
        ok(p.warnings.some(w => /3 frames/.test(w)), `the count is named: ${p.warnings}`);
        ok(p.warnings.some(w => /only the first/.test(w)), 'and what happened to the rest');
    });

    test('a well-formed sprite warns about nothing', () => {
        eq(one().warnings, [], 'no noise on the ordinary path');
    });

    // ── refusals ────────────────────────────────────────

    test('a malformed sprite is refused rather than half-written', () => {
        throws(() => G.plan({ name: 'dag', frames: [], w: 3, h: 2 }), 'no frames', 'empty');
        throws(() => G.plan({ name: 'dag', frames: [FRAME], w: 4, h: 2 }),
            'is not 4x2', 'a frame that disagrees with the declared size');
    });

    // ── a whole project ─────────────────────────────────

    test('many sprites share one decoder', () => {
        // Written five times it is not an error, but a plan that lists it five
        // times reads like five different files.
        const p = G.planProject({
            project: { sprites: ['a', 'b', 'c'].map(n => ({ name: n, frames: [FRAME], w: 3, h: 2 })) },
        });
        eq(p.writes.filter(w => w.path.endsWith('ForgeArt.cs')).length, 1, 'one runtime');
        eq(p.writes.filter(w => w.path.endsWith('ForgeArt.cs')).length
            + p.writes.filter(w => !w.path.endsWith('ForgeArt.cs')).length,
            p.writes.length, 'and everything else is art');
        eq(p.writes.map(w => w.path).filter(x => !x.endsWith('ForgeArt.cs')),
            ['Scripts/Art/A.cs', 'Scripts/Art/B.cs', 'Scripts/Art/C.cs'], 'one class each');
    });

    test('the snippet says how to use what was written', () => {
        ok(/Dag\.Texture/.test(one().snippet), `names the class: ${one().snippet}`);
    });

    test('the decoder is byte-identical every time, so rewriting it is a no-op', () => {
        eq(G.runtime(), G.runtime(), 'stable');
        eq(one().writes[0].text, G.runtime(), 'and it is what the plan writes');
    });
}
