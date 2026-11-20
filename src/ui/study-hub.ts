import { organs, systemById, type Unit } from "../content";
import { isBeginner } from "../course";
import { db } from "../db";
import { canUseExam } from "../profile";
import { h } from "../dom";
import { COURSES, courseOf } from "../settings";
import { sceneFor, type AppContext } from "./context";
import { lessonMinutes } from "./home";
import { nextLesson, pathUnits } from "./lessons";
import { tabIntro } from "./tab-intro";

/** 学び方の一覧の絵（線で描く。色は CSS の currentColor） */
export const ICONS = {
  lessons: `<path d="M12 6.5C10 5 7.3 4.5 4 4.8v13.4c3.3-.3 6 .2 8 1.7 2-1.5 4.7-2 8-1.7V4.8c-3.3-.3-6 .2-8 1.7Z"/><path d="M12 6.5v13.4"/>`,
  drill: `<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4.2"/><circle cx="12" cy="12" r="1" fill="currentColor"/>`,
  exam: `<rect x="5" y="4" width="14" height="17" rx="2.2"/><path d="M9 3h6v2.5H9z"/><path d="m8.8 13.2 2.2 2.2 4.2-4.4"/>`,
  explore: `<circle cx="10.5" cy="10.5" r="6.2"/><path d="m15.2 15.2 5 5"/><path d="M8 10.5h5M10.5 8v5"/>`,
  organ: `<path d="M12 20s-7.5-4.6-7.5-10.2A4.2 4.2 0 0 1 12 7.2a4.2 4.2 0 0 1 7.5 2.6C19.5 15.4 12 20 12 20Z"/><path d="M12 7.2V4"/>`,
  roots: `<path d="M12 21v-8"/><path d="M12 13c0-4 2.5-6.5 7-6.5 0 4-2.5 6.5-7 6.5Z"/><path d="M12 13c0-3-2-5-5.5-5 0 3 2 5 5.5 5Z"/>`,
  progress: `<path d="M4 20h16"/><path d="M7 17v-5M12 17V7M17 17v-8"/>`,
  settings: `<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>`,
  star: `<path d="m12 3.8 2.5 5.2 5.7.8-4.1 4 1 5.7-5.1-2.7-5.1 2.7 1-5.7-4.1-4 5.7-.8z"/>`,
  credits: `<circle cx="12" cy="12" r="8"/><path d="M12 11v5M12 8h.01"/>`,
  guide: `<circle cx="12" cy="12" r="8"/><path d="M9.7 9.6a2.4 2.4 0 1 1 3.3 2.2c-.6.3-1 .8-1 1.4v.5"/><path d="M12 16.6h.01"/>`,
  today: `<rect x="4" y="5" width="16" height="15" rx="3"/><path d="M8 3v4M16 3v4M4 10h16"/>`,
  again: `<path d="M4.5 11a7.5 7.5 0 0 1 13-4.6L19.5 8.5"/><path d="M19.5 4v4.5H15"/><path d="M19.5 13a7.5 7.5 0 0 1-13 4.6L4.5 15.5"/><path d="M4.5 20v-4.5H9"/>`,
  sync: `<path d="M7.2 18.5h9.6a3.9 3.9 0 0 0 .5-7.77A5.6 5.6 0 0 0 6.5 9.6a4.45 4.45 0 0 0 .7 8.9Z"/><path d="m10 14.2 1.6 1.6 3-3.2"/>`,
};

/** コースを変えると使える学び方の行き先（設定のコースの所） */
const COURSE_SETTING: [string, string] = ["#/settings/course", "設定でコースを変える"];

/** 鍵（まだ使えない学び方の印） */
const LOCK = `<rect x="5.5" y="10.5" width="13" height="9.5" rx="2"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>`;

/** 一覧の1行（絵・題・説明・›） */
export function itemRow(href: string, icon: keyof typeof ICONS, color: string, title: string, sub: string, meta = ""): HTMLElement {
  const mark = h("span", { class: "home-item-icon", style: `--item:${color}`, "aria-hidden": "true" });
  mark.innerHTML = `<svg viewBox="0 0 24 24">${ICONS[icon]}</svg>`;
  return h("li", {}, h("a", { class: "home-item", href },
    mark,
    h("span", { class: "home-item-text" }, h("span", { class: "home-item-title" }, title), h("span", { class: "home-item-sub" }, sub)),
    meta ? h("span", { class: "home-item-meta" }, meta) : "",
  ));
}

/**
 * まだ使えない学び方の行（絵・題・どうすれば使えるか・鍵）。学ぶの一覧に全部の学び方を見せるため。
 * 設定を変えれば使えるもの（覚える量を「標準」に）は、go に [行き先, 押したときの言葉] を渡すと、押してその設定へ行ける
 */
export function lockedRow(icon: keyof typeof ICONS, color: string, title: string, sub: string, go?: [href: string, label: string]): HTMLElement {
  const mark = h("span", { class: "home-item-icon", style: `--item:${color}`, "aria-hidden": "true" });
  mark.innerHTML = `<svg viewBox="0 0 24 24">${ICONS[icon]}</svg>`;
  const lock = h("span", { class: "home-item-lock", "aria-hidden": "true" });
  lock.innerHTML = `<svg viewBox="0 0 24 24">${LOCK}</svg>`;
  const text = h("span", { class: "home-item-text" },
    h("span", { class: "home-item-title" }, title, h("span", { class: "visually-hidden" }, "（まだ使えません）")),
    h("span", { class: "home-item-sub wrap" }, sub),
    go ? h("span", { class: "home-item-go" }, `${go[1]} ›`) : "");
  return h("li", {}, go
    ? h("a", { class: "home-item locked can-unlock", href: go[0] }, mark, text, lock)
    : h("div", { class: "home-item locked", "aria-disabled": "true" }, mark, text, lock));
}

/**
 * 学ぶ（#/study）: いちばん上にコースの次の1つ（続きから／次のレッスン）。はじめての人には「このあと」の3つ。
 * その下に学び方（レッスン・臓器の図・演習・骨学試験・語根カード）を、いつも全部と「こんなときに」の一言で（何があるかが分かるように）。
 * まだ使えないもの（何も学んでいないときの演習、はじめての解剖の骨学試験・語根カード）は鍵を付け、どうすれば使えるかを書く
 * （docs/普段使い.md「はじめての人への案内」）。全部で何語・何レッスンといった大きな数は出さない
 */
export async function studyHub(ctx: AppContext): Promise<void> {
  ctx.hint("");
  const [learned, intro] = await Promise.all([db.learned.toArray(), tabIntro("study")]);
  const learnedIds = new Set(learned.map((item) => item.termId));
  const next = nextLesson(learned);
  const course = courseOf();
  const fresh = !learned.length;
  const beginner = isBeginner();

  // 3Dには次のレッスンの語を光らせて見せる（スマホは3Dをたたみ、何が見えるかの帯だけを残す）
  ctx.fold(next ? "3Dで見る：次のレッスンの語" : true);
  if (next) {
    void ctx.viewer.show(sceneFor(next.system, next.id)).then(() => {
      if (ctx.signal.aborted) return;
      ctx.viewer.highlight(next.terms.map((term) => term.id), { isolate: !next.terms.some((term) => term.figure) });
      ctx.viewer.overview();
    });
    ctx.hint(next.title);
  }

  const units = pathUnits();
  const where = (unit: Unit) => {
    const inGroup = units.filter((item) => item.system === unit.system && item.group === unit.group);
    const done = inGroup.filter((item) => item.terms.every((term) => learnedIds.has(term.id))).length;
    const name = systemById.get(unit.system)?.ja ?? "";
    return unit.group ? `${name} › ${unit.group}（${done} / ${inGroup.length}）` : name;
  };
  const nextCard = next ? (() => {
    const done = next.terms.filter((term) => learnedIds.has(term.id)).length;
    const rest = next.terms.length - done;
    return h("section", { class: "home-card study-next" },
      h("p", { class: "home-kicker" }, h("span", {}, fresh ? `最初のレッスン・${systemById.get(next.system)?.ja ?? ""}` : `${done ? "続きから" : "次に学ぶ"}・${where(next)}`)),
      h("div", { class: "study-next-title" }, h("b", {}, next.title), h("span", {}, done ? `${done} / ${next.terms.length}語` : `約${lessonMinutes(next.terms.length)}分`)),
      h("div", { class: "home-meter", "aria-hidden": "true" }, h("span", { style: `width:${(done / next.terms.length) * 100}%;background:var(--accent)` })),
      h("a", { class: "home-primary", href: `#/learn/${next.id}` },
        h("span", { class: "home-primary-text" }, h("span", { class: "home-primary-title" }, done ? `続ける（残り ${rest}語・約${lessonMinutes(rest)}分）` : "始める"))),
    );
  })() : h("section", { class: "home-card" }, h("p", { class: "home-note" }, "このコースのレッスンはすべて終えました。復習と演習で仕上げましょう。"));

  // はじめての人には、このあとのレッスンを3つ（何を学ぶかの見通し。全部の一覧は「すべてのレッスン」）
  const ahead = fresh && next ? units.slice(units.indexOf(next) + 1, units.indexOf(next) + 4) : [];
  const plates = organs.reduce((sum, organ) => sum + organ.plates.length, 0);
  const ways = [
    itemRow("#/lessons", "lessons", "#a8572f", fresh ? "すべてのレッスン" : "レッスン", "新しい語を3Dで1語ずつ覚える。系統ごとに選ぶ"),
    itemRow("#/organs", "organ", "#c2493a", "臓器の図", `心臓・肺・脳などを立体と平面図（${plates}枚）で。細胞と組織・発生も`),
    fresh
      ? lockedRow("drill", "#6b5fb5", "演習", "レッスンを1つ学ぶと使えます。終えた範囲を試験の前に解き直す")
      : itemRow("#/drill", "drill", "#6b5fb5", "演習", "終えたレッスンを試験の前に解き直す。範囲→問い方→数の3段階で選ぶ"),
    // 骨学試験は一旦、名前に「シマエナガ」を含む人だけ（src/profile.ts）
    !canUseExam() ? null : beginner
      ? lockedRow("exam", "#b07d10", "骨学試験", "コースを「標準」にすると使えます", COURSE_SETTING)
      : itemRow("#/exam", "exam", "#b07d10", "骨学試験", "骨学実習の試験の前に。A〜D の形式と、整理して覚える"),
    beginner
      ? lockedRow("roots", "#2f8f55", "語根カード", "コースを「標準」にすると使えます", COURSE_SETTING)
      : itemRow("#/roots", "roots", "#2f8f55", "語根カード", "英語名を部品から読む。知らない英語名も意味が分かる"),
  ];

  ctx.panel.replaceChildren(h("div", { class: "home" },
    h("div", { class: "tab-head" },
      h("h2", {}, "学ぶ"),
      h("a", { class: "course-chip", href: "#/settings", title: "コースを変える（設定）" }, `コース：${COURSES.find((item) => item.id === course)?.short ?? ""} ›`)),
    intro,
    nextCard,
    ahead.length ? h("h3", { class: "list-title" }, "このあと") : "",
    ahead.length ? h("ol", { class: "home-card home-list ahead-list" }, ...ahead.map((unit, i) => h("li", {},
      h("span", { class: "ahead-mark", "aria-hidden": "true" }, String(i + 2)), h("span", {}, unit.title)))) : "",
    h("h3", { class: "list-title" }, "学び方"),
    h("ul", { class: "home-card home-list ways" }, ...ways),
  ));
}
