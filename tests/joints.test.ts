import * as THREE from "three";
import joints from "../content/joints.json";
import basicsJson from "../content/terms/basics.json";

type Joint = { pivot: number[]; axis: number[]; slide?: boolean; moves: string[] };
const all = joints as Record<string, Joint>;
const basics = basicsJson as { units: { terms: { figure: { motion?: { from?: Record<string, number>; to: Record<string, number> } } }[] }[] };

/** アプリ（src/viewer.ts の poseMatrix）と同じく、関節の pivot のまわりに axis で回した点（slide は mm だけ動かす） */
function move(jointId: string, angle: number, point: [number, number, number]): THREE.Vector3 {
  const { pivot, axis, slide } = all[jointId];
  const p = new THREE.Vector3(...point);
  if (slide) return p.add(new THREE.Vector3(...axis).normalize().multiplyScalar(angle / 1000));
  return p.sub(new THREE.Vector3(...pivot)).applyAxisAngle(new THREE.Vector3(...axis).normalize(), THREE.MathUtils.degToRad(angle)).add(new THREE.Vector3(...pivot));
}

// 右側（本人の右＝ -x）、前が +z、上が +y。正の角度で、joints.json の plus の運動になること
describe("関節の向き（scripts/joints.mjs）", () => {
  it("肩・肘・前腕・手関節", () => {
    const hand: [number, number, number] = [-0.26, 0.75, 0.13];
    expect(move("elbow", 90, hand).z).toBeGreaterThan(0.3); // 屈曲: 手が前へ
    const abducted = move("shoulder-abd", 90, hand);
    expect(abducted.x).toBeLessThan(-0.5); // 外転: 手が外側へ
    expect(abducted.y).toBeGreaterThan(1.2);
    expect(move("shoulder-flex", 90, hand).z).toBeGreaterThan(0.4); // 屈曲: 腕が前へ
    const forearmForward = move("elbow", 90, hand);
    expect(move("shoulder-rot", 60, forearmForward.toArray()).x).toBeLessThan(forearmForward.x - 0.2); // 外旋: 前腕が外へ開く
    const thumb: [number, number, number] = [-0.29, 0.75, 0.11];
    expect(move("forearm", 90, thumb).z).toBeGreaterThan(thumb[2] + 0.01); // 回内: 親指（外側）が前を通って内へ
    expect(move("wrist-dev", 20, [-0.27, 0.68, 0.15]).x).toBeLessThan(-0.28); // 橈屈: 指先が外側（親指の側）へ
    expect(move("girdle", 20, [-0.15, 1.35, 0.07]).y).toBeGreaterThan(1.37); // 挙上: 鎖骨の外側端が上へ
  });

  it("股・膝・足", () => {
    const toe: [number, number, number] = [-0.12, -0.06, 0.2];
    expect(move("ankle", 20, toe).y).toBeGreaterThan(toe[1] + 0.02); // 背屈: つま先が上へ
    expect(move("knee", 60, [-0.07, 0.0, 0.08]).z).toBeLessThan(-0.1); // 屈曲: 下腿が後ろへ
    expect(move("hip-flex", 60, [-0.08, 0.4, 0.08]).z).toBeGreaterThan(0.3); // 屈曲: 大腿が前へ
    expect(move("hip-rot", 40, toe).x).toBeLessThan(toe[0] - 0.05); // 外旋: つま先が外へ
    const sole: [number, number, number] = [-0.08, -0.07, 0.1];
    expect(move("subtalar", 25, sole).x).toBeGreaterThan(sole[0]); // 内反: 足の裏が内側へ
    expect(move("neck", 60, [0, 1.52, 0.17]).x).toBeGreaterThan(0.05); // 回旋（正）: 顔が左（+x）を向く
  });

  it("動かす骨は根元から先の順に並び、基本の用語が使う関節はすべてある", () => {
    const used = basics.units.flatMap((unit) => unit.terms.flatMap((term) => Object.keys({ ...term.figure.motion?.from, ...term.figure.motion?.to })));
    for (const id of used) expect(all[id], id).toBeDefined();
    const order = Object.keys(all);
    expect(order.indexOf("shoulder-rot")).toBeLessThan(order.indexOf("elbow"));
    expect(order.indexOf("elbow")).toBeLessThan(order.indexOf("forearm"));
    expect(order.indexOf("knee")).toBeLessThan(order.indexOf("ankle"));
  });
});
