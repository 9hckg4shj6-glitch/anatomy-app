import { exportBackup, importBackup, isBackup } from "../backup";
import { systemById } from "../content";
import { db, nowIso, type Facet } from "../db";
import { canSaveOffline, offlineFiles, savedFiles, saveFiles } from "../offline";
import { h } from "../dom";
import {
  daysUntilExam, loadPreferences, NEW_PER_DAY_OPTIONS, preferences, REVIEW_SIZE_OPTIONS, setPreference, TEXT_SIZES, type Preferences,
} from "../settings";
import { BASIC_FACETS, TERM_KINDS } from "../study";
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
  ctx.panel.replaceChildren(h("h2", {}, "設定"), box, offlineSection(ctx), backupSection(render));
}

/** オフライン: 3Dと音声をまとめて保存する（ふだんは開いた系統・聞いた音声だけが保存される） */
function offlineSection(ctx: AppContext): HTMLElement {
  const status = h("p", { class: "muted" }, "保存したものを調べています…");
  const list = h("p", { class: "muted offline-list" });
  const button = h("button", { class: "ghost-button", type: "button", disabled: true }, "すべて保存");
  const mb = (bytes: number) => `${Math.max(0.1, bytes / 1e6).toFixed(1)}MB`;
  const check = async () => {
    const files = await offlineFiles(ctx.index);
    const saved = await savedFiles(files);
    const missing = files.filter((file) => !saved.has(file.url));
    const groups = [...new Set(files.map((file) => file.group))];
    list.replaceChildren(...groups.map((group) => {
      const inGroup = files.filter((file) => file.group === group);
      const count = inGroup.filter((file) => saved.has(file.url)).length;
      const name = group === "audio" ? "英語の音声" : group === "body" ? "皮膚" : systemById.get(group)?.ja ?? group;
      return h("span", { class: count === inGroup.length ? "offline-item saved" : "offline-item" },
        group === "audio" ? `${name} ${count}/${inGroup.length}` : name);
    }));
    if (!canSaveOffline()) {
      status.textContent = "この開き方では保存できません（ホーム画面に追加したアプリか、公開先の https で開いてください）。";
      button.disabled = true;
      return;
    }
    status.textContent = missing.length
      ? `まだ保存していないもの: ${missing.length}ファイル（約${mb(missing.reduce((sum, file) => sum + file.bytes, 0))}）。保存すると、通信の無い所でもすべての系統と音声が使えます。`
      : "すべて保存してあります。通信の無い所でも使えます。";
    button.disabled = !missing.length;
    button.textContent = missing.length ? `すべて保存（約${mb(missing.reduce((sum, file) => sum + file.bytes, 0))}）` : "すべて保存済み";
    button.onclick = async () => {
      button.disabled = true;
      const total = missing.reduce((sum, file) => sum + file.bytes, 0);
      const failed = await saveFiles(missing, (done, bytes) => {
        status.textContent = `保存中… ${done} / ${missing.length}ファイル（${mb(bytes)} / ${mb(total)}）。この画面を離れると止まります。`;
      }, ctx.signal);
      if (ctx.signal.aborted) return;
      await check();
      if (failed) status.textContent = `${failed}ファイルを保存できませんでした。通信できる所でもう一度押してください。`;
    };
  };
  void check();
  return h("section", { class: "settings" },
    h("h3", {}, "オフライン"),
    status,
    list,
    button,
  );
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
  // 学ぶ問い方: 押すたびに足し外しする。基本の4つ（位置→名前・名前→位置・日→英・英→日）を1つは残す
  const studied = (kind: (typeof TERM_KINDS)[number]) => kind.facets.every((facet) => preferences.studyFacets.includes(facet));
  const studyNote = h("p", { class: "drill-note", hidden: true });
  const studyChips = h("div", { class: "chip-list" }, ...TERM_KINDS.map((kind) => h("button", {
    class: studied(kind) ? "chip on" : "chip", type: "button", "aria-pressed": String(studied(kind)),
    onClick: async () => {
      const next: Facet[] = studied(kind)
        ? preferences.studyFacets.filter((facet) => !kind.facets.includes(facet))
        : [...new Set([...preferences.studyFacets, ...kind.facets])];
      if (!next.some((facet) => BASIC_FACETS.includes(facet))) {
        studyNote.textContent = "位置→名前・名前→位置・日本語→英語・英語→日本語のどれか1つは残しておきます。";
        studyNote.hidden = false;
        return;
      }
      await setPreference("studyFacets", next);
      window.dispatchEvent(new CustomEvent("anatomy:reviewed"));
      render();
    },
  }, kind.label)));
  const examDate = h("input", {
    class: "date-input", type: "date", value: preferences.examDate, "aria-label": "骨学試験の日",
    onChange: async () => {
      await setPreference("examDate", examDate.value);
      render();
    },
  }) as HTMLInputElement;
  return [
    h("section", { class: "settings" },
      h("h3", {}, "学ぶ問い方"),
      h("p", { class: "muted" }, "語の問題で出す問い方です。外した問い方は、新しく始めず、期限が来ても復習に出しません（覚え具合の記録は残るので、戻せば続きから出ます）。たとえば、まず場所だけを覚えるときは日本語→英語・英語→日本語を外します。"),
      studyChips,
      studyNote,
      h("p", { class: "muted" }, "レッスンの確認テストでどれから覚えるかは、レッスンの始めの画面で選べます。語根カードと骨学試験の問題は、ここでは変わりません。"),
    ),
    h("section", { class: "settings" },
      h("h3", {}, "学び方"),
      h("p", { class: "setting-label" }, "1日に新しく始める問題"),
      chips(NEW_PER_DAY_OPTIONS.map((n) => ({ value: n, label: `${n}問` })), preferences.newPerDay, async (value) => {
        await setPreference("newPerDay", value);
        window.dispatchEvent(new CustomEvent("anatomy:reviewed"));
      }),
      h("p", { class: "muted" }, "1つの語に、学ぶ問い方の数だけ問題があり（初めは4つ。筋は7つ）、別々に数えます。期限の来た復習はこの数に関係なくすべて出ます。"),
      h("p", { class: "setting-label" }, "復習の1回の区切り"),
      chips(REVIEW_SIZE_OPTIONS.map((n) => ({ value: n, label: n ? `${n}問` : "全部" })), preferences.reviewSize, (value) => setPreference("reviewSize", value)),
      h("p", { class: "muted" }, "復習を始めるときにも選べます（範囲・問い方もそこで絞れます）。途中で「ここでやめる」（Esc）もできます。"),
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
