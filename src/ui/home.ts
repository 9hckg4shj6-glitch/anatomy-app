import { organs, systems, terms, type Unit } from "../content";
import { beginnerTermCount, courseTerms, courseUnits, isBeginner } from "../course";
import { db, nowIso, type LearnedTerm, type StoredSchedule } from "../db";
import { EXAM_KINDS, examProgress, SECTION_KINDS, SORT_KINDS } from "../exam";
import { h } from "../dom";
import { installHint } from "../install";
import { rootKey, rootUnits } from "../roots";
import { daysUntilExam, preferences, setPreference } from "../settings";
import { nextLesson } from "./lessons";
import { todayCounts } from "./review";
import { sceneFor, termAt, type AppContext } from "./context";

/** ホームで最後に選んだ系統（ほかの画面から戻っても同じ系統を見せる） */
let shownSystem = "skeletal";

/**
 * ホーム（#/）。3Dの人体を大きく見せ、ゆっくり回す。3Dの下の系統のボタンでその系統を見せ、説明の欄にその系統の進み具合と次のレッスン。
 * 欄の上は今日の復習と続き（次の一手は1つだけ大きく）、下は学び方の一覧（レッスン・演習・図鑑など）。3Dの部位をタップすると図鑑で開く
 */
export async function home(ctx: AppContext): Promise<void> {
  const { viewer, signal } = ctx;
  ctx.hint("");
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  // 続けた日数（60日より前はさかのぼらない）
  const since = new Date(startOfDay.getTime() - 60 * 86_400_000).toISOString();
  const [learned, counts, recentEvents, hintClosed, schedules] = await Promise.all([
    db.learned.toArray(), todayCounts(), db.reviewEvents.where("reviewedAt").aboveOrEqual(since).toArray(),
    db.settings.get("installHintClosed"), db.schedules.toArray(),
  ]);
  if (signal.aborted) return;
  const learnedIds = new Set(learned.map((item) => item.termId));
  const days = new Set(recentEvents.map((event) => dayKey(new Date(event.reviewedAt))));
  const answeredToday = recentEvents.some((event) => event.reviewedAt >= startOfDay.toISOString());

  // 3Dに出せる系統（基本の用語・局所解剖は部品を持たないので、レッスンの一覧から）
  const bodySystems = systems.filter((system) => ctx.index.systems[system.id]);
  if (!bodySystems.some((system) => system.id === shownSystem)) shownSystem = "skeletal";

  const caption = h("div", { class: "home-caption", "aria-live": "polite" });
  const systemCard = h("section", { class: "home-card home-system", "aria-label": "系統" });
  const stage = ctx.tools.parentElement!;
  stage.append(caption);
  signal.addEventListener("abort", () => caption.remove(), { once: true });

  const chips = bodySystems.map((system) => h("button", {
    class: "chip", type: "button", style: `--swatch:${system.color}`,
    onClick: () => void choose(system.id),
  }, h("span", { class: "swatch" }), short(system.ja)));

  const choose = async (systemId: string) => {
    shownSystem = systemId;
    for (const [i, system] of bodySystems.entries()) {
      chips[i].classList.toggle("on", system.id === systemId);
      chips[i].setAttribute("aria-pressed", String(system.id === systemId));
    }
    const system = bodySystems.find((item) => item.id === systemId)!;
    const inSystem = courseTerms().filter((term) => term.system === systemId);
    const done = inSystem.filter((term) => learnedIds.has(term.id)).length;
    caption.replaceChildren(
      h("span", { class: "home-caption-kicker" }, "3Dで見る"),
      h("span", { class: "home-caption-title" }, system.ja),
      h("span", { class: "home-caption-sub" }, `${inSystem.length.toLocaleString()}語・学んだ ${done.toLocaleString()}語`),
    );
    systemCard.replaceChildren(...systemDetail(systemId, system.ja, system.color, learnedIds));
    await viewer.show(sceneFor(systemId));
    if (signal.aborted) return;
    viewer.highlight([]);
  };

  ctx.tools.replaceChildren(...chips);
  // 体の全体を、下の系統のボタンに足がかからないよう少し上に寄せて、やや引いて見せる
  const [lo, hi] = ctx.index.bounds;
  const height = hi[1] - lo[1];
  const target: [number, number, number] = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2 - height * 0.07, (lo[2] + hi[2]) / 2];
  const distance = (height * 0.74) / Math.tan((17.5 * Math.PI) / 180);
  viewer.setView([target, [target[0], target[1], target[2] + distance]]);
  viewer.spin(!matchMedia("(prefers-reduced-motion: reduce)").matches);
  viewer.onPick = (elementId, point) => {
    const term = termAt(ctx, elementId, point);
    if (term) location.hash = `#/explore/${term.id}`;
  };
  viewer.onHover = (elementId, point) => termAt(ctx, elementId, point)?.ja ?? null;

  const notices = [
    isBeginner() ? "" : examCountdown(learnedIds, schedules),
    backupReminder(learned),
    hintClosed ? "" : installHint(signal, () => void db.settings.put({ key: "installHintClosed", value: true, updatedAt: nowIso() })),
  ];
  ctx.panel.replaceChildren(h("div", { class: "home" },
    modeSwitch(),
    today(counts, nextLesson(learned), learnedIds, streakOf(days), answeredToday, !learned.length),
    systemCard,
    more(learnedIds, schedules),
    ...notices,
    h("p", { class: "home-footer" }, h("a", { href: "#/credits" }, "出典・クレジット")),
  ));
  await choose(shownSystem);
}

/** 今日の復習と、次の一手（復習があれば「復習を始める」、無ければ次のレッスン）。はじめての人には最初のレッスンと流れの一言 */
function today(counts: { review: number; fresh: number }, nextUnit: Unit | undefined, learnedIds: Set<string>, streak: number, answeredToday: boolean, first: boolean): HTMLElement {
  const now = new Date();
  const weekday = ["日", "月", "火", "水", "木", "金", "土"][now.getDay()];
  const due = counts.review + counts.fresh;
  const lessonRow = nextUnit ? continueRow(nextUnit, learnedIds) : "";
  if (first) {
    return h("section", { class: "home-card home-today" },
      h("p", { class: "home-kicker" }, "はじめに"),
      h("h2", { class: "home-title" }, "3Dを見ながら、名前を覚える"),
      h("p", { class: "home-lead" }, "レッスンで部位の名前を覚え、確認テストに答えると、その語が毎日の復習に入ります。忘れかけたころにもう一度出ます。",
        isBeginner() ? "初心者モードでは、まず絶対に覚える語だけを学びます。" : ""),
      nextUnit ? h("a", { class: "home-primary", href: `#/learn/${nextUnit.id}` }, `最初のレッスン「${nextUnit.title}」`) : "",
      h("p", { class: "home-note" }, "3Dは1本指で回し、2本指でつまんで拡大。部位をタップすると図鑑で開きます。"),
    );
  }
  return h("section", { class: "home-card home-today" },
    h("p", { class: "home-kicker" },
      h("span", {}, `${now.getMonth() + 1}月${now.getDate()}日（${weekday}）`),
      streak ? h("span", { class: "home-streak" }, `${streak}日 続けています`) : ""),
    due
      ? h("p", { class: "home-due" }, h("b", {}, String(due)), h("span", {}, "問"), h("span", { class: "home-due-split" }, `復習 ${counts.review}・新しい ${counts.fresh}`))
      : h("h2", { class: "home-title" }, answeredToday ? "今日の復習は終わりました" : "今日の復習はありません"),
    due
      ? h("a", { class: "home-primary", href: "#/review" }, "復習を始める")
      : nextUnit ? h("a", { class: "home-primary", href: `#/learn/${nextUnit.id}` }, `次のレッスン「${nextUnit.title}」`) : h("p", { class: "home-note" }, "すべてのレッスンを終えました。"),
    due ? lessonRow : "",
  );
}

/** 「続きから」の行（今日の復習があるとき、2番目の一手として） */
function continueRow(unit: Unit, learnedIds: Set<string>): HTMLElement {
  const done = unit.terms.filter((term) => learnedIds.has(term.id)).length;
  return h("a", { class: "home-row", href: `#/learn/${unit.id}` },
    h("span", { class: "home-row-label" }, done ? "続きから" : "次のレッスン"),
    h("span", { class: "home-row-title" }, unit.title),
    h("span", { class: "home-row-meta" }, done ? `${done}/${unit.terms.length}語` : `${unit.terms.length}語`),
  );
}

/** 選んだ系統の進み具合と、その系統の次のレッスン */
function systemDetail(systemId: string, name: string, color: string, learnedIds: Set<string>): (HTMLElement | string)[] {
  const list = courseUnits().filter((unit) => unit.system === systemId);
  const total = list.reduce((sum, unit) => sum + unit.terms.length, 0);
  const done = list.reduce((sum, unit) => sum + unit.terms.filter((term) => learnedIds.has(term.id)).length, 0);
  const next = list.find((unit) => unit.terms.some((term) => !learnedIds.has(term.id)));
  const nextDone = next ? next.terms.filter((term) => learnedIds.has(term.id)).length : 0;
  return [
    h("div", { class: "home-system-head" },
      h("span", { class: "swatch", style: `background:${color}` }),
      h("h2", {}, name),
      h("span", { class: "home-system-count" }, `${list.length}レッスン`),
    ),
    h("div", { class: "home-meter", role: "img", "aria-label": `学んだ語 ${done} / ${total}` },
      h("span", { style: `width:${total ? (done / total) * 100 : 0}%;background:${color}` })),
    h("p", { class: "home-meter-text" }, h("b", {}, done.toLocaleString()), ` / ${total.toLocaleString()}語`,
      h("span", {}, total ? `${Math.floor((done / total) * 100)}%` : "")),
    next
      ? h("a", { class: "home-row", href: `#/learn/${next.id}` },
        h("span", { class: "home-row-label" }, nextDone ? "続きから" : "次に学ぶ"),
        h("span", { class: "home-row-title" }, next.title),
        h("span", { class: "home-row-meta" }, nextDone ? `${nextDone}/${next.terms.length}語` : `${next.terms.length}語`))
      : h("p", { class: "home-note" }, "この系統のレッスンはすべて終えました。"),
    h("a", { class: "home-link", href: `#/lessons/${systemId}` }, `${name}のレッスンを選ぶ`),
  ];
}

/** 学び方の一覧（レッスン・演習・骨学試験・臓器の図・図鑑・語根カード・進捗）。1行ずつ。骨学試験と語根カードは詳細モードだけ */
function more(learnedIds: Set<string>, schedules: StoredSchedule[]): HTMLElement {
  const units = courseUnits();
  const unitsDone = units.filter((unit) => unit.terms.every((term) => learnedIds.has(term.id))).length;
  const exam = EXAM_KINDS.map((kind) => examProgress(kind, learnedIds, schedules));
  const examDone = exam.reduce((sum, p) => sum + p.done, 0);
  const examTotal = exam.reduce((sum, p) => sum + p.total, 0);
  const rootTotal = rootUnits.reduce((sum, unit) => sum + unit.roots.length, 0);
  const rootDone = rootUnits.reduce((sum, unit) => sum + unit.roots.filter((root) => learnedIds.has(rootKey(root))).length, 0);
  const plates = organs.reduce((sum, organ) => sum + organ.plates.length, 0);
  const admin = new URLSearchParams(location.search).has("admin");
  const beginner = isBeginner();
  const item = (href: string, icon: keyof typeof ICONS, color: string, title: string, sub: string, meta = "") => {
    const mark = h("span", { class: "home-item-icon", style: `--item:${color}`, "aria-hidden": "true" });
    mark.innerHTML = `<svg viewBox="0 0 24 24">${ICONS[icon]}</svg>`;
    return h("li", {}, h("a", { class: "home-item", href },
      mark,
      h("span", { class: "home-item-text" }, h("span", { class: "home-item-title" }, title), h("span", { class: "home-item-sub" }, sub)),
      meta ? h("span", { class: "home-item-meta" }, meta) : "",
    ));
  };
  return h("section", { class: "home-more", "aria-labelledby": "home-more-title" },
    h("h2", { id: "home-more-title" }, "学び方"),
    h("ul", { class: "home-card home-list" },
      item("#/lessons", "lessons", "#a8572f", "レッスン", "系統ごとに選ぶ・検索", unitsDone ? `${unitsDone}/${units.length}` : `${units.length}レッスン`),
      beginner ? "" : item("#/exam", "exam", "#b07d10", "骨学試験", "A〜D の形式と、整理して覚える", examDone ? `${examDone}/${examTotal}` : `${examTotal}項目`),
      item("#/drill", "drill", "#6b5fb5", "演習", "範囲を選んで解く・苦手を解く"),
      item("#/organs", "organ", "#c2493a", "臓器の図", `${organs.length}臓器の色分け・切り口・平面図 ${plates}枚`),
      item("#/explore", "explore", "#2f78b0", "図鑑", `${courseTerms().length.toLocaleString()}語を3Dで引く`),
      beginner ? "" : item("#/roots", "roots", "#2f8f55", "語根カード", "英語名を部品から読む", rootDone ? `${rootDone}/${rootTotal}` : `${rootTotal}個`),
      item("#/progress", "progress", "#4f6d8f", "進捗", "覚え具合を人体の色で見る"),
      admin ? item("#/admin", "settings", "#77736a", "ピン", "部位のピンを打つ（管理用）") : "",
    ),
  );
}

/**
 * 初心者モードと詳細モードの切りかえ（ホームのいちばん上）。押すとそのモードでホームを作り直す。
 * 学んだ記録は語ごとなので、どちらのモードで学んでも続く
 */
function modeSwitch(): HTMLElement {
  const option = (mode: "beginner" | "detail", label: string, sub: string) => {
    const on = preferences.mode === mode;
    return h("button", {
      class: on ? "mode-option on" : "mode-option", type: "button", "aria-pressed": String(on),
      onClick: async () => {
        if (on) return;
        await setPreference("mode", mode);
        window.dispatchEvent(new HashChangeEvent("hashchange"));
      },
    }, h("span", { class: "mode-label" }, label), h("span", { class: "mode-sub" }, sub));
  };
  return h("div", { class: "mode-switch", role: "group", "aria-label": "学ぶ範囲" },
    option("beginner", "初心者モード", `最低限の ${beginnerTermCount}語・短い説明`),
    option("detail", "詳細モード", `全 ${terms.length.toLocaleString()}語・くわしい説明`),
  );
}

/** 一覧の絵（線で描く。色は CSS の currentColor） */
const ICONS = {
  lessons: `<path d="M12 6.5C10 5 7.3 4.5 4 4.8v13.4c3.3-.3 6 .2 8 1.7 2-1.5 4.7-2 8-1.7V4.8c-3.3-.3-6 .2-8 1.7Z"/><path d="M12 6.5v13.4"/>`,
  drill: `<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4.2"/><circle cx="12" cy="12" r="1" fill="currentColor"/>`,
  exam: `<rect x="5" y="4" width="14" height="17" rx="2.2"/><path d="M9 3h6v2.5H9z"/><path d="m8.8 13.2 2.2 2.2 4.2-4.4"/>`,
  explore: `<circle cx="10.5" cy="10.5" r="6.2"/><path d="m15.2 15.2 5 5"/><path d="M8 10.5h5M10.5 8v5"/>`,
  organ: `<path d="M12 20s-7.5-4.6-7.5-10.2A4.2 4.2 0 0 1 12 7.2a4.2 4.2 0 0 1 7.5 2.6C19.5 15.4 12 20 12 20Z"/><path d="M12 7.2V4"/>`,
  roots: `<path d="M12 21v-8"/><path d="M12 13c0-4 2.5-6.5 7-6.5 0 4-2.5 6.5-7 6.5Z"/><path d="M12 13c0-3-2-5-5.5-5 0 3 2 5 5.5 5Z"/>`,
  progress: `<path d="M4 20h16"/><path d="M7 17v-5M12 17V7M17 17v-8"/>`,
  settings: `<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>`,
};

/** 3Dの下のボタンの短い名前（「骨格系」→「骨格」。泌尿器・生殖器系は「泌尿・生殖」） */
function short(name: string): string {
  return name === "泌尿器・生殖器系" ? "泌尿・生殖" : name.replace(/系$/, "");
}

function dayKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

/** 続けた日数（今日まだ解いていなければ昨日まで） */
function streakOf(days: Set<string>): number {
  const now = new Date();
  const day = (offset: number) => new Date(now.getFullYear(), now.getMonth(), now.getDate() - offset);
  let streak = 0;
  for (let i = days.has(dayKey(now)) ? 0 : 1; days.has(dayKey(day(i))); i++) streak++;
  return streak;
}

/** 骨学試験の日を決めていれば、残りの日数と、まだ学んでいない項目を1日いくつ解けば間に合うか（1行） */
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
  return h("a", { class: "home-notice home-countdown", href: next ? `#/exam/${next.kind}` : "#/exam" },
    h("b", {}, days ? `骨学試験まで ${days}日` : "骨学試験は今日"),
    h("span", {}, left ? `まだの項目 ${left}・1日 ${perDay}項目で間に合います` : "すべての項目を学びました。苦手な順に仕上げましょう"),
  );
}

/** 記録を書き出してから（一度も書き出していなければ学び始めてから）14日たったら知らせる。記録は端末の中だけにあるので */
function backupReminder(learned: LearnedTerm[]): HTMLElement | string {
  if (!learned.length) return "";
  const since = preferences.lastBackupAt || learned.reduce((first, item) => (item.learnedAt < first ? item.learnedAt : first), learned[0].learnedAt);
  if (Date.now() - new Date(since).getTime() < 14 * 86_400_000) return "";
  return h("a", { class: "home-notice", href: "#/settings" },
    h("b", {}, "記録を書き出しましょう"),
    h("span", {}, `${preferences.lastBackupAt ? "書き出してから" : "学び始めてから"}2週間たちました。記録はこの端末の中だけにあります`),
  );
}
