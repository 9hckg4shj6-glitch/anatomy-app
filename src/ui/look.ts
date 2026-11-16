import { systemById, termById, type Term } from "../content";
import { courseTerms, courseUnitOf } from "../course";
import { h } from "../dom";
import { markOf, recentTerms, starredIds } from "../marks";
import { normalize, searchTerms } from "../search";
import type { AppContext } from "./context";
import { itemRow } from "./study-hub";

/**
 * 調べる（#/look）: どこからでもすぐ1語を引く（実習・講義の間に）。検索・最近見た語・図鑑・★を付けた語。
 * 語を選ぶと図鑑のその語を3Dで開く。上の帯の虫めがねと / キーからもここへ来る
 */
export async function look(ctx: AppContext): Promise<void> {
  ctx.fold(true);
  ctx.hint("");
  void ctx.viewer.show({ systems: ["skeletal"], body: true });
  ctx.viewer.highlight([]);
  ctx.viewer.overview();

  const results = h("div", { class: "look-results", hidden: true });
  const rest = h("div", { class: "look-rest" });
  const search = h("input", {
    class: "search", type: "search", placeholder: "日本語・読み・英語・ラテン語で探す", "aria-label": "語を探す", enterkeyhint: "search",
    autocomplete: "off", autocapitalize: "off", spellcheck: "false",
    onInput: () => show(),
  }) as HTMLInputElement;
  const show = () => {
    const query = normalize(search.value.trim());
    results.hidden = !query;
    rest.hidden = !!query;
    if (!query) return;
    const found = searchTerms(query);
    results.replaceChildren(
      found.length ? h("ul", { class: "home-card look-list" }, ...found.slice(0, 50).map(lookRow)) : h("p", { class: "muted" }, "見つかりませんでした。"),
      found.length > 50 ? h("p", { class: "muted" }, `ほか ${found.length - 50}語。もう少しくわしく打つと絞れます。`) : "",
    );
  };
  search.addEventListener("keydown", (event) => {
    // 決める Enter（日本語入力の変換中は除く）で、いちばん上の語を開く
    if (event.key !== "Enter" || event.isComposing) return;
    const first = results.querySelector<HTMLAnchorElement>("a");
    if (first) location.hash = first.getAttribute("href")!;
  });

  const inCourse = new Set(courseTerms().map((term) => term.id));
  const recent = recentTerms().flatMap((id) => termById.get(id) ?? []);
  const starred = starredIds().flatMap((id) => termById.get(id) ?? []).sort((a, b) => a.yomi.localeCompare(b.yomi, "ja"));
  rest.replaceChildren(
    recent.length ? h("h3", { class: "list-title" }, "最近見た語") : "",
    recent.length ? h("div", { class: "chip-list look-recent" }, ...recent.map((term) => h("a", { class: "chip", href: `#/explore/${term.id}` }, term.ja))) : "",
    h("ul", { class: "home-card home-list" },
      itemRow("#/explore", "explore", "#2f78b0", "図鑑", "3Dを回して、タップした部位を調べる"),
    ),
    h("h3", { class: "list-title" }, `★を付けた語${starred.length ? `（${starred.length}）` : ""}`),
    starred.length
      ? h("ul", { class: "home-card look-list" }, ...starred.map(lookRow))
      : h("p", { class: "home-note" }, "語のカードの ☆ を押すと、ここに集まります。先生が「ここは出す」と言った語などに。"),
    // 初心者モードで、コースの外の語に★を付けていたら知らせる
    starred.some((term) => !inCourse.has(term.id)) ? h("p", { class: "home-note" }, "★の中には、今のコースに入っていない語もあります。") : "",
  );

  ctx.panel.replaceChildren(h("div", { class: "home look" },
    h("div", { class: "tab-head" }, h("h2", {}, "調べる")),
    search, results, rest,
  ));
  // キーボードのある端末では、すぐ打てるように検索欄へ（スマホでは画面のキーボードが急に出ないよう、押してから）
  if (matchMedia("(hover: hover) and (pointer: fine)").matches) search.focus({ preventScroll: true });
}

/** 検索結果と★の行（系統の色の点・日本語と英語・系統とレッスン・メモ） */
function lookRow(term: Term): HTMLElement {
  const system = systemById.get(term.system);
  const parent = term.of ? termById.get(term.of)?.ja : undefined;
  const memo = markOf(term.id).memo;
  return h("li", {}, h("a", { class: "look-row", href: `#/explore/${term.id}` },
    h("span", { class: "look-dot", style: `background:${system?.color ?? "#999"}`, "aria-hidden": "true" }),
    h("span", { class: "look-text" },
      h("span", { class: "look-ja" }, term.ja, h("span", { class: "look-en", lang: "en" }, term.en)),
      h("span", { class: "look-where" }, memo ? `メモ: ${memo}` : [system?.ja ?? "", parent ? `${parent}の部位` : courseUnitOf(term.id)?.title ?? ""].filter(Boolean).join(" › "))),
  ));
}
