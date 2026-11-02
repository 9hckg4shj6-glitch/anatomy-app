import { systems, terms, units } from "../content";
import { db } from "../db";
import { h } from "../dom";
import { retrievability } from "../fsrs";
import { preferences } from "../settings";
import { facetsFor, practiceQueue, TERM_KINDS, unlockedTerms, type PracticeCandidate } from "../study";
import type { AppContext } from "./context";
import { ask, showPanel } from "./quiz";

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
  // 覚え具合は解くたびに変わるので、「もう一度」のときに読み直す
  let scheduleOf = new Map(schedules.map((s) => [s.cardId, s]));
  let unlocked = unlockedTerms(schedules, preferences.studyFacets);
  const reload = async () => {
    const fresh = await db.schedules.toArray();
    scheduleOf = new Map(fresh.map((s) => [s.cardId, s]));
    unlocked = unlockedTerms(fresh, preferences.studyFacets);
  };
  const learnedTerms = terms.filter((term) => learnedIds.has(term.id));
  const available = systems.filter((system) => learnedTerms.some((term) => term.system === system.id));

  const chosen = new Set(available.map((system) => system.id));
  // 問い方は、設定の「学ぶ問い方」で選んだものから始める（演習では外したものも選べる）
  const studied = TERM_KINDS.filter((kind) => kind.facets.some((facet) => preferences.studyFacets.includes(facet)));
  const kinds = new Set((studied.length ? studied : TERM_KINDS).map((kind) => kind.key));
  /** まとまり（骨格系の頭蓋など）。系統を1つだけ選んだときに絞れる。空なら全部 */
  const groups = new Set<string>();
  const groupOf = new Map(units.map((unit) => [unit.id, unit.group]));
  let count = 20;
  let weak = mode === "weak";
  let note = "";

  const groupsOf = (systemId: string) => [...new Set(units.filter((unit) => unit.system === systemId && unit.group).map((unit) => unit.group!))]
    .filter((group) => learnedTerms.some((term) => term.system === systemId && groupOf.get(term.unit) === group));
  const inGroups = (unitId: string) => !groups.size || chosen.size !== 1 || groups.has(groupOf.get(unitId) ?? "");

  const candidates = (): PracticeCandidate[] => learnedTerms
    .filter((term) => chosen.has(term.system) && inGroups(term.unit))
    .flatMap((term) => facetsFor(term, unlocked.has(term.id))
      .filter((facet) => TERM_KINDS.some((kind) => kinds.has(kind.key) && kind.facets.includes(facet)))
      .map((facet) => {
        const schedule = scheduleOf.get(`${term.id}:${facet}`);
        return { termId: term.id, facet, recall: retrievability(schedule), lapses: schedule?.lapses ?? 0 };
      }))
    // 苦手な順のときは、一度は解いたことのある問い方から選ぶ
    .filter((c) => !weak || c.recall !== null);

  // 最後の1つは消せない（何も出せなくなるので）。押したら理由を出す
  const toggle = (set: Set<string>, key: string) => {
    note = "";
    if (set.has(key) && set.size === 1) note = "少なくとも1つは選んでおきます。ほかを選んでから外してください。";
    else if (set.has(key)) set.delete(key);
    else set.add(key);
  };
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
    const only = chosen.size === 1 ? groupsOf([...chosen][0]) : [];
    showPanel(ctx,
      h("div", { class: "quiz-head" }, h("a", { href: "#/" }, "← ホーム"), ""),
      h("h2", {}, weak ? "苦手な語を解く" : "範囲を選んで解く"),
      learnedTerms.length ? "" : h("p", {}, "まだレッスンで学んだ語がありません。ホームからレッスンを始めましょう。"),
      h("h3", {}, "系統"),
      chips(available.map((system) => ({ key: system.id, label: system.ja })), (key) => chosen.has(key), (key) => {
        toggle(chosen, key);
        groups.clear();
      }),
      only.length > 1 ? h("h3", {}, "まとまり", h("span", { class: "muted" }, "（選ばなければ全部）")) : "",
      only.length > 1 ? chips(only.map((group) => ({ key: group, label: group })), (key) => groups.has(key), (key) => {
        if (groups.has(key)) groups.delete(key);
        else groups.add(key);
      }) : "",
      h("h3", {}, "問い方"),
      chips(TERM_KINDS.map((kind) => ({ key: kind.key, label: kind.label })), (key) => kinds.has(key), (key) => toggle(kinds, key)),
      h("h3", {}, "問題の数"),
      chips(COUNTS.map((n) => ({ key: String(n), label: `${n}問` })), (key) => key === String(count), (key) => (count = Number(key))),
      h("h3", {}, "出し方"),
      chips([{ key: "mix", label: "まぜる" }, { key: "weak", label: "苦手な順" }], (key) => (key === "weak") === weak, (key) => (weak = key === "weak")),
      note ? h("p", { class: "drill-note" }, note) : "",
      pool.length ? h("p", { class: "muted" }, `${pool.length}問の中から出します。答えは復習の記録にも入り、次に出る日が変わります。`)
        : weak && learnedTerms.length ? h("p", { class: "drill-note" }, "苦手な順は、一度でも解いた問題から選びます。選んだ範囲で解いた問題がまだありません（「まぜる」なら解けます）。")
          : h("p", { class: "muted" }, "選んだ範囲に問題がありません。"),
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
    // 同じ条件でもう一度（覚え具合を読み直してから選ぶ）。条件を変えるときは設定の画面へ
    const again = h("button", {
      class: "primary", type: "button", onClick: () => void reload().then(() => run(practiceQueue(candidates(), count, weak))).catch((error) => {
        if (!ctx.signal.aborted) throw error;
      }),
    }, "同じ条件でもう一度");
    const change = h("button", { class: "text-button", type: "button", onClick: () => void reload().then(render) }, "条件を変える");
    showPanel(ctx,
      h("h2", {}, "演習おわり"),
      h("p", { class: "today-count" }, `${correct} / ${queue.length} 正解`),
      missed.size ? h("h3", {}, "まちがえた語（図鑑で見る）") : "",
      missed.size ? h("div", { class: "chip-list" }, ...[...missed].map((id) =>
        h("a", { class: "chip", href: `#/explore/${id}` }, terms.find((term) => term.id === id)?.ja ?? id))) : "",
      change,
      h("div", { class: "nav-row" }, h("a", { class: "ghost-button", href: "#/" }, "ホームへ"), again),
    );
  };

  render();
}
