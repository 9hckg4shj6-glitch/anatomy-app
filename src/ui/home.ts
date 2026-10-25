import { systems, units } from "../content";
import { db, nowIso } from "../db";
import { h } from "../dom";
import { installHint } from "../install";
import { dueCount } from "./review";
import type { AppContext } from "./context";

export async function home(ctx: AppContext): Promise<void> {
  ctx.viewer.highlight([]);
  ctx.viewer.overview();
  void ctx.viewer.show({ systems: systems.map((s) => s.id).filter((id) => ctx.index.systems[id]), body: true });
  ctx.hint("ドラッグで回転・ピンチで拡大");

  const [learned, due, hintClosed] = await Promise.all([db.learned.toArray(), dueCount(), db.settings.get("installHintClosed")]);
  const learnedIds = new Set(learned.map((item) => item.termId));
  const nextUnit = units.find((unit) => unit.terms.some((term) => !learnedIds.has(term.id)));

  ctx.panel.replaceChildren(
    h("section", { class: "today" },
      h("h2", {}, "今日の復習"),
      h("p", { class: "today-count" }, due ? `${due}問` : "なし"),
      due
        ? h("a", { class: "primary", href: "#/review" }, "復習する")
        : nextUnit
          ? h("a", { class: "primary", href: `#/learn/${nextUnit.id}` }, `次のレッスン「${nextUnit.title}」`)
          : h("p", {}, "すべてのレッスンを終えました"),
    ),
    hintClosed ? "" : installHint(ctx.signal, () => void db.settings.put({ key: "installHintClosed", value: true, updatedAt: nowIso() })),
    ...systems.map((system) => {
      const list = units.filter((unit) => unit.system === system.id);
      if (!list.length) return "";
      return h("section", { class: "system" },
        h("h2", {}, h("span", { class: "swatch", style: `background:${system.color}` }), system.ja),
        h("ul", { class: "units" }, ...list.map((unit) => {
          const done = unit.terms.filter((term) => learnedIds.has(term.id)).length;
          return h("li", {},
            h("a", { href: `#/learn/${unit.id}`, class: done === unit.terms.length ? "unit done" : "unit" },
              h("span", { class: "unit-title" }, unit.title),
              h("span", { class: "unit-count" }, done ? `${done}/${unit.terms.length}語` : `${unit.terms.length}語`),
            ));
        })),
      );
    }),
    h("p", { class: "footer-link" }, h("a", { href: "#/credits" }, "出典・クレジット")),
  );
}
