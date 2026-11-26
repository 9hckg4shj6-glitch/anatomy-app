import { systems, termById, type Term, type Unit } from "../content";
import { courseTerms, courseUnitOf, courseUnits, isBeginner, studyFacets } from "../course";
import { db, nowIso, type StoredSchedule } from "../db";
import { starredIds } from "../marks";
import { h, onKeys } from "../dom";
import { retrievability } from "../fsrs";
import { normalize, searchTerms, searchUnits } from "../search";
import {
  BASIC_FACETS, facetLabels, facetsFor, KIND_HINTS, practiceQueue, shuffle, TERM_KINDS,
  type PracticeCandidate, type PracticeOrder, type QueueItem,
} from "../study";
import type { AppContext } from "./context";
import { ask, showPanel } from "./quiz";
import { card, choiceRow, foot, group, segmented } from "./settings-kit";
import { ICONS } from "./study-hub";

/** 「すべての語から選ぶ」の絵（4つのます） */
const ALL_ICON = `<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>`;

/** 問題の数（0 は全部） */
export const DRILL_COUNTS = [10, 20, 40, 0];
/** 1問にかかるおよその秒数（「約○分」の目安） */
const SECONDS_PER_QUESTION = 15;
/** 前回の条件を残す設定のキー（同期もする。docs/普段使い.md「演習の見直し」） */
export const DRILL_LAST = "drillLast";

/** 演習の条件（範囲の語・問い方・数・出し方） */
export interface DrillCondition {
  ids: Set<string>;
  kinds: Set<string>;
  count: number;
  order: PracticeOrder;
}

/**
 * 問い方の段階（docs/普段使い.md「演習の見直し」）。名前と場所 → ＋英語 → 総仕上げ。
 * その人に出せる問い方（初心者モードは基本の4つ）だけにし、前の段階と同じになる段階は出さない
 */
export const DRILL_LEVELS: { key: string; title: string; sub: string; kinds: string[] }[] = [
  { key: "basic", title: "名前と場所", sub: "位置→名前・名前→位置。まずはここから", kinds: ["locate", "point"] },
  { key: "english", title: "＋英語", sub: "日本語→英語も", kinds: ["locate", "point", "ja2en", "en2ja"] },
  { key: "all", title: "総仕上げ", sub: "筋の起始・停止・神経・作用、通るもの、向き、ホルモンも。試験の前に", kinds: TERM_KINDS.map((kind) => kind.key) },
];

/** 問い方の一言（基本の4つは KIND_HINTS、ほかは演習で選ぶときのため） */
const HINTS: Record<string, string> = {
  ...KIND_HINTS,
  muscle: "筋の起始・停止・支配神経・作用を選ぶ",
  passage: "孔・溝を通る神経や血管を選ぶ",
  relation: "2つの部位の前後・左右・上下を選ぶ",
  hormone: "ホルモンを出す器官を選ぶ",
};

const ORDERS: { key: PracticeOrder; title: string; sub: string }[] = [
  { key: "mix", title: "まぜる", sub: "範囲からまんべんなく" },
  { key: "weak", title: "苦手から", sub: "思い出しにくい・まちがえた問題から（一度解いた問題だけ）" },
  { key: "fresh", title: "はじめての問題から", sub: "まだ解いていない問題を先に" },
];

/** 自分で選ぶの3つの段階 */
const STEPS = [
  { title: "範囲", question: "どこを解く？" },
  { title: "問い方", question: "どう問う？" },
  { title: "数と出し方", question: "何問・どの順で？" },
];

/** 選んだ条件（アプリを開いている間は、段階を移っても入口に戻っても残す） */
let draft: (DrillCondition & { view: "learned" | "all" }) | null = null;

export const minutesFor = (questions: number): number => Math.max(1, Math.round((questions * SECONDS_PER_QUESTION) / 60));

/** 範囲・問い方の段階が分かる一言（「名前と場所」「問い方 5つ」） */
export function kindsLabel(kinds: Set<string>, levels: typeof DRILL_LEVELS = levelsFor(TERM_KINDS.map((kind) => kind.key))): string {
  const level = levels.find((item) => sameSet(item.kinds, kinds));
  if (level) return level.title;
  if (kinds.size === 1) return TERM_KINDS.find((kind) => kinds.has(kind.key))?.label ?? "";
  return `問い方 ${kinds.size}つ`;
}

/**
 * 出せる問い方に合わせた段階（前の段階と同じになるものは除く）。
 * 英語→日本語（聞いて答える）は、学ぶ問い方（studied）に入れている人だけ「＋英語」に入れる（はじめの問い方には入っていないので。docs/学びやすさ.md の案5）
 */
export function levelsFor(offered: string[], studied: string[] = offered): typeof DRILL_LEVELS {
  const levels: typeof DRILL_LEVELS = [];
  for (const level of DRILL_LEVELS) {
    const kinds = level.kinds.filter((key) => offered.includes(key) && (level.key !== "english" || key !== "en2ja" || studied.includes(key)));
    if (!kinds.length || (levels.length && sameSet(levels.at(-1)!.kinds, new Set(kinds)))) continue;
    // 総仕上げは、筋の起始・停止など基本の4つのほかの問い方を出せるときだけ（初心者モードでは出さない）
    if (level.key === "all" && kinds.every((key) => DRILL_LEVELS[1].kinds.includes(key))) continue;
    levels.push({ ...level, kinds, sub: level.key === "english" && kinds.includes("en2ja") ? "日本語→英語・英語→日本語も" : level.sub });
  }
  return levels;
}

const sameSet = (list: string[], set: Set<string>) => list.length === set.size && list.every((key) => set.has(key));

/** 保存した前回の条件を読む（今のコースに無い語・出せない問い方は除く） */
export function parseCondition(value: unknown, termIds: Set<string>, offered: string[]): DrillCondition | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const ids = Array.isArray(raw.ids) ? raw.ids.filter((id): id is string => typeof id === "string" && termIds.has(id)) : [];
  const kinds = Array.isArray(raw.kinds) ? raw.kinds.filter((key): key is string => typeof key === "string" && offered.includes(key)) : [];
  const count = typeof raw.count === "number" && DRILL_COUNTS.includes(raw.count) ? raw.count : 20;
  const order = ORDERS.some((item) => item.key === raw.order) ? (raw.order as PracticeOrder) : "mix";
  if (!ids.length || !kinds.length) return null;
  return { ids: new Set(ids), kinds: new Set(kinds), count, order };
}

/** 「今日」「昨日」「3日前」 */
function daysAgo(iso: string, now = new Date()): string {
  const day = (date: Date) => Math.floor((date.getTime() - date.getTimezoneOffset() * 60_000) / 86_400_000);
  const days = day(now) - day(new Date(iso));
  return days <= 0 ? "今日" : days === 1 ? "昨日" : `${days}日前`;
}

/**
 * 演習（#/drill。docs/普段使い.md「演習の見直し」）。
 * 入口（#/drill）は「すぐ始める」（最近のレッスン・苦手な語・★を付けた語・前回と同じ条件）と「自分で選ぶ」（3つの段階）。
 * 自分で選ぶは ①範囲（#/drill/custom）→ ②問い方（custom/2。名前と場所 → ＋英語 → 総仕上げの段階か1つずつ）→ ③数と出し方（custom/3）。
 * "#/drill/recent"・"weak"・"stars"・"last" はすぐ始める、"#/drill/term/<語ID>" はその語の問い方をひと通り（図鑑の「この語を演習」）。
 * おまかせ（学んでいない所からも出す）はしない。学んでいない語は、①範囲の一覧を「すべて」にして自分で選んだときだけ。
 * 答えは復習と同じく記録し、次に出る日にも反映する。初心者モードでは範囲は初心者コースの語、問い方は基本の4つから。
 */
export async function drill(ctx: AppContext, mode: string): Promise<void> {
  const { viewer } = ctx;
  ctx.fold(true);
  viewer.highlight([]);
  viewer.overview();
  ctx.hint("");
  const [learned, schedules, lastRow] = await Promise.all([db.learned.toArray(), db.schedules.toArray(), db.settings.get(DRILL_LAST)]);
  const learnedAt = new Map(learned.map((item) => [item.termId, item.learnedAt]));
  // 覚え具合は解くたびに変わるので、「もう一度」のときに読み直す
  let scheduleOf = new Map(schedules.map((s) => [s.cardId, s]));
  const reload = async () => {
    scheduleOf = new Map((await db.schedules.toArray()).map((s: StoredSchedule) => [s.cardId, s]));
  };
  const terms = courseTerms();
  const termIds = new Set(terms.map((term) => term.id));
  const units = courseUnits();
  const learnedTerms = terms.filter((term) => learnedAt.has(term.id));
  // 初心者モードでは、筋の起始・停止などと通るものは選べない（詳細モードで）
  const offered = isBeginner() ? TERM_KINDS.filter((kind) => kind.facets.every((facet) => BASIC_FACETS.includes(facet))) : TERM_KINDS;
  const offeredKeys = offered.map((kind) => kind.key);
  // 問い方の初めは、設定の「学ぶ問い方」で選んだもの（演習では外したものも選べる）
  const studied = offered.filter((kind) => kind.facets.some((facet) => studyFacets().includes(facet))).map((kind) => kind.key);
  const levels = levelsFor(offeredKeys, studied);
  const defaultKinds = () => new Set(studied.length ? studied : offeredKeys);
  const last = parseCondition(lastRow?.value, termIds, offeredKeys);
  const idsOf = (list: Term[]) => list.map((term) => term.id);

  // 選んだ条件。範囲は初めは何も選ばない（前回の範囲は「よく使う範囲」から）。今のコースに無い語・出せない問い方は外す（コースを変えたとき）
  draft ??= {
    ids: new Set(), kinds: last?.kinds ?? defaultKinds(), count: last?.count ?? 20, order: last?.order ?? "mix",
    view: learnedTerms.length ? "learned" : "all",
  };
  for (const id of draft.ids) if (!termIds.has(id)) draft.ids.delete(id);
  for (const key of draft.kinds) if (!offeredKeys.includes(key)) draft.kinds.delete(key);
  if (!draft.kinds.size) draft.kinds = defaultKinds();
  const cond = draft;

  // 演習では筋の3つと通るものも、場所を覚える前から出す（解く順は自分で決める）
  const candidatesOf = (c: Pick<DrillCondition, "ids" | "kinds" | "order">): PracticeCandidate[] => [...c.ids]
    .flatMap((id) => {
      const term = termById.get(id);
      if (!term || !termIds.has(id)) return [];
      return facetsFor(term, true)
        .filter((facet) => offered.some((kind) => c.kinds.has(kind.key) && kind.facets.includes(facet)))
        .map((facet) => {
          const schedule = scheduleOf.get(`${id}:${facet}`);
          return { termId: id, facet, recall: retrievability(schedule), lapses: schedule?.lapses ?? 0 };
        });
    })
    // 苦手からのときは、一度は解いたことのある問い方から選ぶ
    .filter((c2) => c.order !== "weak" || c2.recall !== null);
  const queueOf = (c: DrillCondition) => practiceQueue(candidatesOf(c), c.count || Number.MAX_SAFE_INTEGER, c.order);
  const sizeOf = (c: DrillCondition) => {
    const pool = candidatesOf(c).length;
    return c.count ? Math.min(c.count, pool) : pool;
  };

  /** 範囲の一言（「胸とおなかの筋・首と背中の筋 ほか1」） */
  const rangeLabel = (ids: Set<string>) => {
    const touched = units.filter((unit) => unit.terms.some((term) => ids.has(term.id)));
    if (!touched.length) return "なし";
    if (ids.size === terms.length) return "すべての語";
    return touched.length <= 2 ? touched.map((unit) => unit.title).join("・") : `${touched[0].title} ほか${touched.length - 1}レッスン`;
  };
  const countLabel = (c: DrillCondition) => (c.count ? `${c.count}問` : "全部");
  const describe = (c: DrillCondition) => `${countLabel(c)}・${kindsLabel(c.kinds, levels)}・${rangeLabel(c.ids)}`;

  /** 前回の条件として残す（すぐ始めると自分で選んだとき。1語の演習とまちがえた問題の解き直しは残さない） */
  const remember = (c: DrillCondition) => db.settings.put({
    key: DRILL_LAST, value: { ids: [...c.ids], kinds: [...c.kinds], count: c.count, order: c.order }, updatedAt: nowIso(),
  });

  /** 同じアドレスでも画面を作り直す（「条件を変える」で今いる段階へ戻るとき） */
  const go = (hash: string) => {
    if (location.hash === hash) window.dispatchEvent(new HashChangeEvent("hashchange"));
    else location.hash = hash;
  };

  /** その条件ですぐ解く。出せる問題が無ければ、③数と出し方のまとめで理由を出す */
  const startWith = (c: DrillCondition, keep = true) => {
    const queue = queueOf(c);
    if (!queue.length) {
      draft = { ...c, view: cond.view };
      return go("#/drill/custom/3");
    }
    if (keep) void remember(c);
    void run(queue, c).catch((error) => {
      if (!ctx.signal.aborted) throw error;
    });
  };

  // ---- 解く・終わりの画面 ----

  const run = async (queue: QueueItem[], c: DrillCondition, label = "演習"): Promise<void> => {
    ctx.fold(false);
    const results: { item: QueueItem; correct: boolean }[] = [];
    // 「ここでやめる」（と Esc）: 今の問題をやめて、そこまでのまとめを出す（復習と同じ）
    const stop = new AbortController();
    ctx.signal.addEventListener("abort", () => stop.abort(ctx.signal.reason), { once: true });
    ctx.tools.replaceChildren(h("button", { class: "chip", type: "button", onClick: () => stop.abort("stop") }, "ここでやめる"));
    onKeys(stop.signal, (key) => {
      if (key !== "Escape") return false;
      stop.abort("stop");
      return true;
    });
    const inner = { ...ctx, signal: stop.signal };
    try {
      for (const [i, item] of queue.entries()) {
        const outcome = await ask(inner, item, "practice", `${label} ${i + 1} / ${queue.length}`);
        results.push({ item, correct: outcome === "correct" });
      }
    } catch (error) {
      if (stop.signal.reason !== "stop") throw error;
    }
    const stopped = stop.signal.reason === "stop";
    stop.abort("done");
    ctx.tools.replaceChildren();
    finish(results, c, stopped);
  };

  const finish = (results: { item: QueueItem; correct: boolean }[], c: DrillCondition, stopped: boolean) => {
    const missed = results.filter((result) => !result.correct).map((result) => result.item);
    const missedTerms = new Map<string, Set<string>>();
    for (const item of missed) missedTerms.set(item.termId, (missedTerms.get(item.termId) ?? new Set()).add(facetLabels[item.facet]));
    viewer.setLabel(null);
    viewer.highlight([...missedTerms.keys()]);
    viewer.overview();
    ctx.hint("");
    const answered = results.length;
    const correct = answered - missed.length;
    const rate = answered ? Math.round((correct / answered) * 100) : 0;
    const later = (fn: () => Promise<void>) => () => void fn().catch((error) => {
      if (!ctx.signal.aborted) throw error;
    });
    const again = later(async () => {
      await reload();
      const queue = queueOf(c);
      if (queue.length) await run(queue, c);
      else go("#/drill/custom/3");
    });
    const retryMissed = later(() => run(shuffle(missed), c, "もう一度"));
    const change = () => {
      draft = { ...c, ids: new Set(c.ids), kinds: new Set(c.kinds), view: cond.view };
      go("#/drill/custom/3");
    };

    // 問い方ごとの正解（2つ以上の問い方を解いたとき）
    const byKind = offered.flatMap((kind) => {
      const list = results.filter((result) => kind.facets.includes(result.item.facet));
      return list.length ? [{ label: kind.label, total: list.length, correct: list.filter((result) => result.correct).length }] : [];
    });
    const message = rate >= 90 ? "よくできました。この範囲は日をあけて復習に出ます。"
      : rate >= 60 ? "あと少し。まちがえた問題をもう一度解くと、早く定着します。"
        : "まちがえた語を図鑑で確かめてから、もう一度解きましょう。";
    const missedLink = (id: string, facets: Set<string>) => h("a", { class: "chip", href: `#/explore/${id}` },
      termById.get(id)?.ja ?? id, h("span", { class: "chip-count" }, [...facets].join("・")));

    showPanel(ctx,
      h("h2", {}, stopped ? "ここまでの演習" : "演習おわり"),
      answered ? h("section", { class: "home-card drill-score" },
        h("p", { class: "drill-score-num" }, h("b", {}, String(correct)), h("span", {}, ` / ${answered} 正解`), h("span", { class: "drill-score-rate" }, `${rate}%`)),
        h("div", { class: "home-meter", "aria-hidden": "true" }, h("span", { style: `width:${rate}%;background:${rate >= 60 ? "var(--ok)" : "var(--close)"}` })),
        h("p", { class: "home-note" }, message, " 答えは復習の記録にも入り、次に出る日が変わりました。"),
      ) : h("p", { class: "muted" }, "解いた問題はありません。"),
      byKind.length > 1 ? group("問い方ごと", {}, card(...byKind.map((kind) => h("div", { class: "set-row" },
        h("span", { class: "set-text" }, h("span", { class: "set-label" }, kind.label)),
        h("span", { class: "drill-kind-bar", "aria-hidden": "true" }, h("span", { style: `width:${(kind.correct / kind.total) * 100}%` })),
        h("span", { class: "set-value" }, `${kind.correct} / ${kind.total}`))))) : "",
      missedTerms.size ? group("まちがえた語（押すと図鑑）", {}, h("div", { class: "chip-list drill-missed" }, ...[...missedTerms].map(([id, facets]) => missedLink(id, facets)))) : "",
      h("div", { class: "drill-more" },
        missed.length ? h("button", { class: "text-button", type: "button", onClick: again }, "同じ条件でもう一度") : "",
        h("button", { class: "text-button", type: "button", onClick: () => go("#/drill") }, "演習の入口へ")),
      h("div", { class: "nav-row" },
        h("button", { class: "ghost-button", type: "button", onClick: change }, "条件を変える"),
        missed.length
          ? h("button", { class: "primary", type: "button", onClick: retryMissed }, `まちがえた問題を解き直す（${missed.length}）`)
          : h("button", { class: "primary", type: "button", onClick: again }, "同じ条件で解く")),
    );
  };

  // ---- 入口・自分で選ぶ ----

  const [kind, arg] = [mode.split("/")[0], mode.split("/").slice(1).join("/")];
  const studiedUnits = recentUnits(units, learnedAt);
  const recent = (): DrillCondition => ({
    ids: new Set(studiedUnits.slice(0, 3).flatMap((unit) => unit.terms.filter((term) => learnedAt.has(term.id)).map((term) => term.id))),
    kinds: defaultKinds(), count: 20, order: "mix",
  });
  const weak = (): DrillCondition => ({ ids: new Set(idsOf(learnedTerms)), kinds: defaultKinds(), count: 20, order: "weak" });
  const stars = (): DrillCondition => ({ ids: new Set(starredIds().filter((id) => termIds.has(id))), kinds: defaultKinds(), count: 20, order: "mix" });

  if (kind === "custom") {
    // "custom/1/<系統ID>/<レッスンID>" は①範囲の中の系統・レッスンのページ
    const [stepArg, ...path] = arg.split("/");
    return chooser(Math.min(3, Math.max(1, Number(stepArg) || 1)), path.filter(Boolean));
  }
  if (kind === "recent") return startWith(recent());
  if (kind === "weak") return startWith(weak());
  if (kind === "stars") return startWith(stars());
  if (kind === "last" && last) return startWith(last);
  // その語の問い方をひと通り（筋なら起始・停止なども）
  if (kind === "term" && termById.has(arg)) return startWith({ ids: new Set([arg]), kinds: new Set(offeredKeys), count: 9, order: "mix" }, false);
  return entry();

  /** 入口: すぐ始める（1回押せば始まる）と、自分で選ぶ（3つの段階の見通しと「範囲から選ぶ」） */
  function entry(): void {
    const quick: HTMLElement[] = [];
    if (studiedUnits.length) {
      const c = recent();
      const titles = studiedUnits.slice(0, 3).map((unit) => unit.title).join("・");
      quick.push(quickRow("lessons", "#1f6f78", "最近のレッスン", titles, `${sizeOf(c)}問`, () => startWith(c)));
    }
    const attempted = candidatesOf({ ids: new Set(idsOf(learnedTerms)), kinds: defaultKinds(), order: "weak" });
    if (attempted.length) {
      const shaky = attempted.filter((c) => (c.recall ?? 1) < 0.9 || c.lapses > 0).length;
      quick.push(quickRow("drill", "#c2493a", "苦手な語", shaky ? `まちがえた・忘れかけた ${shaky}問から` : "解いた問題から、思い出しにくい順に", `${sizeOf(weak())}問`, () => startWith(weak())));
    }
    const starred = stars();
    if (starred.ids.size) quick.push(quickRow("star", "#b07d10", "★を付けた語", `自分で印を付けた ${starred.ids.size}語`, `${sizeOf(starred)}問`, () => startWith(starred)));
    if (last) quick.push(quickRow("again", "#6b5fb5", "前回と同じ条件", describe(last), `${sizeOf(last)}問`, () => startWith(last)));

    const plan = STEPS.map((step, i) => h("li", {},
      h("span", { class: "ahead-mark", "aria-hidden": "true" }, String(i + 1)),
      h("span", { class: "drill-plan-text" }, h("b", {}, step.title),
        h("span", {}, [
          learnedTerms.length ? "最近のレッスン・学んだ語すべてなどからすぐ。系統 → レッスン → 語と開いても選べます" : "系統 → レッスン → 語と開いて選びます",
          levels.map((level) => level.title).join(" → "),
          "10〜40問か全部・まぜる／苦手から／はじめての問題から",
        ][i]))));
    showPanel(ctx,
      h("div", { class: "tab-head" }, h("h2", {}, "演習")),
      h("p", { class: "drill-lead" }, "学んだ範囲を、試験の前に解き直します。答えは今日の復習の記録にも入ります。"),
      h("h3", { class: "list-title" }, "すぐ始める"),
      quick.length ? h("ul", { class: "home-card home-list" }, ...quick)
        : h("p", { class: "home-card home-note drill-empty" }, "レッスンを1つ終えると、ここから最近のレッスン・苦手な語をすぐ解けます。まだ学んでいない語は、下の「自分で選ぶ」で系統を開いて選べます。"),
      h("h3", { class: "list-title" }, "自分で選ぶ"),
      h("section", { class: "home-card drill-plan" },
        h("ol", { class: "drill-plan-steps" }, ...plan),
        h("a", { class: "primary drill-plan-go", href: "#/drill/custom" }, "範囲から選ぶ")),
    );
  }

  /** 自分で選ぶ（3つの段階）。step は 1〜3、path は①範囲の中の系統・レッスン */
  function chooser(step: number, path: string[] = []): void {
    ctx.fold(true);
    /** チェック（ids はその下の語、counter は「選んだ数/語の数」を出す所。box の無いものは数だけ） */
    const boxes: { box?: HTMLInputElement; ids: string[]; counter?: HTMLElement; format?: (on: number, all: number) => string }[] = [];
    /** 選んだものが変わったときに合わせるもの（選んでいる範囲・よく使う範囲の濃さ） */
    const hooks: (() => void)[] = [];
    const watch = (ids: string[], counter: HTMLElement, format: (on: number, all: number) => string) => boxes.push({ ids, counter, format });
    const stepValues: HTMLElement[] = [];
    const sum = h("p", { class: "drill-foot-sum" });
    const minutes = h("span", {});
    let note = "";

    const checkbox = (ids: string[], label: string, counter?: HTMLElement) => {
      const box = h("input", {
        type: "checkbox", "aria-label": label,
        onChange: () => {
          for (const id of ids) {
            if (box.checked) cond.ids.add(id);
            else cond.ids.delete(id);
          }
          refresh();
        },
      });
      boxes.push({ box, ids, counter });
      return box;
    };
    const setRange = (ids: string[]) => {
      cond.ids.clear();
      for (const id of ids) cond.ids.add(id);
      refresh();
    };

    /** 選んだものが変わったら、チェック・数・段階の帯・下の帯を合わせる（描き直さないので、開いたフォルダーとスクロールはそのまま） */
    const refresh = () => {
      for (const { box, ids, counter, format } of boxes) {
        const on = ids.filter((id) => cond.ids.has(id)).length;
        if (box) {
          box.checked = !!ids.length && on === ids.length;
          box.indeterminate = on > 0 && on < ids.length;
        }
        if (counter) counter.textContent = format ? format(on, ids.length) : on && on < ids.length ? `${on}/${ids.length}語` : `${ids.length}語`;
      }
      for (const hook of hooks) hook();
      const pool = candidatesOf(cond).length;
      const size = cond.count ? Math.min(cond.count, pool) : pool;
      [`${cond.ids.size}語`, kindsLabel(cond.kinds, levels), countLabel(cond)].forEach((text, i) => (stepValues[i].textContent = text));
      minutes.textContent = size ? `約${minutesFor(size)}分` : "";
      const learnedOn = learnedTerms.filter((term) => cond.ids.has(term.id)).length;
      sum.className = pool ? "drill-foot-sum" : "drill-foot-sum is-warn";
      sum.textContent = !cond.ids.size ? "範囲を選んでください。"
        : !pool ? (cond.order === "weak" ? "苦手からは、一度でも解いた問題から選びます。この範囲で解いた問題がまだありません。"
          : "選んだ範囲に、この問い方の問題がありません。")
          : step === 1 ? `${cond.ids.size}語を選んでいます${learnedTerms.length ? `（学んだ語 ${learnedOn} / ${learnedTerms.length}）` : ""}`
            : step === 2 ? `この範囲・問い方で ${pool}問あります`
              : `${pool}問の中から ${size}問・約${minutesFor(size)}分`;
      if (button instanceof HTMLButtonElement) {
        button.disabled = !pool;
        button.textContent = pool ? `始める（${size}問・約${minutesFor(size)}分）` : "始める";
      } else button.classList.toggle("is-disabled", !cond.ids.size);
    };

    const button = step < 3
      ? h("a", { class: "primary", href: `#/drill/custom/${step + 1}`, onClick: (event: Event) => {
        if (!cond.ids.size) event.preventDefault();
      } }, `次へ：${STEPS[step].title}`)
      : h("button", { class: "primary", type: "button", onClick: () => startWith(cond) }, "始める");

    /** 上の段階の帯（番号・名前・いま選んでいるもの。押すとその段階へ） */
    const stepBar = h("ol", { class: "drill-steps", "aria-label": "演習の条件を選ぶ段階" }, ...STEPS.map((item, i) => {
      const value = h("span", { class: "drill-step-value" });
      stepValues.push(value);
      return h("li", {}, h("a", {
        class: i + 1 === step ? "drill-step is-now" : i + 1 < step && cond.ids.size ? "drill-step is-done" : "drill-step",
        href: i ? `#/drill/custom/${i + 1}` : "#/drill/custom", "aria-current": i + 1 === step ? "step" : null,
      }, h("span", { class: "drill-step-num", "aria-hidden": "true" }, String(i + 1)), h("span", { class: "drill-step-title" }, item.title), value));
    }));

    /** 描き直す（チップや行を押したとき。スクロールは保つ） */
    const again = () => {
      const [panelTop, pageTop] = [ctx.panel.scrollTop, window.scrollY];
      chooser(step, path);
      ctx.panel.scrollTop = panelTop;
      window.scrollTo({ top: pageTop });
    };

    const body = step === 1 ? rangeStep() : step === 2 ? kindStep() : countStep();
    showPanel(ctx,
      stepBar,
      h("h2", { class: "drill-question" }, STEPS[step - 1].question),
      ...body,
      note ? h("p", { class: "drill-note" }, note) : "",
      h("div", { class: "panel-foot drill-foot" }, sum, button),
    );
    refresh();

    /**
     * ①範囲（docs/普段使い.md「演習の範囲の選びやすさ」）。初めは何も選ばない。
     * 一覧の上に「選んでいる範囲」（レッスンごと。×で外す）と「よく使う範囲」、その下に検索と系統の一覧。
     * 系統（#/drill/custom/1/<系統ID>）→ レッスンの語（#/drill/custom/1/<系統ID>/<レッスンID>）と1段ずつ開いて選ぶ。
     * 一番上の「学んだ語から選ぶ／すべての語から選ぶ」は一覧に出すものの切り替え（学んだ語からのときは、レッスンや系統を選ぶと学んだ語だけが入る）
     */
    function rangeStep(): (Node | string)[] {
      const onlyLearned = cond.view === "learned" && learnedTerms.length > 0;
      const shownOf = (unit: Unit) => (onlyLearned ? unit.terms.filter((term) => learnedAt.has(term.id)) : unit.terms);
      const unitsOf = (systemId: string) => units.filter((unit) => unit.system === systemId && shownOf(unit).length);
      const swatch = (color: string) => h("span", { class: "swatch", style: `background:${color}`, "aria-hidden": "true" });
      const courseSystems = systems.filter((item) => units.some((unit) => unit.system === item.id && unit.terms.length));
      const learnedLessons = units.filter((unit) => unit.terms.some((term) => learnedAt.has(term.id))).length;
      /**
       * どこから選ぶか（学んだ語から／すべての語から）の大きなカード2枚。いま選んでいる方は色と✓で強調する。
       * 気付きにくいという声で、範囲の画面の一番上に置く（系統のページは小さめに）。学んだ語が無いときは「学んだ語から」を押せない
       */
      const modeCards = (compact = false) => {
        const card2 = (value: "learned" | "all", icon: string, title: string, sub: string, disabled: boolean) => {
          const on = (value === "learned") === onlyLearned && !disabled;
          const mark = h("span", { class: "drill-mode-icon", "aria-hidden": "true" });
          mark.innerHTML = `<svg viewBox="0 0 24 24">${icon}</svg>`;
          return h("button", {
            class: `drill-mode${on ? " is-on" : ""}`, type: "button", disabled, "aria-pressed": String(on),
            onClick: () => {
              if (on) return;
              cond.view = value;
              again();
            },
          }, mark, h("span", { class: "drill-mode-text" }, h("b", {}, compact ? title.replace(/から選ぶ$/, "") : title), compact ? "" : h("span", {}, ...sub.split("\n").map((line) => h("span", { class: "drill-mode-line" }, line)))),
          h("span", { class: "drill-mode-check", "aria-hidden": "true" }, on ? "✓" : ""));
        };
        return h("div", { class: `drill-modes${compact ? " is-compact" : ""}`, role: "group", "aria-label": "どこから選ぶか" },
          card2("learned", ICONS.lessons, "学んだ語から選ぶ",
            learnedTerms.length ? `レッスンで学んだ ${learnedTerms.length}語・${learnedLessons}レッスン` : "まだありません。\nレッスンを1つ終えると選べます", !learnedTerms.length),
          card2("all", ALL_ICON, "すべての語から選ぶ", `${courseSystems.length}系統・${terms.length.toLocaleString()}語\nまだ学んでいない語も選べます`, false));
      };

      /** 押すと範囲をそれに入れ替えるチップ。いまの範囲と同じなら濃くする */
      const presetChip = (label: string, count: string, isOn: () => boolean, onClick: () => void) => {
        const chip = h("button", { class: "chip drill-preset", type: "button", onClick }, label, count ? h("span", { class: "chip-count" }, count) : "");
        hooks.push(() => {
          chip.classList.toggle("on", isOn());
          chip.setAttribute("aria-pressed", String(isOn()));
        });
        return chip;
      };
      const latestOf = (unit: Unit) => unit.terms.reduce((at, term) => ((learnedAt.get(term.id) ?? "") > at ? learnedAt.get(term.id)! : at), "");

      /** レッスンの行。名前を押すと丸ごと選ぶ、右の「語 ›」で1語ずつ選ぶ画面へ */
      const lessonRow = (unit: Unit, ids: string[], where = "") => {
        const counter = h("span", {});
        const learnedCount = unit.terms.filter((term) => learnedAt.has(term.id)).length;
        const status = !learnedCount ? "まだ学んでいない"
          : learnedCount < unit.terms.length ? `途中まで学んだ（${learnedCount}語）・${daysAgo(latestOf(unit))}` : `学んだ・${daysAgo(latestOf(unit))}`;
        return h("li", { class: "pick-item" },
          h("label", { class: "pick-row" },
            checkbox(ids, unit.title, counter),
            h("span", { class: "pick-text" }, h("span", { class: "pick-title" }, unit.title), h("span", { class: "pick-sub" }, where ? `${where}・${status}` : status)),
            h("span", { class: "pick-meta" }, counter)),
          h("a", { class: "pick-open", href: `#/drill/custom/1/${unit.system}/${unit.id}`, "aria-label": `${unit.title}の語を1つずつ選ぶ` },
            "語", h("span", { "aria-hidden": "true" }, " ›")));
      };
      /** 語の行（英語と、学んだ語には「学んだ」） */
      const termRow = (term: Term, where = "") => h("li", {}, h("label", { class: "pick-row is-term" },
        checkbox([term.id], term.ja),
        h("span", { class: "pick-text" }, h("span", { class: "pick-title" }, term.ja),
          h("span", { class: "pick-sub", lang: "en" }, term.en), where ? h("span", { class: "pick-sub" }, where) : ""),
        learnedAt.has(term.id) ? h("span", { class: "pick-badge" }, "学んだ") : ""));

      const [systemId, unitId] = path;
      const system = systems.find((item) => item.id === systemId && units.some((unit) => unit.system === item.id && unit.terms.length));
      const lessonOf = system && unitId ? units.find((item) => item.id === unitId && item.system === system.id) : undefined;
      if (system && lessonOf) return lessonPage(system, lessonOf);
      if (system) return systemPage(system);
      return topPage();

      /** 一番上: 選んでいる範囲・よく使う範囲・検索・系統の一覧 */
      function topPage(): (Node | string)[] {
        const picked = h("section", { class: "home-card drill-picked", "aria-live": "polite" });
        const starIds = starredIds().filter((id) => termIds.has(id));
        const presets = [
          studiedUnits.length ? { label: studiedUnits.length >= 3 ? "最近の3レッスン" : "最近のレッスン", ids: [...recent().ids] } : null,
          learnedTerms.length ? { label: "学んだ語すべて", ids: idsOf(learnedTerms) } : null,
          starIds.length ? { label: "★を付けた語", ids: starIds } : null,
          last ? { label: "前回の範囲", ids: [...last.ids] } : null,
        ].flatMap((item) => (item ? [presetChip(item.label, `${item.ids.length}語`, () => sameSet(item.ids, cond.ids), () => setRange(item.ids))] : []));
        hooks.push(() => renderPicked(picked, presets.length > 0));

        const rows = systems.flatMap((item) => {
          const list = unitsOf(item.id);
          if (!list.length) return [];
          const badge = h("span", { class: "drill-sys-picked" });
          watch(idsOf(units.filter((unit) => unit.system === item.id).flatMap((unit) => unit.terms)), badge, (on) => (on ? `${on}語` : ""));
          return [h("a", { class: "drill-sys-row", href: `#/drill/custom/1/${item.id}` },
            swatch(item.color),
            h("span", { class: "pick-text" }, h("span", { class: "pick-title" }, item.ja),
              h("span", { class: "pick-sub" }, `${list.length}レッスン・${list.flatMap(shownOf).length}語${onlyLearned ? "（学んだ語）" : ""}`)),
            badge, h("span", { class: "drill-chev", "aria-hidden": "true" }, "›"))];
        });
        const browse = h("div", {}, h("div", { class: "home-card drill-sys-list" }, ...rows),
          h("p", { class: "set-foot" }, "系統を開くと、レッスンごとに選べます。1語ずつ選ぶときは、レッスンの右の「語 ›」から。"));

        /** ここまでが一覧のチェック。この後ろは検索で当たったもののチェック（打ち直すたびに作り直す） */
        const listEnd = boxes.length;
        const results = h("div", { class: "drill-results", hidden: true });
        const search = h("input", {
          class: "search drill-search", type: "search", placeholder: "レッスン・語の名前で探す", "aria-label": "演習するレッスンと語を探す",
          onInput: () => {
            const query = normalize(search.value.trim());
            browse.hidden = !!query;
            results.hidden = !query;
            boxes.splice(listEnd);
            if (!query) return results.replaceChildren();
            const lessons = searchUnits(query).filter((unit) => unit.terms.length);
            const found = searchTerms(query).filter((term) => termIds.has(term.id));
            const systemName = (id: string) => systems.find((item) => item.id === id)?.ja ?? "";
            results.replaceChildren(
              lessons.length ? h("h3", { class: "list-title" }, `レッスン ${lessons.length}`) : "",
              lessons.length ? h("ul", { class: "home-card pick-list" }, ...lessons.slice(0, 20).map((unit) => lessonRow(unit, idsOf(unit.terms), systemName(unit.system)))) : "",
              found.length ? h("h3", { class: "list-title" }, `語 ${found.length}`, found.length > 40 ? h("span", { class: "muted" }, "（はじめの40）") : "") : "",
              found.length ? h("ul", { class: "home-card pick-list" }, ...found.slice(0, 40).map((term) => termRow(term, `${systemName(term.system)}・${courseUnitOf(term.id)?.title ?? ""}`))) : "",
              lessons.length || found.length ? "" : h("p", { class: "muted" }, "見つかりませんでした。"),
            );
            refresh();
          },
        });

        return [
          modeCards(),
          picked,
          presets.length ? h("h3", { class: "list-title" }, "よく使う範囲") : "",
          presets.length ? h("div", { class: "chip-list drill-quick" }, ...presets) : "",
          presets.length ? h("p", { class: "set-foot drill-quick-foot" }, "押すと、範囲がそれに入れ替わります。") : "",
          h("h3", { class: "list-title" }, onlyLearned ? "系統・レッスンから選ぶ（学んだ語）" : "系統・レッスンから選ぶ（すべての語）"),
          search,
          results,
          browse,
        ];
      }

      /** 選んでいる範囲（レッスンごと。×で外す） */
      function renderPicked(box: HTMLElement, hasPresets: boolean): void {
        if (!cond.ids.size) {
          box.classList.add("is-empty");
          box.replaceChildren(h("p", { class: "drill-picked-empty" }, h("b", {}, "まだ何も選んでいません"),
            h("span", {}, hasPresets ? "下の「よく使う範囲」を押すか、系統を開いてレッスン・語にチェックを付けてください。"
              : "下の系統を開いて、レッスン・語にチェックを付けてください。名前で探すこともできます。")));
          return;
        }
        box.classList.remove("is-empty");
        const byUnit = units.flatMap((unit) => {
          const on = unit.terms.filter((term) => cond.ids.has(term.id)).length;
          return on ? [{ unit, on }] : [];
        });
        const shown = byUnit.slice(0, 8);
        box.replaceChildren(
          h("div", { class: "drill-picked-head" },
            h("b", {}, "選んでいる範囲", h("span", { class: "drill-picked-total" }, `${cond.ids.size}語・${byUnit.length}レッスン`)),
            h("button", { class: "drill-link", type: "button", onClick: () => setRange([]) }, "すべて外す")),
          h("ul", { class: "drill-picked-list" }, ...shown.map(({ unit, on }) => h("li", { class: "drill-picked-chip" },
            swatch(systems.find((item) => item.id === unit.system)?.color ?? "#ccc"),
            h("span", { class: "drill-picked-name" }, unit.title),
            h("span", { class: "chip-count" }, on < unit.terms.length ? `${on}/${unit.terms.length}語` : `${on}語`),
            h("button", {
              class: "drill-picked-x", type: "button", "aria-label": `${unit.title}を外す`,
              onClick: () => {
                for (const term of unit.terms) cond.ids.delete(term.id);
                refresh();
              },
            }, "×")))),
          byUnit.length > shown.length ? h("p", { class: "drill-picked-more" }, `ほか ${byUnit.length - shown.length}レッスン`) : "",
        );
      }

      /** 系統のページ: この系統をすべて／まとまり（骨格系の体幹・上肢など）ごと／レッスンごとに選ぶ */
      function systemPage(item: (typeof systems)[number]): (Node | string)[] {
        const list = unitsOf(item.id);
        const allCounter = h("span", {});
        const groups = [...new Set(list.map((unit) => unit.group))];
        const sections = groups.map((name) => {
          const inGroup = list.filter((unit) => unit.group === name);
          const counter = h("span", { class: "folder-count" });
          return h("section", { class: "drill-sys" },
            name ? h("label", { class: "drill-sys-head" },
              checkbox(idsOf(inGroup.flatMap(shownOf)), `${name}をすべて`, counter),
              h("span", { class: "drill-sys-name" }, name), counter) : "",
            h("ul", { class: "home-card pick-list" }, ...inGroup.map((unit) => lessonRow(unit, idsOf(shownOf(unit))))));
        });
        return [
          h("a", { class: "drill-back", href: "#/drill/custom" }, "‹ 選んでいる範囲・系統の一覧"),
          h("h3", { class: "drill-place" }, swatch(item.color), item.ja),
          modeCards(true),
          ...(list.length ? [
            h("ul", { class: "home-card pick-list drill-whole" }, h("li", {}, h("label", { class: "pick-row" },
              checkbox(idsOf(list.flatMap(shownOf)), `${item.ja}をすべて`, allCounter),
              h("span", { class: "pick-text" }, h("span", { class: "pick-title" }, onlyLearned ? `${item.ja}の学んだ語をすべて` : `${item.ja}をすべて`)),
              h("span", { class: "pick-meta" }, allCounter)))),
            ...sections,
            h("p", { class: "set-foot" }, "レッスンの名前を押すと丸ごと選びます。1語ずつ選ぶときは右の「語 ›」。"),
          ] : [h("p", { class: "home-card home-note drill-empty" }, `${item.ja}で学んだレッスンはまだありません。上の「すべての語から選ぶ」にすると、学んでいない語も選べます。`)]),
        ];
      }

      /** レッスンのページ: 1語ずつ選ぶ */
      function lessonPage(item: (typeof systems)[number], unit: Unit): (Node | string)[] {
        const own = idsOf(unit.terms);
        const learnedIds = own.filter((id) => learnedAt.has(id));
        const onHere = () => own.filter((id) => cond.ids.has(id));
        const pick = (ids: string[]) => () => {
          for (const id of own) cond.ids.delete(id);
          for (const id of ids) cond.ids.add(id);
          refresh();
        };
        return [
          h("a", { class: "drill-back", href: `#/drill/custom/1/${item.id}` }, `‹ ${item.ja}`),
          h("h3", { class: "drill-place" }, swatch(item.color), unit.title),
          h("div", { class: "chip-list drill-quick" },
            presetChip("すべて選ぶ", `${own.length}語`, () => onHere().length === own.length, pick(own)),
            learnedIds.length && learnedIds.length < own.length
              ? presetChip("学んだ語だけ", `${learnedIds.length}語`, () => sameSet(learnedIds, new Set(onHere())), pick(learnedIds)) : "",
            presetChip("このレッスンを外す", "", () => false, pick([]))),
          h("ul", { class: "home-card pick-list" }, ...unit.terms.map((term) => termRow(term))),
        ];
      }
    }

    /** ②問い方: 段階（名前と場所 → ＋英語 → 総仕上げ）か、1つずつ */
    function kindStep(): (Node | string)[] {
      const countOf = (keys: string[]) => candidatesOf({ ids: cond.ids, kinds: new Set(keys), order: "mix" }).length;
      const levelRows = levels.map((level, i) => {
        const n = countOf(level.kinds);
        const rowEl = choiceRow(
          h("span", { class: "drill-level" }, h("span", { class: "drill-level-num", "aria-hidden": "true" }, `段階${i + 1}`), level.title),
          level.sub, sameSet(level.kinds, cond.kinds), false,
          () => {
            note = "";
            cond.kinds = new Set(level.kinds);
            again();
          }, `${n}問`);
        if (!n && cond.ids.size) (rowEl as HTMLButtonElement).disabled = true;
        return rowEl;
      });
      const kindRows = offered.map((item) => {
        const n = countOf([item.key]);
        const on = cond.kinds.has(item.key);
        const rowEl = choiceRow(item.label, n || !cond.ids.size ? HINTS[item.key] ?? "" : "この範囲にはありません", on, true, () => {
          note = "";
          if (on && cond.kinds.size === 1) note = "少なくとも1つは選んでおきます。ほかを選んでから外してください。";
          else if (on) cond.kinds.delete(item.key);
          else cond.kinds.add(item.key);
          again();
        }, `${n}問`);
        if (!n && !on && cond.ids.size) (rowEl as HTMLButtonElement).disabled = true;
        return rowEl;
      });
      return [
        group("段階で選ぶ", {}, card(...levelRows),
          foot(`段階が上がるほど問い方が増えます。はじめは「名前と場所」、慣れたら英語${levels.length > 2 ? "、試験の前は総仕上げ" : "も"}。数は選んだ範囲の問題の数です。`)),
        group("1つずつ選ぶ", {}, card(...kindRows)),
      ];
    }

    /** ③数と出し方と、この内容のまとめ */
    function countStep(): (Node | string)[] {
      const weakPool = candidatesOf({ ...cond, order: "weak" }).length;
      const freshPool = candidatesOf({ ...cond, order: "mix" }).filter((c) => c.recall === null).length;
      const counts = segmented("問題の数", DRILL_COUNTS.map((n) => ({ value: n, label: n ? `${n}問` : "全部" })), cond.count, (value) => {
        cond.count = value;
        refresh();
      });
      const orderRows = ORDERS.map((item) => {
        const n = item.key === "weak" ? weakPool : item.key === "fresh" ? freshPool : null;
        const rowEl = choiceRow(item.title, item.key === "fresh" && !n ? "この範囲はすべて一度解いています（まぜると同じ）" : item.sub, cond.order === item.key, false, () => {
          cond.order = item.key;
          again();
        }, n === null ? "" : `${n}問`);
        if (item.key === "weak" && !n && cond.order !== "weak") (rowEl as HTMLButtonElement).disabled = true;
        return rowEl;
      });
      const summaryRow = (title: string, value: string, to: number) => h("a", { class: "set-row drill-sum-row", href: to === 1 ? "#/drill/custom" : `#/drill/custom/${to}` },
        h("span", { class: "set-text" }, h("span", { class: "set-sub" }, title), h("span", { class: "set-label" }, value)),
        h("span", { class: "drill-change" }, "変える"));
      return [
        group("問題の数", {}, card(h("div", { class: "set-row stack" }, counts)), foot(h("span", {}, "1問 約15秒の目安で ", minutes, "。全部は選んだ範囲の問題をすべて。"))),
        group("出し方", {}, card(...orderRows)),
        group("この内容で始めます", {}, card(
          summaryRow("範囲", `${rangeLabel(cond.ids)}（${cond.ids.size}語）`, 1),
          summaryRow("問い方", [...cond.kinds].map((key) => TERM_KINDS.find((item) => item.key === key)?.label ?? key).join("・"), 2),
          h("div", { class: "set-row drill-sum-row" }, h("span", { class: "set-text" }, h("span", { class: "set-sub" }, "問題"),
            h("span", { class: "set-label" }, `${countLabel(cond)}・${ORDERS.find((item) => item.key === cond.order)?.title ?? ""}`)))),
        foot("答えは今日の復習の記録にも入り、次に出る日が変わります。途中で「ここでやめる」（Esc）もできます。")),
      ];
    }
  }

  /** すぐ始めるの1行（絵・題・説明・何問）。押すとすぐ始まる */
  function quickRow(icon: keyof typeof ICONS, color: string, title: string, sub: string, meta: string, onClick: () => void): HTMLElement {
    const mark = h("span", { class: "home-item-icon", style: `--item:${color}`, "aria-hidden": "true" });
    mark.innerHTML = `<svg viewBox="0 0 24 24">${ICONS[icon]}</svg>`;
    return h("li", {}, h("button", { class: "home-item", type: "button", onClick },
      mark,
      h("span", { class: "home-item-text" }, h("span", { class: "home-item-title" }, title), h("span", { class: "home-item-sub" }, sub)),
      h("span", { class: "home-item-meta" }, meta)));
  }
}

/** 学んだ語のあるレッスン（新しく学んだ順） */
export function recentUnits(units: Unit[], learnedAt: Map<string, string>): Unit[] {
  const latest = (unit: Unit) => unit.terms.reduce((at, term) => ((learnedAt.get(term.id) ?? "") > at ? learnedAt.get(term.id)! : at), "");
  return units.filter((unit) => unit.terms.some((term) => learnedAt.has(term.id))).sort((a, b) => latest(b).localeCompare(latest(a)));
}

