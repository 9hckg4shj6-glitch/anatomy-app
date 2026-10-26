import { speak } from "../audio";
import { landmarksOf, pins, systems, termById, terms, type Term } from "../content";
import { h } from "../dom";
import { landmarkAt } from "../landmarks";
import type { AppContext } from "./context";
import { attachMarks } from "./quiz";
import { termCard } from "./term-card";

/** 図鑑：系統を選んで自由に回し、タップした部位や検索した語を調べる */
export async function explore(ctx: AppContext): Promise<void> {
  const { viewer, panel, tools, index } = ctx;
  const available = systems.filter((system) => index.systems[system.id]);
  const shown = new Set([available[0]?.id ?? "skeletal"]);
  let body = true;
  let selected: Term | null = null;
  let isolate = false;
  let attach = false;

  const paint = () => {
    if (selected && attach) viewer.highlight([selected.id], { isolate: true, marks: attachMarks(selected), seeThrough: true });
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
    );
  };

  const select = (term: Term | null) => {
    selected = term;
    // 隠れた部位と骨・器官の部位は周りを半透明にして見せる
    isolate = !!term?.xray || !!term?.of;
    attach = false;
    paint();
    viewer.setLabel(term?.id ?? null, term?.ja ?? "");
    if (term) {
      if (!shown.has(term.system)) {
        shown.add(term.system);
        void apply();
      }
      viewer.focus(term.id, 3.2);
      void speak(term);
    }
    render();
    // 一覧や部位の一覧から選んだとき、説明が見えるように上へ戻す（スマホでは画面全体、PCでは右の欄）
    panel.scrollTop = 0;
    window.scrollTo({ top: 0 });
  };

  const search = h("input", { class: "search", type: "search", placeholder: "日本語・読み・英語で検索", "aria-label": "検索" });
  const list = h("ul", { class: "term-list" });
  const detail = h("div", { class: "detail" });

  const chips = (items: Term[]) => h("div", { class: "chip-list" },
    ...items.map((item) => h("button", { class: "chip", type: "button", onClick: () => select(item) }, item.ja)));

  const render = () => {
    const query = search.value.trim().toLowerCase();
    // 骨・器官の部位は一覧が長くなるので、検索したときと骨・器官を選んだときだけ出す
    const matches = terms.filter((term) =>
      (query ? [term.ja, term.yomi, term.en, ...(term.enAlt ?? [])].some((text) => text.toLowerCase().includes(query)) : !term.of && shown.has(term.system)));
    list.replaceChildren(...matches.map((term) => h("li", {},
      h("button", { type: "button", class: term === selected ? "term-row on" : "term-row", onClick: () => select(term) },
        h("span", {}, term.ja), h("span", { class: "en", lang: "en" }, term.en)))));
    if (!selected) {
      detail.replaceChildren(h("p", { class: "muted" }, "3Dの部位をタップするか、下の一覧から選んでください。"));
      return;
    }
    const term = selected;
    const parts = landmarksOf(term.id);
    const parent = term.of ? termById.get(term.of) : null;
    const attachable = !!(term.originAt?.length || term.insertionAt?.length || viewer.hasAttachments(term.id));
    detail.replaceChildren(h("div", {},
      termCard(term),
      parts.length ? h("h3", {}, `${term.ja}の部位`) : "",
      parts.length ? chips(parts) : "",
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
        !parent && !attachable ? h("button", {
          class: "ghost-button", type: "button",
          onClick: () => {
            isolate = !isolate;
            paint();
            render();
          },
        }, isolate ? "まわりも表示" : "この部位だけ表示") : null,
        h("button", { class: "ghost-button", type: "button", onClick: () => { select(null); viewer.overview(); } }, "選択をやめる"),
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
  panel.replaceChildren(detail, search, list);
  render();
  await apply();
}
