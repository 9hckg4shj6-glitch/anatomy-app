import * as THREE from "three";
import type { Vec3 } from "../landmarks";

/**
 * 動きの図鑑の「わかりやすい模型」（docs/動きの図鑑.md「わかりやすい模型」）の共通の部品。
 * 模型は教科書の模式図を立体にした作り物で、形は cm で作り、全体を 0.01 倍して体の大きさ（m）にする
 */
export const CM = 0.01;
export type P2 = [number, number];

/** 閉じたなめらかな輪郭（点を通る Catmull-Rom を n 点で） */
export function smoothLoop(points: P2[], n = 72): P2[] {
  const curve = new THREE.CatmullRomCurve3(points.map(([x, y]) => new THREE.Vector3(x, y, 0)), true, "centripetal");
  return curve.getSpacedPoints(n).slice(0, n).map((p) => [p.x, p.y]);
}

const shapeOf = (points: P2[]) => new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y)));
const pathOf = (points: P2[]) => new THREE.Path(points.map(([x, y]) => new THREE.Vector2(x, y)));

/**
 * 輪郭を z の向きに厚みをつけた板（穴あり）。z は -depth/2 〜 depth/2。
 * 材質の 0 番は表と裏の面（切り口）、1 番は横の面
 */
export function slab(outer: P2[], holes: P2[][], depth: number, bevel = 0.25): THREE.BufferGeometry {
  const shape = shapeOf(outer);
  for (const hole of holes) shape.holes.push(pathOf(hole));
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: depth - bevel * 2, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel * 0.8, bevelSegments: 2, curveSegments: 1,
  });
  geometry.translate(0, 0, -(depth - bevel * 2) / 2);
  return geometry;
}

/** 点をなめらかに通る管 */
export function tube(points: Vec3[], radius: number, tubular = 64, radial = 14): THREE.TubeGeometry {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)), false, "centripetal");
  return new THREE.TubeGeometry(curve, tubular, radius, radial, false);
}

/** 管の中心線を細かく取る（粒の道すじ） */
export function curvePoints(points: Vec3[], n = 48): Vec3[] {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)), false, "centripetal");
  return curve.getSpacedPoints(n).map((p) => [p.x, p.y, p.z]);
}

/** 樹脂の模型のような、少しつやのある材質 */
export function plastic(color: string, options: { vertexColors?: boolean; roughness?: number; side?: THREE.Side } = {}): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: options.vertexColors ? "#ffffff" : color, roughness: options.roughness ?? 0.48, metalness: 0, vertexColors: !!options.vertexColors, side: options.side ?? THREE.FrontSide,
  });
}

/** 中が見えるよう透かした材質（血液・肺・血管の壁） */
export function clear(color: string, opacity: number, options: { emissive?: string; side?: THREE.Side } = {}): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color, roughness: 0.35, metalness: 0, transparent: true, opacity, depthWrite: false, side: options.side ?? THREE.DoubleSide,
    emissive: options.emissive ?? "#000000",
  });
}

/** 照明に依らず光る色（刺激伝導系・矢印） */
export function glow(color: string, opacity = 1): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({ color, toneMapped: false, transparent: opacity < 1, opacity });
}

/** 矢印の材質（ほかの部品に隠れないよう、いつも手前に描く） */
export function marker(color: string, opacity = 0.95): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({ color, toneMapped: false, transparent: true, opacity, depthTest: false, depthWrite: false });
}

/** 矢印（+y の向き。根もとが原点） */
export function arrow(length: number, radius: number, material: THREE.Material): THREE.Group {
  const group = new THREE.Group();
  const head = Math.min(length * 0.45, radius * 3.2);
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, length - head, 12), material);
  shaft.position.y = (length - head) / 2;
  const cone = new THREE.Mesh(new THREE.ConeGeometry(radius * 2.4, head, 16), material);
  cone.position.y = length - head / 2;
  group.add(shaft, cone);
  shaft.renderOrder = cone.renderOrder = 20;
  group.userData.pick = false;
  return group;
}

/** 矢印を from から to へ向けて置く */
export function pointArrow(group: THREE.Object3D, from: Vec3, to: Vec3): void {
  const direction = new THREE.Vector3(to[0] - from[0], to[1] - from[1], to[2] - from[2]);
  const length = direction.length();
  group.position.set(...from);
  group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
  group.scale.set(1, length, 1);
}

/**
 * 頂点の動きを「形の重ね合わせ」にする（src/ui/motions.ts の LinearDeform と同じ考え。こちらは模型の部品の座標で）。
 * 点ごとに channels 個の変位を先に求め、毎フレームは重みを掛けて足すだけ
 */
export class Deformer {
  private readonly items: { attribute: THREE.BufferAttribute; rest: Float32Array; basis: Float32Array[]; active: number[] }[] = [];

  constructor(meshes: THREE.Mesh[], channels: number, evaluate: (p: THREE.Vector3, mesh: THREE.Mesh, channel: number, out: THREE.Vector3) => void) {
    const p = new THREE.Vector3();
    const out = new THREE.Vector3();
    for (const mesh of meshes) {
      const attribute = mesh.geometry.getAttribute("position") as THREE.BufferAttribute;
      attribute.setUsage(THREE.DynamicDrawUsage);
      const rest = Float32Array.from(attribute.array as Float32Array);
      const basis: Float32Array[] = [];
      const active: number[] = [];
      for (let c = 0; c < channels; c++) {
        const values = new Float32Array(rest.length);
        let max = 0;
        for (let i = 0; i < rest.length; i += 3) {
          p.set(rest[i], rest[i + 1], rest[i + 2]);
          out.set(0, 0, 0);
          evaluate(p, mesh, c, out);
          values[i] = out.x;
          values[i + 1] = out.y;
          values[i + 2] = out.z;
          max = Math.max(max, Math.abs(out.x), Math.abs(out.y), Math.abs(out.z));
        }
        basis.push(values);
        if (max > 1e-6) active.push(c);
      }
      // 動かすと囲む球から外れるので、選ぶとき・描くときに切られないよう少し大きく
      mesh.geometry.computeBoundingSphere();
      if (mesh.geometry.boundingSphere) mesh.geometry.boundingSphere.radius *= 1.3;
      this.items.push({ attribute, rest, basis, active });
    }
  }

  apply(weights: ArrayLike<number>): void {
    for (const { attribute, rest, basis, active } of this.items) {
      const position = attribute.array as Float32Array;
      position.set(rest);
      for (const c of active) {
        const w = weights[c];
        if (!w) continue;
        const b = basis[c];
        for (let i = 0; i < b.length; i++) position[i] += b[i] * w;
      }
      attribute.needsUpdate = true;
    }
  }
}

/** 名前の札（3Dの上に出す HTML）。href があれば図鑑へのリンク */
export function tag(text: string, kind: string, href?: string): HTMLElement {
  const element = document.createElement(href ? "a" : "span");
  element.className = `stage-tag ${kind}`;
  element.textContent = text;
  if (href) (element as HTMLAnchorElement).href = href;
  return element;
}

export const smoothstep = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** 0〜1 の乱数の列（同じ種なら同じ。粒の置き方を毎回同じにする） */
export function random(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}
