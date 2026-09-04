// mesh.js — primitive meshes carrying the UV layouts a 3D engine gives them,
// and a software renderer that wraps a frame onto one.
//
// THE POINT: a sprite drawn for a 3D surface is not a picture of that surface.
// Godot's SphereMesh unwraps equirectangularly, so u = 0 lands on +Z and a face
// drawn in the middle of the canvas comes out on the back of the head. Nothing
// in a 2D editor can tell you that, and no amount of squinting at the canvas
// will either. This is the part that answers "where does this texel go".
//
// THE UV LAYOUTS ARE COPIED, NOT INVENTED. Each is Godot's own formula for that
// primitive; they are stated in the comment above each builder and checked
// against a real Godot render, because a plausible-looking wrong layout is
// worse than no preview at all — it is confidently wrong in the one place you
// went looking for the truth. If you add a shape, verify it the same way.
//
// Vertex normals are carried per vertex and interpolated, because that is what
// the engine does. Shading off the FACE normal instead makes a coarse sphere
// look creased and invents artefacts the engine never renders.
//
// Pure: no DOM, no canvas element. It reads an ImageData and returns one, the
// same currency core/sheet.js already deals in.

window.SpriteForge = window.SpriteForge || {};
window.SpriteForge.mesh = (function () {

    const TAU = Math.PI * 2;

    function norm(v) {
        const l = Math.hypot(v[0], v[1], v[2]) || 1;
        return [v[0] / l, v[1] / l, v[2] / l];
    }

    /**
     * Godot SphereMesh. Rings run pole to pole and radial segments run around.
     *
     *   v = j / (rings + 1),  u = i / radial_segments
     *   x = sin(u * TAU), z = cos(u * TAU), y = radius * cos(PI * v)
     *
     * So v = 0 is the TOP pole and u = 0 lies on +Z. The last column repeats
     * u = 1 at the same place as u = 0 — that duplicated seam column is what
     * lets the texture wrap without the last facet running backwards through
     * the whole image.
     */
    function sphere(rings, segments) {
        const pts = [], uvs = [], normals = [];
        for (let j = 0; j <= rings + 1; j++) {
            const v = j / (rings + 1);
            const w = Math.sin(Math.PI * v);
            const y = Math.cos(Math.PI * v);
            for (let i = 0; i <= segments; i++) {
                const u = i / segments;
                const x = i === segments ? 0 : Math.sin(u * TAU);
                const z = i === segments ? 1 : Math.cos(u * TAU);
                const p = [x * w, y, z * w];
                pts.push(p);
                // On a unit sphere about the origin the vertex normal IS the
                // position. At a pole w is 0 and the position is (0, +-1, 0),
                // which still normalises.
                normals.push(norm(p));
                uvs.push([u, v]);
            }
        }
        return { pts, uvs, normals, tris: grid(rings + 1, segments) };
    }

    /**
     * Godot CylinderMesh, side only — no caps.
     *
     *   v = j / (rings + 1),  u = i / radial_segments,  uv = (u, v * 0.5)
     *
     * The side occupies the TOP HALF of the image and the two caps are discs
     * packed into the bottom half. Only the side is built here: a cylinder in
     * a character rig is a limb or a torso, nothing ever looks at the ends,
     * and a cap disc drawn wrong would be a confident lie about half the
     * canvas. The preview says so rather than guessing.
     *
     * The side normal has no y component for a straight cylinder, which is why
     * a lit cylinder shades left-to-right and never top-to-bottom.
     */
    function cylinder(rings, segments) {
        const pts = [], uvs = [], normals = [];
        for (let j = 0; j <= rings + 1; j++) {
            const v = j / (rings + 1);
            const y = 1 - v * 2;   // +1 at the top, -1 at the bottom
            for (let i = 0; i <= segments; i++) {
                const u = i / segments;
                const x = i === segments ? 0 : Math.sin(u * TAU);
                const z = i === segments ? 1 : Math.cos(u * TAU);
                pts.push([x, y, z]);
                normals.push(norm([x, 0, z]));
                uvs.push([u, v * 0.5]);
            }
        }
        return { pts, uvs, normals, tris: grid(rings + 1, segments), half: true };
    }

    /**
     * A flat quad, the whole image on one face. Not an engine primitive — it is
     * the null hypothesis, and it is what a billboard actually is: magnolia's
     * sprites, and the crossed quads a low-poly game uses for foliage.
     *
     * Useful as a control. If a drawing looks right here and wrong on a sphere,
     * the difference IS the unwrap, which is the thing this panel exists to show.
     */
    function quad() {
        return {
            pts: [[-1, 1, 0], [1, 1, 0], [-1, -1, 0], [1, -1, 0]],
            uvs: [[0, 0], [1, 0], [0, 1], [1, 1]],
            normals: [[0, 0, 1], [0, 0, 1], [0, 0, 1], [0, 0, 1]],
            tris: grid(1, 1),
        };
    }

    /** Quad indices over a (rows+1) x (cols+1) vertex lattice, wound CCW. */
    function grid(rows, cols) {
        const stride = cols + 1, tris = [];
        for (let j = 0; j < rows; j++)
            for (let i = 0; i < cols; i++) {
                const a = j * stride + i, b = a + 1, c = a + stride, d = c + 1;
                tris.push([a, c, b], [b, c, d]);
            }
        return tris;
    }

    const SHAPES = {
        sphere: {
            label: 'sphere',
            build: (d) => sphere(Math.max(2, Math.round(d * 0.75)), Math.max(3, d)),
            note: 'u=0 faces front',
            detail: 'Equirectangular. u=0 lies on +Z, so a face drawn mid-image lands on the '
                + 'BACK. v runs top pole to bottom, and a 2:1 image is the only aspect that '
                + 'wraps without stretching.',
        },
        cylinder: {
            label: 'cylinder',
            build: (d) => cylinder(1, Math.max(3, d)),
            note: 'side = top half',
            detail: 'The side takes the TOP HALF of the image and the two end caps are packed '
                + 'into the bottom half. Only the side is drawn here — a limb or a torso is '
                + 'never seen end-on, and a guessed cap would be a confident lie.',
        },
        quad: {
            label: 'flat',
            build: () => quad(),
            note: 'whole image, flat',
            detail: 'The whole image on one face — a billboard, and the control case. If a '
                + 'drawing reads here and not on a sphere, the difference IS the unwrap.',
        },
    };

    /** [{ id, label, note, detail }] for the picker. */
    function kinds() {
        return Object.entries(SHAPES).map(([id, s]) =>
            ({ id, label: s.label, note: s.note, detail: s.detail }));
    }

    /**
     * @param kind   a key of SHAPES
     * @param detail radial segments; the engine's own segment count, so a
     *               preview can be as chunky as the mesh it stands for
     */
    function build(kind, detail) {
        const s = SHAPES[kind];
        if (!s) throw new Error(`unknown mesh "${kind}"`);
        return s.build(Math.max(3, Math.min(64, detail || 16)));
    }

    /**
     * Wraps `tex` onto `mesh` and returns the rendered ImageData.
     *
     * Orthographic on purpose: with no perspective divide, interpolating UV
     * linearly across a triangle is exact rather than merely close, so what you
     * see is the unwrap and not the renderer's approximation of it.
     *
     * Texels are sampled nearest — this is a pixel-art tool, and a preview that
     * smoothed them would hide the one thing the artist is placing. u wraps and
     * v clamps, matching a repeat/clamp sampler. A fully transparent texel
     * leaves the background showing, so a hole in the drawing reads as a hole.
     *
     * opts: { width, height, yaw, pitch, uOffset, ambient }
     */
    function render(mesh, tex, opts) {
        const o = opts || {};
        const W = Math.max(1, o.width || 160), H = Math.max(1, o.height || 160);
        const out = new ImageData(W, H);
        const uOff = o.uOffset || 0;
        const ambient = o.ambient == null ? 0.35 : o.ambient;

        const cy = Math.cos(o.yaw || 0), sy = Math.sin(o.yaw || 0);
        const cp = Math.cos(o.pitch || 0), sp = Math.sin(o.pitch || 0);
        const rot = (p) => {
            const x = p[0] * cy + p[2] * sy, z = -p[0] * sy + p[2] * cy;
            return [x, p[1] * cp - z * sp, p[1] * sp + z * cp];
        };

        const P = mesh.pts.map(rot);
        const N = mesh.normals.map(rot);
        // Fit the mesh in the frame with a margin, so a cylinder and a sphere
        // are previewed at the same scale rather than each filling the box.
        const scale = Math.min(W, H) * 0.44;
        const ox = W / 2, oy = H / 2;
        const zbuf = new Float32Array(W * H).fill(-Infinity);

        // Upper-left-front, the direction almost every 3D viewport lights from.
        const L = norm([-0.4, 0.55, 0.75]);

        for (const [ia, ib, ic] of mesh.tris) {
            const A = P[ia], B = P[ib], C = P[ic];
            const sx = [A[0] * scale + ox, B[0] * scale + ox, C[0] * scale + ox];
            const sv = [oy - A[1] * scale, oy - B[1] * scale, oy - C[1] * scale];

            // Signed area in screen space culls back faces without needing the
            // face normal, and its sign is the winding.
            const den = (sv[1] - sv[2]) * (sx[0] - sx[2]) + (sx[2] - sx[1]) * (sv[0] - sv[2]);
            if (den >= 0) continue;

            const uv = [mesh.uvs[ia], mesh.uvs[ib], mesh.uvs[ic]];
            const nn = [N[ia], N[ib], N[ic]];
            const z = [A[2], B[2], C[2]];

            const x0 = Math.max(0, Math.floor(Math.min(sx[0], sx[1], sx[2])));
            const x1 = Math.min(W - 1, Math.ceil(Math.max(sx[0], sx[1], sx[2])));
            const y0 = Math.max(0, Math.floor(Math.min(sv[0], sv[1], sv[2])));
            const y1 = Math.min(H - 1, Math.ceil(Math.max(sv[0], sv[1], sv[2])));

            for (let y = y0; y <= y1; y++) {
                for (let x = x0; x <= x1; x++) {
                    const l0 = ((sv[1] - sv[2]) * (x - sx[2]) + (sx[2] - sx[1]) * (y - sv[2])) / den;
                    const l1 = ((sv[2] - sv[0]) * (x - sx[2]) + (sx[0] - sx[2]) * (y - sv[2])) / den;
                    const l2 = 1 - l0 - l1;
                    if (l0 < 0 || l1 < 0 || l2 < 0) continue;

                    const k = y * W + x;
                    const zz = l0 * z[0] + l1 * z[1] + l2 * z[2];
                    if (zz <= zbuf[k]) continue;

                    let u = l0 * uv[0][0] + l1 * uv[1][0] + l2 * uv[2][0] + uOff;
                    u -= Math.floor(u);
                    let v = l0 * uv[0][1] + l1 * uv[1][1] + l2 * uv[2][1];
                    v = v < 0 ? 0 : v > 1 ? 1 : v;

                    const tx = Math.min(tex.width - 1, Math.floor(u * tex.width));
                    const ty = Math.min(tex.height - 1, Math.floor(v * tex.height));
                    const ti = (ty * tex.width + tx) * 4;
                    if (!tex.data[ti + 3]) continue;   // a hole stays a hole

                    const nx = l0 * nn[0][0] + l1 * nn[1][0] + l2 * nn[2][0];
                    const ny = l0 * nn[0][1] + l1 * nn[1][1] + l2 * nn[2][1];
                    const nz = l0 * nn[0][2] + l1 * nn[1][2] + l2 * nn[2][2];
                    const inv = 1 / (Math.hypot(nx, ny, nz) || 1);
                    const lam = Math.max(ambient, (nx * L[0] + ny * L[1] + nz * L[2]) * inv);

                    zbuf[k] = zz;
                    const oi = k * 4;
                    out.data[oi] = tex.data[ti] * lam;
                    out.data[oi + 1] = tex.data[ti + 1] * lam;
                    out.data[oi + 2] = tex.data[ti + 2] * lam;
                    out.data[oi + 3] = 255;
                }
            }
        }
        return out;
    }

    return { SHAPES, kinds, build, render, sphere, cylinder, quad };
})();
