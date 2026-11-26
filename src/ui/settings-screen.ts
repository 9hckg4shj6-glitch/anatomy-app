import { inIosBrowser } from "../install";
import { loadMarks } from "../marks";
import { exportBackup, importBackup, isBackup } from "../backup";
import { systemById, terms } from "../content";
import { beginnerTermCount, standardTermCount } from "../course";
import { db, nowIso, type Facet } from "../db";
import { buildLabel, currentBuild, fetchLatestBuild, sameBuild, updateToLatest } from "../app-version";
import { canSaveOffline, offlineFiles, savedFiles, saveFiles } from "../offline";
import { h } from "../dom";
import {
  COURSES, courseOf, daysUntilExam, loadPreferences, setCourse, NEW_PER_DAY_OPTIONS, preferences, REVIEW_SIZE_OPTIONS, setPreference, TEXT_SIZES, type Preferences,
} from "../settings";
import { BASIC_FACETS, KIND_HINTS, TERM_KINDS } from "../study";
import { PURPOSES, shownPurposes } from "../purposes";
import { canUseExam, loadProfile } from "../profile";
import { account } from "../account";
import { accountSection } from "./account-section";
import type { AppContext } from "./context";
import { itemRow } from "./study-hub";
import { tabIntro } from "./tab-intro";
import { actionRow, card, choiceRow, foot, group, monogram, row, segmented, toggleRow, valueRow } from "./settings-kit";

/**
 * 設定のタブ（#/settings）: アカウントと同期・名前と所属・コース・使う目的・学ぶ問い方・学び方・表示・骨学試験の日・オフライン・記録の書き出しと読み込み、
 * 一番下に使い方・出典。2026-11-20 に記録のタブから分けて、下のタブの1つにした（docs/普段使い.md「記録と設定を分ける」）。
 * 同じ日に見た目を見出しとカードの行に組み直した（docs/普段使い.md「設定の見た目の見直し」、部品は settings-kit.ts）。
 * "#/settings/course" はコースの所を開いて出す（学ぶの鍵の付いた学び方から）、"#/settings/account" はアカウントと同期の所（はじめに・Google から戻ったとき）
 */
export async function settingsScreen(ctx: AppContext, arg = ""): Promise<void> {
  ctx.fold(true);
  ctx.viewer.highlight([]);
  ctx.viewer.overview();
  void ctx.viewer.show({ systems: ["skeletal"], body: true });
  ctx.hint("");
  const box = h("div", { class: "set-groups" });
  const render = () => box.replaceChildren(...settingRows(render));
  render();
  let profile = profileSection(await loadProfile());
  const backup = backupSection(render);
  ctx.panel.replaceChildren(h("div", { class: "set-page" },
    h("div", { class: "tab-head" }, h("h2", {}, "設定")),
    await tabIntro("settings"),
    accountSection(ctx.signal), profile, box, versionSection(ctx.signal), offlineSection(ctx), backup, aboutSection(),
  ));
  // ほかの端末の記録を受けたら、コース・目的・名前と所属などを描き直す
  window.addEventListener("anatomy:synced", async () => {
    render();
    const next = profileSection(await loadProfile());
    profile.replaceWith(next);
    profile = next;
  }, { signal: ctx.signal });
  window.addEventListener("anatomy:account", () => backup.querySelector(".backup-note")?.replaceWith(backupNote()), { signal: ctx.signal });
  if (arg === "course" || arg === "account") {
    const target = ctx.panel.querySelector<HTMLElement>(`#settings-${arg}`);
    requestAnimationFrame(() => target?.scrollIntoView({ block: "start" }));
    target?.classList.add("is-pointed");
  }
}

/** 名前と所属（スタート画面で入れたもの）。押すとスタート画面の #/start/edit で直す */
function profileSection(profile: Awaited<ReturnType<typeof loadProfile>>): HTMLElement {
  const name = profile?.name || "";
  return group("名前と所属", {},
    card(h("a", { class: "set-row set-profile", href: "#/start/edit", "aria-label": "名前と所属を直す" },
      monogram(name),
      h("span", { class: "set-text" },
        h("span", { class: "set-label" }, name || "未入力"),
        h("span", { class: "set-sub" }, [profile?.university, profile?.faculty, profile?.grade].filter(Boolean).join(" · ") || "所属は未入力")),
      h("span", { class: "set-value" }, "直す"))),
    foot("名前と所属は管理者に送られ、利用者の集計に使います。学習の記録は集計に使いません（Google でログインしたときだけ、端末をまたぐためにアカウントに保存します）。"));
}

/**
 * アプリの版: 開いている版と公開先の最新版を比べ、ボタンで最新版にする（src/app-version.ts）。
 * 内容をこまめに直して公開しても、ホーム画面のアプリが前の版のまま開くことがあるため（2026-11-26）
 */
function versionSection(signal: AbortSignal): HTMLElement {
  const latest = h("span", {}, "確かめています…");
  const status = h("p", { class: "set-foot set-status", "aria-live": "polite" });
  const button = actionRow("最新版に更新", { disabled: true }) as HTMLButtonElement;
  const label = button.querySelector(".set-label")!;
  const busy = (text: string) => {
    status.textContent = text;
    button.disabled = true;
  };
  button.onclick = () => void updateToLatest(busy);
  const check = async () => {
    latest.textContent = "確かめています…";
    const build = await fetchLatestBuild(signal);
    if (signal.aborted) return;
    button.disabled = false;
    if (!build) {
      latest.textContent = "確かめられません";
      label.textContent = "読み込み直す";
      status.textContent = "公開先につながりませんでした。通信できる所で開き直すと確かめられます。";
    } else if (sameBuild(build, currentBuild)) {
      latest.textContent = "最新です";
      label.textContent = "最新版です（読み込み直す）";
      status.textContent = "";
    } else {
      latest.textContent = buildLabel(build);
      label.textContent = "最新版に更新";
      status.textContent = "新しい版があります。押すと取り込んで開き直します。学んだ記録はそのまま残ります。";
    }
  };
  void check();
  return group("アプリの版", {},
    card(valueRow("開いている版", buildLabel(currentBuild)), valueRow("公開先の最新版", latest), button),
    status,
    foot("ふだんは、アプリを開いたときや画面に戻ってきたときに新しい版を確かめ、レッスンや演習の途中でなければ自動で切りかえます。切りかわらないときはここで更新してください。公開したばかりのときは、行きわたるまで数分かかることがあります。"),
  );
}

/** オフライン: 3Dと音声をまとめて保存する（ふだんは開いた系統・聞いた音声だけが保存される） */
function offlineSection(ctx: AppContext): HTMLElement {
  const status = h("span", { class: "set-sub" }, "保存したものを調べています…");
  const list = h("div", { class: "set-row set-tags offline-list" });
  const button = actionRow("すべて保存", { disabled: true }) as HTMLButtonElement;
  const label = button.querySelector(".set-label")!;
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
    const size = mb(missing.reduce((sum, file) => sum + file.bytes, 0));
    status.textContent = missing.length
      ? `まだ保存していないもの: ${missing.length}ファイル（約${size}）。保存すると、通信の無い所でもすべての系統と音声が使えます。`
      : "すべて保存してあります。通信の無い所でも使えます。";
    button.disabled = !missing.length;
    label.textContent = missing.length ? `すべて保存（約${size}）` : "すべて保存済み";
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
  return group("オフライン", {},
    card(h("div", { class: "set-row" }, h("span", { class: "set-text" }, h("span", { class: "set-label" }, "3Dと音声をこの端末に保存"), status)), list, button));
}

/** 使う目的のチップ（押すたびに足し外し。src/purposes.ts）。使い方のページで使う（設定ではチェックの行） */
export function purposeChips(onChange: () => void): HTMLElement {
  return h("div", { class: "chip-list" }, ...shownPurposes().map((purpose) => {
    const on = preferences.purposes.includes(purpose.id);
    return h("button", {
      class: on ? "chip on" : "chip", type: "button", "aria-pressed": String(on),
      onClick: async () => {
        const next = on ? preferences.purposes.filter((id) => id !== purpose.id) : [...preferences.purposes, purpose.id];
        await setPreference("purposes", PURPOSES.map((item) => item.id).filter((id) => next.includes(id)));
        onChange();
      },
    }, purpose.title);
  }));
}

function settingRows(render: () => void): (HTMLElement | string)[] {
  const reviewed = () => window.dispatchEvent(new CustomEvent("anatomy:reviewed"));
  const days = daysUntilExam();
  const beginner = preferences.mode === "beginner";
  // 骨学試験は一旦、名前に「シマエナガ」を含む人だけ（src/profile.ts）。ほかの人には説明の文からも外す
  const exam = canUseExam();
  const extras = exam ? "語根カード・骨学試験" : "語根カード";
  const course = courseOf();
  const courseCount = { basic: beginnerTermCount, standard: standardTermCount, free: terms.length } as const;

  // 学ぶ問い方: 押すたびに足し外しする。基本の4つ（位置→名前・名前→位置・日→英・英→日）を1つは残す
  const studied = (kind: (typeof TERM_KINDS)[number]) => kind.facets.every((facet) => preferences.studyFacets.includes(facet));
  const studyNote = h("p", { class: "drill-note set-note", hidden: true, role: "alert" });
  const kindRows = TERM_KINDS.map((kind) => choiceRow(kind.label, KIND_HINTS[kind.key], studied(kind), true, async () => {
    const next: Facet[] = studied(kind)
      ? preferences.studyFacets.filter((facet) => !kind.facets.includes(facet))
      : [...new Set([...preferences.studyFacets, ...kind.facets])];
    if (!next.some((facet) => BASIC_FACETS.includes(facet))) {
      studyNote.textContent = "位置→名前・名前→位置・日本語→英語・英語→日本語のどれか1つは残しておきます。";
      studyNote.hidden = false;
      return;
    }
    await setPreference("studyFacets", next);
    reviewed();
    render();
  }));

  const examDate = h("input", {
    class: "date-input", type: "date", value: preferences.examDate, "aria-label": "骨学試験の日",
    onChange: async () => {
      await setPreference("examDate", examDate.value);
      render();
    },
  }) as HTMLInputElement;

  const installHint = actionRow("「ホーム画面に追加」の案内をもう一度出す", {
    onClick: async () => {
      await db.settings.bulkDelete(["installHintClosed", "installGuideSkipped"]);
      // iPhone・iPad のブラウザでは、絵つきの案内のページ（src/ui/install-guide.ts）を開く
      if (inIosBrowser()) {
        location.hash = "#/start/install";
        return;
      }
      installHint.querySelector(".set-label")!.textContent = "今日の画面に案内を出しました";
      installHint.setAttribute("disabled", "");
    },
  });

  return [
    group("コース", { id: "settings-course" },
      card(...COURSES.map((item) => choiceRow(item.title, item.sub, item.id === course, false, async () => {
        if (item.id === course) return;
        await setCourse(item.id);
        reviewed();
        render();
      }, `${courseCount[item.id].toLocaleString()}語`))),
      foot(`${beginner
        ? `はじめての解剖では、短い「覚えること」と一緒に学びます。問い方は位置・名前・英語の4つだけで、${extras}は出しません。`
        : preferences.mode === "standard"
          ? `標準では、細かすぎる発展の語を除いて学びます。筋の起始・停止・支配神経・作用、${extras}も使えます。`
          : `すべての語では、漢字・語源・くわしい説明、筋の起始・停止・支配神経・作用、${extras}まで学びます。`
      }学んだ記録は語ごとに残るので、コースを変えても続きになります。`),
    ),
    group("使う目的（いくつでも）", {},
      card(...shownPurposes().map((purpose) => {
        const on = preferences.purposes.includes(purpose.id);
        return choiceRow(purpose.title, purpose.sub, on, true, async () => {
          const next = on ? preferences.purposes.filter((id) => id !== purpose.id) : [...preferences.purposes, purpose.id];
          await setPreference("purposes", PURPOSES.map((item) => item.id).filter((id) => next.includes(id)));
          render();
        });
      }), actionRow("使い方の「目的別の使い方」を見る", { href: "#/guide/purpose", chevron: true })),
      foot("選んだ目的の使い方を「使い方」の上に出します。どの目的でも、すべての学び方を使えます。"),
    ),
    group("学ぶ問い方", {},
      card(...kindRows),
      studyNote,
      foot(`レッスンと復習で出す問題の種類です。初めの3つで十分で、慣れたら足します。外した問い方は出なくなりますが、記録は残ります（戻せば続きから）。${beginner ? "初心者モードでは、筋の起始・停止・神経・作用と孔・溝を通るものは出しません。" : ""}${extras}の問題は、ここでは変わりません。`),
    ),
    group("学び方", {},
      card(
        row("1日に新しく始める問題", "期限の来た復習は、この数に関係なくすべて出ます",
          segmented("1日に新しく始める問題", NEW_PER_DAY_OPTIONS.map((n) => ({ value: n, label: `${n}問` })), preferences.newPerDay, async (value) => {
            await setPreference("newPerDay", value);
            reviewed();
          }), true),
        row("復習の1回の区切り", "復習を始めるときにも選べます",
          segmented("復習の1回の区切り", REVIEW_SIZE_OPTIONS.map((n) => ({ value: n, label: n ? `${n}問` : "全部" })), preferences.reviewSize,
            (value) => setPreference("reviewSize", value)), true),
        toggleRow("正解したら自動で次の問題へ", "1.5秒で進みます。まちがえたときは止まります", preferences.autoNext, (value) => setPreference("autoNext", value)),
        toggleRow("英語の発音を自動で鳴らす", "切っていても 🔊 を押せば聞けます", preferences.autoSpeak, (value) => setPreference("autoSpeak", value)),
      ),
      foot("1つの語に、学ぶ問い方の数だけ問題があり（初めは3つ）、別々に数えます。復習は途中で「ここでやめる」（Esc）もできます。"),
    ),
    group("表示", {},
      card(
        row("説明の文字の大きさ", "",
          segmented("説明の文字の大きさ", (Object.keys(TEXT_SIZES) as Preferences["textSize"][]).map((value) => ({ value, label: TEXT_SIZES[value].label })),
            preferences.textSize, (value) => setPreference("textSize", value))),
        toggleRow("説明に英語を併記", "脊柱（vertebral column）のように（）で添えます", preferences.enNotes, (value) => setPreference("enNotes", value)),
        toggleRow("3Dの向きの目印", "右上の小さな人と「上・下・前・後・右・左」の字", preferences.compass, (value) => setPreference("compass", value)),
        installHint,
      ),
      foot("3Dと説明の境目はドラッグで動かせます（ダブルクリックで元に戻す）。3Dの右上の ⤢ で3Dを大きくできます。向きの目印は、向きを答える問題の間は消えます。"),
    ),
    !exam ? "" : group("骨学試験", {},
      card(row("試験の日", days === null ? "" : days === 0 ? "今日が試験です" : `試験まであと${days}日`, h("span", { class: "date-row" }, examDate,
        preferences.examDate ? h("button", { class: "set-clear", type: "button", "aria-label": "試験の日を消す", onClick: async () => { await setPreference("examDate", ""); render(); } }, "消す") : ""))),
      foot(days === null
        ? "決めると、今日と記録の画面に試験までの日数と、まだ学んでいない骨学試験の項目を1日いくつ解けば間に合うかを出します。"
        : "今日の画面に1日の目安を出します。"),
    ),
  ];
}

/** 使い方と、このアプリについて（使い方の入口は上の帯・ここ・3Dの「?」の3か所） */
function aboutSection(): HTMLElement {
  return group("使い方とこのアプリについて", {},
    h("ul", { class: "home-card home-list set-links" },
      itemRow("#/guide", "guide", "#1f6f78", "使い方", "目的に合わせた使い方・6つのタブ・ことばの意味"),
      itemRow("#/credits", "credits", "#77736a", "出典・クレジット", "3Dモデル・図・音声のライセンス"),
      new URLSearchParams(location.search).has("admin") ? itemRow("#/admin", "settings", "#77736a", "ピン", "部位のピンを打つ（管理用）") : "",
    ));
}

/** 記録の置き場所の説明（ログインしているかで替える） */
function backupNote(): HTMLElement {
  return foot(account.status === "signed-in"
    ? "Google でログインしている間は、記録はアカウントにも保存され、ほかの端末と同じになります。書き出しは念のための控えです（読み込むと今の記録に足し合わせ、アカウントにも送ります）。"
    : "ログインしていないとき、記録はこの端末の中だけにあります。機種を変えるときや、iOS の Safari とホーム画面のアプリの間で移すときは、上の「アカウントと同期」で Google でログインするか、ファイルに書き出して読み込んでください（今の記録に足し合わせます）。", "backup-note");
}

/** 記録の書き出し・読み込み（ログインしない人が機種変更や、iOS の Safari とホーム画面のアプリの間で移すとき） */
function backupSection(onImported: () => void): HTMLElement {
  const status = h("p", { class: "set-foot set-status", "aria-live": "polite" });
  const last = h("span", {});
  const showLast = () => {
    last.textContent = preferences.lastBackupAt ? preferences.lastBackupAt.slice(0, 10).replaceAll("-", "/") : "まだ";
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
      await loadMarks();
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
  return group("記録の書き出し・読み込み", { class: "backup" },
    card(
      valueRow("最後に書き出した日", last),
      actionRow("ファイルに書き出す", { onClick: () => void save() }),
      actionRow("ファイルから読み込む", { onClick: () => file.click() }),
    ),
    file,
    status,
    backupNote(),
  );
}
