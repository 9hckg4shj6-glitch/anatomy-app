import { systems, units, type Unit } from "../content";
import { db, nowIso } from "../db";
import { h } from "../dom";
import { installHint } from "../install";
import { rootKey, rootUnits } from "../roots";
import { dueCount } from "./review";
import type { AppContext } from "./context";

export async function home(ctx: AppContext): Promise<void> {
  ctx.viewer.highlight([]);
  ctx.viewer.overview();
  void ctx.viewer.show({ systems: systems.map((s) => s.id).filter((id) => ctx.index.systems[id]), body: true });
  ctx.hint("ドラッグで回転・ピンチで拡大");

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const [learned, due, answeredToday, hintClosed, openSetting] = await Promise.all([
    db.learned.toArray(), dueCount(), db.reviewEvents.where("reviewedAt").aboveOrEqual(startOfDay.toISOString()).count(),
    db.settings.get("installHintClosed"), db.settings.get(OPEN_FOLDERS),
  ]);
  const learnedIds = new Set(learned.map((item) => item.termId));
  // 開いたフォルダーは覚えておき、レッスンから戻ったときも開いたままにする
  const openIds = new Set(Array.isArray(openSetting?.value) ? (openSetting.value as string[]) : []);
  const folder = (id: string, title: (Node | string)[], summary: string, allDone: boolean, list: HTMLElement): HTMLElement =>
    h("details", {
      class: allDone ? "system folder done" : "system folder",
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
  const nextUnit = nextLesson(learnedIds);
  const lessonLink = (className: string) => nextUnit ? h("a", { class: className, href: `#/learn/${nextUnit.id}` }, `次のレッスン「${nextUnit.title}」`) : "";

  ctx.panel.replaceChildren(
    h("section", { class: "today" },
      h("h2", {}, "今日の復習", answeredToday ? h("span", { class: "today-done" }, `今日 ${answeredToday}問 解いた`) : ""),
      h("p", { class: "today-count" }, due ? `${due}問` : "なし"),
      // 復習が残っていても、新しいレッスンへ進めるようにする
      due ? h("a", { class: "primary", href: "#/review" }, "復習する") : nextUnit ? lessonLink("primary") : h("p", {}, "すべてのレッスンを終えました"),
      due ? lessonLink("ghost-button next-lesson") : "",
      learnedIds.size ? h("div", { class: "nav-row" },
        h("a", { class: "ghost-button", href: "#/drill" }, "範囲を選ぶ"),
        h("a", { class: "ghost-button", href: "#/drill/weak" }, "苦手を解く"),
      ) : "",
    ),
    hintClosed ? "" : installHint(ctx.signal, () => void db.settings.put({ key: "installHintClosed", value: true, updatedAt: nowIso() })),
    ...systems.flatMap((system) => {
      const list = units.filter((unit) => unit.system === system.id);
      if (!list.length) return [];
      const total = list.reduce((sum, unit) => sum + unit.terms.length, 0);
      const done = list.reduce((sum, unit) => sum + unit.terms.filter((term) => learnedIds.has(term.id)).length, 0);
      const section = folder(system.id,
        [h("span", { class: "swatch", style: `background:${system.color}` }), system.ja],
        `${list.length}レッスン・${done ? `${done}/${total}` : total}語`,
        done === total,
        h("ul", { class: "units" }, ...list.map((unit) => {
          const done = unit.terms.filter((term) => learnedIds.has(term.id)).length;
          return h("li", {},
            h("a", { href: `#/learn/${unit.id}`, class: done === unit.terms.length ? "unit done" : "unit" },
              h("span", { class: "unit-title" }, unit.title),
              h("span", { class: "unit-count" }, done ? `${done}/${unit.terms.length}語` : `${unit.terms.length}語`),
            ));
        })),
      );
      // 語根カードは基本の用語のすぐ後に（英語名の意味が分かると、どの系統の語も覚えやすくなる）
      return system.id === "basics" ? [section, rootSection(learnedIds, folder)] : [section];
    }),
    h("p", { class: "footer-link" }, h("a", { href: "#/credits" }, "出典・クレジット")),
  );
}

const OPEN_FOLDERS = "homeOpenFolders";

/** まだ学んでいない語のある最初のレッスン（ホームと復習の終わりに出す） */
export function nextLesson(learnedIds: Set<string>): Unit | undefined {
  return units.find((unit) => unit.terms.some((term) => !learnedIds.has(term.id)));
}

type Folder = (id: string, title: (Node | string)[], summary: string, allDone: boolean, list: HTMLElement) => HTMLElement;

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
