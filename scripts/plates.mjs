// 臓器の平面図（content/organs.json の plates）を作る。art があれば元の図（Wikimedia Commons などのイラスト）を取り寄せ、
// 背景を抜いて紙の色に重ねる（ラベルの点は元の図のピクセル px）。無ければ BodyParts3D の形から教科書の図のような絵に描く:
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
  return [...ids, ...organ.with, ...(organ.around ?? [])];
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

/** 元の図（art）の取り置き。data-raw/ は git の対象外なので、無ければ取り寄せる（art.file の自作の図は取り寄せない） */
const ART = path.join(ROOT, "data-raw/plate-art");
const ART_SIZE = 1400;

async function artSource(url) {
  const file = path.join(ART, decodeURIComponent(new URL(url).pathname.split("/").pop()));
  if (!fs.existsSync(file)) {
    fs.mkdirSync(ART, { recursive: true });
    const response = await fetch(url, { headers: { "User-Agent": "anatomy-app-plates/1.0 (https://github.com/9hckg4shj6-glitch/anatomy-app)" } });
    if (!response.ok) throw new Error(`${url}: ${response.status}`);
    fs.writeFileSync(file, Buffer.from(await response.arrayBuffer()));
  }
  return file;
}

/** SVG の元の図を描く長い辺（px）。px は SVG の座標（幅・高さの単位）で書き、この倍率で合わせる */
const SVG_SIZE = 2000;

/** SVG から、開きタグに needle を含む最初の g 要素を中身ごと抜く（ラベルの層・引き出し線のまとまり・背景の層） */
function dropGroup(svg, needle, src) {
  const open = /<g\b[^>]*>/g;
  let start = -1;
  for (let m; (m = open.exec(svg));) if (m[0].includes(needle)) { start = m.index; break; }
  if (start < 0) throw new Error(`${src}: dropGroups の ${needle} が見つかりません`);
  const tag = /<g\b[^>]*?(\/)?>|<\/g>/g;
  tag.lastIndex = start;
  for (let depth = 0, m; (m = tag.exec(svg));) {
    if (m[0] === "</g>") depth--;
    else if (!m[1]) depth++;
    if (depth === 0) return svg.slice(0, start) + svg.slice(tag.lastIndex);
  }
  throw new Error(`${src}: dropGroups の ${needle} が閉じていません`);
}

/**
 * 元の図を読む（art.blur があればぼかす）。SVG なら文字（text）と art.dropGroups の g 要素、art.drop の文字列を含む線（引き出し線など）を抜き、art.recolor の色を置きかえてから、長い辺 SVG_SIZE で描く。
 * scale は px（元の図の座標）から描いた画像のピクセルへの倍率
 */
async function artImage(art) {
  // art.file はリポジトリの中の自作の模式図（content/diagrams/*.svg）。取り寄せずにそのまま読む
  const file = art.file ? path.join(ROOT, art.file) : await artSource(art.src);
  // art.blur は網点で刷った古い図譜のため。先にぼかして網点をならす（薄い所が背景として抜けず、消した跡もなじむ）
  if (!file.endsWith(".svg")) return { image: art.blur ? sharp(file).blur(art.blur) : sharp(file), scale: 1 };
  let svg = fs.readFileSync(file, "utf8").replace(/<(text|flowRoot)\b[\s\S]*?<\/\1>/g, "");
  for (const [from, to] of Object.entries(art.recolor ?? {})) svg = svg.replaceAll(from, to);
  for (const needle of art.dropGroups ?? []) svg = dropGroup(svg, needle, art.src);
  for (const needle of art.drop ?? []) {
    const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const before = svg.length;
    svg = svg.replace(new RegExp(`<(path|line|polyline|polygon)\\b[^>]*${escaped}[^>]*/>`, "g"), "");
    if (svg.length === before) throw new Error(`${art.src}: drop の ${needle} が見つかりません`);
  }
  const buffer = Buffer.from(svg);
  const { width, height } = await sharp(buffer).metadata();
  const scale = SVG_SIZE / Math.max(width, height);
  return { image: sharp(buffer, { density: 72 * scale }), scale };
}

/** 背景の色か（art.background）。dark は黒、red は暗い赤のグラデーション、white は白 */
const BACKGROUND = {
  dark: (r, g, b) => Math.max(r, g, b) < 28,
  red: (r, g, b) => g < 24 && b < 30,
  white: (r, g, b) => Math.min(r, g, b) > 236,
};

/**
 * 元の図（イラスト）から平面図を作る。焼き込まれた引き出し線（art.erase の線分）を両脇の色で埋め、
 * 縁から続く背景を抜いて、いちばん大きい塊（図そのもの）だけを残す（焼き込まれた文字は離れた塊なので消える）。
 * 紙の色に重ね、図の範囲で切り詰め、art.flip が "v" なら上下を返す。ラベルの px は元の図のピクセル（SVG は SVG の座標）
 */
async function artPlate(plate) {
  const art = plate.art;
  const { image: source, scale: unit } = await artImage(art);
  const { data, info } = await source.flatten({ background: "#ffffff" }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const W0 = info.width, H0 = info.height;
  const px = new Float32Array(data);
  const at = (x, y) => (Math.min(H0 - 1, Math.max(0, Math.round(y))) * W0 + Math.min(W0 - 1, Math.max(0, Math.round(x)))) * 3;
  // art.within [x0, y0, x1, y1] があれば、その四角の外を白くしてから作る（1枚の元の図に並んだ図の1つだけを使う）
  if (art.within) {
    const [wx0, wy0, wx1, wy1] = art.within.map((v) => Math.round(v * unit));
    for (let y = 0; y < H0; y++) for (let x = 0; x < W0; x++) if (x < wx0 || x > wx1 || y < wy0 || y > wy1) px.fill(255, (y * W0 + x) * 3, (y * W0 + x) * 3 + 3);
  }
  // 引き出し線: 書いた端を ±8px の範囲で、線に沿って最も暗くなる所へ合わせ直し、線から width の内側を埋める。
  // 埋める点ごとに24の向きで両側の埋めない点まで進み、両端の色が最も近い向きで間を補う（線が横切った輪郭は輪郭の向きにつながる）
  const width = art.eraseWidth ?? 5;
  const darkness = (x1, y1, x2, y2) => {
    let sum = 0;
    for (let i = 0; i <= 100; i++) {
      const k = at(x1 + ((x2 - x1) * i) / 100, y1 + ((y2 - y1) * i) / 100);
      sum += 765 - px[k] - px[k + 1] - px[k + 2];
    }
    return sum;
  };
  // 5つ目の数があれば、その半分の幅の太い帯として合わせ直さずに埋める（図の中に書き込まれた文字を、文字の並びにそった帯で消す）
  const erase = new Uint8Array(W0 * H0);
  let reach = 40;
  for (const line of art.erase ?? []) {
    const segment = line.slice(0, 4).map((v) => v * unit);
    const half = line[4] !== undefined ? line[4] * unit : width;
    let fit = segment;
    if (line[4] === undefined) {
      let best = -1;
      for (let a = -8; a <= 8; a++) for (let b = -8; b <= 8; b++) for (let c = -8; c <= 8; c++) for (let d = -8; d <= 8; d++) {
        const value = darkness(segment[0] + a, segment[1] + b, segment[2] + c, segment[3] + d);
        if (value > best) [best, fit] = [value, [segment[0] + a, segment[1] + b, segment[2] + c, segment[3] + d]];
      }
    }
    reach = Math.max(reach, Math.ceil(2 * half + 8));
    const [x1, y1, x2, y2] = fit;
    const len = Math.hypot(x2 - x1, y2 - y1), tx = (x2 - x1) / len, ty = (y2 - y1) / len;
    for (let s = -half; s <= len + half; s += 0.5) for (let d = -half; d <= half; d += 0.5) erase[at(x1 + tx * s - ty * d, y1 + ty * s + tx * d) / 3] = 1;
  }
  // 図に重なった文字（art.eraseBoxes の四角）も同じように埋める。5つ目に色（#rrggbb）があればその色で平らに塗る
  // （線と線の間の細い所の文字。まわりから補うと、補う長さが短くて線の色を拾う）
  const flat = [];
  for (const box of art.eraseBoxes ?? []) {
    if (typeof box[4] !== "string") continue;
    const [bx0, by0, bx1, by1] = box.slice(0, 4).map((v) => Math.round(v * unit));
    flat.push([[bx0, by0, bx1, by1], hex(box[4])]);
  }
  for (const [bx0, by0, bx1, by1] of (art.eraseBoxes ?? []).filter((box) => typeof box[4] !== "string").map((box) => box.map((v) => Math.round(v * unit)))) {
    for (let y = Math.max(0, by0); y <= Math.min(H0 - 1, by1); y++) for (let x = Math.max(0, bx0); x <= Math.min(W0 - 1, bx1); x++) erase[y * W0 + x] = 1;
    reach = Math.max(reach, Math.ceil(Math.min(bx1 - bx0, by1 - by0) + 8));
  }
  const directions = Array.from({ length: 24 }, (_, i) => [Math.cos((i * Math.PI) / 24), Math.sin((i * Math.PI) / 24)]);
  const march = (x, y, dx, dy) => {
    for (let t = 1; t <= reach; t++) {
      const xx = Math.round(x + dx * t), yy = Math.round(y + dy * t);
      if (xx < 0 || yy < 0 || xx >= W0 || yy >= H0) return null;
      if (!erase[yy * W0 + xx]) return [t, (yy * W0 + xx) * 3];
    }
    return null;
  };
  const filled = [];
  for (let k = 0; k < W0 * H0; k++) {
    if (!erase[k]) continue;
    const x = k % W0, y = (k - x) / W0;
    let best = Infinity, color = null;
    for (const [dx, dy] of directions) {
      const a = march(x, y, dx, dy), b = march(x, y, -dx, -dy);
      if (!a || !b) continue;
      const score = [0, 1, 2].reduce((sum, ch) => sum + Math.abs(px[a[1] + ch] - px[b[1] + ch]), 0) + 2 * (a[0] + b[0]);
      if (score < best) [best, color] = [score, [0, 1, 2].map((ch) => (px[a[1] + ch] * b[0] + px[b[1] + ch] * a[0]) / (a[0] + b[0]))];
    }
    if (color) filled.push([k * 3, color]);
  }
  for (const [k, c] of filled) px.set(c, k);
  for (const [[bx0, by0, bx1, by1], c] of flat) {
    for (let y = Math.max(0, by0); y <= Math.min(H0 - 1, by1); y++) for (let x = Math.max(0, bx0); x <= Math.min(W0 - 1, bx1); x++) px.set(c, (y * W0 + x) * 3);
  }
  // 縁から続く背景（4近傍の塗りつぶし）
  // art.white があれば、白い背景とみなす明るさの下限（ごく薄い色の部分を背景として抜かないように）
  const isBack = art.background === "white" && art.white ? (r, g, b) => Math.min(r, g, b) > art.white : BACKGROUND[art.background];
  const back = new Uint8Array(W0 * H0);
  const stack = [];
  const push = (x, y) => {
    const k = y * W0 + x;
    if (back[k] || !isBack(px[k * 3], px[k * 3 + 1], px[k * 3 + 2])) return;
    back[k] = 1;
    stack.push(k);
  };
  for (let x = 0; x < W0; x++) { push(x, 0); push(x, H0 - 1); }
  for (let y = 0; y < H0; y++) { push(0, y); push(W0 - 1, y); }
  // art.backColor [r, g, b] があれば、縁から続かない所でもその色（±6）の点から背景を広げる（図に囲まれて残った背景の帯の色）
  if (art.backColor) {
    const [br, bg, bb] = art.backColor;
    for (let k = 0; k < W0 * H0; k++) {
      if (Math.abs(px[k * 3] - br) <= 6 && Math.abs(px[k * 3 + 1] - bg) <= 6 && Math.abs(px[k * 3 + 2] - bb) <= 6) push(k % W0, Math.floor(k / W0));
    }
  }
  while (stack.length) {
    const k = stack.pop(), x = k % W0, y = (k - x) / W0;
    if (x > 0) push(x - 1, y);
    if (x < W0 - 1) push(x + 1, y);
    if (y > 0) push(x, y - 1);
    if (y < H0 - 1) push(x, y + 1);
  }
  // 背景でない所の塊（8近傍）のうち、いちばん大きいもの（art.blobs があれば大きい順にその数）だけを残す（焼き込まれた文字は離れた塊なので消える）
  const label = new Int32Array(W0 * H0).fill(-1);
  const sizes = [];
  for (let k0 = 0, id = 0; k0 < W0 * H0; k0++) {
    if (back[k0] || label[k0] >= 0) continue;
    let size = 0;
    label[k0] = id;
    stack.push(k0);
    while (stack.length) {
      const k = stack.pop(), x = k % W0, y = (k - x) / W0;
      size++;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= W0 || yy >= H0) continue;
        const k2 = yy * W0 + xx;
        if (!back[k2] && label[k2] < 0) { label[k2] = id; stack.push(k2); }
      }
    }
    sizes.push(size);
    id++;
  }
  // art.keepAll なら塊を全部残す（陰影の線がばらばらの塊になる銅版画。図の外の文字は eraseBoxes で消しておく）
  const kept = new Set(art.keepAll ? sizes.map((_, id) => id) : sizes.map((size, id) => [size, id]).sort((a, b) => b[0] - a[0]).slice(0, art.blobs ?? 1).map(([, id]) => id));
  // 紙に重ねる。白い背景は掛け合わせ（縁のなじみが白のまま残らない）、暗い背景は縁を少しぼかした型で重ねる
  const keep = new Float32Array(W0 * H0);
  let x0 = W0, x1 = 0, y0 = H0, y1 = 0;
  for (let k = 0; k < W0 * H0; k++) {
    if (!kept.has(label[k])) continue;
    keep[k] = 1;
    const x = k % W0, y = (k - x) / W0;
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
  }
  const soft = new Float32Array(W0 * H0);
  for (let k = 0; k < W0 * H0; k++) {
    const x = k % W0, y = (k - x) / W0;
    let sum = 0, n = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= W0 || yy >= H0) continue;
      sum += keep[yy * W0 + xx] * (dx || dy ? 1 : 2);
      n += dx || dy ? 1 : 2;
    }
    soft[k] = sum / n;
  }
  const out = Buffer.alloc(W0 * H0 * 3);
  for (let k = 0; k < W0 * H0; k++) {
    for (let ch = 0; ch < 3; ch++) {
      const c = px[k * 3 + ch];
      out[k * 3 + ch] = Math.round(art.background === "white"
        ? (keep[k] ? c : 255) * PAPER[ch] / 255
        : PAPER[ch] * (1 - soft[k]) + c * soft[k]);
    }
  }
  // 切り詰める範囲は図の塊の外枠（art.crop があればその四角。体の輪郭など広い背景から臓器の所だけを切り出す）
  const margin = Math.round(0.025 * Math.max(x1 - x0, y1 - y0));
  const crop = art.crop
    ? { left: Math.round(art.crop[0] * unit), top: Math.round(art.crop[1] * unit), width: Math.round((art.crop[2] - art.crop[0]) * unit), height: Math.round((art.crop[3] - art.crop[1]) * unit) }
    : { left: Math.max(0, x0 - margin), top: Math.max(0, y0 - margin) };
  if (!art.crop) {
    crop.width = Math.min(W0, x1 + margin + 1) - crop.left;
    crop.height = Math.min(H0, y1 + margin + 1) - crop.top;
  }
  const scale = Math.min(1, ART_SIZE / Math.max(crop.width, crop.height));
  const W = Math.round(crop.width * scale), H = Math.round(crop.height * scale);
  let image = sharp(out, { raw: { width: W0, height: H0, channels: 3 } }).extract(crop);
  if (art.flip === "v") image = image.flip();
  const pixels = await image.resize(W, H).raw().toBuffer();
  const labels = plate.labels.map((spec) => {
    let [u, v] = [(spec.px[0] * unit - crop.left) / crop.width, (spec.px[1] * unit - crop.top) / crop.height];
    if (art.flip === "v") v = 1 - v;
    const entry = { at: [+u.toFixed(4), +v.toFixed(4)] };
    for (const key of ["term", "ja", "en", "note"]) if (spec[key]) entry[key] = spec[key];
    return entry;
  });
  return { W, H, pixels, labels };
}

/** 確認画像（ラベルの点に番号と名前） */
async function writeCheck(id, pixels, W, H, labels) {
  fs.mkdirSync(CHECK, { recursive: true });
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">`;
  for (const [i, l] of labels.entries()) {
    const [x, y] = [l.at[0] * W, l.at[1] * H];
    const name = l.ja ?? termById.get(l.term)?.ja ?? l.term;
    svg += `<circle cx="${x}" cy="${y}" r="5" fill="#111" stroke="#fff" stroke-width="2"/><text x="${x + 7}" y="${y - 6}" font-size="17" font-family="Hiragino Sans" fill="#000" stroke="#fff" stroke-width="3" paint-order="stroke">${i + 1} ${name}</text>`;
  }
  svg += "</svg>";
  await sharp(pixels, { raw: { width: W, height: H, channels: 3 } }).composite([{ input: Buffer.from(svg) }]).png().toFile(path.join(CHECK, `${id}.png`));
}

async function writePlate(plate, { W, H, pixels, labels }, quality) {
  const webp = await sharp(pixels, { raw: { width: W, height: H, channels: 3 } }).webp({ quality }).toBuffer();
  const hash = createHash("sha1").update(webp).digest("hex").slice(0, 10);
  for (const old of fs.readdirSync(OUT)) if (old.startsWith(`${plate.id}.`) && old.endsWith(".webp")) fs.rmSync(path.join(OUT, old));
  fs.writeFileSync(path.join(OUT, `${plate.id}.${hash}.webp`), webp);
  index.plates[plate.id] = { url: `plates/${plate.id}.${hash}.webp`, w: W, h: H, labels };
  console.log(`${plate.id}: ${W}×${H} ${(webp.length / 1024).toFixed(0)}KB ラベル${labels.length}`);
  if (check) await writeCheck(plate.id, pixels, W, H, labels);
}

fs.mkdirSync(OUT, { recursive: true });
const indexFile = path.join(OUT, "index.json");
const index = fs.existsSync(indexFile) ? JSON.parse(fs.readFileSync(indexFile, "utf8")) : { plates: {} };
for (const organ of organs) {
  const ids = organTerms(organ);
  for (const plate of organ.plates ?? []) {
    if (only.size && !only.has(plate.id)) continue;
    if (plate.art) {
      await writePlate(plate, await artPlate(plate), 84);
      continue;
    }
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
    await writePlate(plate, { W, H, pixels, labels }, 88);
  }
}
// 今の organs.json に無い図は index から除く
const known = new Set(organs.flatMap((organ) => (organ.plates ?? []).map((plate) => plate.id)));
for (const id of Object.keys(index.plates)) if (!known.has(id)) delete index.plates[id];
fs.writeFileSync(indexFile, `${JSON.stringify(index, null, 1)}\n`);
