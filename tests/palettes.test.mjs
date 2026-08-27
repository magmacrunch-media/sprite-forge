import { test, eq, ok, throws } from './assert.mjs';

export default function (SF) {
    const P = SF.palettes;

    test('the vendored themes came across', () => {
        ok(SF.opsThemes.length > 30, `expected the ops set, got ${SF.opsThemes.length}`);
        ok(SF.opsThemes.every(t => t.colors.length), 'every theme has colours');
        ok(SF.opsThemes.every(t => t.id && t.name && t.section), 'every theme is labelled');
    });

    test('every vendored colour is a plain lowercase hex', () => {
        const bad = SF.opsThemes.flatMap(t => t.colors.filter(c => !/^#[0-9a-f]{6}$/.test(c)));
        eq(bad, [], 'malformed colours');
    });

    test('theme ids are unique, so one cannot shadow another', () => {
        const ids = SF.opsThemes.map(t => t.id);
        eq(ids.length, new Set(ids).size, 'duplicate ids');
    });

    test('normalize lowercases, drops rubbish, dedupes and caps', () => {
        eq(P.normalize(['#FF0000', 'nope', '#ff0000', '#00FF00']),
            ['#ff0000', '#00ff00'], 'cleaned');
        eq(P.normalize(['#111111', '#222222', '#333333'], 2),
            ['#111111', '#222222'], 'capped');
    });

    test('a theme too big for the palette is flagged rather than silently cut', () => {
        const big = { name: 'big', colors: ['#111111', '#222222', '#333333'] };
        ok(P.truncates(big, 2), 'three into two');
        ok(!P.truncates(big, 3), 'three into three');
        ok(!P.truncates(big, 0), 'no cap at all');
    });

    test('a custom theme is made from a name and the current swatches', () => {
        const t = P.custom('  My Greens ', ['#00FF00', '#00ff00', '#008800']);
        eq(t.id, 'custom:my-greens', 'id is slugged');
        eq(t.name, 'My Greens', 'name is trimmed');
        eq(t.colors, ['#00ff00', '#008800'], 'colours normalised');
        ok(t.custom, 'marked as yours');
    });

    test('a theme has to have a name and at least one colour', () => {
        throws(() => P.custom('', ['#ffffff']), 'name is empty');
        throws(() => P.custom('empty', []), 'no usable colours');
        throws(() => P.custom('junk', ['nope']), 'no usable colours');
        throws(() => P.validate(null), 'not an object');
        throws(() => P.validate({ name: 'x', colors: 'red' }), 'colors is not a list');
    });

    test('yours are listed after the vendored ones', () => {
        const mine = P.custom('mine', ['#ffffff']);
        const all = P.list([mine]);
        eq(all.length, SF.opsThemes.length + 1, 'one more than vendored');
        eq(all[all.length - 1].id, 'custom:mine', 'and it is last');
        ok(!all[0].custom, 'the vendored ones are not marked custom');
    });

    test('saving over a name replaces it rather than listing it twice', () => {
        const a = P.custom('dupe', ['#ffffff']);
        const b = P.custom('dupe', ['#000000']);
        const all = P.list([a, b]);
        eq(all.filter(t => t.id === 'custom:dupe').length, 1, 'listed once');
        eq(P.find('custom:dupe', [a, b]).colors, ['#000000'], 'the later one wins');
    });

    test('find returns null rather than throwing on an unknown id', () => {
        eq(P.find('custom:nope', []), null, 'unknown id');
    });

    test('grouping keeps yours in their own section', () => {
        const groups = P.bySection([P.custom('mine', ['#ffffff'])]);
        const last = groups[groups.length - 1];
        eq(last.section, 'yours', 'yours is a section');
        eq(last.themes.length, 1, 'holding the one');
        ok(groups.length > 2, 'the vendored sections are there too');
    });
}
