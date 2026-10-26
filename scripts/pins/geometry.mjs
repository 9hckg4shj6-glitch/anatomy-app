// 骨の部位のピンを作るための道具: BodyParts3D の部品の読み込み、視点と枠、光線の当たり判定、ソフトウェア描画（確認用の PNG）。
// 座標は scripts/build-models.mjs と同じモデル座標（m・Y上・前が +z、本人の右が -x）。
import sharp from "sharp";
import { loadTerms, readElements, resolveParts } from "../build-models.mjs";

let cache = null;
export function db() {
  if (cache) return cache;
  const { objDir, elementNames, conceptElements, readMesh: mesh } = readElements();
  const { systems, terms } = loadTerms();
  const withParts = terms.filter((t) => t.parts);
  const { resolved } = resolveParts(withParts, elementNames, conceptElements);
  cache = { objDir, elementNames, conceptElements, terms, systems, resolved, mesh };
  return cache;
}

/** 語の部品。side: "right" なら左の部品を除く（"left" はその逆、"all" は全部） */
export function termMeshes(termId, side = "right") {
  const { resolved, elementNames, mesh } = db();
  let ids = resolved.get(termId);
  if (!ids) throw new Error(`no term ${termId}`);
  if (side === "right") ids = ids.filter((id) => !/\bleft\b/i.test(elementNames.get(id)));
  else if (side === "left") ids = ids.filter((id) => !/\bright\b/i.test(elementNames.get(id)));
  return ids.map((id) => ({ id, name: elementNames.get(id), ...mesh(id) }));
}

const n3 = (v) => { const l = Math.hypot(...v); return v.map((x) => x / l); };
export const VIEWS = {
  antlat: { f: n3([1, 0, -1]), u: [0, 1, 0] },
  postlat: { f: n3([1, 0, 1]), u: [0, 1, 0] },
  antmed: { f: n3([-1, 0, -1]), u: [0, 1, 0] },
  postmed: { f: n3([-1, 0, 1]), u: [0, 1, 0] },
  postsup: { f: n3([0, -1, 1]), u: n3([0, 1, 1]) },
  antsup: { f: n3([0, -1, -1]), u: n3([0, 1, -1]) },
  latsup: { f: n3([1, -1, 0]), u: n3([1, 1, 0]) },
  infpost: { f: n3([0, 1, 1]), u: n3([0, 1, -1]) },
  antinf: { f: n3([0, 1, -1]), u: n3([0, 1, 1]) },
  ant: { f: [0, 0, -1], u: [0, 1, 0] },
  post: { f: [0, 0, 1], u: [0, 1, 0] },
  lat: { f: [1, 0, 0], u: [0, 1, 0] }, // 右側を外から（前が画像の右）
  med: { f: [-1, 0, 0], u: [0, 1, 0] }, // 右側を内から（前が画像の左）
  sup: { f: [0, -1, 0], u: [0, 0, -1] }, // 上から（前が画像の下）
  inf: { f: [0, 1, 0], u: [0, 0, 1] }, // 下から（前が画像の上）
};

const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a) => { const l = Math.hypot(...a) || 1; return a.map((v) => v / l); };

export function basis(view) {
  const v = typeof view === "string" ? VIEWS[view] : view;
  const f = norm(v.f);
  let u = norm(v.u);
  const r = norm(cross(f, u));
  u = cross(r, f);
  return { f, u, r };
}

/** 枠: frame の部品の点を view で写した範囲（余白つき）。(u,v)∈[0,1]² ↔ 画素 */
export function makeFrame(frameMeshes, view, size = 640, margin = 0.08, crop = null) {
  const { f, u, r } = basis(view);
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const m of frameMeshes) {
    const p = m.positions;
    for (let i = 0; i < p.length; i += 3) {
      const q = [p[i], p[i + 1], p[i + 2]];
      const x = dot(q, r), y = dot(q, u);
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
  }
  if (crop) {
    // crop = [u0, v0, u1, v1]（全体枠の中の正規化座標、v は上が0）
    const w = x1 - x0, h = y1 - y0;
    [x0, x1, y0, y1] = [x0 + crop[0] * w, x0 + crop[2] * w, y1 - crop[3] * h, y1 - crop[1] * h];
  }
  const span = Math.max(x1 - x0, y1 - y0) * (1 + 2 * margin);
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const W = Math.round(size * Math.min(1, ((x1 - x0) * (1 + 2 * margin)) / span) + 0.5);
  const H = Math.round(size * Math.min(1, ((y1 - y0) * (1 + 2 * margin)) / span) + 0.5);
  const scale = size / span; // m→px
  return {
    f, u, r, W, H, scale,
    // 画素→モデル平面上の座標
    toScreen: (q) => [(dot(q, r) - cx) * scale + W / 2, H / 2 - (dot(q, u) - cy) * scale, dot(q, f)],
    fromScreen: (sx, sy) => {
      const x = (sx - W / 2) / scale + cx, y = (H / 2 - sy) / scale + cy;
      return { x, y };
    },
    // 正規化（画像の幅・高さに対して 0〜1、上が0）
    uv: (q) => { const [sx, sy] = [(dot(q, r) - cx) * scale + W / 2, H / 2 - (dot(q, u) - cy) * scale]; return [sx / W, sy / H]; },
    ray: (nu, nv) => {
      const sx = nu * W, sy = nv * H;
      const x = (sx - W / 2) / scale + cx, y = (H / 2 - sy) / scale + cy;
      // 原点: r*x + u*y - f*10
      return { o: [r[0] * x + u[0] * y - f[0] * 10, r[1] * x + u[1] * y - f[1] * 10, r[2] * x + u[2] * y - f[2] * 10], d: f };
    },
  };
}

function hex(c) { return [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)]; }

/**
 * meshes: [{positions, indices, color}], spots: [{at:[[x,y,z]...], r, color, label}]
 */
export async function render({ meshes, spots = [], frame, out, grid = true, title = "", ghost = [] }) {
  const { W, H, toScreen, f } = frame;
  const color = new Float32Array(W * H * 3).fill(1);
  for (let i = 0; i < W * H; i++) { color[i * 3] = 0.97; color[i * 3 + 1] = 0.96; color[i * 3 + 2] = 0.93; }
  const depth = new Float32Array(W * H).fill(Infinity);
  const spotList = spots.flatMap((s) => s.at.map((c) => ({ c, r: s.r, n: s.n ? norm(s.n) : null, col: hex(s.color ?? "#ff7a1a").map((v) => v / 255) })));
  for (const m of [...ghost.map((g) => ({ ...g, ghost: true })), ...meshes]) {
    const base = hex(m.color ?? "#e9dfc9").map((v) => v / 255);
    const p = m.positions, idx = m.indices;
    const scr = new Float32Array((p.length / 3) * 3);
    for (let i = 0; i < p.length; i += 3) {
      const s = toScreen([p[i], p[i + 1], p[i + 2]]);
      scr[i] = s[0]; scr[i + 1] = s[1]; scr[i + 2] = s[2];
    }
    for (let t = 0; t < idx.length; t += 3) {
      const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
      const ax = scr[a], ay = scr[a + 1], bx = scr[b], by = scr[b + 1], cx = scr[c], cy = scr[c + 1];
      const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
      if (area === 0) continue;
      const e1 = [p[b] - p[a], p[b + 1] - p[a + 1], p[b + 2] - p[a + 2]];
      const e2 = [p[c] - p[a], p[c + 1] - p[a + 1], p[c + 2] - p[a + 2]];
      const n = norm(cross(e1, e2));
      const shade = 0.3 + 0.7 * Math.abs(dot(n, f));
      const minX = Math.max(0, Math.floor(Math.min(ax, bx, cx))), maxX = Math.min(W - 1, Math.ceil(Math.max(ax, bx, cx)));
      const minY = Math.max(0, Math.floor(Math.min(ay, by, cy))), maxY = Math.min(H - 1, Math.ceil(Math.max(ay, by, cy)));
      for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) {
          const px = x + 0.5, py = y + 0.5;
          const w0 = ((bx - px) * (cy - py) - (by - py) * (cx - px)) / area;
          const w1 = ((cx - px) * (ay - py) - (cy - py) * (ax - px)) / area;
          const w2 = 1 - w0 - w1;
          if (w0 < 0 || w1 < 0 || w2 < 0) continue;
          const d = w0 * scr[a + 2] + w1 * scr[b + 2] + w2 * scr[c + 2];
          const k = y * W + x;
          if (m.ghost) {
            // 半透明: 奥行きを書かずに薄く重ねる
            if (d >= depth[k]) continue;
            for (let ch = 0; ch < 3; ch++) color[k * 3 + ch] = color[k * 3 + ch] * 0.85 + base[ch] * shade * 0.15;
            continue;
          }
          if (d >= depth[k]) continue;
          depth[k] = d;
          let col = base;
          if (spotList.length) {
            const q = [0, 1, 2].map((ch) => w0 * p[a + ch] + w1 * p[b + ch] + w2 * p[c + ch]);
            const vn = m.normals ? norm([0, 1, 2].map((ch) => w0 * m.normals[a + ch] + w1 * m.normals[b + ch] + w2 * m.normals[c + ch])) : null;
            for (const s of spotList) {
              const dist = Math.hypot(q[0] - s.c[0], q[1] - s.c[1], q[2] - s.c[2]);
              if (dist < s.r && (!s.n || !vn || dot(vn, s.n) > -0.3)) { col = s.col; break; }
            }
          }
          for (let ch = 0; ch < 3; ch++) color[k * 3 + ch] = col[ch] * shade;
        }
      }
    }
  }
  const buf = Buffer.alloc(W * H * 3);
  for (let i = 0; i < W * H * 3; i++) buf[i] = Math.max(0, Math.min(255, Math.round(color[i] * 255)));
  // 格子と文字は SVG で重ねる
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">`;
  if (grid) {
    for (let i = 1; i < 10; i++) {
      const x = (i / 10) * W, y = (i / 10) * H;
      const strong = i === 5;
      svg += `<line x1="${x}" y1="0" x2="${x}" y2="${H}" stroke="${strong ? "#3070c0" : "#7aa0d0"}" stroke-opacity="0.5" stroke-width="${strong ? 1.5 : 0.7}"/>`;
      svg += `<line x1="0" y1="${y}" x2="${W}" y2="${y}" stroke="${strong ? "#3070c0" : "#7aa0d0"}" stroke-opacity="0.5" stroke-width="${strong ? 1.5 : 0.7}"/>`;
      svg += `<text x="${x + 2}" y="11" font-size="10" fill="#3070c0">${i}</text>`;
      svg += `<text x="2" y="${y - 2}" font-size="10" fill="#3070c0">${i}</text>`;
    }
  }
  for (const s of spots) {
    if (!s.label) continue;
    const [sx, sy, sd] = toScreen(s.at[0]);
    svg += `<circle cx="${sx}" cy="${sy}" r="2.5" fill="#000"/>`;
    svg += `<text x="${sx + 5}" y="${sy - 4}" font-size="12" font-family="Hiragino Sans" fill="#000" stroke="#fff" stroke-width="3" paint-order="stroke">${s.label}</text>`;
  }
  if (title) svg += `<text x="6" y="${H - 8}" font-size="13" font-family="Hiragino Sans" fill="#222">${title}</text>`;
  svg += "</svg>";
  await sharp(buf, { raw: { width: W, height: H, channels: 3 } })
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
    .png()
    .toFile(out);
  return out;
}

/** 光線と部品の最初の交点（Möller–Trumbore）。返り値 { point, normal, dist } */
export function raycast(meshes, o, d) {
  let best = null;
  for (const m of meshes) {
    const p = m.positions, idx = m.indices;
    for (let t = 0; t < idx.length; t += 3) {
      const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
      const e1 = [p[b] - p[a], p[b + 1] - p[a + 1], p[b + 2] - p[a + 2]];
      const e2 = [p[c] - p[a], p[c + 1] - p[a + 1], p[c + 2] - p[a + 2]];
      const h = cross(d, e2);
      const det = dot(e1, h);
      if (Math.abs(det) < 1e-12) continue;
      const inv = 1 / det;
      const s = [o[0] - p[a], o[1] - p[a + 1], o[2] - p[a + 2]];
      const uu = dot(s, h) * inv;
      if (uu < 0 || uu > 1) continue;
      const q = cross(s, e1);
      const vv = dot(d, q) * inv;
      if (vv < 0 || uu + vv > 1) continue;
      const dist = dot(e2, q) * inv;
      if (dist <= 0 || (best && dist >= best.dist)) continue;
      let n = norm(cross(e1, e2));
      if (dot(n, d) > 0) n = n.map((v) => -v);
      best = { dist, point: [0, 1, 2].map((k) => o[k] + d[k] * dist), normal: n };
    }
  }
  return best;
}

export { dot, cross, norm };
