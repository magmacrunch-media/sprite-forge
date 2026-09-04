// mesh-ui.js — the SURFACE preview: this frame, wrapped onto the shape it is
// actually going to end up on.
//
// It exists because a texture is the one kind of sprite the canvas cannot show
// you. Drawing a face in the middle of a 64x32 image and putting it on a sphere
// lands it on the BACK of the head, because an engine's sphere unwrap puts u=0
// on +Z — and there is nothing on the canvas, at any zoom, that hints at it.
// core/mesh.js carries the layouts; this is the window onto them.
//
// It lives in the dock rather than the sidebar for the reason the animation
// preview does: it is a thing you watch while drawing, not a thing you open.
// Both tiers — a preview needs no filesystem, so it earns no tier row.
//
// The offset is a VIEW control and changes no pixels. That is deliberate: the
// fix for a misplaced face belongs in the material (Godot's uv1_offset) or in
// TRANSFORM's wrapping shift, and silently baking it here would make the export
// disagree with the canvas. The read-out is in texels so the number can be
// typed straight into either.

(function () {
    const mesh = window.SpriteForge.mesh;

    const canvas = document.getElementById('mesh-canvas');
    const shapeSel = document.getElementById('mesh-shape');
    const label = document.getElementById('mesh-label');
    const uOut = document.getElementById('mesh-u');
    const uDown = document.getElementById('mesh-u-down');
    const uUp = document.getElementById('mesh-u-up');
    const dock = document.getElementById('dock');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const PREF_KEY = 'meshPreview';
    const saved = MagmaKit.prefs.read(PREF_KEY) || {};

    let kind = mesh.SHAPES[saved.kind] ? saved.kind : 'sphere';
    let yaw = typeof saved.yaw === 'number' ? saved.yaw : 0;
    let pitch = typeof saved.pitch === 'number' ? saved.pitch : -0.18;
    let uTexels = Math.max(0, Math.round(saved.uTexels) || 0);

    // The detail deliberately matches what a low-poly engine actually builds.
    // A preview on a 64-segment sphere would be smooth and would hide the
    // faceting the art has to survive.
    const DETAIL = 16;
    let built = mesh.build(kind, DETAIL);

    // The last frame handed over, so a shape or offset change can redraw
    // without waiting for the next edit.
    let source = null;

    for (const k of mesh.kinds()) {
        const opt = document.createElement('option');
        opt.value = k.id;
        opt.textContent = k.label;
        opt.title = k.detail;
        shapeSel.append(opt);
    }
    shapeSel.value = kind;

    function save() {
        MagmaKit.prefs.write(PREF_KEY, { kind, yaw, pitch, uTexels });
    }

    function describe() {
        // The offset is deliberately NOT repeated here. It is already in the
        // box beside the canvas, and appending it pushed the label past the
        // width the dock can spare and ellipsised the note instead.
        label.textContent = `surface — ${mesh.SHAPES[kind].note}`;
        // Not while it is being typed into: draw() normalises the offset into
        // the image width, and rewriting the box mid-keystroke would eat the
        // second digit of "32". Only on a change, because this runs on every
        // animation tick.
        const now = String(uTexels);
        if (document.activeElement !== uOut && uOut.value !== now) uOut.value = now;
    }

    /**
     * Redraw, then say what is being shown.
     *
     * describe() is deliberately NOT inside draw(): draw() gives up early when
     * no frame has arrived yet or the dock is hidden, and folding the two
     * together left the label describing the previously selected shape in both
     * cases. Ordered this way round because draw() wraps the offset into the
     * image width and the label should report what it settled on.
     */
    function update() { draw(); describe(); }

    function draw() {
        if (!source || (dock && dock.hidden)) return;
        const w = source.width, h = source.height;
        if (!w || !h) return;
        const tex = source.getContext('2d').getImageData(0, 0, w, h);
        uTexels = ((uTexels % w) + w) % w;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.putImageData(mesh.render(built, tex, {
            width: canvas.width,
            height: canvas.height,
            yaw, pitch,
            uOffset: uTexels / w,
        }), 0, 0);
    }

    shapeSel.addEventListener('change', () => {
        kind = shapeSel.value;
        built = mesh.build(kind, DETAIL);
        update(); save();
    });

    const nudge = (d) => () => { uTexels += d; update(); save(); };
    uDown.addEventListener('click', nudge(-1));
    uUp.addEventListener('click', nudge(1));

    uOut.addEventListener('input', () => {
        const n = parseInt(uOut.value, 10);
        if (Number.isNaN(n)) return;   // mid-edit, or a cleared box
        uTexels = n;
        update(); save();
    });
    // draw() wrapped the value into the image width; show what it settled on.
    uOut.addEventListener('blur', describe);

    // Drag to turn. Pointer events rather than mouse, so a pen or a touch
    // screen turns it too, and capture so a drag that leaves the 108px canvas
    // does not stick the model half way round.
    let dragging = null;
    canvas.addEventListener('pointerdown', (e) => {
        dragging = { x: e.clientX, y: e.clientY };
        canvas.setPointerCapture(e.pointerId);
        e.preventDefault();
    });
    canvas.addEventListener('pointermove', (e) => {
        if (!dragging) return;
        yaw += (e.clientX - dragging.x) * 0.012;
        // Clamped rather than free: past a pole the model reads as upside down
        // and the drag stops meaning anything.
        pitch = Math.max(-1.2, Math.min(1.2, pitch + (e.clientY - dragging.y) * 0.012));
        dragging = { x: e.clientX, y: e.clientY };
        draw();
    });
    const endDrag = () => { if (dragging) { dragging = null; save(); } };
    canvas.addEventListener('pointerup', endDrag);
    canvas.addEventListener('pointercancel', endDrag);

    // Double-click resets, because a model turned to a confusing angle is the
    // one state a drag cannot easily get you out of.
    canvas.addEventListener('dblclick', () => {
        yaw = 0; pitch = -0.18;
        draw(); save();
    });

    window.SpriteForge.meshUI = {
        /**
         * `frameCanvas` is the editor's 1:1 cache of the frame on screen. Taking
         * the canvas rather than the grid keeps this off the editor's pixel
         * format, and costs one getImageData of a sprite-sized bitmap.
         */
        refresh(frameCanvas) {
            source = frameCanvas || source;
            update();
        },
    };

    describe();
}());
