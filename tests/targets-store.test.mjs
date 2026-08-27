import { test, eq, ok, throws } from './assert.mjs';

export default function (SF) {
    const S = SF.targets.store;
    const dag = { label: 'dag', kind: 'adenosine', root: 'C:/games/dag' };

    test('a machine starts with no targets', () => {
        eq(S.blank().targets, [], 'blank list');
        ok(S.blank().format.startsWith('sprite-forge/targets/'), 'format is stamped');
    });

    test('the kinds are the sheet engines plus gamemaker', () => {
        eq([...S.KINDS].sort(),
            ['adenosine', 'gamemaker', 'magnolia', 'texastoast'], 'kinds');
    });

    test('adding a target keeps the original untouched', () => {
        const empty = S.blank();
        const one = S.add(empty, dag);
        eq(empty.targets.length, 0, 'the input is not mutated');
        eq(one.targets.length, 1, 'the copy has it');
        eq(one.targets[0].root, 'C:/games/dag', 'root');
    });

    test('a root is normalised, so one folder cannot be added twice', () => {
        const slash = String.fromCharCode(92);
        eq(S.normalizeRoot('C:' + slash + 'games' + slash + 'dag' + slash),
            'C:/games/dag', 'backslashes and trailing separator');
        const one = S.add(S.blank(), dag);
        throws(() => S.add(one, { ...dag, root: 'C:/games/dag/' }),
            'already exports into', 'the same folder twice');
    });

    test('the same repo can be a target for two different engines', () => {
        const one = S.add(S.blank(), dag);
        const two = S.add(one, { ...dag, kind: 'gamemaker', label: 'dag (gm)' });
        eq(two.targets.length, 2, 'both kept');
    });

    test('a target has to say what it is and where it goes', () => {
        throws(() => S.add(S.blank(), { ...dag, root: '   ' }), 'root is empty');
        throws(() => S.add(S.blank(), { ...dag, label: '' }), 'label is empty');
        throws(() => S.add(S.blank(), { ...dag, kind: 'godot' }), 'unknown kind');
    });

    test('removing is by identity, and removing nothing is not an error', () => {
        const one = S.add(S.blank(), dag);
        eq(S.remove(one, S.id('adenosine', 'C:/games/dag')).targets, [], 'removed');
        eq(S.remove(one, 'adenosine:C:/games/other').targets.length, 1, 'no such target');
    });

    test('a store survives a round trip', () => {
        const two = S.add(S.add(S.blank(), dag),
            { label: 'toast', kind: 'texastoast', root: 'D:/toast' });
        eq(S.parse(S.stringify(two)), two, 'round trip');
    });

    test('a broken targets.json says what is wrong with it', () => {
        throws(() => S.parse('{'), 'not valid JSON');
        throws(() => S.parse('[]'), 'not an object');
        throws(() => S.parse('{"format":"nope","targets":[]}'), 'unknown format');
        throws(() => S.parse(`{"format":"${S.FORMAT}"}`), 'targets is not a list');
        throws(() => S.parse(`{"format":"${S.FORMAT}","targets":[{"kind":"adenosine","root":"C:/x"}]}`),
            'label is empty');
    });
}
