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
    const GM = window.SpriteForge.targets.gamemaker;
    const GD = window.SpriteForge.targets.godot;
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

    /** Re-read for the same reason fs is. The POLICY is core/tier.js's. */
    const can = (cap) => window.SpriteForge.tier.current.has(cap);
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
            const path = await configPath();
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

    /** Where the list lives. Resolved on demand rather than only in loadStore:
     *  that returns early when there is no filesystem yet, and a shell that
     *  installs one afterwards would otherwise reach a null configDir here. */
    async function configPath() {
        if (!configDir) configDir = await fs().configDir();
        return join(configDir, 'targets.json');
    }

    /** Writes the store it is given, and is the only thing that writes. The
     *  callers assign to `store` only once this has returned, so a failed
     *  write leaves the panel agreeing with the disk rather than with what
     *  the user hoped. */
    async function saveStore(next) {
        await fs().writeText(await configPath(), S.stringify(next));
    }

    // ── drawing ─────────────────────────────────────────────

    function render() {
        if (panel) panel.hidden = !can('targets');
        // Nothing below is worth doing into a panel nobody can open, and
        // every row it would draw names a path only the desktop has.
        if (!can('targets')) return;
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
            // A dispatch rather than a ternary chain: three kinds of export now,
            // and which one a target gets is a fact about its kind, not a nested
            // condition to read. Anything not named here takes a sheet.
            const EXPORTERS = { gamemaker: exportGameMaker, godot: exportGodot };
            go.addEventListener('click', () => (EXPORTERS[t.kind] || exportTo)(t));

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
            const next = S.add(store, { label: baseName(root), kind, root });
            await saveStore(next);
            store = next;
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
        const next = S.remove(store, S.id(t.kind, t.root));
        try {
            await saveStore(next);
            store = next;
            render();
        } catch (e) {
            // Without this the row vanished from a panel that no longer
            // matched the file, and the target came back at the next start.
            toast('could not update targets.json');
            console.error('could not forget target:', e);
        }
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

        report(t, plan);
    }

    /**
     * What was written, and the line that loads it.
     *
     * Shared by all three export paths so they cannot come to disagree about
     * how an export is reported. The snippet is where the origin survives the
     * trip for a sheet: it is not in the PNG, so the call that loads it is the
     * only place that number is written down.
     */
    function report(t, plan) {
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

    // ── Godot ───────────────────────────────────────────────
    //
    // No image at all: the frames become C# source that rebuilds the texture at
    // runtime. See core/targets/godot.js for why that is the right shape for a
    // Godot project rather than a PNG.

    async function exportGodot(t) {
        const project = projectUI().currentProject();
        let plan;
        try {
            plan = GD.planProject({ project });
        } catch (e) {
            toast(e.message);
            console.error('could not plan export:', e);
            return;
        }

        try {
            // Text, not bytes — the whole point of this target.
            for (const w of plan.writes) await fs().writeTextInRoot(t.root, w.path, w.text);
        } catch (e) {
            toast('could not export');
            console.error(`export to ${t.root} failed:`, e);
            return;
        }

        report(t, plan);
    }

    // ── GameMaker ───────────────────────────────────────────
    //
    // The other three take a sheet. GameMaker takes the frames apart: one PNG
    // per frame under its own GUID, an identical copy under layers/, and the
    // .yy patched for size and origin. The GUIDs are read out of the existing
    // .yy and never invented, so the slot has to already exist — which is why
    // this asks which sprite to overwrite instead of taking a name.

    const gmModal = document.getElementById('gm-modal');
    const gmList = document.getElementById('gm-list');

    // A question-shaped modal: every way out settles the same promise exactly
    // once, and dismissal answers null. The kit (kit/modal.js) owns that
    // wiring, including the reason it is deliberately NOT driven by the
    // dialog's own close event — settling on that event means any environment
    // that does not raise it leaves the caller waiting for an answer that never
    // comes, with the dialog already gone from the screen. Closing is ours to
    // do, so the answer is ours to deliver.
    const gmUI = gmModal && MagmaKit.modal.asker(gmModal, { closers: ['gm-cancel'] });

    /** @returns {Promise<string|null>} the chosen sprite, or null if dismissed */
    function pickSprite(names) {
        return gmUI.ask((settle) => {
            gmList.textContent = '';
            for (const name of names) {
                const b = document.createElement('button');
                b.className = 'gm-sprite';
                b.textContent = name;
                b.addEventListener('click', () => settle(name));
                gmList.append(b);
            }
        });
    }

    async function exportGameMaker(t) {
        const f = fs();
        const sprite = projectUI().currentProject().sprites[0];

        let spriteName, yyText;
        try {
            const entries = await f.readDir(t.root);
            const yyp = entries.find(e => !e.is_dir && /\.yyp$/i.test(e.name));
            if (!yyp) { toast('no .yyp in that folder'); return; }

            const names = GM.spriteNames(await f.readText(join(t.root, yyp.name)));
            if (!names.length) { toast('that project has no sprites'); return; }

            spriteName = await pickSprite(names);
            if (!spriteName) return;                 // cancelled

            yyText = await f.readText(join(t.root, `sprites/${spriteName}/${spriteName}.yy`));
        } catch (e) {
            toast('could not read the project');
            console.error(`reading ${t.root}:`, e);
            return;
        }

        let plan;
        try {
            plan = GM.plan({
                yyText, spriteName,
                frames: sprite.frames, w: sprite.w, h: sprite.h,
                originX: sprite.origin.x, originY: sprite.origin.y,
            });
        } catch (e) {
            // A frame-count mismatch says both numbers and refuses; that is
            // worth showing rather than reducing to "could not export".
            toast(e.message);
            console.error('could not plan export:', e);
            return;
        }

        try {
            // Each frame is named twice by the plan: once as the frame and
            // once as its layers/ copy. Encoding once and writing the same
            // bytes twice makes them byte-identical rather than merely equal —
            // and a layers/ copy that does not match is the sprite that looks
            // right on disk and renders blank in the IDE.
            const encoded = new Map();
            for (const w of plan.writes) {
                if (!encoded.has(w.frame)) {
                    const canvas = sheet.framesToSheet(
                        [sprite.frames[w.frame]], sprite.w, sprite.h, 1);
                    encoded.set(w.frame, await png.bytes(canvas));
                }
                await f.writeInRoot(t.root, w.path, encoded.get(w.frame));
            }
            // Last, and only if something actually changed: the .yy is the file
            // GameMaker reads first, so writing it before its frames would
            // leave a moment where it describes pixels that are not there yet.
            if (plan.yy) await f.writeTextInRoot(t.root, plan.yy.path, plan.yy.text);
        } catch (e) {
            toast('could not export');
            console.error(`export to ${t.root} failed:`, e);
            return;
        }

        if (exportOutput) {
            exportOutput.value = [
                `// sprite//forge -> ${t.label} (gamemaker)`,
                `// ${t.root}`,
                `//   ${spriteName}: ${sprite.frames.length} frame` +
                    `${sprite.frames.length === 1 ? '' : 's'}, ` +
                    `${plan.writes.length} files` +
                    `${plan.yy ? ' + the .yy' : ' (.yy already correct)'}`,
                '//',
                `// run tools/import_sprite_sheet.py --check to confirm`,
            ].join('\n');
        }

        for (const warning of plan.warnings) console.warn(warning);
        toast(`exported ${spriteName}`);
    }

    // ── init ────────────────────────────────────────────────

    if (kindSelect) {
        // The three sheet engines, then Godot. GameMaker is a valid kind in the
        // store but is deliberately not offered here: adding one means choosing
        // a sprite slot inside an existing .yy, which the export flow asks for
        // rather than the Add button.
        const KINDS = E.kinds().concat({ id: 'godot', label: 'godot (C# source)' });
        for (const { id, label } of KINDS) {
            const opt = document.createElement('option');
            opt.value = id;
            opt.textContent = label;
            kindSelect.append(opt);
        }
    }
    if (btnAdd) btnAdd.addEventListener('click', addTarget);

    render();
    // A browser tab has no game repo to write into, so there is no
    // targets.json to go looking for either.
    if (can('targets')) loadStore();

    window.SpriteForge.targetsUI = {
        render,
        targets: () => (store ? store.targets : []),
        // For tests: drive the same paths the buttons do.
        add: addTarget, exportTo, exportGameMaker, exportGodot, reload: loadStore,
    };
}());
