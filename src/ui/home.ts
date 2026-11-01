import { systems, termById, units, type Unit } from "../content";
import { db, nowIso, type LearnedTerm, type StoredSchedule } from "../db";
import { EXAM_KINDS, examProgress, kindLabels, SECTION_KINDS, SORT_KINDS } from "../exam";
import { h } from "../dom";
import { installHint } from "../install";
import { rootKey, rootUnits } from "../roots";
import { normalize, searchTerms, searchUnits } from "../search";
import { daysUntilExam, preferences } from "../settings";
import { todayCounts } from "./review";
import type { AppContext } from "./context";

export async function home(ctx: AppContext): Promise<void> {
  ctx.viewer.highlight([]);
  ctx.viewer.overview();
  // ホームでは皮膚と骨格だけを読み込む（全系統だと初めて開いたとき約25MB。ほかの系統は使う画面で読み込む）
  void ctx.viewer.show({ systems: ["skeletal"], body: true });
  ctx.hint("ドラッグで回転・ダブルタップで拡大");

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const [learned, counts, answeredToday, hintClosed, openSetting, schedules] = await Promise.all([
    db.learned.toArray(), todayCounts(), db.reviewEvents.where("reviewedAt").aboveOrEqual(startOfDay.toISOString()).count(),
    db.settings.get("installHintClosed"), db.settings.get(OPEN_FOLDERS), db.schedules.toArray(),
  ]);
  const learnedIds = new Set(learned.map((item) => item.termId));
  const due = counts.review + counts.fresh;
  // 開いたフォルダーは覚えておき、レッスンから戻ったときも開いたままにする
  const openIds = new Set(Array.isArray(openSetting?.value) ? (openSetting.value as string[]) : []);
  const folder = (id: string, title: (Node | string)[], summary: string, allDone: boolean, list: HTMLElement, kind = "system folder"): HTMLElement =>
    h("details", {
      class: allDone ? `${kind} done` : kind,
      open: openIds.has(id),
      ontoggle: (event: Event) => {
        if ((event.currentTarget as HTMLDetailsElement).open) openIds.add(id);
        else openIds.delete(id);
        void db.settings.put({ key: OPEN_FOLDERS, value: [...openIds], updatedAt: nowIso() });
      },
    },
      h("summary", {},
        h("span", { class: "folder-title" }, ...title),
        h("span", { class: "folder-count" }, summary),
      ),
      list,
    );
  const nextUnit = nextLesson(learned);
  const recent = recentLessons(learned).filter((unit) => unit !== nextUnit);
  /** レッスンの行。途中まで学んだレッスンには「途中」の印 */
  const unitRow = (unit: Unit) => {
    const done = unit.terms.filter((term) => learnedIds.has(term.id)).length;
    return h("li", {},
      h("a", { href: `#/learn/${unit.id}`, class: done === unit.terms.length ? "unit done" : done ? "unit partial" : "unit" },
        h("span", { class: "unit-title" }, unit.title),
        h("span", { class: "unit-count" }, done ? `${done}/${unit.terms.length}語` : `${unit.terms.length}語`),
      ));
  };
  const lessonLink = (className: string) => nextUnit ? h("a", { class: className, href: `#/learn/${nextUnit.id}` }, `次のレッスン「${nextUnit.title}」`) : "";

  // 検索: レッスンの題と語。打っている間はフォルダーの代わりに当たったものを並べる
  const search = h("input", {
    class: "search", type: "search", placeholder: "レッスン・語を探す", "aria-label": "レッスンと語を探す",
    oninput: () => {
      const query = normalize(search.value.trim());
      folders.hidden = !!query;
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
          h("span", {}, term.ja, h("span", { class: "term-where" }, `${systems.find((s) => s.id === term.system)?.ja ?? ""}・${unitTitle(term.unit)}`)),
          h("span", { class: "en", lang: "en" }, term.en))))) : "",
      lessons.length || found.length ? "" : h("p", { class: "muted" }, "見つかりませんでした。"),
    );
  };

  const folders = h("div", {}, ...systems.flatMap((system) => {
      const list = units.filter((unit) => unit.system === system.id);
      if (!list.length) return [];
      const total = list.reduce((sum, unit) => sum + unit.terms.length, 0);
      const done = list.reduce((sum, unit) => sum + unit.terms.filter((term) => learnedIds.has(term.id)).length, 0);
      // まとまり（骨格系の体幹・上肢など）のある系統は、系統→まとまり→レッスンの入れ子のフォルダーにする
      const groups = [...new Set(list.map((unit) => unit.group))];
      const content = groups[0]
        ? h("div", { class: "subfolders" }, ...groups.map((group) => {
          const inGroup = list.filter((unit) => unit.group === group);
          const groupTotal = inGroup.reduce((sum, unit) => sum + unit.terms.length, 0);
          const groupDone = inGroup.reduce((sum, unit) => sum + unit.terms.filter((term) => learnedIds.has(term.id)).length, 0);
          return folder(`${system.id}/${group}`, [group ?? ""], `${inGroup.length}レッスン・${groupDone ? `${groupDone}/${groupTotal}` : groupTotal}語`,
            groupDone === groupTotal, h("ul", { class: "units" }, ...inGroup.map(unitRow)), "subfolder");
        }))
        : h("ul", { class: "units" }, ...list.map(unitRow));
      const section = folder(system.id,
        [h("span", { class: "swatch", style: `background:${system.color}` }), system.ja],
        `${list.length}レッスン・${done ? `${done}/${total}` : total}語`,
        done === total,
        content,
      );
      // 語根カードは基本の用語のすぐ後に（英語名の意味が分かると、どの系統の語も覚えやすくなる）。骨学試験は骨格系の後に
      if (system.id === "basics") return [section, rootSection(learnedIds, folder)];
      if (system.id === "skeletal") return [section, examSection(learnedIds, schedules, folder)];
      return [section];
    }));

  ctx.panel.replaceChildren(
    learned.length ? "" : welcome(),
    h("section", { class: "today" },
      h("h2", {}, "今日の問題", answeredToday ? h("span", { class: "today-done" }, `今日 ${answeredToday}問 解いた`) : ""),
      h("p", { class: "today-count" }, due ? `${due}問` : "なし",
        due ? h("span", { class: "today-split" }, `復習 ${counts.review}・新しい ${counts.fresh}`) : ""),
      // 復習が残っていても、新しいレッスンへ進めるようにする
      due ? h("a", { class: "primary", href: "#/review" }, "復習する") : nextUnit ? lessonLink("primary") : h("p", {}, "すべてのレッスンを終えました"),
      due ? lessonLink("ghost-button next-lesson") : "",
      learnedIds.size ? h("div", { class: "nav-row" },
        h("a", { class: "ghost-button", href: "#/drill" }, "範囲を選ぶ"),
        h("a", { class: "ghost-button", href: "#/drill/weak" }, "苦手を解く"),
      ) : "",
    ),
    examCountdown(learnedIds, schedules),
    backupReminder(learned),
    hintClosed ? "" : installHint(ctx.signal, () => void db.settings.put({ key: "installHintClosed", value: true, updatedAt: nowIso() })),
    recent.length ? h("section", { class: "recent" },
      h("h3", {}, "最近のレッスン"),
      h("ul", { class: "units" }, ...recent.map(unitRow)),
    ) : "",
    search,
    results,
    folders,
    h("p", { class: "footer-link" }, h("a", { href: "#/credits" }, "出典・クレジット")),
  );
}

const OPEN_FOLDERS = "homeOpenFolders";

/**
 * 次に学ぶレッスン（ホームと復習・レッスンの終わりに出す）。最後に学んだレッスンが途中ならそれ、終えていれば
 * 同じまとまり→同じ系統の、後ろにあるまだ終えていないレッスン。何も学んでいなければ最初のレッスン。
 */
export function nextLesson(learned: LearnedTerm[]): Unit | undefined {
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

/** 最近学んだレッスン（新しい順に3つまで）。記録のレッスンIDは並べ直しで変わるので、語から今のレッスンを引く */
function recentLessons(learned: LearnedTerm[]): Unit[] {
  const latest = new Map<string, string>();
  for (const item of learned) {
    const unit = termById.get(item.termId)?.unit;
    if (unit && (latest.get(unit) ?? "") < item.learnedAt) latest.set(unit, item.learnedAt);
  }
  return [...latest].sort((a, b) => b[1].localeCompare(a[1])).slice(0, 3).flatMap(([id]) => units.filter((unit) => unit.id === id));
}

/** はじめて開いたとき（何も学んでいないとき）の案内 */
function welcome(): HTMLElement {
  return h("section", { class: "welcome" },
    h("h2", {}, "はじめての方へ"),
    h("ol", {},
      h("li", {}, h("b", {}, "3Dを動かす: "), "1本指で回し、2本指でつまんで拡大します。3Dの右上の「?」に操作の一覧があります。"),
      h("li", {}, h("b", {}, "レッスン → 復習: "), "レッスンで3Dを見ながら名前を覚え、確認テストに答えると、その語が毎日の復習に入ります。忘れかけたころにもう一度出ます。"),
      h("li", {}, h("b", {}, "骨学試験の対策: "), "下の「骨格系」と「骨学試験」のフォルダーから。設定（⚙）で試験の日を入れると、1日の目安が出ます。"),
    ),
  );
}

/** 骨学試験の日を決めていれば、残りの日数と、まだ学んでいない項目を1日いくつ解けば間に合うか */
function examCountdown(learnedIds: Set<string>, schedules: StoredSchedule[]): HTMLElement | string {
  const days = daysUntilExam();
  if (days === null) return "";
  const kinds = [...SECTION_KINDS, ...SORT_KINDS];
  const rest = kinds.map((kind) => {
    const { done, total } = examProgress(kind, learnedIds, schedules);
    return { kind, rest: total - done };
  });
  const left = rest.reduce((sum, item) => sum + item.rest, 0);
  const next = rest.find((item) => item.rest > 0);
  const perDay = Math.ceil(left / Math.max(1, days));
  return h("section", { class: "countdown" },
    h("h2", {}, days ? `骨学試験まで あと${days}日` : "骨学試験は今日", h("span", { class: "today-done" }, preferences.examDate.replaceAll("-", "/"))),
    left
      ? h("p", {}, `まだ学んでいない項目 ${left} → 1日 ${perDay}項目で間に合います。`)
      : h("p", {}, "骨学試験の項目はすべて学びました。毎日の復習と「苦手な順に解く」で仕上げましょう。"),
    next ? h("a", { class: "ghost-button", href: `#/exam/${next.kind}` }, `今日の分を解く（${kindLabels[next.kind]}）`) : h("a", { class: "ghost-button", href: "#/exam" }, "骨学試験の一覧"),
  );
}

/** 記録を書き出してから（一度も書き出していなければ学び始めてから）14日たったら知らせる。記録は端末の中だけにあるので */
function backupReminder(learned: LearnedTerm[]): HTMLElement | string {
  if (!learned.length) return "";
  const since = preferences.lastBackupAt || learned.reduce((first, item) => (item.learnedAt < first ? item.learnedAt : first), learned[0].learnedAt);
  if (Date.now() - new Date(since).getTime() < 14 * 86_400_000) return "";
  return h("aside", { class: "install reminder" },
    h("p", {}, preferences.lastBackupAt ? "記録を書き出してから2週間たちました。" : "学び始めてから2週間たちました。",
      "記録はこの端末の中だけにあるので、故障や機種変更に備えて書き出しておきましょう。", h("br"),
      h("a", { href: "#/settings" }, "設定で書き出す")),
  );
}

function unitTitle(unitId: string): string {
  return units.find((unit) => unit.id === unitId)?.title ?? "";
}

type Folder = (id: string, title: (Node | string)[], summary: string, allDone: boolean, list: HTMLElement) => HTMLElement;

/** 骨学試験（A〜D と整理して覚える項目）。押すとまだ学んでいない項目を出る順に解く */
function examSection(learnedIds: Set<string>, schedules: StoredSchedule[], folder: Folder): HTMLElement {
  const progress = EXAM_KINDS.map((kind) => ({ kind, ...examProgress(kind, learnedIds, schedules) }));
  const done = progress.reduce((sum, p) => sum + p.done, 0);
  const total = progress.reduce((sum, p) => sum + p.total, 0);
  return folder("exam",
    [h("span", { class: "swatch exam-swatch" }), "骨学試験"],
    `A〜D・整理 ${done ? `${done}/${total}` : total}項目`,
    done === total,
    h("ul", { class: "units" },
      h("li", {}, h("a", { class: "unit unit-all", href: "#/exam" }, h("span", { class: "unit-title" }, "骨学試験の一覧"), h("span", { class: "unit-count" }, "→"))),
      ...progress.map((p) => h("li", {},
        h("a", { href: `#/exam/${p.kind}`, class: p.done === p.total ? "unit done" : "unit" },
          h("span", { class: "unit-title" }, kindLabels[p.kind]),
          h("span", { class: "unit-count" }, `${p.done ? `${p.done}/${p.total}` : `${p.total}問`}${p.mastery === null ? "" : `・覚え ${Math.round(p.mastery * 100)}%`}`),
        )))),
  );
}

function rootSection(learnedIds: Set<string>, folder: Folder): HTMLElement {
  const total = rootUnits.reduce((sum, unit) => sum + unit.roots.length, 0);
  const done = rootUnits.reduce((sum, unit) => sum + unit.roots.filter((root) => learnedIds.has(rootKey(root))).length, 0);
  return folder("roots",
    [h("span", { class: "swatch root-swatch" }), "語根カード"],
    `${rootUnits.length}レッスン・${done ? `${done}/${total}` : total}個`,
    done === total,
    h("ul", { class: "units" },
      h("li", {}, h("a", { class: "unit unit-all", href: "#/roots" }, h("span", { class: "unit-title" }, "語根の一覧"), h("span", { class: "unit-count" }, "→"))),
      ...rootUnits.map((unit) => {
      const done = unit.roots.filter((root) => learnedIds.has(rootKey(root))).length;
      return h("li", {},
        h("a", { href: `#/roots/${unit.id}`, class: done === unit.roots.length ? "unit done" : "unit" },
          h("span", { class: "unit-title" }, unit.title.replace("語根：", "")),
          h("span", { class: "unit-count" }, done ? `${done}/${unit.roots.length}` : `${unit.roots.length}個`),
        ));
      })),
  );
}
