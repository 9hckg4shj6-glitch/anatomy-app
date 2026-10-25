import { systems, termById, terms } from "../content";
import { db, type StoredSchedule } from "../db";
import { h } from "../dom";
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
  const [learned, schedules] = await Promise.all([db.learned.toArray(), db.schedules.toArray()]);
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
      })),
    ),
    weakest.length ? h("h3", {}, "覚え具合の低い語") : "",
    weakest.length ? h("ul", { class: "term-list" }, ...weakest.map(([id, value]) => {
      const term = termById.get(id)!;
      return h("li", {}, h("button", {
        type: "button", class: "term-row",
        onClick: () => { shown = term.system; void showSystem(); viewer.highlight([id], { isolate: !!term.xray }); viewer.focus(id, 3.2); viewer.setLabel(id, term.ja); },
      }, h("span", {}, term.ja), h("span", { class: "en" }, `${Math.round(value * 100)}%`)));
    })) : "",
  );
}
