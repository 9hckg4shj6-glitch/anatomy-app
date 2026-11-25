import { h } from "../dom";
import { COURSES, courseOf, preferences, setCourse, setPreference, type Preferences } from "../settings";
import { PURPOSES, recommendCourse, shownPurposes, type Purpose } from "../purposes";
import { db, nowIso } from "../db";
import { inIosBrowser, isStandalone } from "../install";
import { installGuide } from "./install-guide";
import { loadProfile, NAME_MAX, needsStart, profileComplete, saveProfile, START_TRIAL_KEY, TRIAL_LESSON, type Profile } from "../profile";
import { account, accountAvailable } from "../account";
import { googleButton, inAppNote } from "./account-section";
import type { AppContext } from "./context";
import { planCard } from "./plan-card";
import { lessonMinutes } from "./home";
import { nextLesson } from "./lessons";
import { profileFields } from "./profile-form";

type Step = "install" | "welcome" | "name" | "profile" | "course" | "ready";
/** 「ホーム画面に追加」の案内を飛ばしたこと（この端末だけ。src/db.ts の DEVICE_SETTINGS） */
const INSTALL_SKIP_KEY = "installGuideSkipped";

/** 名前の画面の3Dで選べるもの（選んだものは覚える） */
const MODELS = [
  { id: "skeletal", label: "骨格", spec: { systems: ["skeletal"], body: true } },
  { id: "muscular", label: "筋", spec: { systems: ["skeletal", "muscular"], body: false } },
] as const;
const MODEL_KEY = "startModel";

/**
 * スタート画面（#/start。docs/普段使い.md「スタート画面」「はじめての人の使いにくさの見直し」）。基礎医学演習アプリにならう。
 * はじめて: はじめ（回る3Dと、できること。「まず3語を試す」）→ 3語のレッスン（#/learn/<TRIAL_LESSON>/try。3Dをタップして答える問題も）
 * → ① 名前 → ② 所属（大学・学部学科・学年。管理者に送る）→ ③ 使う目的・覚える量（コース）・英語の発音 → 準備ができました（あなたの使い方）。
 * 3語を試さずに名前から始めることもできる。名前と所属は飛ばせない（3語のあとも、入れるまでスタート画面に戻る）。
 * 今使っている人で所属がまだなら ①② だけ（コースはもう選んでいる）。
 * 2回目からは出さない（おかえりの画面は作らない）。#/start/edit は設定から名前と所属を直すとき（終われば設定へ戻る）。
 * iPhone・iPad のブラウザでは、はじめの前に「ホーム画面に追加」の案内のページ（src/ui/install-guide.ts）を出す
 * （記録が別々になる前に）。#/start/install は今日・設定からその案内だけを開くとき
 */
export async function start(ctx: AppContext, arg = ""): Promise<void> {
  const edit = arg === "edit";
  const guideOnly = arg === "install";
  const [learned, saved, savedModel, trialRecord, installSkipped] = await Promise.all([
    db.learned.count(), loadProfile(), db.settings.get(MODEL_KEY), db.settings.get(START_TRIAL_KEY), db.settings.get(INSTALL_SKIP_KEY),
  ]);
  if (ctx.signal.aborted) return;
  const draft: Partial<Profile> = { name: saved?.name ?? "", university: saved?.university ?? "", faculty: saved?.faculty ?? "", grade: saved?.grade ?? "" };
  const trialStarted = !!trialRecord?.value;
  // はじめての人: まだ何も学んでいないか、はじめにの3語だけを学んだ人（今まで使っていた人とは分ける）
  const fresh = !learned || trialStarted;
  // コースを選ぶのは、はじめての人でコースをまだ選んでいない人だけ
  const needCourse = !edit && fresh && !preferences.course;
  const steps: Step[] = needCourse ? ["name", "profile", "course"] : ["name", "profile"];
  let step: Step = edit ? "name"
    : !learned && !trialStarted && !draft.name ? "welcome"
      : !draft.name ? "name" : !profileComplete(draft) ? "profile" : "course";
  if (guideOnly) step = "install";
  else if (step === "welcome" && inIosBrowser() && !installSkipped?.value) step = "install";
  if (step !== "welcome" && step !== "install" && !steps.includes(step)) {
    location.replace("#/");
    return;
  }
  let picked: Exclude<Preferences["course"], ""> = preferences.course || (learned && !trialStarted ? courseOf() : "basic");
  /** 覚える量を自分で選んだか（選ぶまでは目的と学年のおすすめに合わせる） */
  let coursePicked = !!preferences.course;
  let purposes: Purpose[] = [...preferences.purposes];
  let examDate = preferences.examDate;
  let speak = preferences.autoSpeak;
  let missing = false;
  let model: string = MODELS.some((m) => m.id === savedModel?.value) ? String(savedModel!.value) : "skeletal";

  const counter = () => h("span", { class: "start-count" }, `${steps.indexOf(step) + 1} / ${steps.length}`);
  const go = (next: Step) => {
    step = next;
    missing = false;
    render();
    window.scrollTo(0, 0);
  };

  const showModel = () => {
    const spec = MODELS.find((m) => m.id === model)!.spec;
    void ctx.viewer.show({ systems: [...spec.systems], body: spec.body });
    ctx.tools.replaceChildren(h("div", { class: "start-models", role: "group", "aria-label": "回すモデルを選ぶ" },
      ...MODELS.map((m) => h("button", {
        class: m.id === model ? "chip on" : "chip", type: "button", "aria-pressed": String(m.id === model),
        onClick: () => {
          model = m.id;
          void db.settings.put({ key: MODEL_KEY, value: model, updatedAt: nowIso() });
          showModel();
        },
      }, m.label))));
  };

  const hero = (withCounter: boolean) => h("div", { class: "start-hero" },
    withCounter ? counter() : "",
    h("p", { class: "start-eyebrow" }, "3D解剖学の単語帳"),
    h("h1", { class: "start-brand" }, "からだ", h("span", {}, "見聞録")),
    h("p", { class: "start-catch" }, "回して、見て、", h("b", {}, "名前と場所"), "をいっしょに覚える。"));

  /** はじめ: 何ができるかを見せて、名前を入れる前に3語を試してもらう */
  const welcomeStep = (): Parts => {
    ctx.fold(false);
    showModel();
    const tryButton = h("button", { class: "primary start-go", type: "button", "data-key": "try" }, "まず3語を試す（約1分）");
    tryButton.addEventListener("click", async () => {
      await db.settings.put({ key: START_TRIAL_KEY, value: true, updatedAt: nowIso() });
      location.hash = `#/learn/${TRIAL_LESSON}/try`;
    }, { once: true });
    return {
      body: [
        hero(false),
        h("ol", { class: "start-points" },
          h("li", {}, h("b", {}, "3Dで場所を見る"), h("span", {}, "人体を回して拡大し、骨や臓器がどこにあるかを見る")),
          h("li", {}, h("b", {}, "名前を覚える"), h("span", {}, "光った所の名前を1語ずつ。3Dをタップして場所も答える")),
          h("li", {}, h("b", {}, "忘れる前に復習"), h("span", {}, "覚えた語は、忘れかけたころに「今日の復習」に出る"))),
        // iPhone・iPad のブラウザでは、記録が別々になる前に（何も入れる前に）ホーム画面への追加をすすめる
        inIosBrowser() ? h("aside", { class: "start-install" },
          h("b", {}, "iPhone・iPad では、先にホーム画面に追加するのがおすすめです"),
          h("span", {}, "ブラウザとホーム画面のアプリでは、学んだ記録が別々になります（Google でログインすれば同じにできます）。"),
          h("button", { class: "start-link", type: "button", onClick: () => go("install") }, "追加のしかたを見る ›")) : "",
        h("p", { class: "muted start-note" }, "名前と所属は、試したあとに伺います。"),
        h("div", { class: "start-links" },
          h("button", { class: "start-link", type: "button", onClick: () => go("name") }, "試さずに始める（名前を入れる）"),
          h("a", { class: "start-link", href: "#/settings" }, "前の記録を読み込む（別の端末から）")),
        signInBlock(),
      ],
      // 小さい画面でも、できること3つの下に隠れないよう画面の下に留める
      foot: tryButton,
    };
  };

  /**
   * 「ホーム画面に追加」の案内（iPhone・iPad のブラウザで、はじめの前）。追加はブラウザのボタンでしかできないので、
   * ここのボタンは「このまま始める」だけ（押したらこの端末では出さない）。ホーム画面から開いていれば、もう追加できていると伝える
   */
  const installStep = (): Parts => {
    ctx.fold(true);
    ctx.tools.replaceChildren();
    if (isStandalone()) {
      return {
        body: [
          h("p", { class: "start-eyebrow" }, "ホーム画面に追加"),
          h("h2", { class: "start-title" }, "もうホーム画面から開いています"),
          h("p", {}, "このままアプリとして使えます。追加のしかたの案内はいりません。"),
        ],
        foot: h("a", { class: "primary", href: "#/" }, "今日へ"),
      };
    }
    const skip = async () => {
      await db.settings.put({ key: INSTALL_SKIP_KEY, value: true, updatedAt: nowIso() });
      if (guideOnly) location.hash = "#/";
      else go("welcome");
    };
    return {
      body: [installGuide()],
      foot: guideOnly
        ? h("a", { class: "ghost-button", href: "#/" }, "今日へ戻る")
        : h("div", { class: "ig-foot" },
          h("p", {}, "追加したら、ホーム画面のアイコンから開いてください"),
          h("button", { class: "ghost-button", type: "button", onClick: skip }, "追加せずに、このブラウザで始める")),
    };
  };

  const nameStep = (): Parts => {
    ctx.fold(false);
    showModel();
    const input = h("input", {
      id: "start-name", class: "start-input", maxlength: String(NAME_MAX), autocomplete: "nickname", placeholder: "例：解剖 花子",
      value: draft.name ?? "", "aria-describedby": "start-name-error",
      onInput: () => { input.removeAttribute("aria-invalid"); error.hidden = true; },
    }) as HTMLInputElement;
    const error = h("p", { id: "start-name-error", class: "start-error", role: "alert", hidden: true }, "名前を入力してください");
    const form = h("form", {
      class: "start-form", novalidate: true,
      onSubmit: async (event: Event) => {
        event.preventDefault();
        const name = input.value.trim();
        if (!name) {
          input.setAttribute("aria-invalid", "true");
          error.hidden = false;
          input.focus();
          return;
        }
        draft.name = name;
        await saveProfile({ name });
        go("profile");
      },
    },
      h("label", { for: "start-name", class: "start-label" }, "お名前",
        h("small", {}, `ニックネームでもかまいません。管理者の利用者一覧に表示されます（${NAME_MAX}文字まで）`)),
      input, error,
      h("button", { class: "primary start-go", type: "submit" }, "次へ（所属）"));
    return {
      body: [
        hero(true),
        // 3語を試したあとなら、続けるために入れることを一言。今使っている人には、なぜ聞くのかを一言
        trialStarted && learned && !edit ? h("p", { class: "trial-note" }, "続けるには、名前と所属を教えてください。") : "",
        learned && !trialStarted && !saved?.name && !edit ? h("p", { class: "trial-note" }, "名前と所属を伺うようになりました。1回だけ入れてください。") : "",
        form,
        // 名前を入れるとアカウントがあるように思えるので、記録の置き場所を先に伝える
        edit ? "" : h("p", { class: "muted start-note" }, accountAvailable()
          ? "学んだ記録はこの端末の中に保存されます。Google でログインすると、ほかの端末（スマホ・iPad・PC）と記録が同じになります（あとから 設定 でも）。"
          : "学んだ記録はこの端末の中に保存されます（アカウントはありません）。機種を変えるときは、設定 から書き出して、新しい端末で読み込みます。"),
        edit ? h("a", { class: "start-link", href: "#/settings" }, "やめて設定へ戻る")
          : fresh ? h("a", { class: "start-link", href: "#/settings" }, "前の記録を読み込む（別の端末から）") : "",
        edit || !fresh ? "" : signInBlock(),
      ],
    };
  };

  const profileStep = (): Parts => {
    ctx.fold(true);
    ctx.tools.replaceChildren();
    const error = h("p", { class: "start-error", role: "alert" }, missingText());
    // 全部選べば消す
    error.hidden = !missing || profileComplete(draft);
    const next = h("button", {
      class: "primary start-go", type: "button",
      onClick: async () => {
        if (!profileComplete(draft)) {
          missing = true;
          render();
          return;
        }
        await saveProfile(draft);
        if (edit) location.hash = "#/settings";
        else if (needCourse) go("course");
        else location.hash = "#/";
      },
    }, edit ? "保存する" : needCourse ? "次へ（使い方を選ぶ）" : "はじめる");
    return {
      body: [
        h("div", { class: "start-top" },
          h("button", { class: "start-back", type: "button", onClick: () => go("name") }, "‹ 名前"), counter()),
        h("p", { class: "start-eyebrow" }, `ようこそ、${draft.name}さん`),
        h("h2", { class: "start-title" }, "所属を教えてください"),
        h("p", { class: "muted" }, "学年と学部に合ったコースをおすすめします。あとで 設定 で直せます。"),
        profileFields(draft, async (patch) => {
          Object.assign(draft, patch);
          await saveProfile(patch);
          render();
        }, ctx.signal, missing),
        error, next,
        h("p", { class: "muted start-note" }, "名前と所属は管理者に送られ、利用者の集計に使います。学習の記録は集計に使いません。"),
      ],
    };
  };

  function missingText() {
    const names = [!draft.university && "大学", !draft.faculty && "学部・学科", !draft.grade && "学年"].filter(Boolean);
    return `${names.join("・")}を選んでください`;
  }

  /**
   * ③ 使う目的（いくつでも）と覚える量（コース）と英語の発音。目的と学年から覚える量をすすめ、自分で選び直すまではおすすめに合わせる
   * （docs/普段使い.md「はじめての人への案内」）。骨学試験を選んだら、試験の日も聞く（あとで決めてもいい）。
   * 「この使い方で始める」は画面の下に留める（小さい画面や iPad でも、選んだらすぐ押せるように）
   */
  const courseStep = (): Parts => {
    ctx.fold(true);
    ctx.tools.replaceChildren();
    void ctx.viewer.show({ systems: ["skeletal"], body: true });
    const recommend = recommendCourse(draft.grade, purposes);
    if (!coursePicked) picked = recommend;
    const purposeCards = shownPurposes().map((purpose) => {
      const on = purposes.includes(purpose.id);
      return h("button", {
        class: on ? "purpose-card on" : "purpose-card", type: "button", role: "checkbox", "aria-checked": String(on), "data-key": purpose.id,
        onClick: () => {
          purposes = on ? purposes.filter((id) => id !== purpose.id) : PURPOSES.map((item) => item.id).filter((id) => id === purpose.id || purposes.includes(id));
          render(purpose.id);
        },
      },
        h("span", { class: "purpose-check", "aria-hidden": "true" }),
        h("span", { class: "course-text" },
          h("span", { class: "purpose-title" }, purpose.title),
          h("span", { class: "course-sub" }, purpose.sub)),
      );
    });
    const examInput = h("input", {
      class: "date-input", type: "date", value: examDate, "aria-label": "骨学試験の日",
      onChange: () => { examDate = examInput.value; },
    }) as HTMLInputElement;
    const cards = COURSES.map((course) => {
      const on = course.id === picked;
      return h("button", {
        class: on ? "course-card compact on" : "course-card compact", type: "button", role: "radio", "aria-checked": String(on), "data-key": course.id,
        onClick: () => {
          picked = course.id;
          coursePicked = true;
          render(course.id);
        },
      },
        h("span", { class: "course-radio", "aria-hidden": "true" }),
        h("span", { class: "course-text" },
          h("span", { class: "course-title" }, course.title, course.id === recommend ? h("span", { class: "course-badge" }, "おすすめ") : ""),
          h("span", { class: "course-sub" }, course.sub)),
      );
    });
    // 英語の発音を自動で鳴らすか（3語を試す間は鳴らしていない。講義中や電車で急に鳴らないように、ここで選んでもらう）
    const speakChoice = (value: boolean, label: string) => h("button", {
      class: speak === value ? "segment on" : "segment", type: "button", "aria-pressed": String(speak === value), "data-key": `speak-${value}`,
      onClick: () => {
        speak = value;
        render(`speak-${value}`);
      },
    }, label);
    const begin = h("button", { class: "primary", type: "button" }, "この使い方で始める");
    begin.addEventListener("click", async () => {
      await setCourse(picked);
      await setPreference("purposes", purposes);
      await setPreference("autoSpeak", speak);
      if (purposes.includes("bone") && examDate) await setPreference("examDate", examDate);
      go("ready");
    });
    return {
      body: [
        h("div", { class: "start-top" },
          h("button", { class: "start-back", type: "button", onClick: () => go("profile") }, "‹ 所属"), counter()),
        h("p", { class: "start-eyebrow" }, [draft.university, draft.faculty, draft.grade].join(" · ")),
        h("h2", { class: "start-title" }, "何のために使いますか？"),
        h("p", { class: "muted" }, "いくつでも選べます。選んだ目的に合わせて、使い方をご案内します。"),
        h("div", { class: "course-list", role: "group", "aria-label": "使う目的" }, ...purposeCards),
        purposes.includes("bone") ? h("label", { class: "start-exam" },
          h("span", {}, "骨学試験の日", h("small", {}, "決まっていれば。1日の目安を出します")), examInput) : "",
        h("h3", { class: "start-sub" }, "コース", h("small", {}, "どこまでの語を覚えるか")),
        h("div", { class: "course-list", role: "radiogroup", "aria-label": "コース（どこまでの語を覚えるか）" }, ...cards),
        picked === "basic" && purposes.includes("bone") ? h("p", { class: "start-warn" }, "骨学試験と語根カードは「標準」と「すべての語」で使えます。") : "",
        h("h3", { class: "start-sub" }, "英語の発音"),
        h("div", { class: "segments", role: "group", "aria-label": "英語の発音" },
          speakChoice(true, "自動で鳴らす"), speakChoice(false, "🔊を押したときだけ")),
        h("p", { class: "muted start-speak-note" }, "語を開いたときと、英語の問題の答え合わせで鳴らします。講義中や電車では「押したときだけ」が安心です。"),
        h("p", { class: "muted start-note" }, "目的もコースも発音も、あとで「設定」から変えられます。学んだ記録は続きます。"),
      ],
      foot: begin,
    };
  };

  /** 準備ができました: 選んだ目的の使い方（あなたの使い方）と、最初（次）のレッスン */
  const readyStep = async (): Promise<Parts> => {
    ctx.fold(true);
    ctx.tools.replaceChildren();
    const learnedNow = await db.learned.toArray();
    const next = nextLesson(learnedNow);
    // 3語を試したレッスンなら「続きから」（残りの語の分の目安）
    const learnedIds = new Set(learnedNow.map((item) => item.termId));
    const rest = next ? next.terms.filter((term) => !learnedIds.has(term.id)).length : 0;
    const label = !next ? "" : rest < next.terms.length ? `続きから「${next.title}」（約${lessonMinutes(rest)}分）`
      : `${learnedNow.length ? "次" : "最初"}のレッスン「${next.title}」（約${lessonMinutes(next.terms.length)}分）`;
    return {
      body: [
        h("p", { class: "start-eyebrow" }, `${draft.name}さん`),
        h("h2", { class: "start-title" }, "準備ができました"),
        h("p", {}, "これからは「今日」を開いて、今日の復習を解くだけで続きます。新しい語は「学ぶ」のレッスンで覚えます。"),
        planCard(),
      ],
      foot: h("div", { class: "nav-row" },
        h("a", { class: "ghost-button", href: "#/" }, "今日へ"),
        next ? h("a", { class: "primary", href: `#/learn/${next.id}` }, label) : h("a", { class: "primary", href: "#/" }, "はじめる")),
    };
  };

  /**
   * ほかの端末で使っている人は、名前を入れる前に Google でログインすれば、名前・所属・コースと記録を受けて今日へ進む
   * （受けたら下の anatomy:synced で確かめる）。ログイン中なら、その旨と受けている途中であること
   */
  function signInBlock(): HTMLElement | string {
    if (!accountAvailable() || account.status === "unavailable" || account.status === "loading") return "";
    if (account.status === "signed-in" || account.status === "conflict") {
      return h("p", { class: "start-signed", role: "status" }, `✓ ${account.user?.email ?? ""} でログイン中。`,
        account.phase === "syncing" ? "記録を受けています…" : account.phase === "not-ready" ? "同期のサーバーの準備がまだです。" : "");
    }
    return h("div", { class: "start-signin" },
      h("p", { class: "start-signin-lead" }, "ほかの端末で使っている人は"),
      inAppNote(),
      googleButton("Google でログインして続きから"),
      account.message ? h("p", { class: "start-error", role: "alert" }, account.message) : "");
  }

  // ログインの状態が変わったら、はじめ（入力の無い画面）だけ描き直す。ほかの端末の記録を受けて名前・所属・コースがそろったら今日へ
  window.addEventListener("anatomy:account", () => {
    if (step === "welcome") void render();
    else ctx.panel.querySelector(".start-signin, .start-signed")?.replaceWith(signInBlock() || "");
  }, { signal: ctx.signal });
  window.addEventListener("anatomy:synced", async () => {
    if (edit) return;
    const [profile, count, trial] = await Promise.all([loadProfile(), db.learned.count(), db.settings.get(START_TRIAL_KEY)]);
    if (!ctx.signal.aborted && !needsStart(profile, count, !!trial?.value, preferences.course)) location.replace("#/");
  }, { signal: ctx.signal });

  async function render(focusKey?: string) {
    ctx.hint("");
    ctx.viewer.highlight([]);
    if (step === "welcome" || step === "name") {
      ctx.viewer.overview();
      ctx.viewer.spin(!matchMedia("(prefers-reduced-motion: reduce)").matches);
    }
    const { body, foot } = step === "install" ? installStep() : step === "welcome" ? welcomeStep() : step === "name" ? nameStep() : step === "profile" ? profileStep()
      : step === "course" ? courseStep() : await readyStep();
    if (ctx.signal.aborted) return;
    ctx.panel.replaceChildren(
      h("div", { class: `start start-${step}` }, ...body),
      // 主のボタンは画面の下に留める（.panel > .panel-foot:last-child）
      foot ? h("div", { class: "panel-foot start-foot" }, foot) : "",
    );
    if (focusKey) ctx.panel.querySelector<HTMLElement>(`[data-key="${focusKey}"]`)?.focus({ preventScroll: true });
  }
  void render();
}

/** 1つの段の中身と、画面の下に留める主のボタン */
interface Parts {
  body: (Node | string)[];
  foot?: Node;
}
