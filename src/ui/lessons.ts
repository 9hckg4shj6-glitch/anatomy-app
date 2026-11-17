import { systems, type Unit } from "../content";
import { courseUnitOf, courseUnits, isBeginner, lessonById } from "../course";
import { db, nowIso, type LearnedTerm } from "../db";
import { h } from "../dom";
import { normalize, searchTerms, searchUnits } from "../search";
import { sceneFor, termAt, type AppContext } from "./context";

/** レッスンの一覧で最後に選んだ系統（レッスンから戻っても同じ系統を見せる） */
let shownSystem = "";

/**
 * レッスンの一覧（#/lessons）。上の系統のボタンで系統を選び、その系統の進み具合（輪）と、まとまりごとのレッスンの道すじ
 * （済み・途中・まだ）を出す。次に学ぶレッスンのあるまとまりは開いておく。検索ではレッスンの題・まとまりと語を探す。
 * "#/lessons/<系統ID>" はその系統を選んで開く
 */
export async function lessons(ctx: AppContext, systemId = ""): Promise<void> {
  ctx.fold(true);
  ctx.hint("");
  // 骨や骨の部位をタップしたら、図鑑でその語を開く
  ctx.viewer.onPick = (elementId, point) => {
    const term = termAt(ctx, elementId, point);
    if (term) location.hash = `#/explore/${term.id}`;
  };
  ctx.viewer.onHover = (elementId, point) => termAt(ctx, elementId, point)?.ja ?? null;

  const [learned, openSetting] = await Promise.all([db.learned.toArray(), db.settings.get(OPEN_FOLDERS)]);
  const learnedIds = new Set(learned.map((item) => item.termId));
  // 開いたまとまりは覚えておき、レッスンから戻ったときも開いたままにする
  const openIds = new Set(Array.isArray(openSetting?.value) ? (openSetting.value as string[]) : []);
  const nextUnit = nextLesson(learned);
  const units = courseUnits();
  const inSystems = systems.filter((system) => units.some((unit) => unit.system === system.id));
  const pick = [systemId, shownSystem, nextUnit?.system].find((id) => id && inSystems.some((system) => system.id === id)) ?? inSystems[0]?.id ?? "";
  const doneOf = (unit: Unit) => unit.terms.filter((term) => learnedIds.has(term.id)).length;

  /** レッスンの行（検索の結果）。途中まで学んだレッスンには「途中」の印 */
  const unitRow = (unit: Unit) => {
    const done = doneOf(unit);
    return h("li", {},
      h("a", { href: `#/learn/${unit.id}`, class: done === unit.terms.length ? "unit done" : done ? "unit partial" : "unit" },
        h("span", { class: "unit-title" }, unit.title),
        h("span", { class: "unit-count" }, done ? `${done}/${unit.terms.length}語` : `${unit.terms.length}語`),
      ));
  };

  // 検索: レッスンの題と語。打っている間は一覧の代わりに当たったものを並べる
  const search = h("input", {
    class: "search", type: "search", placeholder: "レッスン・語を探す", "aria-label": "レッスンと語を探す",
    oninput: () => {
      const query = normalize(search.value.trim());
      body.hidden = !!query;
      results.hidden = !query;
      if (query) showResults(query);
    },
  });
  const results = h("div", { class: "search-results", hidden: true });
  const showResults = (query: string) => {
    const lessons = searchUnits(query);
    const found = searchTerms(query);
    results.replaceChildren(
      lessons.length ? h("h3", {}, `レッスン ${lessons.length}`) : "",
      lessons.length ? h("ul", { class: "units" }, ...lessons.slice(0, 20).map(unitRow)) : "",
      found.length ? h("h3", {}, `語 ${found.length}`, found.length > 40 ? h("span", { class: "muted" }, "（はじめの40）") : "") : "",
      found.length ? h("ul", { class: "term-list" }, ...found.slice(0, 40).map((term) => h("li", {},
        h("a", { class: "term-row", href: `#/explore/${term.id}` },
          h("span", {}, term.ja, h("span", { class: "term-where" }, `${systems.find((s) => s.id === term.system)?.ja ?? ""}・${unitTitle(term.id)}`)),
          h("span", { class: "en", lang: "en" }, term.en))))) : "",
      lessons.length || found.length ? "" : h("p", { class: "muted" }, "見つかりませんでした。"),
    );
  };

  const chips = h("div", { class: "system-chips", role: "tablist", "aria-label": "系統" });
  const body = h("div", {});
  const choose = (id: string) => {
    shownSystem = id;
    for (const chip of chips.querySelectorAll<HTMLButtonElement>(".chip")) {
      const on = chip.dataset.key === id;
      chip.classList.toggle("on", on);
      chip.setAttribute("aria-selected", String(on));
    }
    body.replaceChildren(...systemView(id));
    // 3Dにはその系統を見せる（スマホではたたんでいる）
    void ctx.viewer.show(sceneFor(id)).then(() => {
      if (!ctx.signal.aborted) ctx.viewer.highlight([]);
    });
    ctx.viewer.overview();
  };
  chips.append(...inSystems.map((system) => h("button", {
    class: "chip", type: "button", role: "tab", "data-key": system.id, onClick: () => choose(system.id),
  }, h("span", { class: "swatch", style: `background:${system.color}` }), system.ja.replace(/系$/, ""))));

  /** 系統の札（進み具合の輪）と、まとまりごとのレッスンの道すじ */
  const systemView = (id: string): HTMLElement[] => {
    const system = systems.find((item) => item.id === id)!;
    const list = units.filter((unit) => unit.system === id);
    const total = list.reduce((sum, unit) => sum + unit.terms.length, 0);
    const done = list.reduce((sum, unit) => sum + doneOf(unit), 0);
    const share = total ? done / total : 0;
    const card = h("section", { class: "home-card system-card" },
      ring(share, system.color),
      h("div", {}, h("b", { class: "system-card-name" }, system.ja),
        h("span", { class: "muted" }, `${done ? `${done.toLocaleString()} / ` : ""}${total.toLocaleString()}語・${list.length}レッスン`)),
    );
    const path = (inList: Unit[]) => h("ol", { class: "home-card lesson-path" }, ...inList.map((unit, i) => {
      const n = doneOf(unit);
      const state = n === unit.terms.length ? "done" : n ? "partial" : "todo";
      const isNext = unit === nextUnit;
      return h("li", {}, h("a", { class: `path-row ${state}${isNext ? " next" : ""}`, href: `#/learn/${unit.id}` },
        h("span", { class: "path-mark", "aria-hidden": "true" }, state === "done" ? "✓" : String(i + 1)),
        h("span", { class: "path-text" },
          h("span", { class: "path-title" }, unit.title),
          h("span", { class: "path-sub" }, state === "done" ? `${unit.terms.length}語・済み` : n ? `${n} / ${unit.terms.length}語・途中` : `${unit.terms.length}語`)),
        isNext ? h("span", { class: "path-next" }, n ? "続き" : "次") : "",
      ));
    }));
    const groups = [...new Set(list.map((unit) => unit.group))];
    if (!groups[0]) return [card, path(list)];
    return [card, ...groups.map((group) => {
      const inGroup = list.filter((unit) => unit.group === group);
      const key = `${id}/${group}`;
      const finished = inGroup.filter((unit) => doneOf(unit) === unit.terms.length).length;
      const open = openIds.has(key) || inGroup.includes(nextUnit!) || groups.length === 1;
      return h("details", {
        class: "path-group", open,
        ontoggle: (event: Event) => {
          if ((event.currentTarget as HTMLDetailsElement).open) openIds.add(key);
          else openIds.delete(key);
          void db.settings.put({ key: OPEN_FOLDERS, value: [...openIds], updatedAt: nowIso() });
        },
      },
        h("summary", {}, h("span", { class: "path-group-name" }, group ?? ""),
          h("span", { class: "muted" }, finished ? `${finished} / ${inGroup.length} レッスン` : `${inGroup.length}レッスン`)),
        path(inGroup));
    })];
  };

  ctx.panel.replaceChildren(
    search,
    h("div", { class: "tab-head" }, h("h2", {}, "レッスン")),
    chips,
    results,
    body,
    isBeginner()
      ? h("p", { class: "muted lessons-note" }, "「はじめての解剖」のコースのレッスンです（最低限覚える語だけ）。全部の語は ", h("a", { href: "#/settings" }, "設定"), " でコースを変えると学べます。")
      : "",
  );
  choose(pick);
  chips.querySelector(".chip.on")?.scrollIntoView({ block: "nearest", inline: "center" });
}

/** 進み具合の輪（SVG。真ん中に %） */
function ring(share: number, color: string): SVGElement {
  const r = 23;
  const length = 2 * Math.PI * r;
  const box = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  box.setAttribute("viewBox", "0 0 56 56");
  box.setAttribute("class", "progress-ring");
  box.setAttribute("role", "img");
  box.setAttribute("aria-label", `${Math.floor(share * 100)}%`);
  box.innerHTML = `<circle cx="28" cy="28" r="${r}" fill="none" stroke="var(--ring-track)" stroke-width="6"/>`
    + `<circle cx="28" cy="28" r="${r}" fill="none" stroke="${color}" stroke-width="6" stroke-linecap="round" stroke-dasharray="${(share * length).toFixed(1)} ${length.toFixed(1)}" transform="rotate(-90 28 28)" style="filter:brightness(0.85) saturate(1.2)"/>`
    + `<text x="28" y="33" text-anchor="middle" font-size="14" font-weight="800" fill="currentColor">${Math.floor(share * 100)}%</text>`;
  return box;
}

const OPEN_FOLDERS = "homeOpenFolders";

/**
 * 次に学ぶレッスン（ホーム・レッスンの一覧と、復習・レッスンの終わりに出す）。最後に学んだレッスンが途中ならそれ、終えていれば
 * 同じまとまり→同じ系統の、後ろにあるまだ終えていないレッスン。何も学んでいなければ最初のレッスン。
 */
export function nextLesson(learned: LearnedTerm[]): Unit | undefined {
  const units = courseUnits();
  const learnedIds = new Set(learned.map((item) => item.termId));
  const open = (unit: Unit) => unit.terms.some((term) => !learnedIds.has(term.id));
  const last = recentLessons(learned)[0];
  if (last) {
    if (open(last)) return last;
    const after = units.slice(units.indexOf(last) + 1);
    const next = after.find((unit) => open(unit) && unit.system === last.system && unit.group === last.group)
      ?? after.find((unit) => open(unit) && unit.system === last.system)
      ?? units.find((unit) => open(unit) && unit.system === last.system);
    if (next) return next;
  }
  return units.find(open);
}

/**
 * 最近学んだレッスン（新しい順に3つまで）。記録のレッスンIDは並べ直しで変わるので、語から今のモードのレッスンを引く
 * （初心者モードでは初心者コースのレッスン。コースの外の語は数えない）
 */
function recentLessons(learned: LearnedTerm[]): Unit[] {
  const latest = new Map<string, string>();
  for (const item of learned) {
    const unit = courseUnitOf(item.termId)?.id;
    if (unit && (latest.get(unit) ?? "") < item.learnedAt) latest.set(unit, item.learnedAt);
  }
  return [...latest].sort((a, b) => b[1].localeCompare(a[1])).slice(0, 3).flatMap(([id]) => lessonById.get(id) ?? []);
}

/** 検索の結果に添えるレッスンの名前（今のモードで語の入るレッスン） */
function unitTitle(termId: string): string {
  return courseUnitOf(termId)?.title ?? "";
}
