import { systems, type Unit } from "../content";
import { courseTerms, isBeginner } from "../course";
import { db, nowIso, type LearnedTerm, type StoredSchedule } from "../db";
import { SECTION_KINDS, SORT_KINDS } from "../exam-keys";
import { examLoaded } from "../exam-lazy";
import { h } from "../dom";
import { installHint } from "../install";
import { daysUntilExam, preferences } from "../settings";
import { loadProfile, needsStart, START_TRIAL_KEY } from "../profile";
import { account } from "../account";
import { nextLesson } from "./lessons";
import { finishRow, todayCounts } from "./review";
import { sceneFor, termAt, type AppContext } from "./context";
import { tabIntro } from "./tab-intro";

/** ホームで最後に選んだ系統（ほかの画面から戻っても同じ系統を見せる） */
let shownSystem = "skeletal";

/** 1問にかかる目安（秒）。「今日の復習 N問・約M分」に使う */
const SECONDS_PER_ITEM = 20;

/**
 * 今日（#/。タブの一番左）。3Dの人体を大きく見せ、ゆっくり回す。3Dの下の系統のボタンでその系統を見せる。
 * 欄は今日の一手1つ（今日の復習＝押すとすぐ1問目、無ければ次のレッスン）と、続きから・骨学試験の日の行だけ（docs/普段使い.md）。
 * 学び方の一覧は「学ぶ」、検索は「調べる」、設定と記録は「記録」のタブへ。名前と所属がまだか、何も学んでいなくてコースも選んでいなければ、スタート画面（#/start）へ
 */
export async function home(ctx: AppContext): Promise<void> {
  const { viewer, signal } = ctx;
  ctx.hint("");
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const since = new Date(startOfDay.getTime() - 7 * 86_400_000).toISOString();
  const [learned, counts, recentEvents, hintClosed, schedules, profile, trial] = await Promise.all([
    db.learned.toArray(), todayCounts(), db.reviewEvents.where("reviewedAt").aboveOrEqual(since).toArray(),
    db.settings.get("installHintClosed"), db.schedules.toArray(), loadProfile(), db.settings.get(START_TRIAL_KEY),
  ]);
  if (signal.aborted) return;
  // 名前と所属がまだの人（今使っている人も）と、はじめての人（はじめにの3語だけの人も）はスタート画面へ（src/ui/start.ts）
  if (needsStart(profile, learned.length, !!trial?.value, preferences.course)) {
    location.replace("#/start");
    return;
  }
  const intro = await tabIntro("today");
  if (signal.aborted) return;
  const learnedIds = new Set(learned.map((item) => item.termId));
  const answeredToday = recentEvents.filter((event) => event.reviewedAt >= startOfDay.toISOString());

  // 3Dに出せる系統（基本の用語・局所解剖は部品を持たないので、レッスンの一覧から）
  const bodySystems = systems.filter((system) => ctx.index.systems[system.id]);
  if (!bodySystems.some((system) => system.id === shownSystem)) shownSystem = "skeletal";

  const caption = h("div", { class: "home-caption", "aria-live": "polite" });
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
    // 大きな数（系統の語の数）は出さず、学んだ語があればその数だけ
    const done = courseTerms().filter((term) => term.system === systemId && learnedIds.has(term.id)).length;
    caption.replaceChildren(
      h("span", { class: "home-caption-kicker" }, "3Dで見る"),
      h("span", { class: "home-caption-title" }, system.ja),
      done ? h("span", { class: "home-caption-sub" }, `学んだ ${done.toLocaleString()}語`) : "",
    );
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

  const nextUnit = nextLesson(learned);
  const rows = [
    counts.review + counts.fresh && nextUnit ? continueRow(nextUnit, learnedIds) : "",
    isBeginner() ? "" : examRow(learnedIds, schedules),
  ];
  // タブの1行の説明は今日の札の下に（小さい画面でも、今日の一手のボタンが初めの画面に入るように）
  ctx.panel.replaceChildren(h("div", { class: "home" },
    today(counts, nextUnit, learnedIds, weekDays(recentEvents), answeredToday.length, !learned.length),
    // 仕上げ（今日学んだ語。やらなくてよい）は今日の復習とは別の行に
    counts.finish ? finishRow(counts.finish) : "",
    intro,
    ...rows,
    backupReminder(learned),
    hintClosed ? "" : installHint(signal, () => void db.settings.put({ key: "installHintClosed", value: true, updatedAt: nowIso() })),
  ));
  await choose(shownSystem);
}

/** レッスンの目安の分（1語に約30秒。見る・確認テスト） */
export function lessonMinutes(count: number): number {
  return Math.max(1, Math.round(count * 0.5));
}

/** 大きなボタン（題と小さな説明と →）。solid でなければ縁取り */
function bigButton(href: string, title: string, sub: string, solid = true): HTMLElement {
  return h("a", { class: solid ? "home-primary" : "home-primary outline", href },
    h("span", { class: "home-primary-text" }, h("span", { class: "home-primary-title" }, title), h("span", { class: "home-primary-sub" }, sub)));
}

/** 今日の札: 日付と今週の日、今日の一手（今日の復習／次のレッスン）。はじめての人には最初のレッスン */
function today(counts: { review: number; fresh: number }, nextUnit: Unit | undefined, learnedIds: Set<string>, week: number, answered: number, first: boolean): HTMLElement {
  const now = new Date();
  const weekday = ["日", "月", "火", "水", "木", "金", "土"][now.getDay()];
  const due = counts.review + counts.fresh;
  const kicker = h("p", { class: "home-kicker" },
    h("span", {}, first ? "はじめに" : `${now.getMonth() + 1}月${now.getDate()}日（${weekday}）`),
    first ? "" : weekDots(week));
  const nextDone = nextUnit ? nextUnit.terms.filter((term) => learnedIds.has(term.id)).length : 0;
  const lessonButton = (solid: boolean) => nextUnit
    ? bigButton(`#/learn/${nextUnit.id}`, nextDone ? `続きから「${nextUnit.title}」` : `次のレッスン「${nextUnit.title}」`,
      `${nextDone ? `残り ${nextUnit.terms.length - nextDone}語` : `${nextUnit.terms.length}語`}・約${lessonMinutes(nextUnit.terms.length - nextDone)}分`, solid)
    : h("p", { class: "home-note" }, "すべてのレッスンを終えました。");
  if (first) {
    return h("section", { class: "home-card home-today" }, kicker,
      h("h2", { class: "home-title" }, "3Dを見ながら、名前を覚える"),
      nextUnit ? bigButton(`#/learn/${nextUnit.id}`, "最初のレッスン", `${nextUnit.title}・約${lessonMinutes(nextUnit.terms.length)}分`) : "",
      h("p", { class: "home-note" }, "レッスンで覚えた語が、毎日の復習に入ります。3Dは1本指で回し、2本指でつまんで拡大。部位をタップすると図鑑で開きます。"),
    );
  }
  if (due) {
    const size = preferences.reviewSize ? Math.min(preferences.reviewSize, due) : due;
    return h("section", { class: "home-card home-today" }, kicker,
      bigButton("#/review/now", `今日の復習 ${size}問`, `約${Math.max(1, Math.ceil((size * SECONDS_PER_ITEM) / 60))}分・押すとすぐ1問目`),
      h("p", { class: "home-split" },
        h("span", {}, `復習 ${counts.review}・新しい ${counts.fresh}${size < due ? `（今日は全部で ${due}問）` : ""}`),
        h("a", { class: "home-split-link", href: "#/review" }, "範囲を選ぶ ›")),
    );
  }
  return h("section", { class: "home-card home-today" }, kicker,
    answered
      ? h("div", { class: "home-done" }, h("span", { class: "home-done-mark", "aria-hidden": "true" }, "✓"),
        // レッスンだけの日（はじめの日など）も、今日の分は終わり（今日学んだ語は明日から今日の復習に出る）
        h("div", {}, h("b", {}, "今日の分は終わりました"), h("span", {}, `今日 ${answered}問`)))
      : h("h2", { class: "home-title" }, "今日の復習はありません"),
    lessonButton(!answered),
    h("p", { class: "home-note" }, "次の復習は、日をあけて出ます。"),
  );
}

/** 今週（月曜から）に1問でも解いた日の数を、5つの点で（週5日を目安に。1日休んでも切れない） */
function weekDots(days: number): HTMLElement {
  return h("span", { class: "home-week", title: "今週、1問でも解いた日（週5日が目安）" },
    ...Array.from({ length: 5 }, (_, i) => h("span", { class: i < days ? "home-dot on" : "home-dot" })),
    h("span", {}, `今週 ${Math.min(days, 7)}/5日`));
}

/** 今週（月曜から今日まで）に解いた日の数 */
export function weekDays(events: { reviewedAt: string }[], now = new Date()): number {
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7));
  return new Set(events.filter((event) => new Date(event.reviewedAt) >= monday).map((event) => dayKey(new Date(event.reviewedAt)))).size;
}

/** 「続きから」の行（今日の復習があるとき、2番目の一手として） */
function continueRow(unit: Unit, learnedIds: Set<string>): HTMLElement {
  const done = unit.terms.filter((term) => learnedIds.has(term.id)).length;
  return h("a", { class: "home-row-card", href: `#/learn/${unit.id}` },
    h("span", { class: "home-row-label" }, done ? "続きから" : "次のレッスン"),
    h("span", { class: "home-row-title" }, unit.title),
    h("span", { class: "home-row-meta" }, done ? `${done}/${unit.terms.length}語` : `${unit.terms.length}語`),
  );
}

/** 3Dの下のボタンの短い名前（「骨格系」→「骨格」。泌尿器・生殖器系は「泌尿・生殖」） */
function short(name: string): string {
  return name === "泌尿器・生殖器系" ? "泌尿・生殖" : name.replace(/系$/, "");
}

function dayKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

/** 骨学試験の日を決めていれば、残りの日数と、まだ学んでいない項目を1日いくつ解けば間に合うか（1行。骨学試験は独立のまま、その画面へ） */
function examRow(learnedIds: Set<string>, schedules: StoredSchedule[]): HTMLElement | string {
  const left = examLeft(learnedIds, schedules);
  if (!left) return "";
  return h("a", { class: "home-row-card", href: left.href },
    h("span", { class: "home-row-label" }, "骨学試験"),
    h("span", { class: "home-row-title" }, left.days ? `試験まで ${left.days}日` : "試験は今日"),
    h("span", { class: "home-row-meta" }, left.rest ? `1日 ${left.perDay}項目` : "仕上げ"),
  );
}

/** 骨学試験の日までの日数・まだの項目・1日の目安（試験の日を決めていなければ null）。今日と記録の画面で使う */
export function examLeft(learnedIds: Set<string>, schedules: StoredSchedule[]): { days: number; rest: number; perDay: number; href: string } | null {
  const exam = examLoaded()?.data;
  const days = exam ? daysUntilExam() : null;
  if (!exam || days === null) return null;
  const rest = [...SECTION_KINDS, ...SORT_KINDS].map((kind) => {
    const { done, total } = exam.examProgress(kind, learnedIds, schedules);
    return { kind, rest: total - done };
  });
  const left = rest.reduce((sum, item) => sum + item.rest, 0);
  const next = rest.find((item) => item.rest > 0);
  return { days, rest: left, perDay: Math.ceil(left / Math.max(1, days)), href: next ? `#/exam/${next.kind}` : "#/exam" };
}

/**
 * 記録を書き出してから（一度も書き出していなければ学び始めてから）14日たったら知らせる。記録は端末の中だけにあるので。
 * Google でログインしている人（確かめている間も）には出さない（記録はアカウントにもある）
 */
export function backupReminder(learned: LearnedTerm[]): HTMLElement | string {
  if (!learned.length || account.status === "signed-in" || account.status === "loading") return "";
  const since = preferences.lastBackupAt || learned.reduce((first, item) => (item.learnedAt < first ? item.learnedAt : first), learned[0].learnedAt);
  if (Date.now() - new Date(since).getTime() < 14 * 86_400_000) return "";
  return h("a", { class: "home-notice", href: "#/settings" },
    h("b", {}, "記録を書き出しましょう"),
    h("span", {}, `${preferences.lastBackupAt ? "書き出してから" : "学び始めてから"}2週間たちました。記録はこの端末の中だけにあります（Google でログインすれば、ほかの端末と同じにもなります）`),
  );
}
