import * as THREE from "three";
// @ts-expect-error 型定義の無いビルド用スクリプト
import { bakeAo, muscleFibers, nerveFibers } from "../scripts/surface.mjs";

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
