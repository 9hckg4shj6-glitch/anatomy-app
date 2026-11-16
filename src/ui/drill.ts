import { systems, termById, type Term, type Unit } from "../content";
import { courseTerms, courseUnitOf, courseUnits, isBeginner, studyFacets } from "../course";
import { db, type LearnedTerm } from "../db";
import { starredIds } from "../marks";
import { h } from "../dom";
import { retrievability } from "../fsrs";
import { normalize, searchTerms, searchUnits } from "../search";
import { BASIC_FACETS, facetsFor, practiceQueue, TERM_KINDS, type PracticeCandidate } from "../study";
import type { AppContext } from "./context";
import { ask, showPanel } from "./quiz";
import { ICONS, itemRow } from "./study-hub";

const COUNTS = [10, 20, 40];

/** 範囲のチェック。ids はその下の語、count は「選んだ数/語の数」を出す所 */
interface RangeBox {
  box: HTMLInputElement;
  ids: string[];
  count?: HTMLElement;
}

/**
 * 演習（#/drill）。入口では「終えたレッスンから選ぶ」を一番上に、その下に苦手な語・★を付けた語・範囲を細かく選ぶ。
 * おまかせ（学んでいない所からも出す）はしない。知識の足りない人に、知らない語ばかり出さないため（docs/普段使い.md）。
 * "#/drill/weak" は苦手な順・"#/drill/stars" は★の語・"#/drill/term/<語ID>" はその語の問い方を、すぐに解く。
 * "#/drill/custom" は今までの範囲を細かく選ぶ画面。
 *
 * 範囲を細かく選ぶ：範囲（系統→まとまり→レッスン→語のチェック）と問い方を選んで解く（試験前の総ざらい）。
 * レッスンでまだ学んでいない語も選べる（初めに選んでおくのは学んだ語）。
 * mode が "weak" なら苦手な順に出す。答えは復習と同じく記録し、次に出る日にも反映する。
 * 初心者モードでは範囲は初心者コースのレッスンと語、問い方は基本の4つから。
 */
export async function drill(ctx: AppContext, mode: string): Promise<void> {
  const { viewer } = ctx;
  ctx.fold(true);
  viewer.highlight([]);
  viewer.overview();
  ctx.hint("");
  const [learned, schedules] = await Promise.all([db.learned.toArray(), db.schedules.toArray()]);
  const learnedIds = new Set(learned.map((item) => item.termId));
  // 覚え具合は解くたびに変わるので、「もう一度」のときに読み直す
  let scheduleOf = new Map(schedules.map((s) => [s.cardId, s]));
  const reload = async () => {
    scheduleOf = new Map((await db.schedules.toArray()).map((s) => [s.cardId, s]));
  };
  const terms = courseTerms();
  const units = courseUnits();
  const learnedTerms = terms.filter((term) => learnedIds.has(term.id));
  // 初心者モードでは、筋の起始・停止などと通るものは選べない（詳細モードで）
  const offered = isBeginner() ? TERM_KINDS.filter((kind) => kind.facets.every((facet) => BASIC_FACETS.includes(facet))) : TERM_KINDS;

  /** 選んだ語（初めは学んだ語すべて） */
  const selected = new Set(learnedTerms.map((term) => term.id));
  // 問い方は、設定の「学ぶ問い方」で選んだものから始める（演習では外したものも選べる）
  const studied = offered.filter((kind) => kind.facets.some((facet) => studyFacets().includes(facet)));
  const kinds = new Set((studied.length ? studied : offered).map((kind) => kind.key));
  let count = 20;
  let weak = false;
  let note = "";

  // 演習では筋の3つと通るものも、場所を覚える前から出す（解く順は自分で決める）
  const candidates = (): PracticeCandidate[] => terms
    .filter((term) => selected.has(term.id))
    .flatMap((term) => facetsFor(term, true)
      .filter((facet) => TERM_KINDS.some((kind) => kinds.has(kind.key) && kind.facets.includes(facet)))
      .map((facet) => {
        const schedule = scheduleOf.get(`${term.id}:${facet}`);
        return { termId: term.id, facet, recall: retrievability(schedule), lapses: schedule?.lapses ?? 0 };
      }))
    // 苦手な順のときは、一度は解いたことのある問い方から選ぶ
    .filter((c) => !weak || c.recall !== null);

  // 範囲: 系統・まとまり・レッスン・語のチェック。一部だけ選んだものは「−」にする
  const boxes: RangeBox[] = [];
  /** 検索で当たったもののチェック（打ち直すたびに作り直す） */
  let foundBoxes: RangeBox[] = [];
  const checkbox = (list: RangeBox[], ids: string[], label: string, count?: HTMLElement): HTMLInputElement => {
    const box = h("input", {
      type: "checkbox", "aria-label": label,
      onChange: () => {
        for (const id of ids) {
          if (box.checked) selected.add(id);
          else selected.delete(id);
        }
        refresh();
      },
    });
    list.push({ box, ids, count });
    return box;
  };
  const idsOf = (list: Term[]) => list.map((term) => term.id);
  /** 語の行（押すとチェックが切り替わる） */
  const termRow = (list: RangeBox[], term: Term, where = "") => h("li", {},
    h("label", { class: "range-term" },
      checkbox(list, [term.id], term.ja),
      h("span", {}, term.ja, where ? h("span", { class: "term-where" }, where) : "",
        learnedIds.has(term.id) ? h("span", { class: "term-where" }, "学んだ") : ""),
      h("span", { class: "en", lang: "en" }, term.en)));
  /** フォルダー（系統・まとまり・レッスン）。チェックは選ぶだけ、名前を押すと開く */
  const folder = (list: RangeBox[], ids: string[], title: (Node | string)[], kind: string, content: HTMLElement) => {
    const counter = h("span", { class: "folder-count" });
    return h("details", { class: `${kind} range-folder` },
      h("summary", {},
        // チェックを label で包む（押しやすくし、押してもフォルダーは開かない）
        h("label", { class: "range-check" },
          checkbox(list, ids, title.map((part) => (typeof part === "string" ? part : "")).join(""), counter)),
        h("span", { class: "folder-title" }, ...title),
        counter),
      content);
  };
  const lessonFolder = (list: RangeBox[], unit: Unit, where = "") => {
    const inUnit = unit.terms;
    return h("li", {}, folder(list, idsOf(inUnit),
      [unit.title, where ? h("span", { class: "term-where" }, where) : ""], "subfolder range-lesson",
      h("ul", { class: "term-list" }, ...inUnit.map((term) => termRow(list, term)))));
  };

  const tree = h("div", { class: "range-tree" }, ...systems.flatMap((system) => {
    const list = units.filter((unit) => unit.system === system.id && unit.terms.length);
    if (!list.length) return [];
    const lessonList = (inList: typeof list) => h("ul", { class: "units" }, ...inList.map((unit) => lessonFolder(boxes, unit)));
    // まとまり（骨格系の体幹・上肢など）のある系統は、系統→まとまり→レッスンの入れ子にする
    const groups = [...new Set(list.map((unit) => unit.group))];
    const content = groups[0]
      ? h("div", { class: "subfolders" }, ...groups.map((group) => {
        const inGroup = list.filter((unit) => unit.group === group);
        return folder(boxes, idsOf(inGroup.flatMap((unit) => unit.terms)), [group ?? ""], "subfolder", lessonList(inGroup));
      }))
      : lessonList(list);
    return [folder(boxes, idsOf(list.flatMap((unit) => unit.terms)),
      [h("span", { class: "swatch", style: `background:${system.color}` }), system.ja], "folder", content)];
  }));

  // 検索: レッスンの題と語。打っている間は一覧の代わりに当たったものを並べる
  const results = h("div", { class: "range-tree search-results", hidden: true });
  const search = h("input", {
    class: "search", type: "search", placeholder: "レッスン・語を探して選ぶ", "aria-label": "演習するレッスンと語を探す",
    onInput: () => {
      const query = normalize(search.value.trim());
      tree.hidden = !!query;
      results.hidden = !query;
      foundBoxes = [];
      if (!query) return results.replaceChildren();
      const lessons = searchUnits(query).filter((unit) => unit.terms.length);
      const found = searchTerms(query);
      const where = (term: Term) => `${systems.find((s) => s.id === term.system)?.ja ?? ""}・${courseUnitOf(term.id)?.title ?? ""}`;
      results.replaceChildren(
        lessons.length ? h("h3", {}, `レッスン ${lessons.length}`) : "",
        lessons.length ? h("ul", { class: "units" }, ...lessons.slice(0, 20).map((unit) =>
          lessonFolder(foundBoxes, unit, systems.find((s) => s.id === unit.system)?.ja ?? ""))) : "",
        found.length ? h("h3", {}, `語 ${found.length}`, found.length > 40 ? h("span", { class: "muted" }, "（はじめの40）") : "") : "",
        found.length ? h("ul", { class: "term-list" }, ...found.slice(0, 40).map((term) => termRow(foundBoxes, term, where(term)))) : "",
        lessons.length || found.length ? "" : h("p", { class: "muted" }, "見つかりませんでした。"),
      );
      refresh();
    },
  });

  const summary = h("p", { class: "range-summary" });
  const status = h("p", {});
  const start = h("button", { class: "primary", type: "button", "data-key": "start" }, "始める");
  // 演習の途中でほかの画面へ移ると、出題の待ちが中断される（画面を離れただけなのでエラーにしない）
  start.addEventListener("click", () => void run(practiceQueue(candidates(), count, weak)).catch((error) => {
    if (!ctx.signal.aborted) throw error;
  }));
  /** 選んだ語が変わったら、チェックと数・「始める」を合わせる（一覧は作り直さないので、開いたフォルダーとスクロールはそのまま） */
  const refresh = () => {
    for (const { box, ids, count: counter } of [...boxes, ...foundBoxes]) {
      const on = ids.filter((id) => selected.has(id)).length;
      box.checked = on === ids.length;
      box.indeterminate = on > 0 && on < ids.length;
      if (counter) counter.textContent = on && on < ids.length ? `${on}/${ids.length}語` : `${ids.length}語`;
    }
    const learnedOn = learnedTerms.filter((term) => selected.has(term.id)).length;
    summary.textContent = selected.size === terms.length ? `すべての語（${terms.length}語）`
      : `${selected.size}語を選んでいます（全 ${terms.length}語のうち${learnedTerms.length ? `。学んだ語 ${learnedOn}/${learnedTerms.length}` : ""}）`;
    const pool = candidates();
    start.disabled = !pool.length;
    start.textContent = pool.length ? `始める（${Math.min(count, pool.length)}問）` : "始める";
    status.className = pool.length ? "muted" : "drill-note";
    status.textContent = pool.length ? `${pool.length}問の中から出します。答えは復習の記録にも入り、次に出る日が変わります。`
      : !selected.size ? "範囲を選んでください。"
        : weak ? "苦手な順は、一度でも解いた問題から選びます。選んだ範囲で解いた問題がまだありません（「まぜる」なら解けます）。"
          : "選んだ範囲に、この問い方の問題がありません。";
  };

  // 最後の1つは消せない（何も出せなくなるので）。押したら理由を出す
  const toggle = (set: Set<string>, key: string) => {
    note = "";
    if (set.has(key) && set.size === 1) note = "少なくとも1つは選んでおきます。ほかを選んでから外してください。";
    else if (set.has(key)) set.delete(key);
    else set.add(key);
  };
  const chips = (items: { key: string; label: string }[], isOn: (key: string) => boolean, onClick: (key: string) => void) =>
    h("div", { class: "chip-list" }, ...items.map((item) =>
      h("button", {
        class: isOn(item.key) ? "chip on" : "chip", type: "button", "data-key": item.key, "aria-pressed": String(isOn(item.key)),
        onClick: () => { onClick(item.key); render(item.key); },
      }, item.label)));
  const rangeButton = (key: string, label: string, ids: () => string[]) => h("button", {
    class: "text-button", type: "button", "data-key": key,
    onClick: () => {
      selected.clear();
      for (const id of ids()) selected.add(id);
      refresh();
    },
  }, label);

  /** 画面を組み立てる。focusKey があれば（チップを押したとき）、スクロールを保ち、押したチップにフォーカスを残す */
  const render = (focusKey?: string) => {
    const nodes = [
      h("h2", {}, weak ? "苦手な語を解く" : "範囲を細かく選ぶ"),
      h("h3", {}, "範囲"),
      summary,
      h("div", { class: "range-actions" },
        rangeButton("all", "すべて選ぶ", () => idsOf(terms)),
        learnedTerms.length ? rangeButton("learned", "学んだ語だけ", () => idsOf(learnedTerms)) : "",
        rangeButton("none", "すべて外す", () => [])),
      search,
      results,
      tree,
      h("p", { class: "muted" }, "系統・まとまり・レッスンを開くと、レッスンや語を1つずつ選べます。レッスンでまだ学んでいない語も選べます。"),
      h("h3", {}, "問い方"),
      chips(offered.map((kind) => ({ key: kind.key, label: kind.label })), (key) => kinds.has(key), (key) => toggle(kinds, key)),
      h("h3", {}, "問題の数"),
      chips(COUNTS.map((n) => ({ key: String(n), label: `${n}問` })), (key) => key === String(count), (key) => (count = Number(key))),
      h("h3", {}, "出し方"),
      chips([{ key: "mix", label: "まぜる" }, { key: "weak", label: "苦手な順" }], (key) => (key === "weak") === weak, (key) => (weak = key === "weak")),
      note ? h("p", { class: "drill-note" }, note) : "",
      status,
      h("div", { class: "panel-foot" }, start),
    ];
    if (!focusKey) showPanel(ctx, ...nodes);
    else {
      const [panelTop, pageTop] = [ctx.panel.scrollTop, window.scrollY];
      ctx.panel.replaceChildren(...nodes);
      ctx.panel.scrollTop = panelTop;
      window.scrollTo({ top: pageTop });
      ctx.panel.querySelector<HTMLElement>(`[data-key="${focusKey}"]`)?.focus({ preventScroll: true });
    }
    refresh();
  };

  const run = async (queue: ReturnType<typeof practiceQueue>) => {
    ctx.fold(false);
    const missed = new Set<string>();
    let correct = 0;
    for (const [i, item] of queue.entries()) {
      const outcome = await ask(ctx, item, "practice", `演習 ${i + 1} / ${queue.length}`);
      if (outcome === "correct") correct++;
      else missed.add(item.termId);
    }
    viewer.setLabel(null);
    viewer.highlight([...missed]);
    viewer.overview();
    ctx.hint("");
    // 同じ条件でもう一度（覚え具合を読み直してから選ぶ）。条件を変えるときは設定の画面へ
    const again = h("button", {
      class: "primary", type: "button", onClick: () => void reload().then(() => run(practiceQueue(candidates(), count, weak))).catch((error) => {
        if (!ctx.signal.aborted) throw error;
      }),
    }, "同じ条件でもう一度");
    const change = h("button", { class: "text-button", type: "button", onClick: () => void reload().then(() => render()) }, "条件を変える");
    showPanel(ctx,
      h("h2", {}, "演習おわり"),
      h("p", { class: "today-count" }, `${correct} / ${queue.length} 正解`),
      missed.size ? h("h3", {}, "まちがえた語（図鑑で見る）") : "",
      missed.size ? h("div", { class: "chip-list" }, ...[...missed].map((id) =>
        h("a", { class: "chip", href: `#/explore/${id}` }, termById.get(id)?.ja ?? id))) : "",
      change,
      h("div", { class: "nav-row" }, h("a", { class: "ghost-button", href: "#/drill" }, "演習の入口へ"), again),
    );
  };

  /** 選んだ語ですぐ解く。出せる問題が無ければ、範囲を細かく選ぶ画面で理由を出す */
  const startNow = (ids: string[], options: { weak?: boolean; count?: number; allKinds?: boolean } = {}) => {
    selected.clear();
    for (const id of ids) selected.add(id);
    weak = !!options.weak;
    if (options.count) count = options.count;
    if (options.allKinds) for (const kind of offered) kinds.add(kind.key);
    const queue = practiceQueue(candidates(), count, weak);
    if (!queue.length) return render();
    void run(queue).catch((error) => {
      if (!ctx.signal.aborted) throw error;
    });
  };

  const [kind, arg] = [mode.split("/")[0], mode.split("/").slice(1).join("/")];
  if (kind === "custom") render();
  else if (kind === "weak") startNow(idsOf(learnedTerms), { weak: true });
  else if (kind === "stars") startNow(starredIds().filter((id) => terms.some((term) => term.id === id)));
  // その語の問い方をひと通り（筋なら起始・停止なども）
  else if (kind === "term" && termById.has(arg)) startNow([arg], { count: 9, allKinds: true });
  else entry(ctx, learned, startNow, () => render());
}

/**
 * 演習の入口: 終えたレッスン（学んだ語のあるレッスン。新しく学んだ順）から選んで解く。初めは最近の3つを選んでおく。
 * その下に、苦手な語・★を付けた語・範囲を細かく選ぶ
 */
function entry(ctx: AppContext, learned: LearnedTerm[], startNow: (ids: string[]) => void, custom: () => void): void {
  const learnedAt = new Map(learned.map((item) => [item.termId, item.learnedAt]));
  const latest = (unit: Unit) => unit.terms.reduce((last, term) => ((learnedAt.get(term.id) ?? "") > last ? learnedAt.get(term.id)! : last), "");
  const studied = courseUnits().filter((unit) => unit.terms.some((term) => learnedAt.has(term.id))).sort((a, b) => latest(b).localeCompare(latest(a)));
  const picked = new Set(studied.slice(0, 3).map((unit) => unit.id));
  let showAll = false;
  const stars = starredIds().filter((id) => courseTerms().some((term) => term.id === id)).length;
  const learnedOf = (unit: Unit) => unit.terms.filter((term) => learnedAt.has(term.id));

  const render = () => {
    const ids = studied.filter((unit) => picked.has(unit.id)).flatMap((unit) => learnedOf(unit).map((term) => term.id));
    const shown = showAll ? studied : studied.slice(0, 6);
    const start = h("button", { class: "primary", type: "button", disabled: !ids.length }, ids.length ? `選んだ ${ids.length}語で始める` : "レッスンを選んでください");
    start.addEventListener("click", () => startNow(ids));
    const [panelTop, pageTop] = [ctx.panel.scrollTop, window.scrollY];
    showPanel(ctx,
      h("div", { class: "tab-head" }, h("h2", {}, "演習")),
      studied.length ? h("h3", { class: "list-title" }, "終えたレッスンから選ぶ") : "",
      studied.length ? h("ul", { class: "home-card pick-list" }, ...shown.map((unit) => {
        const learnedHere = learnedOf(unit).length;
        const box = h("input", {
          type: "checkbox", checked: picked.has(unit.id),
          onChange: () => {
            if (box.checked) picked.add(unit.id);
            else picked.delete(unit.id);
            render();
          },
        }) as HTMLInputElement;
        return h("li", {}, h("label", { class: "pick-row" }, box,
          h("span", { class: "pick-title" }, unit.title, learnedHere < unit.terms.length ? h("span", { class: "muted" }, "（途中）") : ""),
          h("span", { class: "muted" }, learnedHere < unit.terms.length ? `学んだ ${learnedHere}語` : `${unit.terms.length}語`)));
      })) : h("p", { class: "home-note" }, "レッスンを1つ終えると、ここに学んだレッスンが並び、選んで解けます。まだ学んでいない語は「範囲を細かく選ぶ」で自分で選んだときだけ出します。"),
      studied.length > 6 ? h("button", { class: "text-button", type: "button", onClick: () => { showAll = !showAll; render(); } },
        showAll ? "最近の6つだけにする" : `ほかのレッスンも出す（${studied.length - 6}）`) : "",
      h("h3", { class: "list-title" }, "ほかの選び方"),
      h("ul", { class: "home-card home-list" },
        studied.length ? itemRow("#/drill/weak", "drill", "#c2493a", "苦手な語", "まちがえた語・忘れかけた語から") : "",
        stars ? itemRow("#/drill/stars", "star", "#b07d10", "★を付けた語", "自分で印を付けた語", `${stars}語`) : "",
        h("li", {}, h("button", { class: "home-item", type: "button", onClick: custom },
          markIcon("settings"),
          h("span", { class: "home-item-text" }, h("span", { class: "home-item-title" }, "範囲を細かく選ぶ"),
            h("span", { class: "home-item-sub" }, "系統・まとまり・語を自分で（学んでいない語も）")))),
      ),
      studied.length ? h("p", { class: "muted" }, "答えは復習の記録にも入り、次に出る日が変わります。") : "",
      studied.length ? start : "",
    );
    ctx.panel.scrollTop = panelTop;
    window.scrollTo({ top: pageTop });
  };
  ctx.fold(true);
  render();
}

function markIcon(icon: keyof typeof ICONS): HTMLElement {
  const mark = h("span", { class: "home-item-icon", style: "--item:#77736a", "aria-hidden": "true" });
  mark.innerHTML = `<svg viewBox="0 0 24 24">${ICONS[icon]}</svg>`;
  return mark;
}
