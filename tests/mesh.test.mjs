import { test, eq, ok, throws } from './assert.mjs';
import { ImageData } from './harness.mjs';

// These pin the UV layouts, because a layout is the whole value of the preview
// and a wrong one is worse than none: it is confidently wrong in exactly the
// place someone went looking for the truth. Each assertion names the engine
// behaviour it stands for, so a failure says which contract moved rather than
// which number changed.
export default function (SF) {
    const { sphere, cylinder, quad, build, kinds, render } = SF.mesh;

    // A texture whose colour says where in the image a texel came from: red
    // rises with u, green rises with v. Sampling the render then reads back as
    // "this pixel of the model is showing that part of the image".
    function gradient(w, h) {
        const img = new ImageData(w, h);
        for (let y = 0; y < h; y++)
            for (let x = 0; x < w; x++) {
                const i = (y * w + x) * 4;
                img.data[i] = Math.round(255 * x / (w - 1));
                img.data[i + 1] = Math.round(255 * y / (h - 1));
                img.data[i + 2] = 0;
                img.data[i + 3] = 255;
            }
        return img;
    }

    const at = (img, x, y) => {
        const i = (y * img.width + x) * 4;
        return [img.data[i], img.data[i + 1], img.data[i + 2], img.data[i + 3]];
    };

    // ── the layouts ─────────────────────────────────────

    test('sphere: v runs top pole to bottom pole', () => {
        const m = sphere(4, 8);
        eq(m.uvs[0][1], 0, 'first row is v = 0');
        eq(m.pts[0][1], 1, 'and it is the TOP of the sphere');
        eq(m.uvs[m.uvs.length - 1][1], 1, 'last row is v = 1');
        eq(m.pts[m.pts.length - 1][1], -1, 'and it is the bottom');
    });

    test('sphere: u = 0 lies on +Z, which is what puts a face on the back of a head', () => {
        const m = sphere(4, 8);
        // The equator row of a 4-ring sphere is j = 2 (v = 0.4) .. use the row
        // whose y is nearest zero, and its first vertex, which is u = 0.
        const stride = 9;
        let best = 0, bestY = Infinity;
        for (let j = 0; j < 6; j++) {
            const y = Math.abs(m.pts[j * stride][1]);
            if (y < bestY) { bestY = y; best = j; }
        }
        const p = m.pts[best * stride];
        eq(m.uvs[best * stride][0], 0, 'u = 0 at the start of the row');
        ok(Math.abs(p[0]) < 1e-9, 'x is 0 there');
        ok(p[2] > 0.9, `z is +1 there, not -1 (got ${p[2].toFixed(3)})`);
    });

    test('sphere: the seam column is duplicated, so u wraps 0..1 across the mesh', () => {
        const m = sphere(2, 6);
        const stride = 7;
        eq(m.uvs[0][0], 0, 'first column u = 0');
        eq(m.uvs[stride - 1][0], 1, 'last column u = 1');
        const a = m.pts[0], b = m.pts[stride - 1];
        ok(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < 1e-9,
            'and both columns sit at the same place in space');
    });

    test('sphere: normals are the position, so shading is smooth and never creases', () => {
        const m = sphere(3, 8);
        for (let i = 0; i < m.pts.length; i++) {
            const p = m.pts[i], n = m.normals[i];
            ok(Math.abs(Math.hypot(n[0], n[1], n[2]) - 1) < 1e-9, `normal ${i} is unit`);
            // Away from the poles the normal points the same way as the point.
            if (Math.abs(p[1]) < 0.99) {
                const dot = p[0] * n[0] + p[1] * n[1] + p[2] * n[2];
                ok(dot > 0.99, `normal ${i} points outward`);
            }
        }
    });

    test('cylinder: the side is the TOP HALF of the image, caps take the rest', () => {
        const m = cylinder(1, 8);
        const vs = m.uvs.map(uv => uv[1]);
        eq(Math.min(...vs), 0, 'top edge at v = 0');
        eq(Math.max(...vs), 0.5, 'bottom edge at v = 0.5, not 1');
        ok(m.half, 'and the mesh says so, so the panel can warn');
    });

    test('cylinder: normals are horizontal, so a lit cylinder never shades top to bottom', () => {
        const m = cylinder(1, 8);
        for (const n of m.normals) eq(n[1], 0, 'no y component');
    });

    test('flat: the whole image, one face, as a control', () => {
        const m = quad();
        eq(m.uvs, [[0, 0], [1, 0], [0, 1], [1, 1]], 'corners map to corners');
        eq(m.tris.length, 2, 'two triangles');
    });

    // ── the renderer ────────────────────────────────────

    test('flat renders the image the right way up and the right way round', () => {
        const img = render(build('quad'), gradient(16, 16), { width: 64, height: 64, ambient: 1 });
        const [rTL, gTL] = at(img, 20, 20);
        const [rBR, gBR] = at(img, 44, 44);
        ok(rBR > rTL + 60, `u rises to the right (${rTL} -> ${rBR})`);
        ok(gBR > gTL + 60, `v rises downward (${gTL} -> ${gBR})`);
    });

    test('the front of an unrotated sphere shows u = 0, not u = 0.5', () => {
        const img = render(build('sphere', 24), gradient(32, 32), { width: 80, height: 80, ambient: 1 });
        const [r] = at(img, 40, 40);   // dead centre, facing the camera
        ok(r < 24 || r > 231, `centre samples the seam, so red is at an end (got ${r})`);
    });

    test('uOffset rotates the image around the mesh, which is how a face is aimed', () => {
        const tex = gradient(32, 32);
        const a = render(build('sphere', 24), tex, { width: 80, height: 80, ambient: 1 });
        const b = render(build('sphere', 24), tex, { width: 80, height: 80, ambient: 1, uOffset: 0.5 });
        const ra = at(a, 40, 40)[0], rb = at(b, 40, 40)[0];
        ok(Math.abs(ra - rb) > 90, `half a turn moves the sampled column (${ra} -> ${rb})`);
    });

    test('a transparent texel leaves a hole rather than a black pixel', () => {
        const tex = gradient(8, 8);
        for (let i = 0; i < tex.data.length; i += 4) tex.data[i + 3] = 0;
        const img = render(build('quad'), tex, { width: 32, height: 32 });
        eq(at(img, 16, 16)[3], 0, 'nothing was drawn');
    });

    test('shading is smooth: no two adjacent facets differ by a hard step', () => {
        // A flat-shaded sphere shows a visible crease per facet. Walking the
        // equator of a deliberately coarse one, the biggest jump between
        // neighbouring pixels stays small when normals are interpolated.
        const white = new ImageData(4, 4);
        white.data.fill(255);
        const img = render(build('sphere', 8), white, { width: 96, height: 96, ambient: 0 });
        let worst = 0, prev = null;
        for (let x = 26; x < 70; x++) {
            const [r, , , a] = at(img, x, 48);
            if (!a) { prev = null; continue; }
            if (prev !== null) worst = Math.max(worst, Math.abs(r - prev));
            prev = r;
        }
        ok(worst <= 12, `largest neighbouring step across an 8-segment sphere is ${worst}`);
    });

    // ── the table ───────────────────────────────────────

    test('every advertised shape builds, and an unknown one says so', () => {
        for (const k of kinds()) {
            const m = build(k.id, 12);
            ok(m.pts.length > 0 && m.tris.length > 0, `${k.id} has geometry`);
            eq(m.pts.length, m.uvs.length, `${k.id}: one uv per point`);
            eq(m.pts.length, m.normals.length, `${k.id}: one normal per point`);
            ok(k.note, `${k.id} carries a short note for the label`);
            ok(k.detail && k.detail.length > 60, `${k.id} carries the long form for the tooltip`);
        }
        throws(() => build('teapot'), 'unknown mesh', 'an unknown shape is named');
    });

    test('detail is clamped, so a silly segment count cannot hang the preview', () => {
        ok(build('sphere', 1).pts.length > 0, 'below the floor still builds');
        ok(build('sphere', 9999).pts.length < 10000, 'above the ceiling is capped');
    });
}
