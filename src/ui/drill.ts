import { systems, terms } from "../content";
import { db, type Facet } from "../db";
import { h } from "../dom";
import { retrievability, State } from "../fsrs";
import { facetsFor, MUSCLE_FACETS, practiceQueue, type PracticeCandidate } from "../study";
import type { AppContext } from "./context";
import { ask, showPanel } from "./quiz";

/** 演習で選べる問い方（筋の3つはまとめて1つ） */
const KINDS: { label: string; facets: Facet[] }[] = [
  { label: "位置→名前", facets: ["locate"] },
  { label: "名前→位置", facets: ["point"] },
  { label: "日本語→英語", facets: ["ja2en"] },
  { label: "英語→日本語", facets: ["en2ja"] },
  { label: "筋の起始・停止・神経・作用", facets: MUSCLE_FACETS },
  { label: "孔・溝を通るもの", facets: ["passage"] },
];
const COUNTS = [10, 20, 40];

/**
 * 演習：系統と問い方を選んで、レッスンで学んだ語から解く（試験前の総ざらい）。mode が "weak" なら苦手な順に出す。
 * 答えは復習と同じく記録し、次に出る日にも反映する。
 */
export async function drill(ctx: AppContext, mode: string): Promise<void> {
  const { viewer } = ctx;
  viewer.highlight([]);
  viewer.overview();
  ctx.hint("");
  const [learned, schedules] = await Promise.all([db.learned.toArray(), db.schedules.toArray()]);
  const learnedIds = new Set(learned.map((item) => item.termId));
  const scheduleOf = new Map(schedules.map((s) => [s.cardId, s]));
  const locateLearned = new Set(schedules.filter((s) => s.facet === "locate" && s.state === State.Review).map((s) => s.termId));
  const learnedTerms = terms.filter((term) => learnedIds.has(term.id));
  const available = systems.filter((system) => learnedTerms.some((term) => term.system === system.id));

  const chosen = new Set(available.map((system) => system.id));
  const kinds = new Set(KINDS.map((kind) => kind.label));
  let count = 20;
  let weak = mode === "weak";

  const candidates = (): PracticeCandidate[] => learnedTerms
    .filter((term) => chosen.has(term.system))
    .flatMap((term) => facetsFor(term, locateLearned.has(term.id))
      .filter((facet) => KINDS.some((kind) => kinds.has(kind.label) && kind.facets.includes(facet)))
      .map((facet) => {
        const schedule = scheduleOf.get(`${term.id}:${facet}`);
        return { termId: term.id, facet, recall: retrievability(schedule), lapses: schedule?.lapses ?? 0 };
      }))
    // 苦手な順のときは、一度は解いたことのある問い方から選ぶ
    .filter((c) => !weak || c.recall !== null);

  const toggle = (set: Set<string>, key: string) => (set.has(key) && set.size > 1 ? set.delete(key) : set.add(key));
  const chips = (items: { key: string; label: string }[], isOn: (key: string) => boolean, onClick: (key: string) => void) =>
    h("div", { class: "chip-list" }, ...items.map((item) =>
      h("button", { class: isOn(item.key) ? "chip on" : "chip", type: "button", onClick: () => { onClick(item.key); render(); } }, item.label)));

  const render = () => {
    const pool = candidates();
    const start = h("button", { class: "primary", type: "button", disabled: !pool.length }, "始める");
    // 演習の途中でほかの画面へ移ると、出題の待ちが中断される（画面を離れただけなのでエラーにしない）
    start.addEventListener("click", () => void run(practiceQueue(pool, count, weak)).catch((error) => {
      if (!ctx.signal.aborted) throw error;
    }));
    showPanel(ctx,
      h("h2", {}, weak ? "苦手な語を解く" : "範囲を選んで解く"),
      learnedTerms.length ? "" : h("p", {}, "まだレッスンで学んだ語がありません。ホームからレッスンを始めましょう。"),
      h("h3", {}, "系統"),
      chips(available.map((system) => ({ key: system.id, label: system.ja })), (key) => chosen.has(key), (key) => toggle(chosen, key)),
      h("h3", {}, "問い方"),
      chips(KINDS.map((kind) => ({ key: kind.label, label: kind.label })), (key) => kinds.has(key), (key) => toggle(kinds, key)),
      h("h3", {}, "問題の数"),
      chips(COUNTS.map((n) => ({ key: String(n), label: `${n}問` })), (key) => key === String(count), (key) => (count = Number(key))),
      h("h3", {}, "出し方"),
      chips([{ key: "mix", label: "まぜる" }, { key: "weak", label: "苦手な順" }], (key) => (key === "weak") === weak, (key) => (weak = key === "weak")),
      h("p", { class: "muted" }, `${pool.length}問の中から出します。答えは復習の記録にも入り、次に出る日が変わります。`),
      start,
    );
  };

  const run = async (queue: ReturnType<typeof practiceQueue>) => {
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
    const again = h("button", { class: "primary", type: "button", onClick: render }, "もう一度");
    showPanel(ctx,
      h("h2", {}, "演習おわり"),
      h("p", { class: "today-count" }, `${correct} / ${queue.length} 正解`),
      missed.size ? h("h3", {}, "まちがえた語（図鑑で見る）") : "",
      missed.size ? h("div", { class: "chip-list" }, ...[...missed].map((id) =>
        h("a", { class: "chip", href: `#/explore/${id}` }, terms.find((term) => term.id === id)?.ja ?? id))) : "",
      h("div", { class: "nav-row" }, h("a", { class: "ghost-button", href: "#/" }, "ホームへ"), again),
    );
  };

  render();
}
