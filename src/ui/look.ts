import { systemById, systems, termById, type OrganCore, type Term } from "../content";
import { courseUnitOf, courseUnits, inCourse, pointOf } from "../course";
import { h } from "../dom";
import { noteText } from "../en-notes";
import { markOf, recentTerms, starredIds } from "../marks";
import { foldKeep, lookup, romajiToKana, suggest, type Hit } from "../search";
import { figureHref, findFigures, findOrgans, organThumb, type FigureHit } from "../organ-figures";
import { figureThumbElement } from "./figure-strip";
import type { AppContext } from "./context";
import { itemRow } from "./study-hub";
import { tabIntro } from "./tab-intro";

/** 一度に出す結果の数（「さらに表示」で全部） */
const FIRST_RESULTS = 40;

/** 最後に打った言葉。図鑑で語を見て「‹ 調べる」で戻ったとき、同じ結果から続けられるように（アプリを開いている間だけ） */
let lastQuery = "";

/**
 * 調べる（#/look）: どこからでもすぐ1語を引く（実習・講義の間に。docs/普段使い.md「調べるの見直し」）。
 * 日本語・読み・英語・ラテン語・ローマ字の読み・自分のメモで探し、当たり方のよい順に、語の「覚えること」を添えて並べる。
 * コースの外の語も引ける（コースの語の後に「コースの外」の札を付けて）。見つからなければ「もしかして」。
 * 何も打っていないときは、最近見た語・★を付けた語・系統から探す（#/look/<系統ID>）・図鑑と臓器の図。
 * 語を選ぶと図鑑のその語を3Dで開く。上の帯の虫めがねと / キーからもここへ来る
 */
export async function look(ctx: AppContext, systemId = ""): Promise<void> {
  ctx.fold(true);
  ctx.hint("");
  void ctx.viewer.show({ systems: ["skeletal"], body: true });
  ctx.viewer.highlight([]);
  ctx.viewer.overview();
  if (systemId) return lookSystem(ctx, systemId);

  const results = h("div", { class: "look-results", hidden: true });
  const rest = h("div", { class: "look-rest" });
  const search = h("input", {
    class: "search", type: "search", placeholder: "日本語・読み・英語で探す", "aria-label": "語を探す", enterkeyhint: "search",
    autocomplete: "off", autocapitalize: "off", spellcheck: "false",
    onInput: () => show(),
  }) as HTMLInputElement;
  /** 矢印キーで選んでいる結果の行（Enter で開く） */
  let active = 0;
  // 矢印キーと Enter は語の行だけ（上の臓器の図の行は押して開く。Enter はこれまでどおりいちばん当たった語を開く）
  const links = () => [...results.querySelectorAll<HTMLAnchorElement>("a.look-row:not(.fig-row, .look-more-row)")];
  const setActive = (index: number) => {
    const list = links();
    if (!list.length) return;
    active = (index + list.length) % list.length;
    list.forEach((link, i) => link.classList.toggle("active", i === active));
    list[active].scrollIntoView({ block: "nearest" });
  };
  const show = (all = false) => {
    const query = search.value.trim();
    lastQuery = query;
    results.hidden = !query;
    rest.hidden = !!query;
    if (!query) return;
    const hits = lookup(query, { all: true, memo: (id) => markOf(id).memo });
    const marks = markers(query);
    active = 0;
    const figures = figureBlock(query, !hits.length);
    if (!hits.length) {
      const near = suggest(query);
      results.replaceChildren(
        figures,
        h("p", { class: "look-count" }, `「${query}」という語は見つかりませんでした。`),
        near.length ? h("h3", { class: "list-title" }, "もしかして") : "",
        near.length ? h("ul", { class: "home-card look-list" }, ...near.map((term) => lookRow({ term, score: 0, via: "ja", inCourse: inCourse(term.id) }, []))) : "",
        h("p", { class: "home-note" }, "漢字・ひらがな・英語・ラテン語のどれでも、字の一部だけでも探せます（「じょうわん」「brach」など）。読みはローマ字（jouwan）でも。"),
      );
      return;
    }
    const shown = all ? hits : hits.slice(0, FIRST_RESULTS);
    const outside = hits.filter((hit) => !hit.inCourse).length;
    results.replaceChildren(
      figures,
      h("p", { class: "look-count" }, `${hits.length}語`, outside ? h("span", { class: "muted" }, `（うちコースの外 ${outside}語）`) : ""),
      h("ul", { class: "home-card look-list" }, ...shown.map((hit) => lookRow(hit, marks))),
      shown.length < hits.length ? h("button", { class: "ghost-button look-more", type: "button", onClick: () => show(true) }, `さらに ${hits.length - shown.length}語を表示`) : "",
    );
    if (document.activeElement === search) setActive(0);
  };
  search.addEventListener("keydown", (event) => {
    if (event.isComposing) return;
    // ↑↓ で結果を選び、決める Enter（日本語入力の変換中は除く）で開く
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setActive(active + (event.key === "ArrowDown" ? 1 : -1));
    } else if (event.key === "Enter") {
      const link = links()[active];
      if (link) location.hash = link.getAttribute("href")!;
    } else if (event.key === "Escape" && search.value) {
      search.value = "";
      show();
    }
  });

  const intro = await tabIntro("look");
  if (ctx.signal.aborted) return;
  rest.replaceChildren(...restSections());

  ctx.panel.replaceChildren(h("div", { class: "home look" },
    h("div", { class: "tab-head" }, h("h2", {}, "調べる")),
    intro,
    search, results, rest,
  ));
  // 図鑑から戻ったときは、前に打った言葉の結果のまま
  if (lastQuery) {
    search.value = lastQuery;
    show();
  }
  // キーボードのある端末では、すぐ打てるように検索欄へ（スマホでは画面のキーボードが急に出ないよう、押してから）
  if (matchMedia("(hover: hover) and (pointer: fine)").matches) {
    search.focus({ preventScroll: true });
    search.select();
    if (lastQuery) setActive(0);
  }
}

/** 何も打っていないときの欄: 最近見た語・★を付けた語・系統から探す・3Dで調べる */
function restSections(): (HTMLElement | "")[] {
  const recent = recentTerms().flatMap((id) => termById.get(id) ?? []);
  const starred = starredIds().flatMap((id) => termById.get(id) ?? []).sort((a, b) => a.yomi.localeCompare(b.yomi, "ja"));
  const units = courseUnits();
  const tiles = systems.flatMap((system) => {
    const count = units.filter((unit) => unit.system === system.id).reduce((sum, unit) => sum + unit.terms.length, 0);
    return count ? [h("a", { class: "look-system", href: `#/look/${system.id}`, style: `--system:${system.color}` },
      h("span", { class: "look-system-name" }, system.ja), h("span", { class: "look-system-count" }, `${count}語`))] : [];
  });
  return [
    recent.length ? h("h3", { class: "list-title" }, "最近見た語") : "",
    recent.length ? h("div", { class: "chip-list look-recent" }, ...recent.map((term) => h("a", { class: "chip", href: `#/explore/${term.id}` }, term.ja))) : "",
    starred.length ? h("h3", { class: "list-title" }, `★を付けた語（${starred.length}）`) : "",
    starred.length ? h("ul", { class: "home-card look-list" }, ...starred.map((term) => lookRow(hitOf(term), []))) : "",
    // 初心者モードで、コースの外の語に★を付けていたら知らせる
    starred.some((term) => !inCourse(term.id)) ? h("p", { class: "home-note" }, "★の中には、今のコースに入っていない語もあります。") : "",
    h("h3", { class: "list-title" }, "系統から探す"),
    h("div", { class: "look-systems" }, ...tiles),
    h("h3", { class: "list-title" }, "3Dで調べる"),
    h("ul", { class: "home-card home-list" },
      itemRow("#/explore", "explore", "#2f78b0", "図鑑", "人体を回して、タップした所の名前を見る"),
      itemRow("#/organs", "organ", "#c0504d", "臓器の図", "心臓・肺・脳などを、色分けの立体と平面図で"),
      itemRow("#/motions", "motion", "#7a4fb5", "動きの図鑑", "呼吸・心臓の拍動・刺激伝導・肺循環と体循環を動きで"),
      itemRow("#/cut", "cut", "#b8862b", "神経を切る", "神経を切ると、どの筋が止まり、どの動きができなくなるか"),
      itemRow("#/journey", "journey", "#c2493a", "からだの旅", "血液の1滴・食べ物・痛みの信号の通り道を、分かれ道ごとに選んで進む"),
    ),
    starred.length ? "" : h("p", { class: "home-note" }, "語のカードの ☆ を押すと、「★を付けた語」としてここに集まります。先生が「ここは出す」と言った語などに。"),
  ];
}

/** 系統から探す（#/look/<系統ID>）: その系統のコースの語を、レッスン（まとまり）ごとに「覚えること」と一緒に並べる。3Dは読まない */
async function lookSystem(ctx: AppContext, systemId: string): Promise<void> {
  const system = systemById.get(systemId);
  const units = courseUnits().filter((unit) => unit.system === systemId && unit.terms.length);
  if (!system || !units.length) {
    ctx.panel.replaceChildren(h("div", { class: "home look" }, h("p", { class: "muted" }, "この系統の語はありません。"), h("a", { href: "#/look" }, "調べるへ")));
    return;
  }
  const total = units.reduce((sum, unit) => sum + unit.terms.length, 0);
  const groups = [...new Set(units.map((unit) => unit.group ?? ""))];
  ctx.panel.replaceChildren(h("div", { class: "home look" },
    h("div", { class: "tab-head look-system-head", style: `--system:${system.color}` },
      h("h2", {}, system.ja), h("span", { class: "muted" }, `${units.length}レッスン・${total}語`)),
    // まとまり（骨格系の体幹・上肢など）があれば、その見出しの下にレッスンを並べる
    ...groups.flatMap((group) => [
      group ? h("h3", { class: "look-group" }, group) : "",
      ...units.filter((unit) => (unit.group ?? "") === group).flatMap((unit) => [
        h("h4", { class: "list-title" }, unit.title, h("span", { class: "muted" }, ` ${unit.terms.length}語`)),
        h("ul", { class: "home-card look-list" }, ...unit.terms.map((term) => lookRow(hitOf(term), [], false))),
      ]),
    ]),
    h("a", { class: "ghost-button look-back", href: "#/look" }, "‹ 調べるへ戻る"),
  ));
}

const hitOf = (term: Term): Hit => ({ term, score: 0, via: "ja", inCourse: inCourse(term.id) });

/** 調べるの結果の上に出す臓器の図の数 */
const FIGURE_ROWS = 2;

/**
 * 調べるの結果の上の「臓器の図」（docs/普段使い.md「平面図の探しやすさの見直し」）: 名前に当たる臓器と、題に当たる平面図（「四腔断」「ネフロン」「胎児循環」）。
 * 語の結果のじゃまにならないよう、名前・題の頭から当たったものを2つまで（語が1つも無いときは途中に当たったものも）。
 * 図に載っている部位の名前でも探せる「臓器の図で探す」へ
 */
function figureBlock(query: string, loose: boolean): HTMLElement | "" {
  const organs = findOrgans(query);
  const figures = findFigures(query).filter((hit) => !hit.byOrgan && (loose || hit.score >= 80));
  const strongOrgans = organs.filter((organ) => loose || foldKeep(organ.ja).startsWith(foldKeep(query)) || organ.yomi.startsWith(foldKeep(query)));
  const rows = [...strongOrgans.map((organ) => organRow(organ)), ...figures.map((hit) => figureRow(hit))];
  if (!rows.length) return "";
  const more = `#/organs/find/${encodeURIComponent(query)}`;
  return h("div", { class: "look-figures" },
    h("h3", { class: "list-title" }, "臓器の図"),
    h("ul", { class: "home-card look-list" }, ...rows.slice(0, FIGURE_ROWS),
      h("li", {}, h("a", { class: "look-row look-more-row", href: more }, rows.length > FIGURE_ROWS ? `ほかの図も臓器の図で探す（あと ${rows.length - FIGURE_ROWS}）` : "図に載っている部位の名前でも探す"))),
  );
}

/** 臓器の図の行（臓器の一覧の絵・名前・平面図の枚数） */
function organRow(organ: OrganCore): HTMLElement {
  const thumb = organThumb(organ);
  return h("li", {}, h("a", { class: "look-row fig-row", href: `#/organs/${organ.id}` },
    thumb ? h("span", { class: "fig-thumb" }, h("img", { src: thumb, alt: "", loading: "lazy", decoding: "async", width: "360", height: "240" })) : h("span", { class: "fig-thumb fig-thumb-3d", "aria-hidden": "true" }, "3D"),
    h("span", { class: "look-text" },
      h("span", { class: "look-ja" }, organ.ja),
      h("span", { class: "look-where" }, organ.plates.length ? `臓器の図 ・ 平面図 ${organ.plates.length}枚` : "臓器の図 ・ 立体"))));
}

/** 平面図の行（小さな絵・図の題・臓器の名前） */
function figureRow(hit: FigureHit): HTMLElement {
  return h("li", {}, h("a", { class: "look-row fig-row", href: figureHref(hit) },
    figureThumbElement(hit.plate.id),
    h("span", { class: "look-text" },
      h("span", { class: "look-ja" }, hit.plate.title),
      h("span", { class: "look-where" }, `${hit.organ.ja}の図`))));
}

/** 結果の行で太く示す文字（打った言葉と、ローマ字ならその読み） */
function markers(query: string): string[] {
  const plain = foldKeep(query).replace(/\s+/g, "");
  const kana = romajiToKana(plain);
  return [plain, ...(kana && kana.length >= 2 ? [kana] : [])].filter(Boolean);
}

/** text の中の、打った言葉に当たる所を <mark> に（表記をそろえても字数の変わらないときだけ） */
function marked(text: string, marks: string[]): (Node | string)[] {
  const folded = foldKeep(text);
  if (folded.length !== text.length) return [text];
  for (const mark of marks) {
    const at = folded.indexOf(mark);
    if (at >= 0) return [text.slice(0, at), h("mark", {}, text.slice(at, at + mark.length)), text.slice(at + mark.length)];
  }
  return [text];
}

/** 語の短い説明（覚えることがあればそれ、無ければ説明の最初の1文） */
function meaningOf(term: Term): string {
  const point = pointOf(term.id);
  if (point) return point;
  const note = noteText(term.note) ?? "";
  const end = note.indexOf("。");
  return end >= 0 ? note.slice(0, end + 1) : note;
}

/**
 * 結果・★・系統の一覧の1行: 系統の色の点・日本語と英語（当たった所を太く）・覚えること・読みと場所。
 * ラテン語・日本語と英語の別名・メモで当たったときはそれも添える。コースの外の語には札
 */
function lookRow(hit: Hit, marks: string[], where = true): HTMLElement {
  const { term } = hit;
  const system = systemById.get(term.system);
  const parent = term.of ? termById.get(term.of)?.ja : undefined;
  const memo = markOf(term.id).memo;
  const place = where ? [system?.ja ?? "", parent ? `${parent}の部位` : courseUnitOf(term.id)?.title ?? ""].filter(Boolean).join(" › ") : parent ? `${parent}の部位` : "";
  const extra = hit.via === "la" ? `ラテン ${term.la}` : hit.via === "enAlt" ? `別名 ${term.enAlt?.join("・")}` : hit.via === "jaAlt" ? `別名 ${term.jaAlt?.join("・")}` : "";
  return h("li", {}, h("a", { class: "look-row", href: `#/explore/${term.id}` },
    h("span", { class: "look-dot", style: `background:${system?.color ?? "#999"}`, "aria-hidden": "true" }),
    h("span", { class: "look-text" },
      h("span", { class: "look-ja" }, ...marked(term.ja, marks),
        h("span", { class: "look-en", lang: "en" }, ...marked(term.en, marks)),
        hit.inCourse ? "" : h("span", { class: "look-outside", title: "今のコースでは学ばない語（設定のコースで変えられます）" }, "コースの外")),
      h("span", { class: "look-meaning" }, meaningOf(term)),
      h("span", { class: "look-where" }, ...marked(term.yomi, marks), place ? ` ・ ${place}` : "", extra ? ` ・ ${extra}` : ""),
      memo ? h("span", { class: "look-memo" }, "メモ ", ...marked(memo, marks)) : "",
    ),
  ));
}
