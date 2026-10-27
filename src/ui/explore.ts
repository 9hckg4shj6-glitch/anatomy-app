import { speak } from "../audio";
import { landmarksOf, loadAttachments, pins, systems, termById, terms, type Term } from "../content";
import { h } from "../dom";
import { landmarkAt } from "../landmarks";
import { relatedTerms } from "../related";
import type { Section } from "../viewer";
import type { AppContext } from "./context";
import { attachMarks } from "./quiz";
import { termCard } from "./term-card";

/** 神経から支配する筋を示すとき、神経に付ける色 */
const NERVE_MARK = "#ffd43b";

const SECTION_AXES: { axis: Section["axis"]; label: string; keep: Section["keep"] }[] = [
  { axis: "y", label: "水平断", keep: 1 },
  { axis: "x", label: "矢状断", keep: -1 },
  { axis: "z", label: "前頭断", keep: -1 },
];

/** 図鑑：系統を選んで自由に回し、タップした部位や検索した語を調べる。termId があればその語を選んで開く */
export async function explore(ctx: AppContext, termId = ""): Promise<void> {
  const { viewer, panel, tools, index } = ctx;
  const attachments = await loadAttachments();
  const available = systems.filter((system) => index.systems[system.id]);
  const opened = termById.get(termId);
  const shown = new Set([opened && index.systems[opened.system] ? opened.system : available[0]?.id ?? "skeletal"]);
  let body = true;
  let selected: Term | null = null;
  let isolate = false;
  let attach = false;
  /** 神経が支配する筋をまとめて示しているとき、その筋 */
  let group: Term[] = [];
  let section: Section | null = null;

  const paint = () => {
    if (selected && group.length) viewer.highlight(group.map((term) => term.id), { isolate: true, marks: [[selected.id, NERVE_MARK]] });
    else if (selected && attach) viewer.highlight([selected.id], { isolate: true, marks: attachMarks(selected), seeThrough: true });
    else viewer.highlight(selected ? [selected.id] : [], { isolate: isolate && !!selected });
  };

  const apply = async () => {
    await viewer.show({ systems: [...shown], body });
    paint();
    renderTools();
  };

  const renderTools = () => {
    tools.replaceChildren(
      ...available.map((system) => h("button", {
        class: shown.has(system.id) ? "chip on" : "chip", type: "button",
        onClick: () => {
          if (shown.has(system.id) && shown.size > 1) shown.delete(system.id);
          else shown.add(system.id);
          void apply();
        },
      }, system.ja)),
      h("button", { class: body ? "chip on" : "chip", type: "button", onClick: () => { body = !body; void apply(); } }, "皮膚"),
      h("button", { class: section ? "chip on" : "chip", type: "button", onClick: () => toggleSection() }, "断面"),
    );
  };

  // 断面: 初めは体全体を出して、選んでいる語（無ければ心臓）の高さで水平に切る。語を選んでいればそのまわりに寄る
  const sectionBox = h("div", { class: "section-box", hidden: true });
  const faceSection = () => {
    const center = selected ? index.terms[selected.id]?.center : undefined;
    viewer.viewSection(true, center, center ? 0.09 : undefined);
  };
  const toggleSection = () => {
    // 断面では切り口で見えるので、隠れた語でも周りを薄くしない（ここで断面を消すときだけ、もとの見せ方に戻す）
    isolate = !!section && (!!selected?.xray || !!selected?.of);
    if (section) {
      section = null;
      viewer.setSection(null);
      viewer.overview();
    } else {
      for (const system of available) if (system.id !== "joints" && system.id !== "lymphatic") shown.add(system.id);
      const center = index.terms[selected?.id ?? "heart"]?.center ?? index.terms.heart.center;
      section = { axis: "y", at: center[1], keep: 1 };
      void apply();
      viewer.setSection(section);
      faceSection();
      ctx.hint("切り口をタップで名前を表示");
    }
    paint();
    renderSection();
    renderTools();
  };
  const renderSection = () => {
    sectionBox.hidden = !section;
    if (!section) return;
    const current = section;
    const k = "xyz".indexOf(current.axis);
    const [lo, hi] = index.bounds;
    const slider = h("input", {
      type: "range", min: String(lo[k]), max: String(hi[k]), step: "0.002", value: String(current.at), "aria-label": "切る位置",
      onInput: () => {
        section = { ...current, at: Number(slider.value) };
        viewer.setSection(section);
      },
    });
    const ends = { y: ["足", "頭"], x: ["右", "左"], z: ["後ろ", "前"] }[current.axis];
    sectionBox.replaceChildren(
      h("div", { class: "chip-list" }, ...SECTION_AXES.map((option) => h("button", {
        class: option.axis === current.axis ? "chip on" : "chip", type: "button",
        onClick: () => {
          const center = index.terms[selected?.id ?? "heart"]?.center ?? index.terms.heart.center;
          section = { axis: option.axis, at: center["xyz".indexOf(option.axis)], keep: option.keep };
          viewer.setSection(section);
          faceSection();
          renderSection();
        },
      }, option.label))),
      h("label", { class: "section-slider" }, h("span", {}, ends[0]), slider, h("span", {}, ends[1])),
      h("div", { class: "nav-row" },
        h("button", { class: "ghost-button", type: "button", onClick: () => { section = { ...current, keep: current.keep === 1 ? -1 : 1 }; viewer.setSection(section); faceSection(); renderSection(); } }, "反対側を残す"),
        h("button", { class: "ghost-button", type: "button", onClick: faceSection }, "切り口を正面に"),
      ),
      current.axis === "y" ? h("p", { class: "muted" }, current.keep === 1 ? "下から見ています（CTと同じ向き：前が上、本人の右が左）。" : "上から見ています（前が上、本人の右が右）。") : "",
    );
  };

  const select = (term: Term | null) => {
    selected = term;
    // 隠れた部位と骨・器官の部位は周りを半透明にして見せる（断面のときは切り口で見えるので薄くしない）
    isolate = !section && (!!term?.xray || !!term?.of);
    attach = false;
    group = [];
    paint();
    viewer.setLabel(term?.id ?? null, term?.ja ?? "");
    if (term) {
      // 基本の用語（方向・面・運動）は骨格の上に図を描く
      const system = term.figure ? "skeletal" : term.system;
      if (!shown.has(system)) {
        shown.add(system);
        void apply();
      }
      if (!section) viewer.focus(term.id, 3.2);
      void speak(term);
    }
    render();
    // 一覧や部位の一覧から選んだとき、説明が見えるように上へ戻す（スマホでは画面全体、PCでは右の欄）
    panel.scrollTop = 0;
    window.scrollTo({ top: 0 });
  };

  const showGroup = (list: Term[]) => {
    group = list;
    for (const term of list) shown.add(term.system);
    void apply();
    viewer.overview();
    render();
  };

  const search = h("input", { class: "search", type: "search", placeholder: "日本語・読み・英語・ラテン語で検索", "aria-label": "検索" });
  const list = h("ul", { class: "term-list" });
  const detail = h("div", { class: "detail" });

  const chips = (items: Term[]) => h("div", { class: "chip-list" },
    ...items.map((item) => h("button", { class: "chip", type: "button", onClick: () => select(item) }, item.ja)));

  const render = () => {
    const query = search.value.trim().toLowerCase();
    // 骨・器官の部位は一覧が長くなるので、検索したときと骨・器官を選んだときだけ出す
    const matches = terms.filter((term) =>
      (query ? [term.ja, term.yomi, term.en, term.la ?? "", ...(term.enAlt ?? [])].some((text) => text.toLowerCase().includes(query)) : !term.of && shown.has(term.system)));
    list.replaceChildren(...matches.map((term) => h("li", {},
      h("button", { type: "button", class: term === selected ? "term-row on" : "term-row", onClick: () => select(term) },
        h("span", {}, term.ja), h("span", { class: "en", lang: "en" }, term.en)))));
    if (!selected) {
      detail.replaceChildren(h("p", { class: "muted" }, section ? "切り口や3Dの部位をタップするか、下の一覧から選んでください。" : "3Dの部位をタップするか、下の一覧から選んでください。"));
      return;
    }
    const term = selected;
    const parts = landmarksOf(term.id);
    const parent = term.of ? termById.get(term.of) : null;
    const attachable = !!(term.originAt?.length || term.insertionAt?.length || viewer.hasAttachments(term.id));
    const related = relatedTerms(term, attachments).filter((relation) => relation.list.length);
    detail.replaceChildren(h("div", {},
      termCard(term, { open: select }),
      parts.length ? h("h3", {}, `${term.ja}の部位`) : "",
      parts.length ? chips(parts) : "",
      ...related.flatMap((relation) => [
        h("h3", {}, `${relation.title}（${relation.list.length}）`),
        chips(relation.list),
        relation.group ? h("button", {
          class: group.length ? "ghost-button on" : "ghost-button", type: "button",
          onClick: () => (group.length ? select(term) : showGroup(relation.list)),
        }, group.length ? "神経だけを見る" : "支配する筋をまとめて3Dで見る（神経は黄）") : "",
      ]),
      h("div", { class: "nav-row" },
        parent ? h("button", { class: "ghost-button", type: "button", onClick: () => select(parent) }, `${parent.ja}を見る`) : null,
        attachable ? h("button", {
          class: attach ? "ghost-button on" : "ghost-button", type: "button",
          onClick: () => {
            attach = !attach;
            paint();
            render();
          },
        }, attach ? "起始・停止を隠す" : "起始・停止を骨で見る") : null,
        !parent && !attachable && !term.figure ? h("button", {
          class: "ghost-button", type: "button",
          onClick: () => {
            isolate = !isolate;
            paint();
            render();
          },
        }, isolate ? "まわりも表示" : "この部位だけ表示") : null,
        h("button", { class: "ghost-button", type: "button", onClick: () => { select(null); if (section) viewer.viewSection(); else viewer.overview(); } }, "選択をやめる"),
      )));
  };
  search.addEventListener("input", render);

  viewer.onPick = (elementId, point) => {
    const termId = elementId ? viewer.termsOf(elementId)[0] : null;
    // 骨・器官の部位（ピン）の上をタップしたら、骨・器官ではなく部位を選ぶ
    const parts = elementId && point ? terms.filter((term) => term.of && pins[term.id] && index.terms[term.id]?.elements.includes(elementId)) : [];
    const part = point ? landmarkAt(point, parts, 0.002) : null;
    select(part ?? (termId ? termById.get(termId) ?? null : null));
  };
  ctx.hint("タップで名前を表示");
  panel.replaceChildren(sectionBox, detail, search, list);
  render();
  await apply();
  if (opened) select(opened);
}
