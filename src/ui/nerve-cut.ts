import * as THREE from "three";
import { pins, systemById, termById, terms, units } from "../content";
import { h } from "../dom";
import { pinCenter, type Vec3 } from "../landmarks";
import { CUT_REGIONS, cutById, cutQuestions, NERVE_CUTS, type CutQuestion, type CutRegion, type CutSite, type NerveCut } from "../nerve-cut";
import type { AppContext } from "./context";
import { card, group } from "./settings-kit";

/**
 * 神経を切ると何が起こる？（#/cut。学ぶ・調べるの一覧から。src/nerve-cut.ts）
 * "#/cut" は神経の一覧（3Dでは神経が黄色く光り、押すとその神経へ）、"#/cut/<神経ID>[/<切る所>]" は神経を切る画面、
 * "#/cut/quiz[/<体の部分>]" は症状から神経を当てる問い。
 * 3Dは右側だけ（頭と首は、左を動く側として並べる）。止まる筋は灰色、弱まる筋はうすい灰色、まわりの動く筋は半透明、神経は黄色、切る所に赤い印。
 * 「できなくなる動き」は、ふだんのその動きを筋の動き（playAction）で、下垂手・下垂足は骨の姿勢（playPose）で見せる
 */

const MUSCLE = systemById.get("muscular")?.color ?? "#c75b4f";
const LOST = "#8a8f96";
const WEAK = "#cdb3ac";
const NERVE = "#ffd23f";
const CUT = "#e5322d";
const COLOR_NOTE: [string, string][] = [[LOST, "止まる筋"], [WEAK, "弱まる筋（ほかの神経も来る）"], [NERVE, "神経"], [CUT, "切る所"]];
const REGION_JA = Object.fromEntries(CUT_REGIONS.map((region) => [region.id, region.ja])) as Record<CutRegion, string>;
const QUIZ_COUNT = 10;
/** 手足の神経の場面に並べる骨（右側）。長胸神経は胸郭も */
const LIMB_BONES: Record<"upper" | "lower", string[]> = {
  upper: ["clavicle", "scapula", "humerus", "radius", "ulna", "carpal-bones", "metacarpals", "phalanges-hand"],
  lower: ["hip-bone", "sacrum", "coccyx", "femur", "patella", "tibia", "fibula", "tarsal-bones", "metatarsals", "phalanges-foot"],
};
const CHEST_BONES = ["ribs", "costal-cartilages", "sternum", "thoracic-vertebrae"];
/** まわりの筋は、その手足の単元（content/terms/muscular.json の group）の筋だけ。手を下げると腰や太ももの筋に近いので */
const LIMB_GROUPS: Record<"upper" | "lower", string[]> = { upper: ["上肢"], lower: ["下肢"] };

export async function nerveCutScreen(ctx: AppContext, arg: string): Promise<void> {
  const [first = "", second = ""] = arg.split("/");
  if (first === "quiz") return quiz(ctx, CUT_REGIONS.some((region) => region.id === second) ? (second as CutRegion) : undefined);
  const cut = cutById.get(first);
  if (!cut) return list(ctx);
  return nerveScreen(ctx, cut, cut.sites.find((site) => site.id === second) ?? cut.sites[0]);
}

// ---------------------------------------------------------------- 3D

const ja = (id: string) => termById.get(id)?.ja ?? id;

/** 3Dの場面の後始末（画面を離れたとき） */
function cleanup(ctx: AppContext): void {
  ctx.signal.addEventListener("abort", () => {
    ctx.viewer.playPose(null);
    ctx.viewer.playAction(null);
    ctx.viewer.setTags(null);
    ctx.viewer.setSchematic(null);
    ctx.viewer.setStage(null);
  }, { once: true });
}

/** 色を混ぜる（t＝0 で a、1 で b） */
function mix(a: string, b: string, t: number): string {
  return `#${new THREE.Color(a).lerp(new THREE.Color(b), t).getHexString()}`;
}

/** 系統ごとの部品（index.json の語から） */
const systemCache = new WeakMap<object, Map<string, Set<string>>>();
function elementsBySystem(ctx: AppContext): Map<string, Set<string>> {
  const cached = systemCache.get(ctx.index);
  if (cached) return cached;
  const out = new Map<string, Set<string>>();
  for (const term of Object.values(ctx.index.terms)) {
    const set = out.get(term.system) ?? new Set<string>();
    for (const element of term.elements) set.add(element);
    out.set(term.system, set);
  }
  systemCache.set(ctx.index, out);
  return out;
}

/** 神経の一覧の場面: 骨格と、一覧の神経（右側）を黄色く光らせる。返り値は部品 → 神経 */
async function overviewStage(ctx: AppContext, alive: () => boolean = () => true): Promise<Map<string, NerveCut> | null> {
  const { viewer } = ctx;
  await viewer.show({ systems: ["skeletal", "nervous"] });
  if (ctx.signal.aborted || !alive()) return null;
  const nerveOf = new Map<string, NerveCut>();
  for (const cut of NERVE_CUTS) {
    for (const element of ctx.index.terms[cut.id]?.elements ?? []) if ((viewer.sideOf(element) ?? 1) <= 0 && !nerveOf.has(element)) nerveOf.set(element, cut);
  }
  viewer.setTags(null);
  viewer.setSchematic(null);
  viewer.setStage({ solid: [...(elementsBySystem(ctx).get("skeletal") ?? [])], glow: [...nerveOf.keys()], colors: Object.fromEntries([...nerveOf.keys()].map((element) => [element, NERVE])) });
  viewer.overview();
  return nerveOf;
}

/** 神経を切る場面。apply(t) で筋の色を切る前（0）→ 切ったあと（1）に。frame() で映し直す */
interface CutScene {
  apply: (t: number, around?: boolean) => void;
  frame: () => void;
  /** 部品 → 語と、その部品の役（止まる・弱まる・神経・まわり） */
  pick: (element: string) => { term: string; role: "lost" | "weak" | "nerve" | "other" } | null;
  /** 語の右側の部品（札の所へ寄るため） */
  rightOf: (term: string) => string[];
  marker: (text: string) => void;
}

/** alive が false を返したら（あとから別の場面を頼んだら）何もしない */
async function cutScene(ctx: AppContext, cut: NerveCut, site: CutSite, alive: () => boolean = () => true): Promise<CutScene | null> {
  const { viewer } = ctx;
  const head = cut.region === "head";
  const muscleTerms = [...site.lost, ...(site.weak ?? [])];
  const systems = [...new Set(["skeletal", "muscular", "nervous", ...muscleTerms.map((id) => termById.get(id)?.system ?? "muscular")])];
  await viewer.show({ systems });
  if (ctx.signal.aborted || !alive()) return null;
  const elementsOf = (id: string) => ctx.index.terms[id]?.elements ?? [];
  const right = (element: string) => (viewer.sideOf(element) ?? 1) <= 0;
  const rightOf = (id: string) => elementsOf(id).filter(right);
  const lost = new Set(site.lost.flatMap(rightOf));
  const weak = new Set((site.weak ?? []).flatMap(rightOf).filter((element) => !lost.has(element)));
  // 頭と首は、左側（動く側）も並べて比べる
  const healthy = new Set(head ? muscleTerms.flatMap(elementsOf).filter((element) => !right(element)) : []);
  const nerve = rightOf(cut.id);
  const focus = [...lost, ...weak, ...nerve, ...healthy];

  // まわり: 止まる筋と神経を囲む箱の中の、ほかの筋・骨（手足は右側だけ）
  const box = new THREE.Box3();
  for (const element of focus) {
    const center = viewer.partCenter([element]);
    if (center) box.expandByPoint(new THREE.Vector3(...center));
  }
  const around = (margin: number) => box.clone().expandByScalar(margin);
  const inside = (element: string, area: THREE.Box3) => {
    if (!head && !right(element)) return false;
    const center = viewer.partCenter([element]);
    return !!center && area.containsPoint(new THREE.Vector3(...center));
  };
  const bySystem = elementsBySystem(ctx);
  const shown = new Set([...lost, ...weak, ...healthy, ...nerve]);
  const muscleArea = around(0.04);
  const chest = cut.id === "long-thoracic-nerve";
  const limb = cut.region === "head" ? null : cut.region;
  const groupOf = new Map(units.map((unit) => [unit.id, unit.group ?? ""]));
  const allowed = limb ? [...LIMB_GROUPS[limb], ...(chest ? ["体幹"] : [])] : null;
  const pool = allowed ? new Set(terms.filter((term) => term.system === "muscular" && allowed.includes(groupOf.get(term.unit) ?? "")).flatMap((term) => elementsOf(term.id))) : null;
  const others = systems.filter((id) => id !== "skeletal" && id !== "nervous")
    .flatMap((id) => [...(bySystem.get(id) ?? [])]).filter((element) => !shown.has(element) && (!pool || pool.has(element)) && inside(element, muscleArea));
  // 手足はその手足の骨をまるごと（右側）。頭と首は、止まる筋と神経のまわりの骨
  const bones = limb
    ? [...new Set([...LIMB_BONES[limb], ...(chest ? CHEST_BONES : [])].flatMap(elementsOf))].filter(right)
    : [...(bySystem.get("skeletal") ?? [])].filter((element) => inside(element, around(0.08)));

  // 部品 → 語（押した所の名前）
  const termOf = new Map<string, { term: string; role: "lost" | "weak" | "nerve" | "other" }>();
  for (const id of site.lost) for (const element of elementsOf(id)) if (lost.has(element) && !termOf.has(element)) termOf.set(element, { term: id, role: "lost" });
  for (const id of site.weak ?? []) for (const element of elementsOf(id)) if (weak.has(element) && !termOf.has(element)) termOf.set(element, { term: id, role: "weak" });
  for (const element of nerve) termOf.set(element, { term: cut.id, role: "nerve" });

  // 切る所: 骨の部位の目安に、神経の上でいちばん近い点
  const near = site.near?.map((id) => pinCenter(pins[id]));
  const target: Vec3 | null = near?.length
    ? (near.reduce((sum, p) => [sum[0] + p[0], sum[1] + p[1], sum[2] + p[2]], [0, 0, 0]).map((v) => v / near.length) as Vec3)
    : viewer.partCenter(nerve);
  const point = target && nerve.length ? viewer.nearestPoint(nerve, target) : null;
  const size = Math.max(0.1, box.getSize(new THREE.Vector3()).length());
  const markerSize = THREE.MathUtils.clamp(size * 0.04, 0.014, 0.03);
  const tag = h("div", { class: "stage-tag cut-tag" });

  const apply = (t: number, showAround = true) => {
    const colors: Record<string, string> = {};
    for (const element of lost) colors[element] = mix(MUSCLE, LOST, t);
    for (const element of weak) colors[element] = mix(MUSCLE, WEAK, t);
    for (const element of healthy) colors[element] = MUSCLE;
    for (const element of nerve) colors[element] = NERVE;
    viewer.setStage({
      solid: [...lost, ...weak, ...healthy, ...(head ? [] : bones)],
      glass: [...(showAround ? others : []), ...(head ? bones : [])],
      glassStrength: 0.5,
      glow: nerve,
      colors,
    });
  };
  return {
    apply,
    frame: () => viewer.frameStage(site.from, focus.length ? focus : bones, 0.85),
    pick: (element) => termOf.get(element) ?? (viewer.termsOf(element)[0] ? { term: viewer.termsOf(element)[0], role: "other" } : null),
    rightOf,
    marker: (text) => {
      viewer.setSchematic(point ? cutMarker(point, markerSize, site.from) : null);
      tag.textContent = text;
      // 札は印の上に（印に重ねると隠れる）
      viewer.setTags(point && text ? [{ element: tag, at: [point[0], point[1] + markerSize * 1.6 + 0.012, point[2]] }] : null);
    },
  };
}

/** 切る所の印（赤い球と白い輪。輪は映す向き from に向ける。筋に隠れないよう奥行きを無視して手前に描く） */
function cutMarker(at: Vec3, size: number, from: Vec3): THREE.Object3D {
  const group = new THREE.Group();
  const overlay = (color: string) => new THREE.MeshBasicMaterial({ color, depthTest: false, depthWrite: false, transparent: true, opacity: 0.95 });
  const ball = new THREE.Mesh(new THREE.SphereGeometry(size * 0.42, 24, 16), overlay(CUT));
  const ring = new THREE.Mesh(new THREE.TorusGeometry(size * 0.66, size * 0.09, 10, 40), overlay("#ffffff"));
  ring.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(...from).normalize());
  ball.renderOrder = 21;
  ring.renderOrder = 20;
  group.add(ring, ball);
  group.position.set(...at);
  return group;
}

// ---------------------------------------------------------------- 一覧

async function list(ctx: AppContext): Promise<void> {
  const { viewer } = ctx;
  ctx.hint("光っている神経を押すと、その神経へ");
  cleanup(ctx);
  ctx.panel.replaceChildren(h("div", { class: "home cut" },
    h("div", { class: "tab-head" }, h("h2", {}, "神経を切ると")),
    h("section", { class: "home-card" },
      h("p", { class: "cut-lead" }, "神経を1本選んで「切る」と、その神経が動かす筋が3Dで灰色になり、できなくなる動きと、そのときに出る手足の形（下垂手など）が分かります。"),
      h("p", { class: "home-note" }, "どこで切るかで、止まる筋が変わる神経もあります（枝が分かれる所より先で切ると、上の枝の筋は残る）。"),
      h("a", { class: "home-primary cut-quiz-go", href: "#/cut/quiz" },
        h("span", { class: "home-primary-text" },
          h("span", { class: "home-primary-title" }, "症状から神経を当てる"),
          h("span", { class: "home-primary-sub" }, `「手首が上がらない人がいます。どの神経？」${QUIZ_COUNT}問・4つから選ぶ`))),
    ),
    ...CUT_REGIONS.map((region) => group(`${region.ja}の神経`, {},
      card(...NERVE_CUTS.filter((cut) => cut.region === region.id).map((cut) => h("a", { class: "set-row cut-row", href: `#/cut/${cut.id}` },
        h("span", { class: "set-text" }, h("span", { class: "set-label" }, ja(cut.id)), h("span", { class: "set-sub" }, cut.sign)),
        h("span", { class: "set-value" }, cut.roots, " ›")))),
      h("p", { class: "set-foot" }, h("a", { href: `#/cut/quiz/${region.id}` }, `${region.ja}だけで当てる ›`)))),
  ));
  const nerveOf = await overviewStage(ctx);
  if (!nerveOf) return;
  viewer.onHover = (element) => {
    const cut = nerveOf.get(element);
    return cut ? `${ja(cut.id)}（${cut.sign}）` : null;
  };
  viewer.onPick = (element) => {
    const cut = element ? nerveOf.get(element) : undefined;
    if (cut) location.hash = `#/cut/${cut.id}`;
  };
}

// ---------------------------------------------------------------- 神経を切る

async function nerveScreen(ctx: AppContext, cut: NerveCut, first: CutSite): Promise<void> {
  const { viewer, signal } = ctx;
  cleanup(ctx);
  const nerve = termById.get(cut.id)!;
  let site = first;
  let done = false;
  let showAround = true;
  let scene: CutScene | null = null;
  let playing: string | null = null;
  let timer = 0;
  signal.addEventListener("abort", () => clearInterval(timer), { once: true });
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

  const body = h("div", { class: "cut-body" });
  const picked = h("div", { class: "cut-picked", "aria-live": "polite" });
  const cutButton = h("button", { class: "cut-button", type: "button", onClick: () => setDone(!done) });
  const sitePicker = cut.sites.length > 1 ? h("div", { class: "cut-sites", role: "radiogroup", "aria-label": "切る所" }) : null;
  const aroundChip = h("button", { class: "chip on", type: "button", "aria-pressed": "true", onClick: () => {
    showAround = !showAround;
    aroundChip.className = showAround ? "chip on" : "chip";
    aroundChip.setAttribute("aria-pressed", String(showAround));
    if (!playing) scene?.apply(done ? 1 : 0, showAround);
  } }, "まわりの筋");
  const backChip = h("button", { class: "chip on", type: "button", onClick: () => stopPlaying() }, "‹ 切った神経に戻る");

  ctx.panel.replaceChildren(h("div", { class: "home cut" },
    h("div", { class: "tab-head" }, h("h2", {}, "神経を切ると")),
    h("section", { class: "home-card cut-head" },
      h("p", { class: "home-kicker" }, `${REGION_JA[cut.region]}の神経・${cut.roots}`),
      h("p", { class: "cut-name" }, h("b", {}, nerve.ja), h("span", { lang: "en" }, nerve.en)),
      sitePicker ? h("p", { class: "cut-label" }, "どこで切る？") : "",
      sitePicker,
      h("p", { class: "cut-cause" }),
      cutButton,
      h("ul", { class: "legend cut-legend" }, ...COLOR_NOTE.map(([color, text]) => h("li", {}, h("span", { class: "swatch", style: `background:${color}` }), text))),
    ),
    picked,
    body,
    h("p", { class: "footer-link" },
      h("a", { href: `#/explore/${cut.id}` }, `${nerve.ja}を図鑑で見る`), "・",
      h("a", { href: "#/cut/quiz" }, "症状から神経を当てる"), "・",
      h("a", { href: "#/cut" }, "ほかの神経")),
  ));

  const renderSites = () => {
    if (!sitePicker) return;
    sitePicker.replaceChildren(...cut.sites.map((item) => h("button", {
      class: item === site ? "chip on" : "chip", type: "button", role: "radio", "aria-checked": String(item === site),
      onClick: () => void chooseSite(item),
    }, item.ja)));
  };
  const renderHead = () => {
    renderSites();
    ctx.panel.querySelector(".cut-cause")!.replaceChildren(h("span", { class: "cut-cause-label" }, "よくある原因"), site.cause);
    cutButton.className = done ? "cut-button is-done" : "cut-button";
    cutButton.replaceChildren(
      h("span", { class: "cut-button-mark", "aria-hidden": "true" }, done ? "↺" : "✂"),
      h("span", { class: "cut-button-text" },
        h("b", {}, done ? "つなぎ直す" : `${site.ja.replace(/（.*）$/, "")}で切る`),
        h("small", {}, done ? "切る前の色に戻す" : "押すと、止まる筋が灰色になります")));
  };

  /** 押した筋・神経の名前（3Dで寄って札を出す） */
  const showTerm = (id: string, role: "lost" | "weak" | "nerve" | "other", move = true) => {
    const term = termById.get(id);
    if (!term || !scene) return;
    const elements = scene.rightOf(id);
    if (move && elements.length) viewer.frameStage(site.from, elements, 0.55);
    viewer.setPartLabel(elements.length ? elements : null, term.ja);
    const state = role === "lost" ? (done ? "止まった筋" : "この神経だけで動く筋") : role === "weak" ? (done ? "弱まった筋（ほかの神経も来る）" : "ほかの神経と一緒に動かす筋")
      : role === "nerve" ? "切る神経" : "動く（この神経とは別）";
    picked.replaceChildren(h("section", { class: "home-card cut-pick" },
      h("p", { class: "home-kicker" }, "選んだ所"),
      h("b", { class: "cut-pick-name" }, term.ja, h("small", { lang: "en" }, ` ${term.en}`)),
      h("span", { class: "cut-pick-state" }, state, term.nerve ? `・神経：${term.nerve}` : ""),
      term.action ? h("span", { class: "muted" }, `作用：${term.action}`) : "",
      h("a", { href: `#/explore/${term.id}` }, "図鑑で見る ›")));
  };
  const muscleChip = (id: string, role: "lost" | "weak") => h("button", { class: "chip cut-chip", type: "button", onClick: () => showTerm(id, role) },
    h("span", { class: "swatch", style: `background:${done ? (role === "lost" ? LOST : WEAK) : MUSCLE}` }), ja(id));

  const renderBody = () => {
    const lostChips = h("div", { class: "chip-list" }, ...site.lost.map((id) => muscleChip(id, "lost")));
    const weakChips = site.weak?.length ? h("div", { class: "chip-list" }, ...site.weak.map((id) => muscleChip(id, "weak"))) : "";
    if (!done) {
      body.replaceChildren(
        h("section", { class: "home-card" },
          h("p", { class: "home-kicker" }, `ここで切ると止まる筋 ${site.lost.length}`),
          h("p", { class: "home-note cut-guess" }, "押す前に、どの動きができなくなるか考えてみましょう。名前を押すと3Dでその筋に寄ります。"),
          lostChips,
          weakChips ? h("p", { class: "home-kicker cut-sub" }, `弱まる筋 ${site.weak!.length}`) : "", weakChips),
      );
      return;
    }
    body.replaceChildren(
      ...site.signs.map((sign) => h("section", { class: "home-card cut-sign" },
        h("p", { class: "home-kicker" }, "出てくる形・徴候"),
        h("b", { class: "cut-sign-name" }, sign.ja),
        h("p", {}, sign.text),
        sign.pose ? h("button", { class: "ghost-button cut-play", type: "button", onClick: () => playPose(sign.ja, sign.pose!) }, `▶ ${sign.ja}の形を3Dで見る`) : "")),
      h("section", { class: "home-card" },
        h("p", { class: "home-kicker" }, "できなくなる動き"),
        h("ul", { class: "cut-moves" }, ...site.cannot.map((move) => h("li", {},
          h("span", {}, move.text),
          move.by ? h("button", { class: "ghost-button cut-play", type: "button", onClick: () => playMove(move.by!, move.text) }, `▶ ふだんの動き（${ja(move.by)}）`) : ""))),
        site.spared ? h("p", { class: "cut-spared" }, h("b", {}, "残る動き "), site.spared) : ""),
      h("section", { class: "home-card" },
        h("p", { class: "home-kicker" }, h("span", { class: "swatch", style: `background:${LOST}` }), `止まった筋 ${site.lost.length}`),
        lostChips,
        weakChips ? h("p", { class: "home-kicker cut-sub" }, h("span", { class: "swatch", style: `background:${WEAK}` }), `弱まった筋 ${site.weak!.length}`) : "", weakChips),
      h("section", { class: "home-card cut-facts" },
        h("dl", { class: "term-notes" },
          h("div", {}, h("dt", {}, "しびれる所"), h("dd", {}, site.numb)),
          site.note ? h("div", {}, h("dt", {}, "見分け方"), h("dd", {}, site.note)) : null)),
    );
  };

  const paint = () => {
    scene?.apply(done ? 1 : 0, showAround);
    scene?.marker(done ? "切った所" : "ここで切る");
  };
  /** 切る・つなぎ直す（筋の色をなめらかに変える） */
  const setDone = (next: boolean) => {
    stopPlaying(false);
    done = next;
    renderHead();
    renderBody();
    picked.replaceChildren();
    viewer.setPartLabel(null);
    clearInterval(timer);
    scene?.marker(done ? "切った所" : "ここで切る");
    if (reduced || !scene) return paint();
    let step = 0;
    timer = window.setInterval(() => {
      step++;
      const t = Math.min(1, step / 8);
      scene?.apply(done ? t : 1 - t, showAround);
      if (t >= 1) clearInterval(timer);
    }, 70);
  };

  const chooseSite = async (next: CutSite) => {
    if (next === site && scene) return;
    stopPlaying(false);
    site = next;
    done = false;
    const hash = `#/cut/${cut.id}${site === cut.sites[0] ? "" : `/${site.id}`}`;
    if (location.hash !== hash) history.replaceState(null, "", hash);
    renderHead();
    renderBody();
    picked.replaceChildren();
    viewer.setPartLabel(null);
    const asked = site;
    const made = await cutScene(ctx, cut, site, () => site === asked);
    if (!made || signal.aborted || site !== asked) return;
    scene = made;
    paint();
    scene.frame();
  };

  // ---- ふだんの動き・徴候の形（骨だけを動かす）
  const startPlaying = (key: string, hint: string) => {
    clearInterval(timer);
    playing = key;
    viewer.setTags(null);
    viewer.setSchematic(null);
    viewer.setPartLabel(null);
    ctx.hint(hint);
    ctx.tools.replaceChildren(backChip);
  };
  const playMove = (by: string, text: string) => {
    startPlaying(`move:${by}`, `ふだんの動き：${text.replace(/。.*$/, "")}（${ja(by)}が縮む）。切るとこれができない`);
    viewer.setStage(null);
    viewer.playAction(by);
  };
  const playPose = (name: string, pose: NonNullable<CutSite["signs"][number]["pose"]>) => {
    startPlaying(`pose:${name}`, `${name}：ふつう → 切ったあと`);
    viewer.playAction(null);
    viewer.setStage({ solid: [...(elementsBySystem(ctx).get("skeletal") ?? [])] });
    viewer.playPose(pose);
  };
  function stopPlaying(repaint = true): void {
    if (!playing) return;
    playing = null;
    viewer.playAction(null);
    viewer.playPose(null);
    ctx.hint("");
    ctx.tools.replaceChildren(aroundChip);
    if (repaint) {
      paint();
      scene?.frame();
    }
  }

  viewer.onPick = (element) => {
    if (playing || !element || !scene) return;
    const hit = scene.pick(element);
    if (!hit) return;
    showTerm(hit.term, hit.role, false);
  };
  viewer.onHover = (element) => {
    if (playing || !scene) return null;
    const hit = scene.pick(element);
    return hit ? ja(hit.term) : null;
  };
  ctx.tools.replaceChildren(aroundChip);
  // ブラウザの「戻る」「進む」で切る所だけが変わったときは、作り直さずに選び直す
  ctx.stay((arg) => {
    const [id, siteId = ""] = arg.split("/");
    if (id !== cut.id) return false;
    void chooseSite(cut.sites.find((item) => item.id === siteId) ?? cut.sites[0]);
    return true;
  });
  await chooseSite(first);
}

// ---------------------------------------------------------------- 当てる問い

async function quiz(ctx: AppContext, region?: CutRegion): Promise<void> {
  const { viewer, signal } = ctx;
  cleanup(ctx);
  const questions = cutQuestions(QUIZ_COUNT, Math.random, region);
  const wrong: CutQuestion[] = [];
  let index = 0;
  let score = 0;
  /** 3Dの場面の頼んだ順（あとから頼んだ場面だけを置く） */
  let stageSeq = 0;
  const latest = () => {
    const mine = ++stageSeq;
    return () => mine === stageSeq;
  };
  const box = h("div", { class: "home cut cut-quiz" });
  ctx.panel.replaceChildren(box);
  const ask = () => {
    const question = questions[index];
    ctx.hint("");
    void overviewStage(ctx, latest());
    viewer.onPick = null;
    viewer.onHover = null;
    const feedback = h("div", { class: "cut-feedback", "aria-live": "polite" });
    const buttons = question.choices.map((choice) => h("button", {
      class: "choice long", type: "button",
      onClick: () => answer(choice),
    }, ja(choice.id), h("small", { class: "cut-choice-roots" }, `　${choice.roots}`)));
    const answer = async (choice: NerveCut) => {
      const right = choice === question.cut;
      if (right) score++;
      else wrong.push(question);
      for (const [k, button] of buttons.entries()) {
        button.disabled = true;
        const item = question.choices[k];
        if (item === question.cut) button.classList.add("right");
        else if (item === choice) button.classList.add("wrong");
      }
      const site = question.site;
      const last = index === questions.length - 1;
      feedback.replaceChildren(h("section", { class: right ? "home-card cut-result is-right" : "home-card cut-result is-wrong" },
        h("b", { class: "cut-result-mark" }, right ? "○ 正解" : `× 正解は ${ja(question.cut.id)}`),
        h("p", {}, h("b", {}, `${ja(question.cut.id)}・${site.ja}`), "で傷ついたとき。",
          site.signs.length ? `${site.signs.map((sign) => sign.ja).join("・")}。` : ""),
        site.spared ? h("p", { class: "muted" }, site.spared) : "",
        h("p", { class: "muted" }, "3Dで、止まった筋が灰色になっています。"),
        h("div", { class: "nav-row" },
          h("a", { class: "ghost-button", href: `#/cut/${question.cut.id}${site === question.cut.sites[0] ? "" : `/${site.id}`}` }, "くわしく見る"),
          h("button", { class: "primary", type: "button", onClick: () => {
            index++;
            if (last) finish();
            else ask();
          } }, last ? "結果を見る" : "次へ"))));
      feedback.querySelector<HTMLButtonElement>(".primary")?.focus({ preventScroll: true });
      const scene = await cutScene(ctx, question.cut, site, latest());
      if (!scene || signal.aborted) return;
      scene.apply(1);
      scene.marker("切った所");
      scene.frame();
    };
    box.replaceChildren(
      h("div", { class: "tab-head" }, h("h2", {}, region ? `症状から神経を当てる（${REGION_JA[region]}）` : "症状から神経を当てる")),
      h("p", { class: "cut-quiz-count" }, `${index + 1} / ${questions.length}`),
      h("section", { class: "home-card cut-ask" },
        h("p", { class: "home-kicker" }, "どの神経が傷ついた？"),
        h("p", { class: "cut-ask-text" }, question.ask)),
      h("div", { class: "choices" }, ...buttons),
      feedback,
    );
    ctx.panel.scrollTop = 0;
  };

  const finish = () => {
    ctx.hint("");
    void overviewStage(ctx, latest());
    box.replaceChildren(
      h("div", { class: "tab-head" }, h("h2", {}, "症状から神経を当てる")),
      h("section", { class: "home-card cut-score" },
        h("p", { class: "home-kicker" }, "結果"),
        h("p", { class: "cut-score-count" }, h("b", {}, String(score)), h("span", {}, ` / ${questions.length}問`)),
        h("p", { class: "home-note" }, score === questions.length ? "全問正解です。徴候と神経がつながっています。" : "まちがえた神経は、3Dで切って止まる筋を確かめておきましょう。")),
      wrong.length ? group("まちがえた問い", {}, card(...wrong.map((question) => h("a", {
        class: "set-row cut-row", href: `#/cut/${question.cut.id}${question.site === question.cut.sites[0] ? "" : `/${question.site.id}`}`,
      }, h("span", { class: "set-text" }, h("span", { class: "set-label" }, `${ja(question.cut.id)}・${question.site.ja}`), h("span", { class: "set-sub" }, question.ask)), h("span", { class: "set-value" }, "›"))))) : "",
      h("div", { class: "nav-row" },
        h("a", { class: "ghost-button", href: "#/cut" }, "神経の一覧へ"),
        h("button", { class: "primary", type: "button", onClick: () => void quiz(ctx, region) }, "もう一度")),
    );
    ctx.panel.scrollTop = 0;
  };
  ask();
}
