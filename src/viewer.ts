import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { loadAttachments, loadModelIndex, pins, systemById, termById, type Attachments, type ModelIndex } from "./content";
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

/** 強調の色。null はその語のふだんの色（骨の部位を探す問題で、骨だけを見せるとき） */
type Highlight = Map<string, string | null>;

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
  private labelTerm: string | null = null;
  private dirty = true;
  private showSeq = 0;
  private tween: { from: [THREE.Vector3, THREE.Vector3]; to: [THREE.Vector3, THREE.Vector3]; start: number } | null = null;

  constructor(private readonly host: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    host.prepend(this.renderer.domElement);
    this.label = document.createElement("div");
    this.label.className = "stage-label";
    this.label.hidden = true;
    host.append(this.label);

    this.scene.add(new THREE.HemisphereLight("#ffffff", "#8a8070", 1.6));
    const headlight = new THREE.DirectionalLight("#ffffff", 1.8);
    headlight.position.set(0.3, 0.5, 1);
    this.camera.add(headlight);
    this.scene.add(this.camera);
    this.tapBall.renderOrder = 10;
    this.tapBall.visible = false;
    this.scene.add(this.tapBall);

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
        // 骨の部位は骨と同じ部品なので、タップした部品の名前には使わない
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
    const pin = pins[termId];
    const term = this.index.terms[termId];
    if (!pin && !term) return;
    const tan = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    const direction = this.camera.position.clone().sub(this.controls.target).normalize();
    if (direction.lengthSq() === 0) direction.set(0, 0, 1);
    if (pin) {
      // 骨の部位は、部位の表面を正面から見る向きで、骨の周りが少し入る近さに寄る
      const target = new THREE.Vector3(...pinCenter(pin));
      const reach = include ? target.distanceTo(new THREE.Vector3(...include)) * 1.3 : 0;
      const half = Math.max(0.055, pinSpread(pin) * 1.4 + pin.r * zoom * 0.8, reach);
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

  private solid(color: string): THREE.Material {
    return this.material(`solid:${color}`, () => new THREE.MeshStandardMaterial({ color, roughness: 0.65, metalness: 0 }));
  }

  private ghost(color: string, opacity: number): THREE.Material {
    return this.material(`ghost:${color}:${opacity}`, () =>
      new THREE.MeshStandardMaterial({ color, roughness: 0.8, transparent: true, opacity, depthWrite: false }));
  }

  /** 表面のうち、スポット（球）の中に入る所を塗る材質。縁を少し濃くして範囲を分かりやすくする */
  private spotted(color: string): THREE.Material {
    return this.material(`spot:${color}`, () => {
      const material = new THREE.MeshStandardMaterial({ color, roughness: 0.65, metalness: 0 });
      material.onBeforeCompile = (shader) => {
        Object.assign(shader.uniforms, this.spotUniforms);
        shader.vertexShader = shader.vertexShader
          .replace("#include <common>", "#include <common>\nvarying vec3 vSpotPosition;\nvarying vec3 vSpotNormal;")
          .replace("#include <project_vertex>", "#include <project_vertex>\nvSpotPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvSpotNormal = normalize(mat3(modelMatrix) * objectNormal);");
        shader.fragmentShader = shader.fragmentShader
          .replace("#include <common>", `#include <common>
varying vec3 vSpotPosition;
varying vec3 vSpotNormal;
uniform int spotCount;
uniform vec4 spots[${SPOT_MAX}];
uniform vec3 spotColors[${SPOT_MAX}];
uniform vec3 spotNormals[${SPOT_MAX}];`)
          .replace("#include <color_fragment>", `#include <color_fragment>
for (int i = 0; i < ${SPOT_MAX}; i++) {
  if (i >= spotCount) break;
  float d = distance(vSpotPosition, spots[i].xyz);
  float r = spots[i].w;
  float inside = 1.0 - smoothstep(r * 0.92, r, d);
  if (dot(spotNormals[i], spotNormals[i]) > 0.0) inside *= smoothstep(-0.45, -0.2, dot(normalize(vSpotNormal), spotNormals[i]));
  float rim = smoothstep(r * 0.78, r * 0.92, d) * inside;
  diffuseColor.rgb = mix(diffuseColor.rgb, spotColors[i] * (1.0 - 0.35 * rim), inside);
}`);
      };
      return material;
    });
  }

  private refresh(): void {
    const highlightedElements = new Map<string, string | null>();
    const spotElements = new Set<string>();
    type Spot = { at: Vec3; r: number; color: string; n?: Vec3 };
    const spots: Spot[] = [];
    const mirrored: Spot[] = [];
    const spot = (at: Vec3, r: number, color: string, n?: Vec3) => {
      spots.push({ at, r, color, n });
      // 左右がある骨は、左側にも折り返して示す（ピン・付着面は右側にある）
      if (Math.abs(at[0]) > 0.01) mirrored.push({ at: [-at[0], at[1], at[2]], r, color, n: n && [-n[0], n[1], n[2]] });
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
      for (const at of pin.at) spot(at, pin.r, color, pin.n);
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
      if (system === "body") {
        mesh.material = this.ghost("#e8c9a8", 0.1);
        mesh.renderOrder = 2;
        this.ghosted.add(elementId);
      } else if (highlightedElements.get(elementId)) {
        mesh.material = this.seeThrough ? this.ghost(highlightedElements.get(elementId)!, 0.45) : this.solid(highlightedElements.get(elementId)!);
        if (this.seeThrough) mesh.renderOrder = 1;
      } else if (spotElements.has(elementId)) {
        // 骨の部位（筋の起始・停止を含む）は、添えるだけの系統の骨でも不透明にして示す
        mesh.material = this.spotted(highlightedElements.has(elementId) ? own() : base);
      } else if (this.context.has(system)) {
        mesh.material = this.ghost(base, 0.16);
        mesh.renderOrder = 1;
        this.ghosted.add(elementId);
      } else if (highlightedElements.has(elementId)) {
        mesh.material = this.solid(own());
      } else if (this.isolate) {
        mesh.material = this.ghost(base, 0.12);
        mesh.renderOrder = 1;
        this.ghosted.add(elementId);
      } else {
        mesh.material = this.solid(own());
      }
    }
    this.dirty = true;
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
    if (this.tween) {
      const t = Math.min(1, (performance.now() - this.tween.start) / 450);
      const ease = 1 - (1 - t) ** 3;
      this.controls.target.lerpVectors(this.tween.from[0], this.tween.to[0], ease);
      this.camera.position.lerpVectors(this.tween.from[1], this.tween.to[1], ease);
      if (t === 1) this.tween = null;
      this.dirty = true;
    }
    if (this.controls.update()) this.dirty = true;
    if (!this.dirty) return;
    this.dirty = false;
    this.renderer.render(this.scene, this.camera);
    this.placeLabel();
  }

  private placeLabel(): void {
    if (!this.labelTerm || !this.index) return;
    const pin = pins[this.labelTerm];
    const center = pin ? pinCenter(pin) : this.index.terms[this.labelTerm]?.center;
    if (!center) return;
    const point = new THREE.Vector3(...center).project(this.camera);
    const behind = point.z > 1;
    this.label.style.transform = `translate(${((point.x + 1) / 2) * this.host.clientWidth}px, ${((1 - point.y) / 2) * this.host.clientHeight}px)`;
    this.label.style.opacity = behind ? "0" : "1";
  }
}
