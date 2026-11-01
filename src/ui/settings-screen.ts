import { exportBackup, importBackup, isBackup } from "../backup";
import { db, nowIso } from "../db";
import { h } from "../dom";
import {
  daysUntilExam, loadPreferences, NEW_PER_DAY_OPTIONS, preferences, REVIEW_SIZE_OPTIONS, setPreference, TEXT_SIZES, type Preferences,
} from "../settings";
import type { AppContext } from "./context";

/** 設定の画面（#/settings）: 学び方・表示・骨学試験の日・記録の書き出しと読み込み */
export async function settingsScreen(ctx: AppContext): Promise<void> {
  ctx.viewer.highlight([]);
  ctx.viewer.overview();
  void ctx.viewer.show({ systems: ["skeletal"], body: true });
  ctx.hint("");
  const box = h("div", {});
  const render = () => box.replaceChildren(...settingRows(render));
  render();
  ctx.panel.replaceChildren(h("h2", {}, "設定"), box, backupSection(render));
}

function settingRows(render: () => void): HTMLElement[] {
  const chips = <T>(options: { value: T; label: string }[], current: T, onPick: (value: T) => Promise<void>) =>
    h("div", { class: "chip-list" }, ...options.map((option) => h("button", {
      class: option.value === current ? "chip on" : "chip", type: "button", "aria-pressed": String(option.value === current),
      onClick: async () => {
        await onPick(option.value);
        render();
      },
    }, option.label)));
  const days = daysUntilExam();
  const examDate = h("input", {
    class: "date-input", type: "date", value: preferences.examDate, "aria-label": "骨学試験の日",
    onChange: async () => {
      await setPreference("examDate", examDate.value);
      render();
    },
  }) as HTMLInputElement;
  return [
    h("section", { class: "settings" },
      h("h3", {}, "学び方"),
      h("p", { class: "setting-label" }, "1日に新しく始める問題"),
      chips(NEW_PER_DAY_OPTIONS.map((n) => ({ value: n, label: `${n}問` })), preferences.newPerDay, async (value) => {
        await setPreference("newPerDay", value);
        window.dispatchEvent(new CustomEvent("anatomy:reviewed")); // 上の印の数を変える
      }),
      h("p", { class: "muted" }, "1つの語に問い方が4つ（筋は7つ）あり、別々に数えます。期限の来た復習はこの数に関係なくすべて出ます。"),
      h("p", { class: "setting-label" }, "復習の1回の区切り"),
      chips(REVIEW_SIZE_OPTIONS.map((n) => ({ value: n, label: n ? `${n}問` : "全部" })), preferences.reviewSize, (value) => setPreference("reviewSize", value)),
      h("p", { class: "muted" }, "10問より多いときは、復習を始めるときにも選べます。途中で「ここでやめる」（Esc）もできます。"),
      h("p", { class: "setting-label" }, "正解したら自動で次の問題へ"),
      chips([{ value: true, label: "進む（1.5秒）" }, { value: false, label: "自分で「次へ」" }], preferences.autoNext, (value) => setPreference("autoNext", value)),
      h("p", { class: "muted" }, "まちがえたときは、説明を読めるよう自動では進みません。正解の画面で3Dや説明に触れると止まります。"),
      h("p", { class: "setting-label" }, "英語の発音を自動で鳴らす"),
      chips([{ value: true, label: "鳴らす" }, { value: false, label: "鳴らさない" }], preferences.autoSpeak, (value) => setPreference("autoSpeak", value)),
      h("p", { class: "muted" }, "鳴らさないときも、🔊を押せば聞けます。"),
    ),
    h("section", { class: "settings" },
      h("h3", {}, "表示"),
      h("p", { class: "setting-label" }, "説明の文字の大きさ"),
      chips((Object.keys(TEXT_SIZES) as Preferences["textSize"][]).map((value) => ({ value, label: TEXT_SIZES[value].label })), preferences.textSize,
        (value) => setPreference("textSize", value)),
      h("p", { class: "muted" }, "3Dと説明の境目はドラッグで動かせます（ダブルクリックで元に戻す）。3Dの右上の ⤢ で3Dを大きくできます。"),
      h("button", {
        class: "ghost-button", type: "button",
        onClick: async (event: Event) => {
          await db.settings.delete("installHintClosed");
          (event.currentTarget as HTMLButtonElement).textContent = "ホームに案内を出しました";
        },
      }, "「ホーム画面に追加」の案内をもう一度出す"),
    ),
    h("section", { class: "settings" },
      h("h3", {}, "骨学試験の日"),
      h("div", { class: "date-row" }, examDate,
        preferences.examDate ? h("button", { class: "text-button", type: "button", onClick: async () => { await setPreference("examDate", ""); render(); } }, "消す") : ""),
      h("p", { class: "muted" }, days === null
        ? "決めると、ホームに試験までの日数と、まだ学んでいない骨学試験の項目を1日いくつ解けば間に合うかを出します。"
        : `試験まであと${days}日。ホームに1日の目安を出します。`),
    ),
  ];
}

/** 記録の書き出し・読み込み（機種変更や、iOS の Safari とホーム画面のアプリの間で移すとき） */
function backupSection(onImported: () => void): HTMLElement {
  const status = h("p", { class: "muted" });
  const last = h("p", { class: "muted" });
  const showLast = () => {
    last.textContent = preferences.lastBackupAt ? `最後に書き出した日: ${preferences.lastBackupAt.slice(0, 10)}` : "まだ書き出していません。";
  };
  showLast();
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
    await setPreference("lastBackupAt", nowIso());
    showLast();
    status.textContent = `書き出しました（覚え具合 ${backup.schedules.length}件・解いた記録 ${backup.reviewEvents.length}件）。`;
  };
  return h("section", { class: "backup" },
    h("h3", {}, "記録の書き出し・読み込み"),
    h("p", { class: "muted" }, "記録はこの端末の中だけにあります。機種を変えるときや、iOS の Safari とホーム画面のアプリの間で移すときは、ファイルに書き出して読み込んでください（今の記録に足し合わせます）。"),
    last,
    h("div", { class: "nav-row" },
      h("button", { class: "ghost-button", type: "button", onClick: () => void save() }, "書き出す"),
      h("button", { class: "ghost-button", type: "button", onClick: () => file.click() }, "読み込む"),
    ),
    file,
    status,
  );
}
