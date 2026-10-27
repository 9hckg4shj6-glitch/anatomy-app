import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { joints, loadAttachments, loadModelIndex, pins, systemById, systems, termById, terms, type Attachments, type FigurePlane, type ModelIndex } from "./content";
import { pinCenter, pinSpread, type Vec3 } from "./landmarks";

export interface SceneSpec {
  /** 表示してタップで選べる系統 */
  systems: string[];
  /** 位置の手がかりとして半透明で添える系統（選べない） */
  context?: string[];
  /** 皮膚の輪郭を半透明で添える */
  body?: boolean;
}

const HIGHLIGHT = "#ff7a1a";
const WRONG = "#3d7bd9";
/** 筋の起始・停止を骨の上に示す色 */
export const ORIGIN_COLOR = "#2f9e44";
export const INSERTION_COLOR = "#7048e8";
/** 1度に光らせられるスポット（骨の部位）の数。左右の折り返しも数える */
const SPOT_MAX = 64;
/** 基本の用語の図で、関節の動きの道すじを示す矢印の色 */
const PATH_COLOR = "#0c8599";
/** 関節の動きの1回分（秒）: 初めの姿勢で止まる → 動く → 終わりの姿勢で止まる → 初めに戻る */
const MOTION_HOLD = 0.6;
const MOTION_MOVE = 1.6;
const MOTION_CYCLE = 3.4;

/** 強調の色。null はその語のふだんの色（骨の部位を探す問題で、骨だけを見せるとき） */
type Highlight = Map<string, string | null>;

/**
 * 組織ごとの質感。bump は細かい凹凸の深さ（mm）、grain はざらつきの粒の大きさ（m）、mottle は色むらの強さ、
 * deepen は色を濃くする割合（筋の赤を深く）、clearcoat はぬれた表面のつや。筋・神経の線維は GLB の頂点の向き（surfaceFiber）に沿って描く。
 */
interface Tissue { roughness: number; clearcoat: number; sheen: number; bump: number; grain: number; mottle: number; deepen: number; fibers?: boolean }
const TISSUES: Record<string, Tissue> = {
  bone: { roughness: 0.62, clearcoat: 0, sheen: 0, bump: 0.05, grain: 0.012, mottle: 0.1, deepen: 0 },
  cartilage: { roughness: 0.38, clearcoat: 0.35, sheen: 0, bump: 0.015, grain: 0.015, mottle: 0.06, deepen: 0 },
  muscle: { roughness: 0.5, clearcoat: 0.25, sheen: 0.35, bump: 0.09, grain: 0.008, mottle: 0.12, deepen: 0.6, fibers: true },
  nerve: { roughness: 0.5, clearcoat: 0.2, sheen: 0.2, bump: 0.06, grain: 0.008, mottle: 0.08, deepen: 0, fibers: true },
  vessel: { roughness: 0.4, clearcoat: 0.5, sheen: 0, bump: 0.02, grain: 0.02, mottle: 0.08, deepen: 0.3 },
  organ: { roughness: 0.45, clearcoat: 0.45, sheen: 0, bump: 0.03, grain: 0.015, mottle: 0.1, deepen: 0.2 },
};
const TISSUE_OF: Record<string, string> = { skeletal: "bone", muscular: "muscle", cardiovascular: "vessel", nervous: "organ" };
/** 骨格の中の軟骨（肋軟骨・椎間円板。GLB の部品に cartilage の印）の色 */
const CARTILAGE = "#d5dfe0";
/** 系統・語のもとの色。この色のときだけ組織の色の深め（deepen）をかける（強調の橙・青や進捗の色は変えない） */
const NATURAL = new Set([...systems.map((system) => system.color), ...terms.flatMap((term) => (term.color ? [term.color] : [])), CARTILAGE]);

/** 組織の凹凸と色むらに使う、つなぎ目の無い3Dのノイズ（size³）。乱数を3つの向きにぼかして作る */
function noiseTexture(size = 64): THREE.Data3DTexture {
  let a = new Float32Array(size ** 3);
  let seed = 7;
  for (let i = 0; i < a.length; i++) {
    seed = (seed * 16807) % 2147483647;
    a[i] = seed / 2147483647;
  }
  let b = new Float32Array(a.length);
  for (let pass = 0; pass < 2; pass++) {
    for (const stride of [1, size, size * size]) {
      for (let i = 0; i < a.length; i++) {
        const c = Math.floor(i / stride) % size;
        const prev = i + (((c + size - 1) % size) - c) * stride;
        const next = i + (((c + 1) % size) - c) * stride;
        b[i] = (a[prev] + 2 * a[i] + a[next]) / 4;
      }
      [a, b] = [b, a];
    }
  }
  let mean = 0, variance = 0;
  for (const v of a) mean += v / a.length;
  for (const v of a) variance += (v - mean) ** 2 / a.length;
  const data = new Uint8Array(a.length);
  for (let i = 0; i < a.length; i++) data[i] = Math.round(THREE.MathUtils.clamp(0.5 + ((a[i] - mean) / Math.sqrt(variance)) * 0.17, 0, 1) * 255);
  const texture = new THREE.Data3DTexture(data, size, size, size);
  texture.format = THREE.RedFormat;
  texture.wrapS = texture.wrapT = texture.wrapR = THREE.RepeatWrapping;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

const SURFACE_VERTEX = /* glsl */ `
attribute float surfaceAo;
attribute vec3 surfaceFiber;
varying float vSurfAo;
varying vec3 vSurfFiber;
varying vec3 vSurfPos;
#ifdef USE_SPOTS
varying vec3 vSpotPosition;
varying vec3 vSpotNormal;
#endif`;

const SURFACE_FRAGMENT = /* glsl */ `
uniform sampler3D surfNoise;
uniform float surfBump;
uniform float surfGrain;
uniform float surfMottle;
uniform float surfDeepen;
varying float vSurfAo;
varying vec3 vSurfFiber;
varying vec3 vSurfPos;
#ifdef USE_SPOTS
varying vec3 vSpotPosition;
varying vec3 vSpotNormal;
uniform int spotCount;
uniform vec4 spots[${SPOT_MAX}];
uniform vec3 spotColors[${SPOT_MAX}];
uniform vec3 spotNormals[${SPOT_MAX}];
#endif
float surfNoiseAt(vec3 p, float tile) { return texture(surfNoise, p / tile).r - 0.5; }
// 細かい凹凸の高さ（mm）。色むらと線維の濃淡で color も変える
float surfaceDetail(inout vec3 color) {
  vec3 p = vSurfPos;
  color = mix(color, color * color * 1.25, surfDeepen);
  float mottle = surfNoiseAt(p, 0.09) + 0.6 * surfNoiseAt(p, 0.03);
  float grain = surfNoiseAt(p, surfGrain) + 0.5 * surfNoiseAt(p, surfGrain * 0.41);
  float height = grain;
  float shade = mottle * surfMottle + grain * 0.05;
#ifdef SURF_FIBERS
  // 線維: 向きに沿って並べた点のノイズを平均すると（線積分）、その向きにそろった細い筋になる
  float strength = clamp(length(vSurfFiber), 0.0, 1.0);
  vec3 f = vSurfFiber / max(length(vSurfFiber), 1e-4);
  float fine = 0.0, coarse = 0.0;
  for (int i = 0; i < 6; i++) {
    float t = float(i) - 2.5;
    fine += surfNoiseAt(p + f * (t * 0.0011), 0.007);
    coarse += surfNoiseAt(p + f * (t * 0.005), 0.03);
  }
  // fine は細い線維（約1mm）、coarse は線維の束（約4mm）。6つの和なので小さめの係数で戻す
  float fibers = fine * 0.3 + coarse * 0.45;
  height = mix(grain, fibers * 1.6, strength);
  shade += strength * fibers * 0.55;
#endif
  color *= 1.0 + shade;
  return height * surfBump;
}
// 高さの画面上の変化から法線を傾ける（Mikkelsen の方法。単位は mm）
vec3 surfacePerturb(vec3 n, float height, float faceDirection) {
  vec3 pos = -vViewPosition * 1000.0;
  vec3 sx = dFdx(pos), sy = dFdy(pos);
  vec3 r1 = cross(sy, n), r2 = cross(n, sx);
  float det = dot(sx, r1) * faceDirection;
  vec3 grad = sign(det) * (dFdx(height) * r1 + dFdy(height) * r2);
  return normalize(abs(det) * n - grad);
}`;

/** 表面の材質に、くぼみの暗さ（AO）・凹凸・色むら・線維と、骨の部位のスポット（USE_SPOTS）を足す */
function surfaceShader(shader: THREE.WebGLProgramParametersWithUniforms): void {
  shader.vertexShader = shader.vertexShader
    .replace("#include <common>", `#include <common>\n${SURFACE_VERTEX}`)
    .replace("#include <begin_vertex>", `#include <begin_vertex>
vSurfAo = surfaceAo;
vSurfFiber = surfaceFiber;`)
    // 形の座標は GLB の量子化で部品ごとに縮めてあるので、凹凸の大きさをそろえるため体の座標（m）で引く
    .replace("#include <project_vertex>", `#include <project_vertex>
vSurfPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
#ifdef USE_SPOTS
vSpotPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;
vSpotNormal = normalize(mat3(modelMatrix) * objectNormal);
#endif`);
  shader.fragmentShader = shader.fragmentShader
    .replace("#include <common>", `#include <common>\n${SURFACE_FRAGMENT}`)
    .replace("#include <color_fragment>", `#include <color_fragment>
float surfHeight = surfaceDetail(diffuseColor.rgb);
#ifdef USE_SPOTS
for (int i = 0; i < ${SPOT_MAX}; i++) {
  if (i >= spotCount) break;
  float d = distance(vSpotPosition, spots[i].xyz);
  float r = spots[i].w;
  float inside = 1.0 - smoothstep(r * 0.92, r, d);
  if (dot(spotNormals[i], spotNormals[i]) > 0.0) inside *= smoothstep(-0.45, -0.2, dot(normalize(vSpotNormal), spotNormals[i]));
  float rim = smoothstep(r * 0.78, r * 0.92, d) * inside;
  diffuseColor.rgb = mix(diffuseColor.rgb, spotColors[i] * (1.0 - 0.35 * rim), inside);
}
#endif`)
    .replace("#include <normal_fragment_maps>", `#include <normal_fragment_maps>
normal = surfacePerturb(normal, surfHeight, faceDirection);`)
    .replace("#include <aomap_fragment>", `#include <aomap_fragment>
// くぼみ・すき間を暗くする。影は描かないので、直接の光も少し弱めて奥行きを出す
float surfOcclusion = clamp(vSurfAo, 0.0, 1.0);
reflectedLight.indirectDiffuse *= surfOcclusion * surfOcclusion;
reflectedLight.indirectSpecular *= surfOcclusion * surfOcclusion;
reflectedLight.directDiffuse *= mix(1.0, surfOcclusion, 0.85);
reflectedLight.directSpecular *= mix(1.0, surfOcclusion, 0.8);`);
}

/** 器官の部位を示すとき、器官を淡くしてスポット（橙）を見分けやすくする（消化器の橙・泌尿器の黄の上でも目立つように） */
function pale(color: string): string {
  return `#${new THREE.Color(color).lerp(new THREE.Color("#f4f1ea"), 0.6).getHexString()}`;
}

export class AnatomyViewer {
  readonly ready: Promise<void>;
  /** タップされた部品IDとその点・面の外向き（何も無い所なら null） */
  onPick: ((elementId: string | null, point: Vec3 | null, normal: Vec3 | null) => void) | null = null;

  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(35, 1, 0.01, 20);
  private readonly controls: OrbitControls;
  private readonly loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  private readonly label: HTMLDivElement;
  private readonly groups = new Map<string, Promise<THREE.Group>>();
  /** 読み込み中の系統の数（3Dの上に「読み込み中」を出す） */
  private loading = 0;
  private readonly meshes = new Map<string, THREE.Mesh>();
  private readonly materials = new Map<string, THREE.Material>();
  private index!: ModelIndex;
  private attachments: Attachments = {};
  private elementTerms = new Map<string, string[]>();
  /** ほかの構造をおおったりふさいだりする形（大網・口腔など、veil の語）の部品。強調していないときはごく薄く見せ、タップでは選べない */
  private veiled = new Set<string>();
  private active = new Set<string>();
  private context = new Set<string>();
  private highlighted: Highlight = new Map();
  private isolate = false;
  /** 強調した語を半透明にして、下の骨（筋の起始・停止のスポット）が透けて見えるようにする */
  private seeThrough = false;
  /** 問題で答えをタップした所（青い小さな印） */
  private tapMark: { element: string; point: Vec3 } | null = null;
  /** タップした所の印。骨の裏に回っても見えるよう、奥行きを無視して描く */
  private readonly tapBall = new THREE.Mesh(
    new THREE.SphereGeometry(0.003, 16, 12),
    new THREE.MeshBasicMaterial({ color: WRONG, depthTest: false, transparent: true, opacity: 0.9 }),
  );
  /** 半透明にしている部品（タップでは選べない） */
  private ghosted = new Set<string>();
  /** 骨の部位を示すスポット。すべてのスポット用の材質でこの値を共有する */
  private readonly spotUniforms = {
    spotCount: { value: 0 },
    spots: { value: Array.from({ length: SPOT_MAX }, () => new THREE.Vector4()) },
    spotColors: { value: Array.from({ length: SPOT_MAX }, () => new THREE.Color()) },
    // 部位の表面の向き。肩甲骨のような薄い骨で、裏側の面まで塗らないようにする（0 なら向きを問わない）
    spotNormals: { value: Array.from({ length: SPOT_MAX }, () => new THREE.Vector3()) },
  };
  private colors: Map<string, string> | null = null;
  /** 組織の凹凸・色むら・線維に使うノイズ（すべての表面の材質で共有） */
  private readonly noise = noiseTexture();
  /** 基本の用語（方向・面・運動）の図。矢印・面・動きの道すじ */
  private readonly figureGroup = new THREE.Group();
  private figureTerm: string | null = null;
  /** 図のラベルを置く点（矢印の先・面の角・動きの道すじの終わり） */
  private figureAnchor: THREE.Vector3 | null = null;
  /** 関節の動き。部品ごとに効く関節（content/joints.json の並び＝根元から先へ） */
  private motion: { from: Record<string, number>; to: Record<string, number>; start: number; meshes: Map<THREE.Mesh, string[]> } | null = null;
  private labelTerm: string | null = null;
  private dirty = true;
  /** 画素の細かさ（2まで）。描くのが重い端末では、動かしている間だけ下げる（frame） */
  private readonly fullRatio = Math.min(window.devicePixelRatio, 2);
  private frameGap = 0;
  private lastRender = 0;
  private showSeq = 0;
  private tween: { from: [THREE.Vector3, THREE.Vector3]; to: [THREE.Vector3, THREE.Vector3]; start: number } | null = null;

  constructor(private readonly host: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(this.fullRatio);
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    host.prepend(this.renderer.domElement);
    // WebGL がいったん失われて戻ったとき（スマホでアプリを裏に回したときなど）は、描き直さないと画面が空のままになる
    this.renderer.domElement.addEventListener("webglcontextrestored", () => {
      this.lightEnvironment();
      this.dirty = true;
    });
    this.label = document.createElement("div");
    this.label.className = "stage-label";
    this.label.hidden = true;
    host.append(this.label);

    // 光はカメラに付ける（どの向きから見ても同じ明るさ）。左上の主な光・右の弱い光・後ろからの縁の光と、部屋の映り込み
    this.lightEnvironment();
    this.scene.add(new THREE.HemisphereLight("#fffaf2", "#5e5448", 0.25));
    for (const [x, y, z, intensity] of [[-0.55, 0.75, 1, 2.4], [0.9, 0.1, 0.5, 0.4], [0.15, 0.6, -1, 1.2]] as const) {
      const light = new THREE.DirectionalLight("#ffffff", intensity);
      light.position.set(x, y, z);
      light.target.position.set(0, 0, 0);
      this.camera.add(light, light.target);
    }
    this.scene.add(this.camera);
    this.tapBall.renderOrder = 10;
    this.tapBall.visible = false;
    this.scene.add(this.tapBall);
    this.scene.add(this.figureGroup);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.minDistance = 0.08;
    this.controls.maxDistance = 4;
    this.controls.addEventListener("change", () => (this.dirty = true));

    let down: { x: number; y: number; t: number } | null = null;
    this.renderer.domElement.addEventListener("pointerdown", (event) => {
      down = { x: event.clientX, y: event.clientY, t: performance.now() };
    });
    this.renderer.domElement.addEventListener("pointerup", (event) => {
      // ドラッグ（回転）とタップを区別する
      if (!down || Math.hypot(event.clientX - down.x, event.clientY - down.y) > 8 || performance.now() - down.t > 600) return;
      down = null;
      const hit = this.pick(event.clientX, event.clientY);
      this.onPick?.(hit?.element ?? null, hit?.point ?? null, hit?.normal ?? null);
    });

    new ResizeObserver(() => this.resize()).observe(host);
    this.resize();
    this.renderer.setAnimationLoop(() => this.frame());

    this.ready = Promise.all([loadModelIndex(), loadAttachments()]).then(([index, attachments]) => {
      this.index = index;
      this.attachments = attachments;
      for (const [termId, term] of Object.entries(index.terms)) {
        if (termById.get(termId)?.veil) for (const element of term.elements) this.veiled.add(element);
        // 骨・器官の部位は骨・器官と同じ部品なので、タップした部品の名前には使わない
        if (termById.get(termId)?.of) continue;
        for (const element of term.elements) {
          const list = this.elementTerms.get(element) ?? [];
          list.push(termId);
          this.elementTerms.set(element, list);
        }
      }
      // 小さい（部品の少ない）語を先に置く。タップした部品の名前は、それを含む一番細かい語で答える。
      for (const list of this.elementTerms.values()) {
        list.sort((a, b) => index.terms[a].elements.length - index.terms[b].elements.length);
      }
      this.overview(false);
    });
  }

  /** 筋の付着面（Z-Anatomy から作った起始・停止の面）があるか */
  hasAttachments(termId: string): boolean {
    return !!this.attachments[termId];
  }

  /** 部品を含む語（細かい順）。表示中の系統に限る。 */
  termsOf(elementId: string): string[] {
    return (this.elementTerms.get(elementId) ?? []).filter((id) => this.active.has(this.index.terms[id].system));
  }

  async show(spec: SceneSpec): Promise<void> {
    // 画面をすばやく切り替えたとき、先に呼ばれた show の読み込みが後から終わって上書きしないようにする
    const seq = ++this.showSeq;
    await this.ready;
    const context = [...(spec.context ?? []), ...(spec.body ? ["body"] : [])];
    const wanted = [...spec.systems, ...context].filter((id) => this.index.systems[id]);
    await Promise.all(wanted.map((id) => this.group(id)));
    if (seq !== this.showSeq) return;
    this.active = new Set(spec.systems);
    this.context = new Set(context);
    for (const [id, group] of await this.loadedGroups()) group.visible = wanted.includes(id);
    this.refresh();
  }

  /**
   * 語を強調する。骨の部位は、その骨をふだんの色で見せ、部位の所だけを光らせる。
   * marks で、ほかの語（筋の起始・停止の部位など）を別の色で同時に示せる。
   * marks の "語ID@origin" "語ID@insertion" は、その筋の付着面（attachments-za.json）を示す。
   */
  highlight(termIds: string[], options: { isolate?: boolean; color?: string; marks?: [string, string][]; seeThrough?: boolean } = {}): void {
    this.highlighted = new Map([...termIds.map((id) => [id, options.color ?? HIGHLIGHT] as const), ...(options.marks ?? [])]);
    this.isolate = options.isolate ?? false;
    this.seeThrough = options.seeThrough ?? false;
    this.tapMark = null;
    this.refresh();
  }

  /** その語だけをふだんの色で見せ、ほかを半透明にする（骨の部位をタップで答えるとき） */
  only(termIds: string[]): void {
    this.highlighted = new Map(termIds.map((id) => [id, null]));
    this.isolate = true;
    this.seeThrough = false;
    this.tapMark = null;
    this.refresh();
  }

  /** 正解（橙）と、間違えて選んだ所（青）を同時に示す。tap はタップした部品と点（小さな青い印） */
  reveal(correct: string, wrong: string | null, isolate = false, tap: { element: string; point: Vec3 } | null = null): void {
    this.highlighted = new Map([[correct, HIGHLIGHT]]);
    if (wrong && wrong !== correct) this.highlighted.set(wrong, WRONG);
    this.isolate = isolate;
    this.seeThrough = false;
    this.tapMark = tap;
    this.refresh();
  }

  /** 語ごとの色分け（進捗表示）。null で系統の色に戻す。 */
  colorTerms(colors: Map<string, string> | null): void {
    this.colors = colors;
    this.refresh();
  }

  setLabel(termId: string | null, text = ""): void {
    this.labelTerm = termId;
    this.label.textContent = text;
    this.label.hidden = !termId;
    this.dirty = true;
  }

  /** 語に寄る。zoom を大きくするほど引いて周りも映す（答えが分かりすぎないように）。include の点も画面に入れる */
  focus(termId: string, zoom = 3.2, animate = true, include?: Vec3): void {
    const tan = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    const figure = termById.get(termId)?.figure;
    if (figure) {
      // 基本の用語の図は、決めた向きから決めた広さを映す（縦長の画面では横も入るように引く）
      const target = new THREE.Vector3(...figure.view.target);
      const distance = figure.view.size / tan / Math.min(1, this.camera.aspect);
      this.moveTo(target, target.clone().add(new THREE.Vector3(...figure.view.from).normalize().multiplyScalar(distance)), animate);
      return;
    }
    const pin = pins[termId];
    const term = this.index.terms[termId];
    if (!pin && !term) return;
    const direction = this.camera.position.clone().sub(this.controls.target).normalize();
    if (direction.lengthSq() === 0) direction.set(0, 0, 1);
    if (pin) {
      // 骨の部位は、部位の表面を正面から見る向きで、骨の周りが少し入る近さに寄る。
      // 器官の部位は器官が大きいので、器官の形が分かるところまで引く
      const target = new THREE.Vector3(...pinCenter(pin));
      const reach = include ? target.distanceTo(new THREE.Vector3(...include)) * 1.3 : 0;
      const organ = term && termById.get(termId)?.system !== "skeletal" ? term.radius * 0.6 : 0;
      const half = Math.max(0.055, pinSpread(pin) * 1.4 + pin.r * zoom * 0.8, reach, organ);
      const view = pin.n ?? pin.v;
      if (view) {
        direction.set(...view).normalize();
        // 真上・真下からだと回転の操作がしにくいので少し前に傾ける
        if (Math.abs(direction.y) > 0.96) direction.add(new THREE.Vector3(0, 0, 0.3)).normalize();
      }
      this.moveTo(target, target.clone().add(direction.multiplyScalar(half / tan)), animate);
      return;
    }
    const target = new THREE.Vector3(...term.center);
    const distance = Math.max(0.18, term.radius * zoom) / tan;
    this.moveTo(target, target.clone().add(direction.multiplyScalar(distance)), animate);
  }

  /** 骨の部位でも、ピンではなく骨全体に寄る（部位をタップで答えるとき）。from はカメラを置く向き（無ければ今の向き） */
  focusWhole(termId: string, zoom = 1.6, animate = true, from?: Vec3): void {
    const term = this.index.terms[termId];
    if (!term) return;
    const tan = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    const direction = from ? new THREE.Vector3(...from).normalize() : this.camera.position.clone().sub(this.controls.target).normalize();
    if (direction.lengthSq() === 0) direction.set(0, 0, 1);
    const target = new THREE.Vector3(...term.center);
    this.moveTo(target, target.clone().add(direction.multiplyScalar(Math.max(0.06, term.radius * zoom) / tan)), animate);
  }

  /** 全身を正面から */
  overview(animate = true): void {
    const [lo, hi] = this.index.bounds;
    const target = new THREE.Vector3((lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2);
    const height = hi[1] - lo[1];
    const distance = (height * 0.62) / Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    this.moveTo(target, target.clone().add(new THREE.Vector3(0, 0, distance)), animate);
  }

  private moveTo(target: THREE.Vector3, position: THREE.Vector3, animate: boolean): void {
    if (!animate) {
      this.controls.target.copy(target);
      this.camera.position.copy(position);
      this.tween = null;
      this.dirty = true;
      return;
    }
    this.tween = {
      from: [this.controls.target.clone(), this.camera.position.clone()],
      to: [target, position],
      start: performance.now(),
    };
  }

  private async loadedGroups(): Promise<[string, THREE.Group][]> {
    return Promise.all([...this.groups].map(async ([id, group]) => [id, await group] as [string, THREE.Group]));
  }

  private group(systemId: string): Promise<THREE.Group> {
    let group = this.groups.get(systemId);
    if (!group) {
      this.loading++;
      this.host.classList.add("loading");
      const { url, za } = this.index.systems[systemId];
      const files = [url, ...(za ? [za.url] : [])].map((file) => this.loader.loadAsync(`${import.meta.env.BASE_URL}${file}`));
      group = Promise.all(files).then((gltfs) => {
        const root = new THREE.Group();
        for (const gltf of gltfs) root.add(gltf.scene);
        root.userData.system = systemId;
        root.traverse((object) => {
          if (object instanceof THREE.Mesh) {
            object.userData.system = systemId;
            // GLB の頂点ごとの値（scripts/surface.mjs）: くぼみの暗さと、筋線維・神経の向き
            const geometry = object.geometry as THREE.BufferGeometry;
            for (const [from, to] of [["_ao", "surfaceAo"], ["_fiber", "surfaceFiber"]]) {
              if (!geometry.hasAttribute(from)) continue;
              geometry.setAttribute(to, geometry.getAttribute(from));
              geometry.deleteAttribute(from);
            }
            const fiber = geometry.getAttribute("surfaceFiber");
            let fibers = false;
            for (let i = 0; fiber && i < fiber.count && !fibers; i++) fibers = !!(fiber.getX(i) || fiber.getY(i) || fiber.getZ(i));
            object.userData.fibers = fibers;
            this.meshes.set(object.name, object);
          }
        });
        this.scene.add(root);
        return root;
      });
      this.groups.set(systemId, group);
      const settle = (ok: boolean) => {
        this.host.classList.toggle("loading", --this.loading > 0);
        this.host.classList.toggle("load-failed", !ok);
        // 読み込めなかった系統（オフラインでまだ保存していないなど）は、次に表示するときにやり直す
        if (!ok) this.groups.delete(systemId);
      };
      group.then(() => settle(true), () => settle(false));
    }
    return group;
  }

  private material(key: string, make: () => THREE.Material): THREE.Material {
    let material = this.materials.get(key);
    if (!material) {
      material = make();
      this.materials.set(key, material);
    }
    return material;
  }

  /** 部屋の映り込み（つやのある所に柔らかい光が映る）。WebGL が戻ったときも作り直す */
  private lightEnvironment(): void {
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment?.dispose();
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.35;
    pmrem.dispose();
  }

  /** 部品の組織（質感）。筋の色の語（喉頭・咽頭・骨盤底の筋）と線維のある部品は筋・神経の質感にする */
  private tissue(mesh: THREE.Mesh, color: string): string {
    if (mesh.userData.cartilage) return "cartilage";
    if (mesh.userData.fibers) return mesh.userData.system === "nervous" ? "nerve" : "muscle";
    if (color === "#c75b4f") return "muscle";
    return TISSUE_OF[mesh.userData.system as string] ?? "organ";
  }

  /** 不透明の表面。spots にすると、スポット（球）の中に入る所を塗る（縁を少し濃くして範囲を分かりやすくする） */
  private surface(color: string, tissue: string, spots = false): THREE.Material {
    return this.material(`${spots ? "spot" : "solid"}:${tissue}:${color}`, () => {
      const kind = TISSUES[tissue];
      const material = new THREE.MeshPhysicalMaterial({
        color, metalness: 0, roughness: kind.roughness,
        clearcoat: kind.clearcoat, clearcoatRoughness: 0.32,
        sheen: kind.sheen, sheenRoughness: 0.55, sheenColor: new THREE.Color(color).lerp(new THREE.Color("#ffffff"), 0.5),
      });
      material.defines = { ...(kind.fibers ? { SURF_FIBERS: "" } : {}), ...(spots ? { USE_SPOTS: "" } : {}) };
      // GLB に AO・線維の値が無い形（念のため）は、さえぎる物なし・線維なしとして描く
      // （three.js は型に無いが、どの材質でもこの値を見る）
      Object.assign(material, { defaultAttributeValues: { surfaceAo: [1], surfaceFiber: [0, 0, 0] } });
      const uniforms = {
        surfNoise: { value: this.noise },
        surfBump: { value: kind.bump },
        surfGrain: { value: kind.grain },
        surfMottle: { value: kind.mottle },
        surfDeepen: { value: NATURAL.has(color) ? kind.deepen : 0 },
      };
      material.onBeforeCompile = (shader) => {
        Object.assign(shader.uniforms, uniforms, spots ? this.spotUniforms : {});
        surfaceShader(shader);
      };
      return material;
    });
  }

  private solid(color: string, mesh: THREE.Mesh): THREE.Material {
    // 軟骨は、骨格の色のときだけ軟骨の色にする（強調・進捗の色はそのまま）
    if (mesh.userData.cartilage && color === systemById.get("skeletal")?.color) color = CARTILAGE;
    return this.surface(color, this.tissue(mesh, color));
  }

  private ghost(color: string, opacity: number): THREE.Material {
    return this.material(`ghost:${color}:${opacity}`, () =>
      new THREE.MeshStandardMaterial({ color, roughness: 0.8, transparent: true, opacity, depthWrite: false }));
  }

  private refresh(): void {
    const figureId = [...this.highlighted.keys()].find((id) => termById.get(id)?.figure) ?? null;
    if (figureId !== this.figureTerm) this.setFigure(figureId);
    else this.prepareMotion(); // 骨格を読み込む前に図を出したときは、読み込んでから動かす骨を集める
    const highlightedElements = new Map<string, string | null>();
    const spotElements = new Set<string>();
    type Spot = { at: Vec3; r: number; color: string; n?: Vec3 };
    const spots: Spot[] = [];
    const mirrored: Spot[] = [];
    const spot = (at: Vec3, r: number, color: string, n?: Vec3, one = false) => {
      spots.push({ at, r, color, n });
      // 左右がある骨は、左側にも折り返して示す（ピン・付着面は右側にある）。左右の無い器官の部位（one）は折り返さない
      if (!one && Math.abs(at[0]) > 0.01) mirrored.push({ at: [-at[0], at[1], at[2]], r, color, n: n && [-n[0], n[1], n[2]] });
    };
    for (const [termId, color] of this.highlighted) {
      const [muscle, kind] = termId.split("@") as [string, "origin" | "insertion" | undefined];
      if (kind) {
        for (const [on, x, y, z, r, ...n] of (color && this.attachments[muscle]?.[kind]) || []) {
          for (const element of this.index.terms[on]?.elements ?? []) spotElements.add(element);
          spot([x, y, z], r, color!, n.length ? (n as Vec3) : undefined);
        }
        continue;
      }
      const pin = color ? pins[termId] : undefined;
      for (const element of this.index.terms[termId]?.elements ?? []) {
        if (pin) spotElements.add(element);
        else if (!highlightedElements.has(element) || color) highlightedElements.set(element, color);
      }
      if (!pin || !color) continue;
      for (const at of pin.at) spot(at, pin.r, color, pin.n, pin.one);
    }
    // 塗れる数を超えるときは左側への折り返しをやめる（右側だけでも全部を示す）
    if (spots.length + mirrored.length + (this.tapMark ? 1 : 0) <= SPOT_MAX) spots.push(...mirrored);
    if (this.tapMark) {
      spots.unshift({ at: this.tapMark.point, r: 0.004, color: WRONG });
      spotElements.add(this.tapMark.element);
      this.tapBall.position.set(...this.tapMark.point);
    }
    this.tapBall.visible = !!this.tapMark;
    this.spotUniforms.spotCount.value = Math.min(SPOT_MAX, spots.length);
    for (const [i, spot] of spots.slice(0, SPOT_MAX).entries()) {
      this.spotUniforms.spots.value[i].set(...spot.at, spot.r);
      this.spotUniforms.spotColors.value[i].set(spot.color);
      if (spot.n) this.spotUniforms.spotNormals.value[i].set(...spot.n).normalize();
      else this.spotUniforms.spotNormals.value[i].set(0, 0, 0);
    }

    this.ghosted.clear();
    for (const [elementId, mesh] of this.meshes) {
      const system = mesh.userData.system as string;
      const base = systemById.get(system)?.color ?? "#cccccc";
      const own = () => {
        const termId = this.elementTerms.get(elementId)?.[0];
        return (termId && (this.colors?.get(termId) ?? termById.get(termId)?.color)) || base;
      };
      mesh.renderOrder = 0;
      // 関節の動きを示すときは、動く骨を光らせ、動かない皮膚は消す
      mesh.visible = !(this.motion && system === "body");
      if (this.motion?.meshes.has(mesh)) {
        mesh.material = this.solid(HIGHLIGHT, mesh);
      } else if (system === "body") {
        // 方向・面の図では、体の表面（浅・深の境）が分かるよう皮膚を少し濃くする
        mesh.material = this.ghost("#e8c9a8", this.figureTerm ? 0.2 : 0.1);
        mesh.renderOrder = 2;
        this.ghosted.add(elementId);
      } else if (highlightedElements.get(elementId)) {
        mesh.material = this.seeThrough ? this.ghost(highlightedElements.get(elementId)!, 0.45) : this.solid(highlightedElements.get(elementId)!, mesh);
        if (this.seeThrough) mesh.renderOrder = 1;
      } else if (spotElements.has(elementId)) {
        // 骨の部位（筋の起始・停止を含む）は、添えるだけの系統の骨でも不透明にして示す
        const color = highlightedElements.has(elementId) ? own() : base;
        mesh.material = this.surface(system === "skeletal" ? color : pale(color), this.tissue(mesh, color), true);
      } else if (this.context.has(system)) {
        mesh.material = this.ghost(base, 0.16);
        mesh.renderOrder = 1;
        this.ghosted.add(elementId);
      } else if (this.veiled.has(elementId) && !highlightedElements.has(elementId)) {
        mesh.material = this.ghost(own(), 0.12);
        mesh.renderOrder = 1;
        this.ghosted.add(elementId);
      } else if (highlightedElements.has(elementId)) {
        mesh.material = this.solid(own(), mesh);
      } else if (this.isolate) {
        mesh.material = this.ghost(base, 0.12);
        mesh.renderOrder = 1;
        this.ghosted.add(elementId);
      } else {
        mesh.material = this.solid(own(), mesh);
      }
    }
    this.dirty = true;
  }

  /** 基本の用語の図を出す（null で消す）。矢印・面はすぐに描き、関節の動きは骨格を読み込んでから始める */
  private setFigure(termId: string | null): void {
    this.figureTerm = termId;
    this.figureAnchor = null;
    for (const child of [...this.figureGroup.children]) {
      this.figureGroup.remove(child);
      child.traverse((object) => {
        if (object instanceof THREE.Mesh || object instanceof THREE.LineSegments) object.geometry.dispose();
      });
    }
    this.stopMotion();
    const figure = termId ? termById.get(termId)?.figure : undefined;
    if (!figure) return;
    // 矢印の太さは映す広さに合わせる（全身でも太ももの近くでも同じくらいに見える）
    const radius = THREE.MathUtils.clamp(figure.view.size * 0.012, 0.0025, 0.012);
    if (figure.guide) this.figureGroup.add(this.planeFigure(figure.guide, "#d9d3c7", 0.12));
    if (figure.plane) {
      this.figureGroup.add(this.planeFigure(figure.plane, HIGHLIGHT, 0.3));
      const [lo, hi] = this.index.bounds;
      const { axis, at } = figure.plane;
      this.figureAnchor = new THREE.Vector3(...(axis === "x" ? [at, hi[1], hi[2]] : axis === "y" ? [lo[0], at, hi[2]] : [lo[0], hi[1], at]) as Vec3);
    }
    for (const [from, to] of figure.arrows ?? []) {
      this.figureGroup.add(this.arrowFigure(new THREE.Vector3(...from), new THREE.Vector3(...to), HIGHLIGHT, radius));
      this.figureAnchor = new THREE.Vector3(...to);
    }
    if (figure.motion) {
      this.motion = { from: figure.motion.from ?? {}, to: figure.motion.to, start: performance.now(), meshes: new Map() };
      this.prepareMotion();
    }
    this.dirty = true;
  }

  /** 動かす骨（右側。環軸関節は正中の骨すべて）を集め、いちばん大きく動く骨の通り道を矢印で示す */
  private prepareMotion(): void {
    const motion = this.motion;
    if (!motion || motion.meshes.size) return;
    for (const [jointId, joint] of Object.entries(joints)) {
      if (!(jointId in motion.from) && !(jointId in motion.to)) continue;
      for (const termId of joint.moves) {
        for (const element of this.index.terms[termId]?.elements ?? []) {
          const mesh = this.meshes.get(element);
          if (!mesh || (!joint.mid && this.restCenter(mesh).x > 0)) continue;
          const list = motion.meshes.get(mesh) ?? [];
          if (!list.includes(jointId)) list.push(jointId);
          motion.meshes.set(mesh, list);
        }
      }
    }
    if (!motion.meshes.size) return; // まだ骨格を読み込んでいない
    // 上下に動かすだけの関節（肩甲骨の挙上）は、その関節の pivot（肩の外側）を通り道の矢印の所にする
    let tip: { center: THREE.Vector3; joints: string[]; moved: number } | null = null;
    for (const [jointId, joint] of Object.entries(joints)) {
      if (!joint.slide || (motion.from[jointId] ?? 0) === (motion.to[jointId] ?? 0)) continue;
      const center = new THREE.Vector3(...joint.pivot);
      tip = { center, joints: [jointId], moved: center.clone().applyMatrix4(this.poseMatrix([jointId], motion.from)).distanceTo(center.clone().applyMatrix4(this.poseMatrix([jointId], motion.to))) };
    }
    for (const [mesh, ids] of motion.meshes) {
      mesh.updateMatrix();
      mesh.userData.rest = mesh.matrix.clone();
      mesh.matrixAutoUpdate = false;
      const center = this.restCenter(mesh);
      const moved = center.clone().applyMatrix4(this.poseMatrix(ids, motion.from)).distanceTo(center.clone().applyMatrix4(this.poseMatrix(ids, motion.to)));
      if (!tip || moved > tip.moved) tip = { center, joints: ids, moved };
    }
    const points = Array.from({ length: 25 }, (_, i) => tip!.center.clone().applyMatrix4(this.poseMatrix(tip!.joints, this.poseAt(i / 24))));
    const radius = THREE.MathUtils.clamp(termById.get(this.figureTerm!)!.figure!.view.size * 0.008, 0.002, 0.006);
    this.figureGroup.add(this.pathFigure(points, PATH_COLOR, radius));
    this.figureAnchor = points[points.length - 1];
  }

  private stopMotion(): void {
    for (const mesh of this.motion?.meshes.keys() ?? []) {
      mesh.matrix.copy(mesh.userData.rest as THREE.Matrix4);
      mesh.matrixAutoUpdate = true;
      mesh.matrixWorldNeedsUpdate = true;
    }
    this.motion = null;
  }

  /** 部品の中心（動かす前の位置） */
  private restCenter(mesh: THREE.Mesh): THREE.Vector3 {
    if (!mesh.userData.center) {
      mesh.geometry.computeBoundingBox();
      const matrix = (mesh.userData.rest as THREE.Matrix4 | undefined) ?? (mesh.updateMatrix(), mesh.matrix);
      mesh.userData.center = mesh.geometry.boundingBox!.getCenter(new THREE.Vector3()).applyMatrix4(matrix);
    }
    return (mesh.userData.center as THREE.Vector3).clone();
  }

  /** 動きの途中の姿勢（t＝0 で from、1 で to） */
  private poseAt(t: number): Record<string, number> {
    const { from, to } = this.motion!;
    const angles: Record<string, number> = {};
    for (const id of new Set([...Object.keys(from), ...Object.keys(to)])) angles[id] = (from[id] ?? 0) + ((to[id] ?? 0) - (from[id] ?? 0)) * t;
    return angles;
  }

  /** 部品に効く関節を、先の関節から順に回してから根元の関節で回す（joints は根元から先の順） */
  private poseMatrix(jointIds: string[], angles: Record<string, number>): THREE.Matrix4 {
    const matrix = new THREE.Matrix4();
    for (const id of jointIds) {
      const angle = angles[id] ?? 0;
      if (!angle) continue;
      const { pivot, axis, slide } = joints[id];
      if (slide) {
        matrix.multiply(new THREE.Matrix4().makeTranslation(new THREE.Vector3(...axis).normalize().multiplyScalar(angle / 1000)));
        continue;
      }
      matrix
        .multiply(new THREE.Matrix4().makeTranslation(...pivot))
        .multiply(new THREE.Matrix4().makeRotationAxis(new THREE.Vector3(...axis).normalize(), THREE.MathUtils.degToRad(angle)))
        .multiply(new THREE.Matrix4().makeTranslation(-pivot[0], -pivot[1], -pivot[2]));
    }
    return matrix;
  }

  private animateMotion(): void {
    const motion = this.motion;
    if (!motion?.meshes.size) return;
    const time = ((performance.now() - motion.start) / 1000) % MOTION_CYCLE;
    const t = Math.min(1, Math.max(0, (time - MOTION_HOLD) / MOTION_MOVE));
    const angles = this.poseAt(t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
    for (const [mesh, ids] of motion.meshes) {
      mesh.matrix.multiplyMatrices(this.poseMatrix(ids, angles), mesh.userData.rest as THREE.Matrix4);
      mesh.matrixWorldNeedsUpdate = true;
    }
    this.dirty = true;
  }

  /** 図の材質。体の中を通る矢印も見えるよう、奥行きを無視して手前に描く */
  private overlay(color: string): THREE.Material {
    return this.material(`overlay:${color}`, () =>
      new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.35, roughness: 0.5, depthTest: false, transparent: true, opacity: 0.95 }));
  }

  private arrowFigure(from: THREE.Vector3, to: THREE.Vector3, color: string, radius: number): THREE.Object3D {
    const direction = to.clone().sub(from);
    const length = direction.length();
    const head = Math.min(length * 0.4, radius * 7);
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, length - head, 12), this.overlay(color));
    shaft.position.y = (length - head) / 2;
    const tip = new THREE.Mesh(new THREE.ConeGeometry(radius * 2.6, head, 20), this.overlay(color));
    tip.position.y = length - head / 2;
    shaft.renderOrder = tip.renderOrder = 10;
    const arrow = new THREE.Group().add(shaft, tip);
    arrow.position.copy(from);
    arrow.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
    return arrow;
  }

  /** 動きの道すじ（曲がった矢印） */
  private pathFigure(points: THREE.Vector3[], color: string, radius: number): THREE.Object3D {
    const group = new THREE.Group();
    const curve = new THREE.CatmullRomCurve3(points.slice(0, -2));
    const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 48, radius, 8), this.overlay(color));
    tube.renderOrder = 10;
    group.add(tube, this.arrowFigure(points[points.length - 3], points[points.length - 1], color, radius));
    return group;
  }

  /** 体の面（体を囲む大きさの四角形と縁） */
  private planeFigure({ axis, at }: FigurePlane, color: string, opacity: number): THREE.Object3D {
    const [lo, hi] = this.index.bounds;
    const pad = 0.08;
    const size = (k: number) => hi[k] - lo[k] + pad * 2;
    const mid = (k: number) => (lo[k] + hi[k]) / 2;
    const geometry = axis === "x" ? new THREE.PlaneGeometry(size(2), size(1)) : axis === "y" ? new THREE.PlaneGeometry(size(0), size(2)) : new THREE.PlaneGeometry(size(0), size(1));
    const face = new THREE.Mesh(geometry, this.material(`plane:${color}:${opacity}`, () =>
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity, side: THREE.DoubleSide, depthWrite: false })));
    const edge = new THREE.LineSegments(new THREE.EdgesGeometry(geometry), this.material(`planeEdge:${color}`, () =>
      new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.8 })));
    face.renderOrder = edge.renderOrder = 3;
    const plane = new THREE.Group().add(face, edge);
    if (axis === "x") plane.rotation.y = Math.PI / 2;
    if (axis === "y") plane.rotation.x = -Math.PI / 2;
    plane.position.set(axis === "x" ? at : mid(0), axis === "y" ? at : mid(1), axis === "z" ? at : mid(2));
    return plane;
  }

  private pick(clientX: number, clientY: number): { element: string; point: Vec3; normal: Vec3 | null } | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const raycaster = new THREE.Raycaster();
    // 半透明の部品（周りを薄くしたときなど）は選べない
    const candidates = [...this.meshes.values()].filter((mesh) =>
      this.active.has(mesh.userData.system as string) && !this.ghosted.has(mesh.name) && this.isVisible(mesh));
    // 細い骨や血管は指で当てにくいので、外れたら周りを少しずつ広げて探す
    for (const radius of [0, 6, 12, 18]) {
      const steps = radius ? 8 : 1;
      for (let i = 0; i < steps; i++) {
        const x = clientX + radius * Math.cos((i / steps) * Math.PI * 2);
        const y = clientY + radius * Math.sin((i / steps) * Math.PI * 2);
        raycaster.setFromCamera(new THREE.Vector2(((x - rect.left) / rect.width) * 2 - 1, -((y - rect.top) / rect.height) * 2 + 1), this.camera);
        const hit = raycaster.intersectObjects(candidates, false)[0];
        if (hit) {
          const normal = hit.face ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld) : null;
          // 裏から当たった面（向きがそろっていない部品）は、見ている側へ向け直す
          if (normal && normal.dot(raycaster.ray.direction) > 0) normal.negate();
          return { element: hit.object.name, point: hit.point.toArray() as Vec3, normal: (normal?.toArray() as Vec3) ?? null };
        }
      }
    }
    return null;
  }

  private isVisible(object: THREE.Object3D): boolean {
    for (let node: THREE.Object3D | null = object; node; node = node.parent) if (!node.visible) return false;
    return true;
  }

  private resize(): void {
    const { clientWidth: width, clientHeight: height } = this.host;
    if (!width || !height) return;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.dirty = true;
  }

  private frame(): void {
    const now = performance.now();
    if (this.tween) {
      const t = Math.min(1, (performance.now() - this.tween.start) / 450);
      const ease = 1 - (1 - t) ** 3;
      this.controls.target.lerpVectors(this.tween.from[0], this.tween.to[0], ease);
      this.camera.position.lerpVectors(this.tween.from[1], this.tween.to[1], ease);
      if (t === 1) this.tween = null;
      this.dirty = true;
    }
    if (this.controls.update()) this.dirty = true;
    this.animateMotion();
    if (!this.dirty) {
      // 止まったら、動かしている間だけ下げていた画素の細かさを戻して描き直す
      if (this.renderer.getPixelRatio() >= this.fullRatio || now - this.lastRender < 250) return;
      this.renderer.setPixelRatio(this.fullRatio);
    } else if (now - this.lastRender < 100) {
      // 続けて描いている（回している）間の間隔を測る。平均で 30ms を超える端末では、動かしている間の細かさを下げる
      this.frameGap = this.frameGap * 0.9 + (now - this.lastRender) * 0.1;
      if (this.frameGap > 30 && this.renderer.getPixelRatio() > 1) this.renderer.setPixelRatio(Math.max(1, this.fullRatio * 0.6));
    }
    this.dirty = false;
    this.lastRender = now;
    this.renderer.render(this.scene, this.camera);
    this.placeLabel();
  }

  private placeLabel(): void {
    if (!this.labelTerm || !this.index) return;
    const pin = pins[this.labelTerm];
    const figure = this.labelTerm === this.figureTerm ? this.figureAnchor?.toArray() : undefined;
    const center = figure ?? (pin ? pinCenter(pin) : this.index.terms[this.labelTerm]?.center);
    if (!center) return;
    const point = new THREE.Vector3(...center).project(this.camera);
    const behind = point.z > 1;
    this.label.style.transform = `translate(${((point.x + 1) / 2) * this.host.clientWidth}px, ${((1 - point.y) / 2) * this.host.clientHeight}px)`;
    this.label.style.opacity = behind ? "0" : "1";
  }
}
