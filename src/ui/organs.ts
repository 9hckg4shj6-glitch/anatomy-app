import { autoSpeak } from "../audio";
import { loadPlateIndex, organById, organTerms, termById, unitById, type Organ, type OrganCore, type PlateIndex, type PlateLabel, type PlateSpec, type Term } from "../content";
import { organLessons } from "../course";
import { db, nowIso } from "../db";
import { h } from "../dom";
import type { Section } from "../viewer";
import { termAt, type AppContext } from "./context";
import { flowDiagram } from "./diagrams";
import { drawPlate, labelName, type LabelMode } from "./plate-view";
import { termCard } from "./term-card";
import { noteText } from "../en-notes";
import { MOTIONS } from "../motion-list";
import { fullOrganById } from "../organ-details";
import { alsoFigures, allFigures, figureHref, findFigures, ORGAN_GROUPS, organThumb, type Figure } from "../organ-figures";
import { figureCard, figureCards, figureThumbElement, termFigures, type FigureCard } from "./figure-strip";

export { ORGAN_GROUPS, organThumb };

/** 臓器の図から動きの図鑑へ（その臓器の動きがあれば） */
const ORGAN_MOTIONS: Record<string, string[]> = {
  heart: ["heartbeat", "conduction", "circulation"], vessels: ["circulation"], lung: ["breathing"], "lung-segments": ["breathing"],
  pleura: ["breathing"], mediastinum: ["breathing", "circulation"], diaphragms: ["breathing"],
};

function motionLinks(organId: string): HTMLElement | string {
  const list = (ORGAN_MOTIONS[organId] ?? []).flatMap((id) => MOTIONS.find((motion) => motion.id === id) ?? []);
  return list.length ? h("div", { class: "chip-list motion-links" }, h("span", { class: "muted" }, "動きで見る："),
    ...list.map((motion) => h("a", { class: "chip", href: `#/motions/${motion.id}` }, `▶ ${motion.ja}`))) : "";
}

const LABEL_MODES: [LabelMode, string][] = [["both", "日本語と英語"], ["ja", "日本語"], ["en", "英語"], ["hide", "隠して確かめる"]];
const LABEL_MODE = "plateLabelMode";

/**
 * 臓器の図（#/organs）。臓器の一覧（#/organs）・すべての図（#/organs/all）・図を探した結果（#/organs/find/<言葉>）と、臓器ごとの画面（#/organs/<臓器ID>）。
 * 立体（#/organs/<臓器ID>/3d/<語ID>）は臓器と大血管だけを、部屋の色分け・向き・切り口を選んで見る。
 * 平面図（#/organs/<臓器ID>/<図ID>/<語ID>）は教科書のような図に、名前を日本語と英語で添える（scripts/plates.mjs が元のイラストから作った図・形から描いた図と、手で描いた模式図）。
 * 語ID があれば、その名前を選んで開く（図鑑などの「この語が載っている図」から）
 */
export async function organScreen(ctx: AppContext, arg: string): Promise<void> {
  const [organId, mode, termId] = arg.split("/");
  if (organId === "all") return await organList(ctx, "figures");
  if (organId === "find") return await organList(ctx, "organs", arg.slice("find/".length));
  const organ = fullOrganById(organId);
  if (!organ) return await organList(ctx, "organs");
  await organPage(ctx, organ, mode ?? "", termId ?? "");
}

/** 一覧の札の小さな字（平面図の枚数と、図のレッスンの進み具合） */
export function organMeta(organ: OrganCore, lessons: number, done: number): string[] {
  const plates = organ.plates.length ? `平面図 ${organ.plates.length}枚` : "立体だけ";
  return lessons ? [plates, done ? `レッスン ${done} / ${lessons}` : `レッスン ${lessons}`] : [plates];
}

/** 図を探した結果の数（「さらに表示」で全部） */
const FIRST_FIGURES = 30;

/**
 * 臓器の図の一覧（docs/普段使い.md「画面の分かりにくさの見直し」「平面図の探しやすさの見直し」）。
 * 上に図を探す欄（図の題・図に載っている語の名前・臓器の名前で）と、「臓器から」「すべての図」の切りかえ。
 * 臓器からは系統のまとまりの見出しと絵つきの札を2列に、すべての図は臓器ごとに平面図の絵を並べる（どの臓器に入っているか分からなくても見つかる）。
 * 英語名は臓器の画面で出す。3Dは使わないので、スマホでは3Dごとたたむ
 */
async function organList(ctx: AppContext, view: "organs" | "figures", startQuery = ""): Promise<void> {
  ctx.fold(true);
  ctx.viewer.highlight([]);
  ctx.viewer.overview();
  void ctx.viewer.show({ systems: ["skeletal"], body: true });
  const learnedIds = new Set((await db.learned.toArray()).map((item) => item.termId));
  const card = (organ: OrganCore) => {
    const lessons = organLessons(organ);
    const done = lessons.filter((unit) => unit.terms.every((term) => learnedIds.has(term.id))).length;
    const thumb = organThumb(organ);
    return h("li", {},
      h("a", { class: "organ-card", href: `#/organs/${organ.id}` },
        thumb
          ? h("img", { class: "organ-thumb", src: thumb, alt: "", loading: "lazy", decoding: "async", width: "360", height: "240" })
          : h("span", { class: "organ-thumb organ-thumb-3d", "aria-hidden": "true" }, "3D"),
        h("span", { class: "organ-name" }, organ.ja),
        h("span", { class: "organ-meta" }, ...organMeta(organ, lessons.length, done).map((text) => h("span", {}, text)))));
  };
  const groups = ORGAN_GROUPS.map((group) => ({ ...group, list: group.organs.flatMap((id) => (organById.has(id) ? [organById.get(id)!] : [])) })).filter((group) => group.list.length);
  const groupHead = (group: (typeof groups)[number]) => h("h3", { class: "organ-group" }, h("span", { class: "swatch", style: `background:${group.color}` }), group.title);
  const body = view === "figures"
    // すべての図: 系統のまとまり → 臓器の名前（押すと臓器の画面）→ その臓器の平面図の絵
    ? groups.flatMap((group) => [groupHead(group), ...group.list.filter((organ) => organ.plates.length).flatMap((organ) => [
      h("h4", { class: "fig-organ-head" }, h("a", { href: `#/organs/${organ.id}` }, organ.ja, h("span", { class: "muted" }, ` 平面図 ${organ.plates.length}枚 ›`))),
      figureCards(organ.plates.map((plate) => figureCard({ organ, plate })), { layout: "grid", label: `${organ.ja}の平面図` }),
    ])])
    : groups.flatMap((group) => [groupHead(group), h("ul", { class: "organ-grid" }, ...group.list.map(card))]);

  const results = h("div", { class: "fig-results", hidden: true });
  const rest = h("div", {},
    h("div", { class: "segments organ-view", role: "group", "aria-label": "一覧の見せ方" },
      h("a", { class: view === "organs" ? "segment on" : "segment", href: "#/organs", ...(view === "organs" ? { "aria-current": "page" } : {}) }, "臓器から"),
      h("a", { class: view === "figures" ? "segment on" : "segment", href: "#/organs/all", ...(view === "figures" ? { "aria-current": "page" } : {}) }, `すべての図（${allFigures.length}枚）`)),
    ...body);
  const search = h("input", {
    class: "search", type: "search", placeholder: "図や部位の名前で探す（例: 弁・膵管）", "aria-label": "平面図を探す", enterkeyhint: "search",
    autocomplete: "off", autocapitalize: "off", spellcheck: "false",
    onInput: () => show(),
  }) as HTMLInputElement;
  const show = (all = false) => {
    const query = search.value.trim();
    results.hidden = !query;
    rest.hidden = !!query;
    // 図を開いて戻ったとき、同じ結果から続けられるように（アドレスだけ変える。画面は作り直さない）
    const hash = query ? `#/organs/find/${encodeURIComponent(query)}` : view === "figures" ? "#/organs/all" : "#/organs";
    if (location.hash !== hash) history.replaceState(null, "", hash);
    if (!query) return;
    const hits = findFigures(query, { labels: true });
    if (!hits.length) {
      results.replaceChildren(
        h("p", { class: "look-count" }, `「${query}」の載っている図は見つかりませんでした。`),
        h("p", { class: "home-note" }, "図の題（「四腔断」「ネフロン」など）・図に載っている部位の名前（日本語・読み・英語）・臓器の名前で探せます。語そのものは「調べる」で。"),
      );
      return;
    }
    const shown = all ? hits : hits.slice(0, FIRST_FIGURES);
    results.replaceChildren(
      h("p", { class: "look-count" }, `${hits.length}枚`),
      h("ul", { class: "home-card look-list fig-rows" }, ...shown.map((hit) => figureRow(hit, hit.term, hit.label))),
      shown.length < hits.length ? h("button", { class: "ghost-button look-more", type: "button", onClick: () => show(true) }, `さらに ${hits.length - shown.length}枚を表示`) : "",
    );
  };

  ctx.panel.replaceChildren(
    h("h2", {}, "臓器の図"),
    h("p", { class: "muted" }, "臓器を立体（3D）と教科書のような平面図で見ます。見たい図がどの臓器にあるか分からないときは、図の名前や部位の名前で探すか「すべての図」から。"),
    search, results, rest,
  );
  if (startQuery) {
    search.value = startQuery;
    show();
  }
}

/** 図を探した結果の1行: 小さな絵・図の題・臓器の名前と、語で当たったときは「〇〇が載っている」 */
function figureRow(figure: Figure, term?: string, label?: string): HTMLElement {
  return h("li", {}, h("a", { class: "look-row fig-row", href: figureHref(figure, term) },
    figureThumbElement(figure.plate.id),
    h("span", { class: "look-text" },
      h("span", { class: "look-ja" }, figure.plate.title),
      h("span", { class: "look-where" }, `${figure.organ.ja}の図`, label ? ` ・ 「${label}」が載っている` : ""))));
}

/**
 * 臓器の画面の図の帯（名前のすぐ下）: 立体（3D）・この臓器の平面図・ほかの臓器の図（organs.json の also）を絵つきの札で。
 * 今の図は濃く、帯の真ん中に。前は「見方」の文字だけのボタンが説明とレッスンの下にあり、図に辿り着きにくかった
 */
function figureStrip(organ: Organ, current: string): HTMLElement {
  const own: FigureCard[] = [
    ...(organ.box ? [{ href: `#/organs/${organ.id}/3d`, title: "立体（3D）", kind: "3d" as const, current: current === "3d" }] : []),
    ...organ.plates.map((plate) => ({ ...figureCard({ organ, plate }), kind: plate.diagram ? ("diagram" as const) : undefined, current: plate.id === current })),
  ];
  const others = alsoFigures(organ.also);
  const count = organ.plates.length;
  return h("div", { class: "fig-strip-box" },
    h("p", { class: "fig-head" }, organ.box ? (count ? "立体と平面図" : "立体") : "平面図", count ? h("span", { class: "muted" }, `（平面図 ${count}枚${others.length ? `・ほかの臓器の図 ${others.length}枚` : ""}）`) : ""),
    figureCards([...own, ...(others.length ? [{ divider: "ほかの臓器の図" }, ...others.map((figure) => figureCard(figure, { showOrgan: true }))] : [])], { label: `${organ.ja}の図` }));
}

/** 平面図の上の「前の図・次の図」（立体と平面図を帯の順に。ほかの臓器の図には行かない） */
function figureNav(organ: Organ, plate: PlateSpec): HTMLElement {
  const views = [...(organ.box ? [{ id: "3d", title: "立体（3D）" }] : []), ...organ.plates];
  const at = views.findIndex((view) => view.id === plate.id);
  const link = (view: { id: string; title: string } | undefined, text: string) => view
    ? h("a", { class: "fig-nav-button", href: `#/organs/${organ.id}/${view.id}`, title: view.title }, text)
    : h("span", { class: "fig-nav-button off", "aria-hidden": "true" }, text);
  return h("nav", { class: "fig-nav", "aria-label": "前の図・次の図" },
    link(views[at - 1], "‹ 前の図"),
    h("span", { class: "fig-nav-count" }, `平面図 ${organ.plates.indexOf(plate) + 1} / ${organ.plates.length}`),
    link(views[at + 1], "次の図 ›"));
}

/** 臓器の画面の「図で学ぶレッスン」の欄（無ければ空）。平面図を見ている間は、図の名前の一覧が下へ押し出されないようたたむ */
async function lessonBox(organ: Organ, folded = false): Promise<HTMLElement | string> {
  const lessons = organLessons(organ);
  if (!lessons.length) return "";
  const learnedIds = new Set((await db.learned.bulkGet(lessons.flatMap((unit) => unit.terms.map((term) => term.id)))).flatMap((item) => (item ? [item.termId] : [])));
  const done = lessons.filter((unit) => unit.terms.every((term) => learnedIds.has(term.id))).length;
  // 多い（細胞と組織の11レッスンなど）ときは、見方の切りかえが下へ押し出されないよう、初めはたたむ
  return h("details", { class: "path-group organ-lessons", open: !folded && lessons.length <= 4 },
    h("summary", {}, h("span", { class: "path-group-name" }, "図で学ぶレッスン"),
      h("span", { class: "muted" }, done ? `${done} / ${lessons.length} レッスン` : `${lessons.length}レッスン`)),
    h("ol", { class: "home-card lesson-path" }, ...lessons.map((unit, i) => {
      const n = unit.terms.filter((term) => learnedIds.has(term.id)).length;
      const state = n === unit.terms.length ? "done" : n ? "partial" : "todo";
      return h("li", {}, h("a", { class: `path-row ${state}`, href: `#/learn/${unit.id}` },
        h("span", { class: "path-mark", "aria-hidden": "true" }, state === "done" ? "✓" : String(i + 1)),
        h("span", { class: "path-text" },
          h("span", { class: "path-title" }, unit.title),
          h("span", { class: "path-sub" }, state === "done" ? `${unit.terms.length}語・済み` : n ? `${n} / ${unit.terms.length}語・途中` : `${unit.terms.length}語`))));
    })));
}

async function organPage(ctx: AppContext, organ: Organ, mode: string, startTerm: string): Promise<void> {
  const { viewer, panel } = ctx;
  const stage = document.getElementById("stage")!;
  const [plateIndex, modeSetting] = await Promise.all([loadPlateIndex().catch((): PlateIndex => ({ plates: {} })), db.settings.get(LABEL_MODE)]);
  let labelMode: LabelMode = LABEL_MODES.some(([key]) => key === modeSetting?.value) ? (modeSetting!.value as LabelMode) : "both";
  const ids = new Set(organTerms(organ));
  // 3Dの無い臓器（皮膚）は平面図だけ（初めは最初の図）
  const plate = organ.plates.find((item) => item.id === mode) ?? (organ.box ? null : organ.plates[0]);

  // 平面図は3Dの上に重ねる紙（画面を離れたら外す）
  const layer = h("div", { class: "plate-layer", hidden: true });
  stage.insertBefore(layer, stage.querySelector("canvas")?.nextSibling ?? null);
  ctx.signal.addEventListener("abort", () => layer.remove(), { once: true });

  const head = h("div", { class: "organ-head" },
    h("a", { class: "back-link", href: "#/organs" }, "臓器の図"),
    h("h2", {}, h("ruby", {}, organ.ja, h("rt", {}, organ.yomi)), h("span", { class: "organ-en", lang: "en" }, organ.en)),
  );
  const about = [h("p", { class: "muted organ-about" }, noteText(organ.about)), motionLinks(organ.id)];
  const body = h("div", {});
  const lessonList = await lessonBox(organ, !!plate);

  if (plate) {
    // 平面図: 名前 → 図の帯 → 図で学ぶレッスン（たたむ）→ 前の図・次の図と図の題・名前の一覧 → 臓器の説明
    panel.replaceChildren(head, figureStrip(organ, plate.id), lessonList, figureNav(organ, plate), body,
      h("div", { class: "organ-about-end" }, h("h3", {}, `${organ.ja}について`), ...about));
    viewer.highlight([]);
    // 3Dの向きの目印は図のラベルに重なるので隠す（画面を移ると main.ts が戻す）
    viewer.hideCompass(true);
    layer.hidden = false;
    showPlate(ctx, organ, plate, plateIndex, layer, body, labelMode, (next) => {
      labelMode = next;
      void db.settings.put({ key: LABEL_MODE, value: next, updatedAt: nowIso() });
    }, startTerm);
    return;
  }
  // 立体: 名前 → 図の帯 → 臓器の説明・動きで見る → 図で学ぶレッスン → 向き・切り口・語
  panel.replaceChildren(head, figureStrip(organ, "3d"), ...about, lessonList, body);

  // 立体: 臓器と大血管だけを見せ、部屋・葉の色分け・向き・切り口を選ぶ
  const colorable = Object.keys(organ.colors).length > 0;
  let colored = colorable;
  let cut: number | null = null;
  let selected: Term | null = null;
  await viewer.show({ systems: [...new Set(organTerms(organ).map((id) => termById.get(id)?.system ?? "").filter(Boolean))], organ: organ.id });
  const paint = () => {
    viewer.colorTerms(colored ? new Map(Object.entries(organ.colors)) : null);
    // 隠れた部位（弁など）は、周りをガラスのように透かして見せる（切っているときは切り口で見える）
    viewer.highlight(selected ? [selected.id] : [], { isolate: cut === null && (!!selected?.xray || !!selected?.of) });
    viewer.setLabel(selected?.id ?? null, selected?.ja ?? "");
  };
  const applyCut = () => {
    const spec = cut === null ? null : organ.cuts[cut];
    const section: Section | null = spec
      ? { axis: "y", keep: 1, normal: spec.normal, at: spec.normal.reduce((sum, v, k) => sum + v * spec.point[k], 0) / Math.hypot(...spec.normal), from: spec.from }
      : null;
    viewer.setSection(section);
    viewer.setPeel(spec?.hide ?? [], []);
    if (section) viewer.viewSection(true, spec?.zoom ? spec.point : undefined, spec?.zoom);
    else viewer.viewOrgan(organ.views[0]?.from ?? [0, 0, 1]);
    paint();
  };
  const select = (term: Term | null, move = true) => {
    selected = term;
    paint();
    if (term && move && cut === null) viewer.focus(term.id, 2.2);
    if (term) autoSpeak(term);
    const hash = `#/organs/${organ.id}/3d${term ? `/${term.id}` : ""}`;
    if (location.hash !== hash) history.replaceState(null, "", hash);
    render();
  };
  viewer.onPick = (elementId, point) => select(termAt(ctx, elementId, point, ids), false);
  viewer.onHover = (elementId, point) => termAt(ctx, elementId, point, ids)?.ja ?? null;
  ctx.hint("タップで名前を表示");

  const legend = () => h("div", { class: "organ-legend" },
    ...Object.entries(organ.colors).map(([id, color]) => {
      const term = termById.get(id);
      return h("button", { type: "button", class: "legend-item", onClick: () => term && select(term) },
        h("span", { class: "swatch", style: `background:${color}` }), term?.ja ?? id, h("span", { class: "en", lang: "en" }, term?.en ?? ""));
    }),
  );
  const lessons = organ.units.flatMap((id) => unitById.get(id) ?? []);
  const inLessons = new Set(lessons.flatMap((unit) => unit.terms.map((term) => term.id)));
  const withTerms = organ.with.filter((id) => !inLessons.has(id)).flatMap((id) => termById.get(id) ?? []);
  const aroundTerms = organ.aroundTitle ? (organ.around ?? []).filter((id) => !inLessons.has(id)).flatMap((id) => termById.get(id) ?? []) : [];
  const render = () => {
    body.replaceChildren(
      h("h3", {}, "向き"),
      h("div", { class: "chip-list" }, ...organ.views.map((view) => h("button", {
        class: "chip", type: "button",
        onClick: () => {
          if (cut !== null) {
            cut = null;
            applyCut();
            render();
          }
          viewer.viewOrgan(view.from);
        },
      }, view.label))),
      h("h3", {}, "切って中を見る"),
      h("div", { class: "chip-list" },
        h("button", { class: cut === null ? "chip on" : "chip", type: "button", onClick: () => { cut = null; applyCut(); render(); } }, "切らない"),
        ...organ.cuts.map((item, i) => h("button", {
          class: cut === i ? "chip on" : "chip", type: "button",
          onClick: () => { cut = i; applyCut(); render(); },
        }, item.label)),
      ),
      colorable ? h("label", { class: "switch-row" },
        h("input", { type: "checkbox", checked: colored, onChange: (event: Event) => { colored = (event.target as HTMLInputElement).checked; paint(); render(); } }),
        organ.colorLabel ?? "色を分ける") : "",
      colored ? legend() : "",
      organ.colorNote ? h("p", { class: "muted" }, noteText(organ.colorNote)) : "",
      selected ? h("div", { class: "detail" },
        termCard(selected, { open: (word) => (ids.has(word.id) ? select(word) : (location.hash = `#/explore/${word.id}`)) }),
        termFigures(selected.id, { prefer: organ.id }),
        h("div", { class: "nav-row" },
          h("a", { class: "ghost-button", href: `#/explore/${selected.id}` }, "図鑑で開く"),
          h("button", { class: "ghost-button", type: "button", onClick: () => select(null) }, "選択をやめる"),
        ),
      ) : h("p", { class: "muted" }, "3Dの部位をタップするか、下の語を選んでください。"),
      ...[...lessons.map((unit) => [unit.title, unit.terms] as const), ["いっしょに見せる語", withTerms] as const, [organ.aroundTitle ?? "", aroundTerms] as const].filter(([, list]) => list.length).flatMap(([title, list]) => [
        h("h3", {}, title),
        h("div", { class: "chip-list" }, ...list.map((term) => h("button", {
          class: term === selected ? "chip on" : "chip", type: "button", onClick: () => select(term),
        }, term.ja))),
      ]),
    );
  };
  applyCut();
  select(termById.get(startTerm) && ids.has(startTerm) ? termById.get(startTerm)! : null);
}

/**
 * 平面図を紙（layer）に描く（plate-view.ts の drawPlate）。欄（body）には図の題・名前の出し方・名前の一覧と、選んだ語の説明
 */
function showPlate(ctx: AppContext, organ: Organ, spec: PlateSpec, index: PlateIndex, layer: HTMLElement, body: HTMLElement, startMode: LabelMode, saveMode: (mode: LabelMode) => void, startTerm = ""): void {
  let labelMode = startMode;
  const revealed = new Set<number>();
  const entry = index.plates[spec.id];
  const diagram = spec.diagram === "flow" ? flowDiagram() : null;
  const labels: PlateLabel[] = diagram ? diagram.labels : entry?.labels ?? [];
  const nameOf = labelName;
  // 図鑑などの「この語が載っている図」から来たときは、その語の名前を選んでおく（隠しているときも、その名前は出す）
  const start = startTerm ? labels.findIndex((label) => label.term === startTerm) : -1;
  let chosen: number | null = start >= 0 ? start : null;
  if (chosen !== null) revealed.add(chosen);
  ctx.hint("");

  const paper = h("div", { class: "plate-paper" });
  const toolbar = h("div", { class: "plate-tools" }, ...LABEL_MODES.map(([key, text]) => h("button", {
    class: key === labelMode ? "chip on" : "chip", type: "button",
    onClick: () => {
      labelMode = key;
      revealed.clear();
      saveMode(key);
      for (const button of toolbar.querySelectorAll("button")) button.classList.toggle("on", button.textContent === text);
      draw();
      renderList();
    },
  }, text)));
  layer.replaceChildren(paper, toolbar);

  const choose = (i: number | null) => {
    chosen = i;
    if (i !== null && labelMode === "hide") revealed.add(i);
    draw();
    renderList();
    const term = i !== null ? nameOf(labels[i]).term : undefined;
    if (term) autoSpeak(term);
  };

  const draw = () => {
    if (diagram) {
      paper.replaceChildren(diagram.svg((i) => choose(i), labelMode, revealed, chosen));
      return;
    }
    if (!entry) {
      paper.replaceChildren(h("p", { class: "muted" }, "この図はまだ作られていません（node scripts/plates.mjs）。"));
      return;
    }
    // 図は名前の出し方のボタンの下から（狭い画面ではボタンが2行になる）
    drawPlate(layer, paper, { entry, spec, labels, labelMode, revealed, chosen, choose, top: Math.max(52, toolbar.offsetTop + toolbar.offsetHeight + 8) });
  };

  const listBox = h("div", {});
  const renderList = () => {
    const chosenLabel = chosen !== null ? labels[chosen] : null;
    const chosenTerm = chosenLabel ? nameOf(chosenLabel).term : undefined;
    listBox.replaceChildren(
      chosenLabel ? h("div", { class: "detail" },
        chosenTerm ? termCard(chosenTerm, { open: (word) => (location.hash = `#/explore/${word.id}`) }) : h("article", { class: "term-card" },
          h("div", { class: "term-head" }, h("span", { class: "term-ja" }, nameOf(chosenLabel).ja)),
          h("div", { class: "term-en" }, h("span", { lang: "en" }, nameOf(chosenLabel).en)),
          chosenLabel.note ? h("p", {}, noteText(chosenLabel.note)) : ""),
        chosenTerm ? termFigures(chosenTerm.id, { prefer: organ.id, except: spec.id, title: "この語が載っているほかの図" }) : "",
        chosenTerm ? h("div", { class: "nav-row" },
          organ.box && (organTerms(organ).includes(chosenTerm.id) || chosenTerm.of) ? h("a", { class: "ghost-button", href: `#/organs/${organ.id}/3d/${chosenTerm.id}` }, "立体で見る") : null,
          h("a", { class: "ghost-button", href: `#/explore/${chosenTerm.id}` }, "図鑑で開く"),
        ) : "",
      ) : h("p", { class: "muted" }, labelMode === "hide" ? "名前を隠しています。番号を押すと名前が出ます。" : "名前を押すと説明が出ます。"),
      h("h3", {}, `この図の名前（${labels.length}）`),
      labelMode === "hide" ? h("button", { class: "text-button", type: "button", onClick: () => { labels.forEach((_, i) => revealed.add(i)); draw(); renderList(); } }, "すべての名前を出す") : "",
      h("ol", { class: "plate-list" }, ...labels.map((label, i) => {
        const { ja, en } = nameOf(label);
        const hidden = labelMode === "hide" && !revealed.has(i);
        return h("li", {}, h("button", { type: "button", class: i === chosen ? "term-row on" : "term-row", onClick: () => choose(i) },
          h("span", {}, hidden ? "？" : labelMode === "en" ? en : ja), h("span", { class: "en", lang: "en" }, hidden || labelMode !== "both" ? "" : en)));
      })),
    );
  };

  const art = spec.art;
  body.replaceChildren(
    h("h3", { class: "plate-title" }, spec.title, h("span", { class: "en", lang: "en" }, `　${spec.en}`)),
    spec.note ? h("p", { class: "muted" }, noteText(spec.note)) : "",
    spec.points?.length ? h("div", { class: "plate-points" }, h("h3", {}, "この図の要点"), h("ul", {}, ...spec.points.map((point) => h("li", {}, noteText(point))))) : "",
    listBox,
    art ? h("p", { class: "plate-credit muted" }, "図: ",
      h("a", { href: art.page, target: "_blank", rel: "noopener" }, art.author), "（",
      h("a", { href: art.licenseUrl, target: "_blank", rel: "noopener" }, art.license), `）。${art.changes}`) : "",
  );
  renderList();
  // 3Dの欄の大きさ（境目のつまみ・⤢）が変わったら描き直す
  const observer = new ResizeObserver(() => draw());
  observer.observe(layer);
  ctx.signal.addEventListener("abort", () => observer.disconnect(), { once: true });
  draw();
}
