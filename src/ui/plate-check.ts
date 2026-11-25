import type { PlateLabel } from "../content";
import { db, nowIso } from "../db";
import { h, onKeys } from "../dom";
import { labelName, type CheckView, type HideKind } from "./plate-view";

/**
 * 平面図の「隠して確かめる」（docs/普段使い.md「隠して確かめるの見直し」）。
 * 何を隠すか（名前を全部・日本語・英語）を選ぶと、図の名前を隠して1つずつ（ばらばらの順に）問う。
 * 思い出してから「答えを見る」→ 自分で ○ か × をつけて次へ。終わったら × だけをもう一度。結果は図ごと・隠し方ごとに残す（db.settings の plateCheck.<図ID>）
 */

/** 隠し方: キー・ボタンの名前・何から何を思い出すか */
export const HIDE_KINDS: [HideKind, string, string][] = [
  ["all", "全部隠す", "番号 → 名前"],
  ["ja", "日本語を隠す", "英語 → 日本語"],
  ["en", "英語を隠す", "日本語 → 英語"],
];
const KIND_NAME: Record<HideKind, string> = { all: "名前を全部隠す", ja: "日本語を隠す", en: "英語を隠す" };

/** 1回の結果: ○の数・名前の数・× だった名前（labelKey）・日時 */
export interface CheckResult {
  right: number;
  total: number;
  missed: string[];
  at: string;
}
export type CheckResults = Partial<Record<HideKind, CheckResult>>;

export const checkKey = (plateId: string): string => `plateCheck.${plateId}`;
/** 結果に残すラベルの名前（語があれば語ID）。図を作り直して番号が変わっても、同じ名前を指す */
export const labelKey = (label: PlateLabel): string => label.term ?? label.ja ?? label.en ?? "";

/** 確かめている1回の様子 */
export interface CheckState {
  hide: HideKind;
  /** 問う順（ラベルの番号） */
  order: number[];
  /** order の何番目を問うているか（order.length で終わり） */
  at: number;
  /** 今の問いの答えを出したか */
  shown: boolean;
  /** ○（true）・×（false） */
  marks: Map<number, boolean>;
}

export function shuffled<T>(list: readonly T[], random = Math.random): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** 新しい回。only を渡すと、その番号だけを問う（ほかは○のまま。前回の × だけ） */
export function newRound(hide: HideKind, count: number, only?: readonly number[], random = Math.random): CheckState {
  const ask = only ? [...only] : Array.from({ length: count }, (_, i) => i);
  const marks = new Map<number, boolean>();
  if (only) for (let i = 0; i < count; i++) if (!only.includes(i)) marks.set(i, true);
  return { hide, order: shuffled(ask, random), at: 0, shown: false, marks };
}

/** 終わった回の × だけをもう一度（○はそのまま） */
export function retryRound(state: CheckState, random = Math.random): CheckState {
  const missed = [...state.marks].filter(([, ok]) => !ok).map(([i]) => i);
  const marks = new Map(state.marks);
  for (const i of missed) marks.delete(i);
  return { hide: state.hide, order: shuffled(missed, random), at: 0, shown: false, marks };
}

export const currentOf = (state: CheckState): number | null => (state.at < state.order.length ? state.order[state.at] : null);
export const isDone = (state: CheckState): boolean => state.at >= state.order.length;

/** 今の問いに ○（ok）か × をつけて次へ */
export function grade(state: CheckState, ok: boolean): void {
  const i = currentOf(state);
  if (i === null) return;
  state.marks.set(i, ok);
  state.at++;
  state.shown = false;
}

/** 図の番号を押したら、その名前を先に問う（まだ問うていない番号だけ。そうでなければ false） */
export function jump(state: CheckState, i: number): boolean {
  const k = state.order.indexOf(i, state.at);
  if (k < 0 || k === state.at) return false;
  state.order.splice(k, 1);
  state.order.splice(state.at, 0, i);
  state.shown = false;
  return true;
}

/** 図に渡す様子: まだ答えを出していない名前を隠す */
export function checkView(state: CheckState): CheckView {
  const rest = state.order.slice(state.at).filter((_, k) => !(k === 0 && state.shown));
  return { hide: state.hide, hidden: new Set(rest), marks: state.marks };
}

/** 終わった回の結果（どの名前にも○×がついている） */
export function resultOf(state: CheckState, labels: readonly PlateLabel[], at = nowIso()): CheckResult {
  const missed = labels.flatMap((label, i) => (state.marks.get(i) === true ? [] : [labelKey(label)]));
  return { right: labels.length - missed.length, total: labels.length, missed, at };
}

/** 前回の × の番号（今の図に無い名前は除く） */
export function missedOf(result: CheckResult | undefined, labels: readonly PlateLabel[]): number[] {
  if (!result?.missed.length) return [];
  const missed = new Set(result.missed);
  return labels.flatMap((label, i) => (missed.has(labelKey(label)) ? [i] : []));
}

function isResult(value: unknown): value is CheckResult {
  const item = value as CheckResult;
  return !!item && typeof item.right === "number" && typeof item.total === "number" && Array.isArray(item.missed) && typeof item.at === "string";
}

export async function loadResults(plateId: string): Promise<CheckResults> {
  const value = (await db.settings.get(checkKey(plateId)))?.value as Record<string, unknown> | undefined;
  const out: CheckResults = {};
  for (const [kind] of HIDE_KINDS) if (isResult(value?.[kind])) out[kind] = value[kind] as CheckResult;
  return out;
}

async function saveResult(plateId: string, hide: HideKind, result: CheckResult): Promise<CheckResults> {
  const all = { ...(await loadResults(plateId)), [hide]: result };
  await db.settings.put({ key: checkKey(plateId), value: all, updatedAt: nowIso() });
  return all;
}

/** 「11/25」 */
const dayOf = (iso: string) => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : `${date.getMonth() + 1}/${date.getDate()}`;
};

/** 前回の結果の短い文（「前回 18 / 22」・全部○なら「前回 全部○」） */
export function resultText(result: CheckResult): string {
  return result.right === result.total ? `前回 全部○（${dayOf(result.at)}）` : `前回 ${result.right} / ${result.total}（${dayOf(result.at)}）`;
}

export interface PlateChecker {
  /** 確かめている間（選ぶ欄を開いているときも） */
  active(): boolean;
  /** 図に渡す様子（確かめていなければ null） */
  view(): CheckView | null;
  /** 今の問いの番号（終わったら null） */
  current(): number | null;
  /** 今の問いの答えを出したか */
  shown(): boolean;
  /** 隠し方を選ぶ欄を開く */
  open(): void;
  /** 図の番号・名前を押した。まだ問うていない名前なら、それを先に問うて true */
  tap(i: number): boolean;
  /** 上の帯の中身（確かめている間） */
  tools(): (Node | string)[];
  /** 前回の結果（図ごと・隠し方ごと） */
  results(): CheckResults;
}

/**
 * 隠して確かめるの進め方と、図の下の欄（bar）。図の上の帯（tools）は描き直しのときに organs.ts が入れる。
 * キーボード: スペース・Enter で答えを見る、← か 1 で ×、→ か 2 で ○、Esc でやめる
 */
export function plateChecker(options: {
  plateId: string;
  labels: readonly PlateLabel[];
  signal: AbortSignal;
  bar: HTMLElement;
  /** 様子が変わった（図・帯・一覧を描き直す）。keep なら選んだ名前はそのまま（前回の結果を読み終えただけ） */
  changed: (keep?: boolean) => void;
  /** 答えを出した（読み上げなど） */
  revealed?: (i: number) => void;
  /** 確かめ始めた（はじめの案内を消す） */
  started?: () => void;
}): PlateChecker {
  const { plateId, labels, signal, bar } = options;
  let state: CheckState | null = null;
  let picking = false;
  let results: CheckResults = {};
  void loadResults(plateId).then((value) => {
    results = value;
    // 選ぶ欄と欄の札に前回の結果を出す
    if (picking) renderBar();
    options.changed(true);
  }).catch(() => undefined);

  const render = () => {
    renderBar();
    options.changed();
  };
  const start = (next: CheckState) => {
    state = next;
    picking = false;
    options.started?.();
    render();
  };
  const quit = () => {
    state = null;
    picking = false;
    render();
  };
  const show = () => {
    if (!state || state.shown || isDone(state)) return;
    state.shown = true;
    render();
    const i = currentOf(state);
    if (i !== null) options.revealed?.(i);
  };
  const mark = (ok: boolean) => {
    if (!state || !state.shown) return;
    grade(state, ok);
    if (isDone(state)) {
      const done = state;
      void saveResult(plateId, done.hide, resultOf(done, labels)).then((value) => {
        results = value;
      }).catch(() => undefined);
    }
    render();
  };

  const button = (text: string, cls: string, onClick: () => void, extra: Record<string, string> = {}) => h("button", { class: cls, type: "button", onClick, ...extra }, text);
  const num = (i: number) => h("span", { class: "pc-num", "aria-hidden": "true" }, String(i + 1));

  /** 隠し方を選ぶ欄: 3つの隠し方（前回の結果つき）・前回の × だけ・やり方 */
  const pickSheet = () => {
    const again = HIDE_KINDS.flatMap(([kind, name]) => {
      const only = missedOf(results[kind], labels);
      return only.length ? [button(`${name}：前回の × ${only.length}つだけ`, "chip pc-again", () => start(newRound(kind, labels.length, only)))] : [];
    });
    return [
      h("div", { class: "pc-head" },
        h("p", { class: "pc-title" }, "何を隠して確かめますか？"),
        button("×", "pc-close", quit, { "aria-label": "閉じる" })),
      h("div", { class: "pc-kinds" }, ...HIDE_KINDS.map(([kind, name, how]) => h("button", {
        class: "pc-kind", type: "button", onClick: () => start(newRound(kind, labels.length)),
      },
      h("b", {}, name),
      h("small", {}, how),
      results[kind] ? h("small", { class: "pc-last" }, resultText(results[kind]!)) : ""))),
      again.length ? h("div", { class: "pc-again-row" }, ...again) : "",
      h("p", { class: "pc-how" }, `${labels.length}の名前を、ばらばらの順に1つずつ出します。思い出してから「答えを見る」を押し、○か×を自分でつけます。図の番号を押すと、その名前から。`),
    ];
  };

  /** 問い: 番号と、隠し方によって英語か日本語の手がかり */
  const question = (s: CheckState, i: number) => {
    const { ja, en } = labelName(labels[i]);
    const ask = s.hide === "all"
      ? [h("b", {}, "この番号の名前は？")]
      : s.hide === "ja"
        ? [h("span", { class: "pc-cue", lang: "en" }, en), h("b", {}, "日本語は？")]
        : [h("span", { class: "pc-cue" }, ja), h("b", {}, "英語は？")];
    return [h("div", { class: "pc-row" }, num(i), h("p", { class: "pc-text" }, ...ask),
      button("答えを見る", "primary pc-show", show)),
    h("p", { class: "pc-keys" }, "スペースで答え")];
  };

  const answer = (i: number) => {
    const { ja, en } = labelName(labels[i]);
    return [h("div", { class: "pc-row" }, num(i), h("p", { class: "pc-text pc-answer" }, h("span", { class: "pc-ja" }, ja), h("span", { class: "pc-en", lang: "en" }, en)),
      h("div", { class: "pc-grade" },
        button("× まだ", "pc-ng", () => mark(false)),
        button("○ わかった", "pc-ok", () => mark(true)))),
    h("p", { class: "pc-keys" }, "← まだ ・ → わかった")];
  };

  /** 終わり: ○の数と、× をもう一度・ほかの隠し方・終える */
  const summary = (s: CheckState) => {
    const ng = [...s.marks.values()].filter((ok) => !ok).length;
    const right = labels.length - ng;
    return [
      h("p", { class: "pc-sum" }, ng ? h("b", {}, `${labels.length}のうち ${right} が○`) : h("b", {}, `全部○です（${labels.length}）`),
        ng ? h("span", {}, `× の${ng}つは図に赤で出ています`) : h("span", {}, "ほかの隠し方でも確かめてみましょう")),
      h("div", { class: "pc-end" },
        ng ? button(`× の${ng}つをもう一度`, "primary", () => start(retryRound(s))) : "",
        button("ほかの隠し方で", "ghost-button", () => {
          state = null;
          picking = true;
          render();
        }),
        button("終える", "ghost-button", quit)),
    ];
  };

  const renderBar = () => {
    const s = state;
    const i = s ? currentOf(s) : null;
    const content = picking ? pickSheet() : !s ? null : isDone(s) ? summary(s) : i === null ? null : s.shown ? answer(i) : question(s, i);
    bar.hidden = !content;
    bar.classList.toggle("pc-picking", picking);
    if (content) bar.replaceChildren(...content);
    else bar.replaceChildren();
    // 押したあと、次のボタンへ（キーボードで続けられるように。画面の読み上げにも）
    bar.querySelector<HTMLElement>(".pc-show, .pc-ok, .pc-end .primary")?.focus({ preventScroll: true });
  };

  onKeys(signal, (key) => {
    if (!state && !picking) return false;
    if (key === "Escape") {
      quit();
      return true;
    }
    if (!state || isDone(state)) return false;
    if (!state.shown && (key === " " || key === "Enter")) show();
    else if (state.shown && (key === "ArrowLeft" || key === "1")) mark(false);
    else if (state.shown && (key === "ArrowRight" || key === "2")) mark(true);
    else return false;
    return true;
  });

  return {
    active: () => !!state || picking,
    view: () => (state ? checkView(state) : null),
    current: () => (state ? currentOf(state) : null),
    shown: () => !!state?.shown,
    open: () => {
      state = null;
      picking = true;
      render();
    },
    tap: (i) => {
      if (!state || isDone(state) || !jump(state, i)) return false;
      render();
      return true;
    },
    tools: () => {
      const s = state;
      if (!s && !picking) return [];
      const count = s ? (isDone(s) ? "おわり" : `${s.at + 1} / ${s.order.length}`) : "";
      return [
        button("やめる", "chip pc-quit", quit),
        h("span", { class: "pc-mode" }, s ? KIND_NAME[s.hide] : "隠して確かめる"),
        count ? h("span", { class: "pc-count" }, count) : "",
      ];
    },
    results: () => results,
  };
}

/** はじめの案内（db.settings のキー。見た回数、確かめたか × で閉じたら -1） */
export const CHECK_TIP_KEY = "plateCheckTip";
const CHECK_TIP_TIMES = 3;

/**
 * 「隠して確かめる」を知らない人へ、ボタンの下に吹き出しで（平面図を開いたとき、確かめたことが無ければ3回まで）。
 * 「やってみる」で隠し方を選ぶ欄を開く
 */
export async function checkTip(layer: HTMLElement, anchor: HTMLElement, signal: AbortSignal, tryIt: () => void): Promise<void> {
  const saved = (await db.settings.get(CHECK_TIP_KEY))?.value;
  const seen = typeof saved === "number" ? saved : 0;
  if (seen < 0 || seen >= CHECK_TIP_TIMES || signal.aborted) return;
  void db.settings.put({ key: CHECK_TIP_KEY, value: seen + 1, updatedAt: nowIso() });
  const close = () => {
    tip.remove();
    void db.settings.put({ key: CHECK_TIP_KEY, value: -1, updatedAt: nowIso() });
  };
  const tip = h("aside", { class: "pc-tip", "aria-label": "隠して確かめるの案内" },
    h("p", { class: "pc-tip-title" }, "覚えたら、名前を隠して確かめる"),
    h("p", {}, "図の名前を隠して、1つずつ思い出します。日本語だけ・英語だけを隠すことも。まちがえた所はもう一度。"),
    h("div", { class: "pc-tip-row" },
      h("button", { class: "primary", type: "button", onClick: () => { close(); tryIt(); } }, "やってみる"),
      h("button", { class: "ghost-button", type: "button", onClick: close }, "あとで")));
  const place = () => {
    tip.style.top = `${anchor.offsetTop + anchor.offsetHeight + 10}px`;
    tip.style.setProperty("--tip-x", `${anchor.offsetLeft + Math.min(anchor.offsetWidth / 2, 60)}px`);
  };
  layer.append(tip);
  place();
  signal.addEventListener("abort", () => tip.remove(), { once: true });
}

/** 確かめたら案内を出さない */
export async function checkTipDone(): Promise<void> {
  if ((await db.settings.get(CHECK_TIP_KEY))?.value === -1) return;
  await db.settings.put({ key: CHECK_TIP_KEY, value: -1, updatedAt: nowIso() });
}
