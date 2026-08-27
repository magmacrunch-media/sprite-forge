// targets-ui.js — the TARGETS panel: export straight into a game repo.
//
// Desktop only, and for the same reason project-ui.js is: it looks for
// SpriteForge.fs and hides itself when there is none. A browser tab has no
// game repo to write into.
//
// It owns no export knowledge. Where a sheet goes and what the load call looks
// like is core/targets/engines.js; what a valid list of targets is, and how it
// round-trips, is core/targets/store.js. This file picks folders, draws rows,
// and moves bytes between the two.
//
// The list itself is read from and written to targets.json in the OS config
// directory — never the project, never the repo. See core/targets/store.js.

(function () {
    const S = window.SpriteForge.targets.store;
    const E = window.SpriteForge.targets.engines;
    const sheet = window.SpriteForge.sheet;
    const png = window.SpriteForge.png;

    const panel = document.querySelector('[data-section="targets"]');
    const list = document.getElementById('target-list');
    const kindSelect = document.getElementById('target-kind');
    const btnAdd = document.getElementById('target-add');
    const exportOutput = document.getElementById('export-output');

    // Re-read rather than capture, exactly as project-ui.js does: a stub can
    // be installed after this file has loaded, and a captured reference would
    // miss it.
    const fs = () => window.SpriteForge.fs;
    const projectUI = () => window.SpriteForge.projectUI;

    let store = S.blank();
    let configDir = null;

    const toast = (m) => window.Toast ? window.Toast.show(String(m).toUpperCase()) : console.log(m);
    const join = (dir, file) => dir.replace(/[\\/]+$/, '') + '/' + file;

    // ── the list on disk ────────────────────────────────────

    async function loadStore() {
        const f = fs();
        if (!f) return;
        try {
            configDir = await f.configDir();
            const path = join(configDir, 'targets.json');
            // A machine that has never added a target has no file, and that is
            // the normal first run rather than an error to report.
            store = await f.exists(path) ? S.parse(await f.readText(path)) : S.blank();
        } catch (e) {
            // A targets.json that cannot be read is worth saying out loud: the
            // alternative is silently behaving as though it held nothing and
            // then overwriting it with that nothing on the next Add.
            toast('could not read targets.json');
            console.error('targets.json:', e);
            store = null;
        }
        render();
    }

    async function saveStore() {
        await fs().writeText(join(configDir, 'targets.json'), S.stringify(store));
    }

    // ── drawing ─────────────────────────────────────────────

    function render() {
        if (panel) panel.hidden = !fs();
        if (!list) return;

        if (!store) {
            list.innerHTML = '<div class="hint">targets.json could not be read; ' +
                'fix or delete it and reopen.</div>';
            if (btnAdd) btnAdd.disabled = true;
            return;
        }
        if (btnAdd) btnAdd.disabled = false;

        list.textContent = '';
        if (!store.targets.length) {
            const empty = document.createElement('div');
            empty.className = 'hint';
            empty.textContent = 'no targets yet. add a game repo and export goes straight into it.';
            list.append(empty);
            return;
        }

        for (const t of store.targets) {
            const row = document.createElement('div');
            row.className = 'target-row';

            const name = document.createElement('div');
            name.className = 'target-name';
            name.textContent = t.label;
            name.title = `${t.kind} — ${t.root}`;

            const go = document.createElement('button');
            go.textContent = 'EXPORT';
            // GameMaker is in the store's vocabulary because its planner
            // exists, but nothing here can drive it yet: it needs a .yy chosen
            // and read before it can plan anything. Listing it disabled beats
            // hiding a target the user can see in their own targets.json.
            if (t.kind === 'gamemaker') {
                go.disabled = true;
                go.title = 'GameMaker export is not wired up yet';
            } else {
                go.addEventListener('click', () => exportTo(t));
            }

            const del = document.createElement('button');
            del.className = 'target-del';
            del.textContent = '×';
            del.title = `Forget ${t.label}`;
            del.addEventListener('click', () => forget(t));

            row.append(name, go, del);
            list.append(row);
        }
    }

    // ── adding and forgetting ───────────────────────────────

    async function addTarget() {
        const f = fs();
        if (!f || !store) return;
        const kind = kindSelect ? kindSelect.value : 'adenosine';
        const root = await f.pickFolder(`Choose the ${kind} project folder`);
        if (!root) return;                      // cancelled
        try {
            store = S.add(store, { label: baseName(root), kind, root });
            await saveStore();
            render();
            toast('target added');
        } catch (e) {
            // The store refuses a folder already registered for that engine.
            // Its message is prefixed with the index it was validating, which
            // is what you want reading a broken file and not what you want
            // after clicking Add, where there is only one candidate.
            toast(e.message.replace(/^targets\[\d+\]:\s*/, ''));
            console.error('could not add target:', e);
        }
    }

    async function forget(t) {
        const f = fs();
        if (!await f.confirm(`Stop exporting into ${t.root}?`, 'SPRITE//FORGE')) return;
        store = S.remove(store, S.id(t.kind, t.root));
        await saveStore();
        render();
    }

    const baseName = (p) => S.normalizeRoot(p).split('/').pop() || p;

    // ── the export itself ───────────────────────────────────

    async function exportTo(t) {
        const project = projectUI().currentProject();
        let plan;
        try {
            plan = E.planProject({ kind: t.kind, project });
        } catch (e) {
            // A frame that is not the size it claims, or a sprite with none.
            toast(e.message);
            console.error('could not plan export:', e);
            return;
        }

        try {
            for (const w of plan.writes) {
                const canvas = sheet.framesToSheet(w.frames, w.w, w.h, w.cols);
                await fs().writeInRoot(t.root, w.path, await png.bytes(canvas));
            }
        } catch (e) {
            // writeInRoot refuses anything that climbs out of the root, and the
            // disk can be full or read-only. Either way nothing is claimed.
            toast('could not export');
            console.error(`export to ${t.root} failed:`, e);
            return;
        }

        // The snippet is where the origin survives the trip: it is not in the
        // PNG, so the call that loads the sheet is the only place it is
        // written down.
        if (exportOutput) {
            exportOutput.value = [
                `// sprite//forge -> ${t.label} (${t.kind})`,
                `// ${t.root}`,
                ...plan.writes.map(w => `//   ${w.path}`),
                '//',
                plan.snippet,
            ].join('\n');
        }

        for (const warning of plan.warnings) console.warn(warning);
        toast(plan.warnings.length
            ? `exported with ${plan.warnings.length} warning${plan.warnings.length === 1 ? '' : 's'}`
            : `exported to ${t.label}`);
    }

    // ── init ────────────────────────────────────────────────

    if (kindSelect) {
        for (const { id, label } of E.kinds()) {
            const opt = document.createElement('option');
            opt.value = id;
            opt.textContent = label;
            kindSelect.append(opt);
        }
    }
    if (btnAdd) btnAdd.addEventListener('click', addTarget);

    render();
    loadStore();

    window.SpriteForge.targetsUI = {
        render,
        targets: () => (store ? store.targets : []),
        // For tests: drive the same paths the buttons do.
        add: addTarget, exportTo, reload: loadStore,
    };
}());
