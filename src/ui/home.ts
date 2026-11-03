import { organs, terms } from "../content";
import { db, nowIso, type LearnedTerm, type StoredSchedule } from "../db";
import { EXAM_KINDS, examProgress, SECTION_KINDS, SORT_KINDS, kindLabels } from "../exam";
import { h } from "../dom";
import { installHint } from "../install";
import { rootKey, rootUnits } from "../roots";
import { daysUntilExam, preferences } from "../settings";
import { nextLesson } from "./lessons";
import { todayCounts } from "./review";
import type { AppContext } from "./context";

/**
 * ホーム（#/）。3Dは出さず、今日の問題と、アプリの項目（レッスン・復習・図鑑…）を並べる。
 * 項目を押すとそれぞれのページへ移る（上の帯の「‹ ホーム」で戻る）
 */
export async function home(ctx: AppContext): Promise<void> {
  ctx.hint("");
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  // 続けた日数と、この7日に解いたかどうか（60日より前はさかのぼらない）
  const since = new Date(startOfDay.getTime() - 60 * 86_400_000).toISOString();
  const [learned, counts, recentEvents, hintClosed, schedules] = await Promise.all([
    db.learned.toArray(), todayCounts(), db.reviewEvents.where("reviewedAt").aboveOrEqual(since).toArray(),
    db.settings.get("installHintClosed"), db.schedules.toArray(),
  ]);
  if (ctx.signal.aborted) return;
  const learnedIds = new Set(learned.map((item) => item.termId));
  const due = counts.review + counts.fresh;
  const nextUnit = nextLesson(learned);
  const days = new Set(recentEvents.map((event) => dayKey(new Date(event.reviewedAt))));
  const answeredToday = recentEvents.filter((event) => event.reviewedAt >= startOfDay.toISOString()).length;

  const learnedTerms = terms.filter((term) => learnedIds.has(term.id)).length;
  const examAll = EXAM_KINDS.map((kind) => examProgress(kind, learnedIds, schedules));
  const examDone = examAll.reduce((sum, p) => sum + p.done, 0);
  const examTotal = examAll.reduce((sum, p) => sum + p.total, 0);
  const rootTotal = rootUnits.reduce((sum, unit) => sum + unit.roots.length, 0);
  const rootDone = rootUnits.reduce((sum, unit) => sum + unit.roots.filter((root) => learnedIds.has(rootKey(root))).length, 0);
  const plates = organs.reduce((sum, organ) => sum + organ.plates.length, 0);
  const admin = new URLSearchParams(location.search).has("admin");

  ctx.panel.replaceChildren(h("div", { class: "hub" },
    hero(due, counts, nextUnit, days, answeredToday, learnedTerms),
    learned.length ? "" : welcome(),
    examCountdown(learnedIds, schedules),
    backupReminder(learned),
    hintClosed ? "" : installHint(ctx.signal, () => void db.settings.put({ key: "installHintClosed", value: true, updatedAt: nowIso() })),
    tileGroup("学ぶ",
      tile({ href: "#/lessons", icon: "lesson", color: "#1f6f78", title: "レッスン", sub: "3Dを見ながら名前を覚える", progress: [learnedTerms, terms.length], unit: "語" }),
      tile({ href: "#/review", icon: "review", color: "#e0672a", title: "復習", sub: due ? `復習 ${counts.review}・新しい ${counts.fresh}` : "今日の分は終わり", badge: due ? `${due}問` : "" }),
      tile({ href: "#/drill", icon: "drill", color: "#6b5fb5", title: "演習", sub: "範囲を選ぶ・苦手を解く" }),
      tile({ href: "#/exam", icon: "exam", color: "#b07d10", title: "骨学試験", sub: "A〜D と整理して覚える", progress: [examDone, examTotal], unit: "項目" }),
    ),
    tileGroup("見る・調べる",
      tile({ href: "#/explore", icon: "explore", color: "#2f78b0", title: "図鑑", sub: `${terms.length.toLocaleString()}語を3Dで引く` }),
      tile({ href: "#/organs", icon: "organ", color: "#c2493a", title: "臓器の図", sub: `${organs.length}臓器・平面図 ${plates}枚` }),
      tile({ href: "#/roots", icon: "roots", color: "#2f8f55", title: "語根カード", sub: "英語名を部品から読む", progress: [rootDone, rootTotal], unit: "個" }),
    ),
    tileGroup("記録",
      tile({ href: "#/progress", icon: "progress", color: "#4f6d8f", title: "進捗", sub: "覚え具合を人体の色で見る" }),
      tile({ href: "#/settings", icon: "settings", color: "#77736a", title: "設定", sub: "試験の日・問い方・書き出し" }),
      admin ? tile({ href: "#/admin", icon: "settings", color: "#77736a", title: "ピン", sub: "部位のピンを打つ（管理用）" }) : "",
    ),
    h("p", { class: "footer-link" }, h("a", { href: "#/credits" }, "出典・クレジット")),
  ));
}

/** 上の大きな札: 日付とあいさつ、今日の問題と次の一手、この7日と続けた日数、覚えた語の輪 */
function hero(due: number, counts: { review: number; fresh: number }, nextUnit: ReturnType<typeof nextLesson>, days: Set<string>, answeredToday: number, learnedTerms: number): HTMLElement {
  const now = new Date();
  const hour = now.getHours();
  const greeting = hour >= 5 && hour < 11 ? "おはようございます" : hour >= 11 && hour < 18 ? "こんにちは" : "こんばんは";
  const weekday = ["日", "月", "火", "水", "木", "金", "土"];
  const day = (offset: number) => new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
  let streak = 0;
  for (let i = days.has(dayKey(now)) ? 0 : 1; days.has(dayKey(day(-i))); i++) streak++;
  const lessonLink = (className: string) => nextUnit
    ? h("a", { class: className, href: `#/learn/${nextUnit.id}` }, h("span", { class: "hero-button-label" }, "次のレッスン"), h("span", { class: "hero-button-title" }, nextUnit.title))
    : "";
  return h("section", { class: "hero" },
    h("div", { class: "hero-main" },
      h("p", { class: "hero-date" }, `${now.getMonth() + 1}月${now.getDate()}日（${weekday[now.getDay()]}）・${greeting}`),
      h("h2", { class: "hero-title" }, "今日の問題"),
      h("p", { class: "hero-count" },
        ...(due ? [h("b", {}, String(due)), h("span", {}, "問")] : [h("span", { class: "hero-clear" }, answeredToday ? "今日の分は終わり" : "復習はありません")]),
        due ? h("span", { class: "hero-split" }, `復習 ${counts.review}・新しい ${counts.fresh}`) : ""),
      h("div", { class: "hero-actions" },
        due ? h("a", { class: "hero-primary", href: "#/review" }, "復習する") : lessonLink("hero-primary"),
        due ? lessonLink("hero-secondary") : "",
        !due && !nextUnit ? h("p", { class: "hero-note" }, "すべてのレッスンを終えました") : "",
      ),
      h("div", { class: "hero-week", "aria-label": `この7日に解いた日・続けて${streak}日` },
        h("ol", { class: "week-dots" }, ...Array.from({ length: 7 }, (_, i) => {
          const date = day(i - 6);
          const on = days.has(dayKey(date));
          return h("li", { class: i === 6 ? (on ? "on today" : "today") : on ? "on" : "" }, h("span", { class: "dot" }), h("span", { class: "dot-label" }, weekday[date.getDay()]));
        })),
        h("p", { class: "hero-streak" }, ...(streak ? [h("b", {}, String(streak)), "日 続けています"] : ["今日から始めましょう"]),
          answeredToday ? h("span", {}, `・今日 ${answeredToday}問`) : ""),
      ),
    ),
    ring(learnedTerms, terms.length),
  );
}

/** 覚えた語の割合の輪 */
function ring(done: number, total: number): HTMLElement {
  const r = 52;
  const length = 2 * Math.PI * r;
  const ratio = total ? done / total : 0;
  const box = h("figure", { class: "hero-ring", role: "img", "aria-label": `学んだ語 ${done} / ${total}` },
    h("div", { class: "ring-text" },
      h("b", {}, done.toLocaleString()),
      h("span", {}, `/ ${total.toLocaleString()}語`),
      h("span", { class: "ring-percent" }, `${Math.floor(ratio * 100)}%`),
    ),
  );
  box.insertAdjacentHTML("afterbegin",
    `<svg viewBox="0 0 128 128" aria-hidden="true"><circle cx="64" cy="64" r="${r}" class="ring-track"/>`
    + (done ? `<circle cx="64" cy="64" r="${r}" class="ring-value" stroke-dasharray="${(length * ratio).toFixed(1)} ${length.toFixed(1)}"/>` : "") + "</svg>");
  return box;
}

function tileGroup(title: string, ...tiles: (HTMLElement | string)[]): HTMLElement {
  return h("section", { class: "tile-group" }, h("h3", {}, title), h("div", { class: "tiles" }, ...tiles));
}

interface TileSpec {
  href: string;
  icon: keyof typeof ICONS;
  color: string;
  title: string;
  sub: string;
  /** 終えた数と全体の数（細い帯で出す） */
  progress?: [number, number];
  unit?: string;
  /** 右上の印（復習の問題数など） */
  badge?: string;
}

function tile(spec: TileSpec): HTMLElement {
  const icon = h("span", { class: "tile-icon", "aria-hidden": "true" });
  icon.innerHTML = `<svg viewBox="0 0 24 24">${ICONS[spec.icon]}</svg>`;
  const [done, total] = spec.progress ?? [0, 0];
  return h("a", { class: "tile", href: spec.href, style: `--tile:${spec.color}` },
    icon,
    spec.badge ? h("span", { class: "tile-badge" }, spec.badge) : "",
    h("span", { class: "tile-title" }, spec.title),
    h("span", { class: "tile-sub" }, spec.sub),
    spec.progress ? h("span", { class: "tile-progress" },
      h("span", { class: "tile-bar" }, h("span", { style: `width:${total ? (done / total) * 100 : 0}%` })),
      h("span", { class: "tile-num" }, `${done.toLocaleString()}/${total.toLocaleString()}${spec.unit ?? ""}`),
    ) : "",
  );
}

/** 項目の絵（線で描く。色は CSS の currentColor） */
const ICONS = {
  lesson: `<path d="M3.5 5.5c2.8-1.2 5.8-1.1 8.5.6 2.7-1.7 5.7-1.8 8.5-.6v13c-2.8-1.2-5.8-1.1-8.5.6-2.7-1.7-5.7-1.8-8.5-.6Z"/><path d="M12 6.1v13"/>`,
  review: `<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3"/><path d="M19.5 4.5v4h-4"/><path d="M12 8.5V12l2.5 1.5"/>`,
  drill: `<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4.2"/><circle cx="12" cy="12" r="1" fill="currentColor"/>`,
  exam: `<rect x="5" y="4" width="14" height="17" rx="2.2"/><path d="M9 3h6v2.5H9z"/><path d="m8.8 13.2 2.2 2.2 4.2-4.4"/>`,
  explore: `<circle cx="10.5" cy="10.5" r="6.2"/><path d="m15.2 15.2 5 5"/><path d="M8 10.5h5M10.5 8v5"/>`,
  organ: `<path d="M12 20s-7.5-4.6-7.5-10.2A4.2 4.2 0 0 1 12 7.2a4.2 4.2 0 0 1 7.5 2.6C19.5 15.4 12 20 12 20Z"/><path d="M12 7.2V4"/>`,
  roots: `<path d="M12 21v-8"/><path d="M12 13c0-4 2.5-6.5 7-6.5 0 4-2.5 6.5-7 6.5Z"/><path d="M12 13c0-3-2-5-5.5-5 0 3 2 5 5.5 5Z"/>`,
  progress: `<path d="M4 20h16"/><path d="M7 17v-5M12 17V7M17 17v-8"/>`,
  settings: `<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>`,
};

function dayKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

/** はじめて開いたとき（何も学んでいないとき）の案内 */
function welcome(): HTMLElement {
  return h("section", { class: "welcome" },
    h("h2", {}, "はじめての方へ"),
    h("ol", {},
      h("li", {}, h("b", {}, "レッスン → 復習: "), "「レッスン」で3Dを見ながら名前を覚え、確認テストに答えると、その語が毎日の復習に入ります。忘れかけたころにもう一度出ます。"),
      h("li", {}, h("b", {}, "3Dを動かす: "), "1本指で回し、2本指でつまんで拡大します。3Dの右上の「?」に操作の一覧があります。"),
      h("li", {}, h("b", {}, "骨学試験の対策: "), "下の「骨学試験」から。「設定」で試験の日を入れると、1日の目安が出ます。"),
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
