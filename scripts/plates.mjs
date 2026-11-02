// 臓器の平面図（content/organs.json の plates）を、BodyParts3D の形から教科書の図のような絵に描く。
// なめらかな陰影・部品の境と輪郭の線・切り口の平らな塗りで描き、ラベルの指す点（語の見えている所の真ん中、骨・器官の部位はピン）を求める。
// 出力: public/plates/<図ID>.<ハッシュ>.webp と public/plates/index.json（画像の大きさ・ラベルの点 0〜1）。
// 使い方: node scripts/plates.mjs [図ID…]（無ければ全部）。--check を付けると、ラベルの点に印を付けた確認画像を data-raw/plate-check/ に書く
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { basis, db, loadDb, termMeshes } from "./pins/geometry.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const OUT = path.join(ROOT, "public/plates");
const CHECK = path.join(ROOT, "data-raw/plate-check");
/** 画像の長い辺（px）と、なめらかにするための描きこみの倍率 */
const SIZE = 1100;
const SS = 2;
const PAPER = [251, 248, 241];

const args = process.argv.slice(2);
const check = args.includes("--check");
const only = new Set(args.filter((a) => !a.startsWith("--")));

const organs = JSON.parse(fs.readFileSync(path.join(ROOT, "content/organs.json"), "utf8")).organs;
const systems = JSON.parse(fs.readFileSync(path.join(ROOT, "content/systems.json"), "utf8"));
const pins = JSON.parse(fs.readFileSync(path.join(ROOT, "content/pins.json"), "utf8"));
await loadDb();
const { terms } = db();
const termById = new Map(terms.map((t) => [t.id, t]));
const systemColor = new Map(systems.map((s) => [s.id, s.color]));

const hex = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
const mix = (a, b, t) => a.map((v, k) => v + (b[k] - v) * t);
const norm = (v) => { const l = Math.hypot(...v) || 1; return v.map((x) => x / l); };
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** 臓器の語（レッスンの語と添える語。骨・器官の部位は形を持たないので除く） */
function organTerms(organ) {
  const ids = [];
  const files = fs.readdirSync(path.join(ROOT, "content/terms"));
  for (const file of files) {
    for (const unit of JSON.parse(fs.readFileSync(path.join(ROOT, "content/terms", file), "utf8")).units) {
      if (organ.units.includes(unit.id)) ids.push(...unit.terms.filter((t) => !t.of).map((t) => t.id));
    }
  }
  return [...ids, ...organ.with];
}

/**
 * 部品ごとに、それを含むいちばん細かい語で色と名前を決める（アプリの viewer と同じ）。
 * colors は図の色の上書き（語ID → 色）
 */
function drawList(ids, plate) {
  const owner = new Map();
  const sorted = ids.map((id) => [id, termMeshes(id, "all")]).sort((a, b) => a[1].length - b[1].length);
  for (const [id, meshes] of sorted) for (const m of meshes) if (!owner.has(m.id)) owner.set(m.id, [id, m]);
  const hidden = new Set(plate.hide ?? []);
  const list = [];
  for (const [element, [id, mesh]] of owner) {
    if (hidden.has(id) || (plate.hideElements ?? []).includes(element)) continue;
    const term = termById.get(id);
    const color = plate.colors?.[id] ?? term.color ?? systemColor.get(term.system) ?? "#cccccc";
    list.push({ element, term: id, mesh, color: hex(color) });
  }
  return list;
}

/** 切る面: n・p >= n・point の側を残す */
function cutOf(plate) {
  if (!plate.cut) return null;
  const n = norm(plate.cut.normal);
  return { n, d: dot(n, plate.cut.point) };
}

function render(plate, items, organBox, seamless) {
  const { f, u, r } = basis(plate.view);
  const cut = cutOf(plate);
  const keep = (q) => !cut || dot(cut.n, q) >= cut.d;
  // 枠: 見えている点（切った残り・箱の中）の範囲
  const inBox = (q) => q.every((v, k) => v >= organBox[0][k] && v <= organBox[1][k]);
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  const framed = plate.frameTerms ? items.filter((item) => plate.frameTerms.includes(item.term)) : items;
  for (const { mesh } of framed) {
    const p = mesh.positions;
    for (let i = 0; i < p.length; i += 3) {
      const q = [p[i], p[i + 1], p[i + 2]];
      if (!keep(q) || !inBox(q)) continue;
      const x = dot(q, r), y = dot(q, u);
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    }
  }
  if (plate.frame) [x0, x1, y0, y1] = plate.frame;
  const margin = 0.04 * Math.max(x1 - x0, y1 - y0);
  [x0, x1, y0, y1] = [x0 - margin, x1 + margin, y0 - margin, y1 + margin];
  const scale = SIZE / Math.max(x1 - x0, y1 - y0);
  const W = Math.round((x1 - x0) * scale), H = Math.round((y1 - y0) * scale);
  const SW = W * SS, SH = H * SS, sscale = scale * SS;
  const toScreen = (q) => [(dot(q, r) - x0) * sscale, (y1 - dot(q, u)) * sscale, dot(q, f)];

  const depth = new Float32Array(SW * SH).fill(Infinity);
  const owner = new Int32Array(SW * SH).fill(-1);
  const normal = new Float32Array(SW * SH * 3);
  const back = new Uint8Array(SW * SH);
  // 光は左上手前から（見る向きの座標で）
  const light = norm([-f[0] * 0.9 + u[0] * 0.55 - r[0] * 0.4, -f[1] * 0.9 + u[1] * 0.55 - r[1] * 0.4, -f[2] * 0.9 + u[2] * 0.55 - r[2] * 0.4]);
  for (const [index, { mesh }] of items.entries()) {
    const p = mesh.positions, N = mesh.normals, I = mesh.indices;
    const scr = new Float32Array(p.length);
    for (let i = 0; i < p.length; i += 3) scr.set(toScreen([p[i], p[i + 1], p[i + 2]]), i);
    for (let t = 0; t < I.length; t += 3) {
      const [a, b, c] = [I[t] * 3, I[t + 1] * 3, I[t + 2] * 3];
      const area = (scr[b] - scr[a]) * (scr[c + 1] - scr[a + 1]) - (scr[b + 1] - scr[a + 1]) * (scr[c] - scr[a]);
      if (area === 0) continue;
      // 面の向き（三角形の順から）。画面で時計回りなら手前を向く（y が下向きのため）
      const facing = area < 0;
      const minX = Math.max(0, Math.floor(Math.min(scr[a], scr[b], scr[c]))), maxX = Math.min(SW - 1, Math.ceil(Math.max(scr[a], scr[b], scr[c])));
      const minY = Math.max(0, Math.floor(Math.min(scr[a + 1], scr[b + 1], scr[c + 1]))), maxY = Math.min(SH - 1, Math.ceil(Math.max(scr[a + 1], scr[b + 1], scr[c + 1])));
      for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) {
          const px = x + 0.5, py = y + 0.5;
          const w0 = ((scr[b] - px) * (scr[c + 1] - py) - (scr[b + 1] - py) * (scr[c] - px)) / area;
          const w1 = ((scr[c] - px) * (scr[a + 1] - py) - (scr[c + 1] - py) * (scr[a] - px)) / area;
          const w2 = 1 - w0 - w1;
          if (w0 < 0 || w1 < 0 || w2 < 0) continue;
          const d = w0 * scr[a + 2] + w1 * scr[b + 2] + w2 * scr[c + 2];
          const k = y * SW + x;
          if (d >= depth[k]) continue;
          const q = [0, 1, 2].map((ch) => w0 * p[a + ch] + w1 * p[b + ch] + w2 * p[c + ch]);
          if (!keep(q) || !inBox(q)) continue;
          depth[k] = d;
          owner[k] = index;
          back[k] = facing ? 0 : 1;
          const n = norm([0, 1, 2].map((ch) => w0 * N[a + ch] + w1 * N[b + ch] + w2 * N[c + ch]));
          normal.set(n, k * 3);
        }
      }
    }
  }
  // 色: 陰影（切り口は平らに明るく）。部品の境・奥行きの段・輪郭に線を引く
  const color = new Float32Array(SW * SH * 3);
  const viewer = f.map((v) => -v);
  for (let k = 0; k < SW * SH; k++) {
    const o = owner[k];
    if (o < 0) { color.set(PAPER, k * 3); continue; }
    const base = items[o].color;
    let c;
    if (back[k] && cut) {
      // 切り口（形の裏が見えている所）: 少し明るい平らな色
      c = mix(base, [255, 255, 255], 0.28).map((v) => v * 0.93);
    } else {
      let n = [normal[k * 3], normal[k * 3 + 1], normal[k * 3 + 2]];
      if (dot(n, viewer) < 0) n = n.map((v) => -v);
      const diffuse = Math.max(0, dot(n, light));
      const facingView = Math.abs(dot(n, viewer));
      const shade = (0.5 + 0.55 * diffuse) * (0.82 + 0.18 * facingView);
      const spec = Math.pow(Math.max(0, dot(norm([light[0] + viewer[0], light[1] + viewer[1], light[2] + viewer[2]]), n)), 40) * 0.16;
      c = base.map((v) => Math.min(255, v * shade + 255 * spec));
    }
    color.set(c, k * 3);
  }
  const lineWidth = SS * 1.1;
  const step = 0.0035; // この奥行きの差（m）より大きい段は輪郭として線を引く
  const edgeAt = (k, k2) => {
    const a = owner[k], b = owner[k2];
    if (a === b && (a < 0 || Math.abs(depth[k] - depth[k2]) < step)) return 0;
    if (a < 0 || b < 0) return 2;
    if (a !== b) return (items[a].term === items[b].term || (seamless.has(items[a].term) && seamless.has(items[b].term))) && Math.abs(depth[k] - depth[k2]) < step ? 0 : 1;
    return 1;
  };
  const out = new Float32Array(color);
  const reach = Math.ceil(lineWidth);
  for (let y = 0; y < SH; y++) {
    for (let x = 0; x < SW; x++) {
      const k = y * SW + x;
      if (owner[k] < 0) continue;
      let strength = 0;
      for (let dy = -reach; dy <= reach && strength < 2; dy++) {
        for (let dx = -reach; dx <= reach; dx++) {
          if (dx * dx + dy * dy > lineWidth * lineWidth) continue;
          const xx = x + dx, yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= SW || yy >= SH) { strength = 2; break; }
          const k2 = yy * SW + xx;
          // 手前の側だけに線を描く（同じ線が2重に太らないように）
          if (owner[k2] >= 0 && depth[k2] < depth[k] - 1e-6 && owner[k2] !== owner[k]) continue;
          strength = Math.max(strength, edgeAt(k, k2));
        }
      }
      if (!strength) continue;
      const base = items[owner[k]].color;
      const ink = strength === 2 ? [70, 45, 40] : base.map((v) => v * 0.42);
      out.set(mix([out[k * 3], out[k * 3 + 1], out[k * 3 + 2]], ink, strength === 2 ? 0.95 : 0.8), k * 3);
    }
  }
  // 縮小（SS×SS の平均）
  const pixels = Buffer.alloc(W * H * 3);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      for (let ch = 0; ch < 3; ch++) {
        let sum = 0;
        for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) sum += out[((y * SS + sy) * SW + x * SS + sx) * 3 + ch];
        pixels[(y * W + x) * 3 + ch] = Math.round(sum / (SS * SS));
      }
    }
  }
  return { W, H, SW, SH, pixels, owner, depth, toScreen, sscale };
}

/** 語の見えている所のうち、縁から最も遠い点（ラベルの指す所）。見えていなければ null */
function innerPoint(owner, SW, SH, indices) {
  const inside = new Uint8Array(SW * SH);
  let any = false;
  for (let k = 0; k < SW * SH; k++) if (indices.has(owner[k])) { inside[k] = 1; any = true; }
  if (!any) return null;
  // 縁からの距離（チェス盤距離の2回走査）
  const dist = new Float32Array(SW * SH);
  const big = 1e9;
  for (let y = 0; y < SH; y++) for (let x = 0; x < SW; x++) {
    const k = y * SW + x;
    if (!inside[k]) { dist[k] = 0; continue; }
    dist[k] = Math.min(x > 0 ? dist[k - 1] + 1 : 1, y > 0 ? dist[k - SW] + 1 : 1, x > 0 && y > 0 ? dist[k - SW - 1] + 1.414 : 1, x < SW - 1 && y > 0 ? dist[k - SW + 1] + 1.414 : 1, big);
  }
  let best = -1, bestK = -1;
  for (let y = SH - 1; y >= 0; y--) for (let x = SW - 1; x >= 0; x--) {
    const k = y * SW + x;
    if (!inside[k]) continue;
    dist[k] = Math.min(dist[k], x < SW - 1 ? dist[k + 1] + 1 : 1, y < SH - 1 ? dist[k + SW] + 1 : 1, x < SW - 1 && y < SH - 1 ? dist[k + SW + 1] + 1.414 : 1, x > 0 && y < SH - 1 ? dist[k + SW - 1] + 1.414 : 1);
    if (dist[k] > best) [best, bestK] = [dist[k], k];
  }
  return [(bestK % SW) + 0.5, Math.floor(bestK / SW) + 0.5];
}

fs.mkdirSync(OUT, { recursive: true });
const indexFile = path.join(OUT, "index.json");
const index = fs.existsSync(indexFile) ? JSON.parse(fs.readFileSync(indexFile, "utf8")) : { plates: {} };
for (const organ of organs) {
  const ids = organTerms(organ);
  for (const plate of organ.plates ?? []) {
    if (only.size && !only.has(plate.id)) continue;
    if (!plate.view) continue; // 模式図（SVG を手で描いたもの）は描かない
    const items = drawList(plate.terms ?? ids, plate);
    const { W, H, SW, SH, pixels, owner, depth, toScreen } = render(plate, items, plate.box ?? organ.box, new Set(organ.seamless ?? []));
    const labels = [];
    for (const label of plate.labels) {
      const spec = typeof label === "string" ? { term: label } : label;
      let at = spec.uv ? [spec.uv[0] * SW, spec.uv[1] * SH] : null;
      if (!at && spec.point) at = toScreen(spec.point).slice(0, 2);
      if (!at && spec.term && pins[spec.term]) {
        // 骨・器官の部位: ピンの点のうち手前の形に隠れていないもの（溝のように点が並ぶときは、その真ん中）
        const pin = pins[spec.term];
        const visible = (pin.region ? [pin.region.c] : pin.at).map(toScreen).filter(([sx, sy, sd]) => {
          const k = Math.round(sy) * SW + Math.round(sx);
          return sx >= 0 && sy >= 0 && sx < SW && sy < SH && depth[k] > sd - 0.006;
        });
        if (!visible.length) { console.warn(`${plate.id}: ${spec.term} のピンは手前の形に隠れています`); continue; }
        at = visible[spec.pin ?? Math.floor(visible.length / 2)]?.slice(0, 2);
        if (!at) { console.warn(`${plate.id}: ${spec.term} の見える点に ${spec.pin} 番がありません`); continue; }
      }
      if (!at && spec.term) {
        const indices = new Set(items.flatMap((item, i) => (item.term === spec.term || termMeshes(spec.term, "all").some((m) => m.id === item.element) ? [i] : [])));
        at = innerPoint(owner, SW, SH, indices);
        if (!at) { console.warn(`${plate.id}: ${spec.term} が図に見えていません`); continue; }
      }
      const entry = { at: [+(at[0] / SW).toFixed(4), +(at[1] / SH).toFixed(4)] };
      if (spec.term) entry.term = spec.term;
      for (const key of ["ja", "en", "note", "side"]) if (spec[key]) entry[key] = spec[key];
      labels.push(entry);
    }
    const webp = await sharp(pixels, { raw: { width: W, height: H, channels: 3 } }).webp({ quality: 88 }).toBuffer();
    const hash = createHash("sha1").update(webp).digest("hex").slice(0, 10);
    for (const old of fs.readdirSync(OUT)) if (old.startsWith(`${plate.id}.`) && old.endsWith(".webp")) fs.rmSync(path.join(OUT, old));
    fs.writeFileSync(path.join(OUT, `${plate.id}.${hash}.webp`), webp);
    index.plates[plate.id] = { url: `plates/${plate.id}.${hash}.webp`, w: W, h: H, labels };
    console.log(`${plate.id}: ${W}×${H} ${(webp.length / 1024).toFixed(0)}KB ラベル${labels.length}`);
    if (check) {
      fs.mkdirSync(CHECK, { recursive: true });
      let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">`;
      for (const [i, l] of labels.entries()) {
        const [x, y] = [l.at[0] * W, l.at[1] * H];
        const name = l.ja ?? termById.get(l.term)?.ja ?? l.term;
        svg += `<circle cx="${x}" cy="${y}" r="4" fill="#111"/><text x="${x + 6}" y="${y - 5}" font-size="15" font-family="Hiragino Sans" fill="#000" stroke="#fff" stroke-width="3" paint-order="stroke">${i + 1} ${name}</text>`;
      }
      svg += "</svg>";
      await sharp(pixels, { raw: { width: W, height: H, channels: 3 } }).composite([{ input: Buffer.from(svg) }]).png().toFile(path.join(CHECK, `${plate.id}.png`));
    }
  }
}
// 今の organs.json に無い図は index から除く
const known = new Set(organs.flatMap((organ) => (organ.plates ?? []).map((plate) => plate.id)));
for (const id of Object.keys(index.plates)) if (!known.has(id)) delete index.plates[id];
fs.writeFileSync(indexFile, `${JSON.stringify(index, null, 1)}\n`);
