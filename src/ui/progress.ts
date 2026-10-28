import { exportBackup, importBackup, isBackup } from "../backup";
import { systems, termById, terms } from "../content";
import { db, type StoredSchedule } from "../db";
import { h } from "../dom";
import { EXAM_KINDS, examProgress, kindLabels } from "../exam";
import { rootKey, roots } from "../roots";
import { loadPreferences, NEW_PER_DAY_OPTIONS, preferences, setPreference } from "../settings";
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

  const settings = settingsSection();

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
      }), rootRow(), ...EXAM_KINDS.map(examRow)),
    ),
    weakest.length ? h("h3", {}, "覚え具合の低い語") : "",
    weakest.length ? h("ul", { class: "term-list" }, ...weakest.map(([id, value]) => {
      const term = termById.get(id)!;
      return h("li", {}, h("button", {
        type: "button", class: "term-row",
        onClick: () => { shown = term.system; void showSystem(); viewer.highlight([id], { isolate: !!term.xray }); viewer.focus(id, 3.2); viewer.setLabel(id, term.ja); },
      }, h("span", {}, term.ja), h("span", { class: "en" }, `${Math.round(value * 100)}%`)));
    })) : "",
    weakest.length ? h("div", { class: "nav-row" }, h("a", { class: "primary", href: "#/drill/weak" }, "苦手な語を解く")) : "",
    settings.box,
    backupSection(settings.render),
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

/** 設定（発音の自動再生・1日の新しい問題の数）。記録を読み込んだら render で描き直す */
function settingsSection(): { box: HTMLElement; render: () => void } {
  const box = h("section", { class: "settings" });
  const chips = <T>(options: { value: T; label: string }[], current: T, onPick: (value: T) => Promise<void>) =>
    h("div", { class: "chip-list" }, ...options.map((option) => h("button", {
      class: option.value === current ? "chip on" : "chip", type: "button",
      onClick: async () => {
        await onPick(option.value);
        render();
      },
    }, option.label)));
  const render = () => box.replaceChildren(
    h("h3", {}, "設定"),
    h("p", { class: "setting-label" }, "英語の発音を自動で鳴らす"),
    chips([{ value: true, label: "鳴らす" }, { value: false, label: "鳴らさない" }], preferences.autoSpeak, (value) => setPreference("autoSpeak", value)),
    h("p", { class: "muted" }, "鳴らさないときも、🔊を押せば聞けます。"),
    h("p", { class: "setting-label" }, "1日に新しく始める問題"),
    chips(NEW_PER_DAY_OPTIONS.map((n) => ({ value: n, label: `${n}問` })), preferences.newPerDay, async (value) => {
      await setPreference("newPerDay", value);
      window.dispatchEvent(new CustomEvent("anatomy:reviewed")); // 復習のバッジの数を変える
    }),
    h("p", { class: "muted" }, "1つの語に問い方が4つ（筋は7つ）あり、別々に数えます。期限の来た復習はこの数に関係なくすべて出ます。"),
  );
  render();
  return { box, render };
}

/** 記録の書き出し・読み込み（機種変更や、iOS の Safari とホーム画面のアプリの間で移すとき） */
function backupSection(onImported: () => void): HTMLElement {
  const status = h("p", { class: "muted" });
  const file = h("input", { type: "file", accept: "application/json,.json", hidden: true });
  file.addEventListener("change", async () => {
    const chosen = file.files?.[0];
    file.value = "";
    if (!chosen) return;
    try {
      const data: unknown = JSON.parse(await chosen.text());
      if (!isBackup(data)) throw new Error("このアプリの記録のファイルではありません");
      if (!confirm(`${data.exportedAt.slice(0, 10)} に書き出した記録を、今の記録に足し合わせます。よろしいですか？`)) return;
      const result = await importBackup(data);
      await loadPreferences();
      onImported();
      window.dispatchEvent(new CustomEvent("anatomy:reviewed"));
      status.textContent = `読み込みました（覚え具合 ${result.schedules}件・解いた記録 ${result.reviewEvents}件・学んだ語 ${result.learned}件）。`;
    } catch (error) {
      status.textContent = `読み込めませんでした: ${error instanceof Error ? error.message : String(error)}`;
    }
  });
  const save = async () => {
    const backup = await exportBackup();
    const url = URL.createObjectURL(new Blob([JSON.stringify(backup)], { type: "application/json" }));
    const link = h("a", { href: url, download: `anatomy-records-${backup.exportedAt.slice(0, 10)}.json` });
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    status.textContent = `書き出しました（覚え具合 ${backup.schedules.length}件・解いた記録 ${backup.reviewEvents.length}件）。`;
  };
  return h("section", { class: "backup" },
    h("h3", {}, "記録の書き出し・読み込み"),
    h("p", { class: "muted" }, "記録はこの端末の中だけにあります。機種を変えるときや、iOS の Safari とホーム画面のアプリの間で移すときは、ファイルに書き出して読み込んでください（今の記録に足し合わせます）。"),
    h("div", { class: "nav-row" },
      h("button", { class: "ghost-button", type: "button", onClick: () => void save() }, "書き出す"),
      h("button", { class: "ghost-button", type: "button", onClick: () => file.click() }, "読み込む"),
    ),
    file,
    status,
  );
}
