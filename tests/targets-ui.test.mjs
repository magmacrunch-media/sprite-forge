import { test, eq, ok } from './assert.mjs';
import { coreSandbox, loadUI, canvas } from './harness.mjs';

// The second ui/ file these tests reach into, and for the same reason
// project-ui.js earned it: the part of it that is a decision rather than a DOM.
//
// The decision is whether to export at all. A target is a folder chosen from a
// dialog, so it existed once — and then the repo moves. From inside the app a
// moved repo is invisible, because the write SUCCEEDS: magma-kit's write_in_root
// calls create_dir_all on the parent, so exporting into a root that is gone
// rebuilds the old path out of nothing, drops the sheet in it, and reports every
// file it wrote. This desk had exactly that in its own targets.json, pointing at
// C:/magma/dev/moonlight-drift/wii from before the games moved under
// magmacrunch/games/, and nothing would have said so.
//
// So each of the three export paths asks the disk first, and these pin that it
// refuses, names the path, and writes nothing.

const CFG = 'C:/cfg';
const TARGETS = CFG + '/targets.json';

/** A fake element: enough for a row to be built and inspected, no more.
 *
 *  `textContent = ''` empties the children, because that is what it does in a
 *  browser and it is how render() clears the list before redrawing it. Without
 *  that the rows from every earlier render are still in `children` and the row
 *  assertions below read a list three times the length of the one on screen. */
function elem(tag) {
    let text = '';
    const e = {
        tag, children: [], className: '', title: '',
        style: {}, disabled: false, hidden: false,
        classList: { add: () => {}, toggle: () => {} },
        append: (...kids) => e.children.push(...kids),
        appendChild: (kid) => e.children.push(kid),
        addEventListener: (ev, fn) => { e[ev] = fn; },
    };
    Object.defineProperty(e, 'textContent', {
        get: () => text,
        set: (v) => { text = String(v); e.children.length = 0; },
    });
    Object.defineProperty(e, 'innerHTML', {
        get: () => '',
        set: () => { e.children.length = 0; },
    });
    return e;
}

function mount(opts = {}) {
    const sandbox = coreSandbox();
    const toasts = [];
    const logged = [];
    const wrote = [];
    // Which paths the stub filesystem believes in. The config file always; the
    // roots only when a case says so, because a root that is gone is the case.
    const present = new Set([TARGETS, ...(opts.present || [])]);

    sandbox.console = { ...console, error: (...a) => logged.push(a.map(String).join(' ')), warn: () => {} };

    const list = elem('div');
    // Every id resolves to null except the row container. gm-modal among them,
    // which is what keeps MagmaKit out of this suite: targets-ui only builds the
    // GameMaker asker when that element exists.
    sandbox.document.getElementById = (id) => (id === 'target-list' ? list : null);
    sandbox.document.querySelector = () => null;
    sandbox.document.createElement = (tag) => (tag === 'canvas' ? canvas() : elem(tag));

    sandbox.Toast = { show: (m) => toasts.push(m) };

    sandbox.SpriteForge.fs = {
        configDir: async () => CFG,
        exists: async (p) => present.has(p),
        readText: async () => JSON.stringify({
            format: 'sprite-forge/targets/1',
            targets: opts.targets || [],
        }),
        writeText: async () => {},
        writeInRoot: async (root, rel) => { wrote.push(root + '/' + rel); },
        writeTextInRoot: async (root, rel) => { wrote.push(root + '/' + rel); },
        readDir: async () => { throw new Error('readDir should not be reached'); },
    };
    // png.js is ui/ and encodes with a real canvas; the bytes are not what is
    // under test, only whether anything asked for them.
    sandbox.SpriteForge.png = { bytes: async () => new Uint8Array([137, 80, 78, 71]) };
    sandbox.SpriteForge.projectUI = {
        currentProject: () => ({ sprites: [sprite('spr_dag')] }),
    };

    // core/ loaded before the fs stub above, so tier.js decided LITE. The panel
    // is desktop-only and every path here is one the desktop takes; say FULL
    // rather than let a test's load order stand in for that.
    sandbox.SpriteForge.tier.current = sandbox.SpriteForge.tier.create(true);

    loadUI(sandbox, 'targets-ui.js');
    return { ui: sandbox.SpriteForge.targetsUI, toasts, logged, wrote, list, present };
}

/** One 2x2 sprite — the sheet is not what is being tested. */
function sprite(name) {
    return {
        name, w: 2, h: 2, origin: { x: 0, y: 2 }, fps: 8,
        frames: [[['#ff0000', '#ff0000'], ['#ff0000', '#ff0000']]],
    };
}

const MAGNOLIA = { label: 'moonlight-drift (wii)', kind: 'magnolia', root: 'C:/gone/wii' };
const GODOT = { label: 'bis', kind: 'godot', root: 'C:/gone/bis' };
const GM = { label: 'dag', kind: 'gamemaker', root: 'C:/gone/dag' };

export default async function () {
    await test.async('a sheet export into a root that is gone writes nothing and says which path', async () => {
        const m = mount({ targets: [MAGNOLIA] });
        await m.ui.reload();
        await m.ui.exportTo(MAGNOLIA);

        eq(m.wrote, [], 'nothing was written');
        ok(m.toasts.some(t => t.includes('C:/GONE/WII')), 'the toast names the root: ' + m.toasts);
        ok(m.logged.some(l => l.includes('C:/gone/wii') && l.includes('does not exist')),
            'and the console says why');
    });

    await test.async('the same for godot, which writes source rather than a sheet', async () => {
        const m = mount({ targets: [GODOT] });
        await m.ui.reload();
        await m.ui.exportGodot(GODOT);
        eq(m.wrote, [], 'nothing was written');
        ok(m.toasts.some(t => t.includes('C:/GONE/BIS')), 'named');
    });

    // GameMaker reads the .yyp before it plans, so a missing root already
    // failed — with "could not read the project", which sends you looking at
    // the project rather than at the path it is not at.
    await test.async('and for gamemaker, before it tries to read the .yyp', async () => {
        const m = mount({ targets: [GM] });
        await m.ui.reload();
        await m.ui.exportGameMaker(GM);      // readDir throws if it is reached
        eq(m.wrote, [], 'nothing was written');
        ok(m.toasts.some(t => t.includes('C:/GONE/DAG')), 'named');
        ok(!m.toasts.some(t => t.includes('COULD NOT READ')), 'not the generic message');
    });

    await test.async('a root that is there still exports', async () => {
        const m = mount({ targets: [MAGNOLIA], present: [MAGNOLIA.root] });
        await m.ui.reload();
        await m.ui.exportTo(MAGNOLIA);
        eq(m.wrote, ['C:/gone/wii/sprites/spr_dag.png'], 'the sheet landed');
        eq(m.ui.missing(), [], 'and the row is not marked');
    });

    await test.async('the row for a missing root is marked, and its neighbour is not', async () => {
        const here = { label: 'here', kind: 'adenosine', root: 'C:/here' };
        const m = mount({ targets: [MAGNOLIA, here], present: [here.root] });
        await m.ui.reload();
        await m.ui.checkRoots();

        eq(m.ui.missing(), ['magnolia:c:/gone/wii'], 'one of the two');
        const classes = m.list.children.map(r => r.className);
        eq(classes, ['target-row gone', 'target-row'], 'and only that row wears it');
        ok(m.list.children[0].children[0].title.includes('NOT THERE'), 'the tooltip says so');
    });

    await test.async('a target that comes back clears its own mark', async () => {
        const m = mount({ targets: [MAGNOLIA] });
        await m.ui.reload();
        await m.ui.checkRoots();
        eq(m.ui.missing(), ['magnolia:c:/gone/wii'], 'marked while it is gone');

        m.present.add(MAGNOLIA.root);
        await m.ui.exportTo(MAGNOLIA);
        eq(m.ui.missing(), [], 'the export re-asked, so no reload was needed');
        eq(m.wrote, ['C:/gone/wii/sprites/spr_dag.png'], 'and it exported');
    });
}
