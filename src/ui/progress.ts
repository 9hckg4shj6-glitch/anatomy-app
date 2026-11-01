import { systems, termById, terms } from "../content";
import { db, type ReviewEvent, type StoredSchedule } from "../db";
import { h } from "../dom";
import { EXAM_KINDS, examProgress, isExamKey, kindLabels } from "../exam";
import { isRootKey, rootKey, roots } from "../roots";
import { termMastery } from "../study";
import { sceneFor, type AppContext } from "./context";

const LEVELS = [
  { min: 0.9, color: "#3a9d5d", label: "覚えている（90%以上）" },
  { min: 0.7, color: "#e0b43a", label: "あやしい（70〜90%）" },
  { min: 0, color: "#d0503c", label: "忘れかけ（70%未満）" },
];
const UNSEEN = "#d9d4c7";

/** 進捗：人体を覚えた度合いで色分けし、系統ごとの数と弱い語を出す */
export async function progress(ctx: AppContext): Promise<void> {
  const { viewer, panel, tools, index } = ctx;
  const [learned, schedules, events] = await Promise.all([db.learned.toArray(), db.schedules.toArray(), db.reviewEvents.toArray()]);
  const byTerm = new Map<string, StoredSchedule[]>();
  for (const schedule of schedules) byTerm.set(schedule.termId, [...(byTerm.get(schedule.termId) ?? []), schedule]);
  const learnedIds = new Set(learned.map((item) => item.termId));
  const mastery = new Map(terms.map((term) => [term.id, learnedIds.has(term.id) ? termMastery(byTerm.get(term.id) ?? []) : null]));

  const colorOf = (value: number | null) => (value === null ? UNSEEN : LEVELS.find((level) => value >= level.min)!.color);
  viewer.colorTerms(new Map([...mastery].map(([id, value]) => [id, colorOf(value)])));
  // 全系統を重ねると、学んだ骨がまだ学んでいない筋の下に隠れるので、系統を1つずつ見せる。最初は学んだ語の多い系統
  const available = systems.filter((system) => index.systems[system.id]);
  const learnedCount = (id: string) => terms.filter((term) => term.system === id && learnedIds.has(term.id)).length;
  let shown = [...available].sort((a, b) => learnedCount(b.id) - learnedCount(a.id))[0]?.id ?? "skeletal";
  const showSystem = async () => {
    tools.replaceChildren(...available.map((system) => h("button", {
      class: system.id === shown ? "chip on" : "chip", type: "button",
      onClick: () => { shown = system.id; void showSystem(); },
    }, system.ja)));
    await viewer.show(sceneFor(shown));
  };
  await showSystem();
  viewer.overview();
  ctx.hint("色＝今の覚え具合");


  const weakest = [...mastery]
    .filter((entry): entry is [string, number] => entry[1] !== null)
    .sort((a, b) => a[1] - b[1])
    .slice(0, 10);

  panel.replaceChildren(
    h("h2", {}, "進捗"),
    ...records(events, schedules),
    h("h3", {}, "覚え具合"),
    h("ul", { class: "legend" },
      ...LEVELS.map((level) => h("li", {}, h("span", { class: "swatch", style: `background:${level.color}` }), level.label)),
      h("li", {}, h("span", { class: "swatch", style: `background:${UNSEEN}` }), "まだ学んでいない"),
    ),
    h("table", { class: "progress-table" },
      h("thead", {}, h("tr", {}, h("th", {}, "系統"), h("th", {}, "学んだ語"), h("th", {}, "平均"))),
      h("tbody", {}, ...systems.filter((system) => terms.some((term) => term.system === system.id)).map((system) => {
        const list = terms.filter((term) => term.system === system.id);
        const values = list.map((term) => mastery.get(term.id)).filter((v): v is number => v != null);
        return h("tr", {},
          h("td", {}, system.ja),
          h("td", {}, `${list.filter((term) => learnedIds.has(term.id)).length} / ${list.length}`),
          h("td", {}, values.length ? `${Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 100)}%` : "—"));
      }), rootRow(), ...EXAM_KINDS.map(examRow)),
    ),
    weakest.length ? h("h3", {}, "覚え具合の低い語（押すと図鑑）") : "",
    weakest.length ? h("ul", { class: "term-list" }, ...weakest.map(([id, value]) => {
      const term = termById.get(id)!;
      // 押すと図鑑でその語を開く（説明・関係する語を見直せるように）
      return h("li", {}, h("a", { class: "term-row", href: `#/explore/${id}` },
        h("span", {}, term.ja), h("span", { class: "en" }, `${Math.round(value * 100)}%`)));
    })) : "",
    weakest.length ? h("div", { class: "nav-row" }, h("a", { class: "primary", href: "#/drill/weak" }, "苦手な語を解く")) : "",
    h("p", { class: "footer-link" }, "設定と記録の書き出し・読み込みは ", h("a", { href: "#/settings" }, "設定"), " へ移りました。"),
  );

  function examRow(kind: (typeof EXAM_KINDS)[number]): HTMLElement {
    const { done, total, mastery } = examProgress(kind, learnedIds, schedules);
    return h("tr", {},
      h("td", {}, `骨学試験 ${kindLabels[kind]}`),
      h("td", {}, `${done} / ${total}`),
      h("td", {}, mastery === null ? "—" : `${Math.round(mastery * 100)}%`));
  }

  function rootRow(): HTMLElement {
    const keys = roots.map(rootKey);
    const values = keys.filter((key) => learnedIds.has(key)).map((key) => termMastery(byTerm.get(key) ?? [])).filter((v): v is number => v != null);
    return h("tr", {},
      h("td", {}, "語根カード"),
      h("td", {}, `${keys.filter((key) => learnedIds.has(key)).length} / ${keys.length}`),
      h("td", {}, values.length ? `${Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 100)}%` : "—"));
  }
}

/** その日の 0 時（端末の時刻）の "YYYY-MM-DD" */
function dayKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/**
 * 記録: 直近30日に解いた数（日ごとの棒）・続けた日数・これから7日の復習の予定・系統ごとの今日の期限。
 * 毎日の目安と、どの系統の復習がたまっているかを見るため
 */
function records(events: ReviewEvent[], schedules: StoredSchedule[], now = new Date()): (HTMLElement | string)[] {
  if (!events.length) return [h("p", { class: "muted" }, "まだ解いた記録がありません。レッスンや復習を解くと、日ごとの数と復習の予定がここに出ます。")];
  const perDay = new Map<string, number>();
  for (const event of events) {
    const key = dayKey(new Date(event.reviewedAt));
    perDay.set(key, (perDay.get(key) ?? 0) + 1);
  }
  const day = (offset: number) => new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
  const last30 = Array.from({ length: 30 }, (_, i) => day(i - 29));
  const counts = last30.map((date) => perDay.get(dayKey(date)) ?? 0);
  // 続けた日数: 今日（まだ解いていなければ昨日）からさかのぼって、毎日1問以上解いた日数
  let streak = 0;
  for (let i = perDay.has(dayKey(now)) ? 0 : 1; perDay.has(dayKey(day(-i))); i++) streak++;
  // これから7日の復習の予定（今日の分には期限を過ぎたものも入れる）
  const forecast = Array.from({ length: 7 }, (_, i) => {
    const end = day(i + 1).getTime();
    const start = i ? day(i).getTime() : -Infinity;
    return schedules.filter((s) => { const due = new Date(s.due).getTime(); return due >= start && due < end; }).length;
  });
  const endOfToday = day(1).getTime();
  const dueBySystem = new Map<string, number>();
  for (const schedule of schedules) {
    if (new Date(schedule.due).getTime() >= endOfToday) continue;
    const label = isRootKey(schedule.termId) ? "語根カード" : isExamKey(schedule.termId) ? "骨学試験"
      : systems.find((system) => system.id === termById.get(schedule.termId)?.system)?.ja;
    if (label) dueBySystem.set(label, (dueBySystem.get(label) ?? 0) + 1);
  }
  const weekday = ["日", "月", "火", "水", "木", "金", "土"];
  return [
    h("div", { class: "stat-row" },
      stat("今日", `${counts[29]}問`),
      stat("続けた日数", `${streak}日`),
      stat("30日の合計", `${counts.reduce((a, b) => a + b, 0)}問`),
    ),
    h("h3", {}, "直近30日に解いた数"),
    bars(counts, last30.map((date, i) => (i === 29 ? "今日" : i % 7 === 1 ? `${date.getMonth() + 1}/${date.getDate()}` : "")), "直近30日に解いた数"),
    h("h3", {}, "これから7日の復習"),
    bars(forecast, forecast.map((_, i) => (i ? weekday[day(i).getDay()] : "今日")), "これから7日の復習の予定", true),
    dueBySystem.size ? h("p", { class: "muted" }, "今日の期限: ", [...dueBySystem].sort((a, b) => b[1] - a[1]).map(([label, count]) => `${label} ${count}`).join("・")) : "",
  ];
}

function stat(label: string, value: string): HTMLElement {
  return h("div", { class: "stat" }, h("span", { class: "stat-value" }, value), h("span", { class: "stat-label" }, label));
}

/** 棒グラフ（SVG）。数は棒の上に（7本のときだけ）、下に目盛りの文字 */
function bars(values: number[], labels: string[], title: string, showValues = false): HTMLElement {
  const width = 300;
  const height = 90;
  const gap = values.length > 10 ? 2 : 8;
  const barWidth = (width - gap * (values.length - 1)) / values.length;
  const max = Math.max(1, ...values);
  const box = h("figure", { class: "bars", role: "img", "aria-label": `${title}: ${values.join("・")}` });
  const rects = values.map((value, i) => {
    const barHeight = value ? Math.max(2, (value / max) * (height - 18)) : 0;
    const x = i * (barWidth + gap);
    return `<rect x="${x.toFixed(1)}" y="${(height - 14 - barHeight).toFixed(1)}" width="${barWidth.toFixed(1)}" height="${barHeight.toFixed(1)}" rx="2" class="${i === (showValues ? 0 : values.length - 1) ? "bar today" : "bar"}"><title>${labels[i] || ""} ${value}</title></rect>`
      + (showValues && value ? `<text x="${(x + barWidth / 2).toFixed(1)}" y="${(height - 17 - barHeight).toFixed(1)}" class="bar-value">${value}</text>` : "")
      + (labels[i] ? `<text x="${(x + barWidth / 2).toFixed(1)}" y="${height - 2}" class="bar-label">${labels[i]}</text>` : "");
  });
  // 端の目盛りの文字と、いちばん高い棒の上の数が切れないように、まわりに余白をとる
  box.innerHTML = `<svg viewBox="-10 -12 ${width + 20} ${height + 12}" aria-hidden="true">${rects.join("")}</svg>`;
  return box;
}
