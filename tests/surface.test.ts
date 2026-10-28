import * as THREE from "three";
import { mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";
// @ts-expect-error 型定義の無いビルド用スクリプト
import { bakeAo, dropStrays, muscleFibers, nerveFibers, radialFibers, subdivide } from "../scripts/surface.mjs";

type Mesh = { positions: Float32Array; normals: Float32Array; indices: Uint32Array };

function mesh(geometry: THREE.BufferGeometry): Mesh {
  geometry.computeVertexNormals();
  return {
    positions: new Float32Array(geometry.getAttribute("position").array),
    normals: new Float32Array(geometry.getAttribute("normal").array),
    indices: new Uint32Array(geometry.index!.array),
  };
}

/** y 軸に沿った円柱（両端は閉じない） */
const cylinder = (radius: number, height: number) => mesh(new THREE.CylinderGeometry(radius, radius, height, 24, 30, true));

const direction = (field: Float32Array, i: number) => new THREE.Vector3(field[i * 3], field[i * 3 + 1], field[i * 3 + 2]);

describe("くぼみの暗さ（scripts/surface.mjs の bakeAo）", () => {
  it("向かい合う板の内側は暗く、外側はさえぎる物が無い", () => {
    // 下の板（上向き）と、その 1cm 上の板（下向き）
    const lower = mesh(new THREE.PlaneGeometry(0.1, 0.1, 10, 10).rotateX(-Math.PI / 2));
    const upper = mesh(new THREE.PlaneGeometry(0.1, 0.1, 10, 10).rotateX(Math.PI / 2).translate(0, 0.01, 0));
    const lonely = mesh(new THREE.PlaneGeometry(0.1, 0.1, 10, 10).rotateX(-Math.PI / 2).translate(0, -0.5, 0));
    const [inner, outside] = bakeAo([lower, lonely], [lower, upper, lonely], { distance: 0.03 }) as Float32Array[];
    const center = 60; // 11×11 の頂点の真ん中
    expect(inner[center]).toBeLessThan(0.6);
    expect(Math.min(...outside)).toBeGreaterThan(0.99);
  });

  it("中に入った形の裏側からはさえぎられない（心臓の内腔のような形が真っ黒にならない）", () => {
    const shell = mesh(new THREE.SphereGeometry(0.05, 24, 16));
    const inside = mesh(new THREE.SphereGeometry(0.01, 12, 8));
    const [ao] = bakeAo([inside], [inside, shell], { distance: 0.03 }) as Float32Array[];
    expect(Math.min(...ao)).toBeGreaterThan(0.99);
  });
});

describe("線維の向き（scripts/surface.mjs）", () => {
  it("筋は起始から停止へ向く", () => {
    const m = cylinder(0.01, 0.2);
    const field = muscleFibers(m, { origin: [[0, -0.1, 0]], insertion: [[0, 0.1, 0]] }) as Float32Array;
    for (let i = 0; i < m.positions.length / 3; i += 37) expect(Math.abs(direction(field, i).y)).toBeGreaterThan(0.95);
  });

  it("起始・停止が無ければ形の長い向き", () => {
    const m = mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.2, 24, 30, true).rotateZ(Math.PI / 2));
    const field = muscleFibers(m, null) as Float32Array;
    for (let i = 0; i < m.positions.length / 3; i += 37) expect(Math.abs(direction(field, i).x)).toBeGreaterThan(0.95);
  });

  it("細い神経は走る向きに強く、広い面では弱い", () => {
    const nerve = cylinder(0.0015, 0.1);
    const field = nerveFibers(nerve) as Float32Array;
    const v = direction(field, 400);
    expect(v.length()).toBeGreaterThan(0.8);
    expect(Math.abs(v.y) / v.length()).toBeGreaterThan(0.95);
    const sheet = mesh(new THREE.PlaneGeometry(0.1, 0.1, 40, 40));
    expect(direction(nerveFibers(sheet) as Float32Array, 840).length()).toBeLessThan(0.2);
  });
});

describe("形の手直し（scripts/surface.mjs）", () => {
  /** 2つの形を1つにつなぐ（三角形の番号をずらす） */
  const join = (a: Mesh, b: Mesh): Mesh => {
    const count = a.positions.length / 3;
    return {
      positions: new Float32Array([...a.positions, ...b.positions]),
      normals: new Float32Array([...a.normals, ...b.normals]),
      indices: new Uint32Array([...a.indices, ...[...b.indices].map((i) => i + count)]),
    };
  };
  /** 多面体の形（三角形ごとに頂点が分かれている）を、頂点を共有する形にする */
  const polyhedron = (geometry: THREE.BufferGeometry) => mesh(mergeVertices(geometry.deleteAttribute("normal").deleteAttribute("uv")));
  const radii = (m: Mesh) => {
    const out: number[] = [];
    for (let i = 0; i < m.positions.length; i += 3) out.push(Math.hypot(m.positions[i], m.positions[i + 1], m.positions[i + 2]));
    return out;
  };

  it("本体から離れた小さなかけらを除き、近くのものと大きいものは残す", () => {
    const body = mesh(new THREE.SphereGeometry(0.012, 32, 24));
    const far = polyhedron(new THREE.TetrahedronGeometry(0.0005).translate(0.055, 0, 0));
    const near = polyhedron(new THREE.TetrahedronGeometry(0.0005).translate(0.015, 0, 0));
    const out = dropStrays(join(join(body, far), near)) as Mesh & { bounds: number[][] };
    expect(out.indices.length).toBe(body.indices.length + near.indices.length);
    expect(out.bounds[1][0]).toBeLessThan(0.02);
    const twin = join(body, mesh(new THREE.SphereGeometry(0.012, 32, 24).translate(0.06, 0, 0)));
    expect(dropStrays(twin).indices.length).toBe(twin.indices.length);
  });

  it("細分すると三角形が4倍になり、元の点を通って球の形に近づく", () => {
    // 角張った球（80面体）の面の真ん中は球の内側へへこんでいる。細分した形は縮まず、それより球に近い
    const coarse = polyhedron(new THREE.IcosahedronGeometry(0.02, 1));
    const fine = subdivide(coarse, 2) as Mesh;
    expect(fine.indices.length).toBe(coarse.indices.length * 16);
    const centers: number[] = [];
    for (let t = 0; t < coarse.indices.length; t += 3) {
      const c = [0, 1, 2].map((k) => [0, 1, 2].reduce((sum, e) => sum + coarse.positions[coarse.indices[t + e] * 3 + k] / 3, 0));
      centers.push(Math.hypot(...c));
    }
    const r = radii(fine);
    expect(Math.min(...r)).toBeGreaterThan(Math.min(...centers));
    expect(Math.max(...r)).toBeLessThanOrEqual(0.02 + 1e-6);
    // 法線は外向き
    for (let i = 0; i < fine.positions.length; i += 3 * 17) {
      const p = new THREE.Vector3(fine.positions[i], fine.positions[i + 1], fine.positions[i + 2]);
      expect(direction(fine.normals, i / 3).dot(p)).toBeGreaterThan(0);
    }
  });

  it("細分しても縁は縮まない（開いた形の穴が広がらない）", () => {
    const sheet = mesh(new THREE.PlaneGeometry(0.1, 0.1, 4, 4));
    const fine = subdivide(sheet, 1) as Mesh;
    let reach = 0;
    for (let i = 0; i < fine.positions.length; i += 3) reach = Math.max(reach, Math.abs(fine.positions[i]));
    expect(reach).toBeCloseTo(0.05, 6);
  });

  it("虹彩のすじは中心から外へ向き、瞳孔の縁の近くは弱い", () => {
    const disc = mesh(new THREE.RingGeometry(0.002, 0.006, 48, 6));
    const field = radialFibers(disc) as Float32Array;
    for (let i = 0; i < disc.positions.length / 3; i += 13) {
      const p = new THREE.Vector3(disc.positions[i * 3], disc.positions[i * 3 + 1], 0);
      const v = direction(field, i);
      if (p.length() > 0.005) expect(Math.abs(v.clone().normalize().dot(p.normalize()))).toBeGreaterThan(0.95);
      if (p.length() < 0.0021) expect(v.length()).toBeLessThan(0.05);
    }
  });
});
