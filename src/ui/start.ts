import { h } from "../dom";
import { COURSES, courseOf, preferences, setCourse, setPreference, type Preferences } from "../settings";
import { PURPOSES, recommendCourse, type Purpose } from "../purposes";
import { db } from "../db";
import { loadProfile, NAME_MAX, profileComplete, saveProfile, type Profile } from "../profile";
import type { AppContext } from "./context";
import { nextLesson } from "./lessons";
import { profileFields } from "./profile-form";

type Step = "name" | "profile" | "course";

/** 名前の画面の3Dで選べるもの（選んだものは覚える） */
const MODELS = [
  { id: "skeletal", label: "骨格", spec: { systems: ["skeletal"], body: true } },
  { id: "muscular", label: "筋", spec: { systems: ["skeletal", "muscular"], body: false } },
] as const;
const MODEL_KEY = "startModel";

/**
 * スタート画面（#/start。docs/普段使い.md「スタート画面」）。基礎医学演習アプリにならう。
 * はじめて: ① 名前（上で本物の3Dが回る）→ ② 所属（大学・学部学科・学年。管理者に送る）→ ③ 使う目的と覚える量（コース）→ 3語のレッスン（#/learn/<ID>/try）。
 * 今使っている人で所属がまだなら ①② だけ（コースはもう選んでいる）。所属はできるだけ入れてもらうので飛ばせない。
 * 2回目からは出さない（おかえりの画面は作らない）。#/start/edit は設定から名前と所属を直すとき（終われば設定へ戻る）
 */
export async function start(ctx: AppContext, arg = ""): Promise<void> {
  const edit = arg === "edit";
  const [learned, saved, savedModel] = await Promise.all([db.learned.count(), loadProfile(), db.settings.get(MODEL_KEY)]);
  if (ctx.signal.aborted) return;
  const draft: Partial<Profile> = { name: saved?.name ?? "", university: saved?.university ?? "", faculty: saved?.faculty ?? "", grade: saved?.grade ?? "" };
  // コースを選ぶのは、まだ何も学んでいなくてコースも選んでいない人だけ
  const needCourse = !edit && !learned && !preferences.course;
  const steps: Step[] = needCourse ? ["name", "profile", "course"] : ["name", "profile"];
  let step: Step = edit || !draft.name ? "name" : !profileComplete(draft) ? "profile" : "course";
  if (!steps.includes(step)) {
    location.replace("#/");
    return;
  }
  let picked: Exclude<Preferences["course"], ""> = preferences.course || (learned ? courseOf() : "basic");
  /** 覚える量を自分で選んだか（選ぶまでは目的と学年のおすすめに合わせる） */
  let coursePicked = !!preferences.course;
  let purposes: Purpose[] = [...preferences.purposes];
  let examDate = preferences.examDate;
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
          void db.settings.put({ key: MODEL_KEY, value: model, updatedAt: new Date().toISOString() });
          showModel();
        },
      }, m.label))));
  };

  const nameStep = () => {
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
      h("button", { class: "primary start-go", type: "submit" }, edit ? "次へ（所属）" : "はじめる"));
    return [
      h("div", { class: "start-hero" },
        counter(),
        h("p", { class: "start-eyebrow" }, "3D解剖学の単語帳"),
        h("h1", { class: "start-brand" }, "からだ", h("span", {}, "見聞録")),
        h("p", { class: "start-catch" }, "回して、見て、", h("b", {}, "名前と場所"), "をいっしょに覚える。")),
      // 今使っている人には、なぜ聞くのかを一言
      learned && !saved?.name && !edit ? h("p", { class: "trial-note" }, "名前と所属を伺うようになりました。1回だけ入れてください。") : "",
      form,
      edit ? h("a", { class: "start-link", href: "#/settings" }, "やめて設定へ戻る")
        : learned ? "" : h("a", { class: "start-link", href: "#/settings" }, "前の記録を読み込む（別の端末から）"),
    ];
  };

  const profileStep = () => {
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
    return [
      h("div", { class: "start-top" },
        h("button", { class: "start-back", type: "button", onClick: () => go("name") }, "‹ 名前"), counter()),
      h("p", { class: "start-eyebrow" }, `ようこそ、${draft.name}さん`),
      h("h2", { class: "start-title" }, "所属を教えてください"),
      h("p", { class: "muted" }, "学年と学部に合ったコースをおすすめします。あとで 記録 › 設定 で直せます。"),
      profileFields(draft, async (patch) => {
        Object.assign(draft, patch);
        await saveProfile(patch);
        render();
      }, ctx.signal, missing),
      error, next,
      h("p", { class: "muted start-note" }, "名前と所属は管理者に送られ、利用者の集計に使います。学習の記録は送りません。"),
    ];
  };

  function missingText() {
    const names = [!draft.university && "大学", !draft.faculty && "学部・学科", !draft.grade && "学年"].filter(Boolean);
    return `${names.join("・")}を選んでください`;
  }

  /**
   * ③ 使う目的（いくつでも）と覚える量（コース）。目的と学年から覚える量をすすめ、自分で選び直すまではおすすめに合わせる
   * （docs/普段使い.md「はじめての人への案内」）。骨学試験を選んだら、試験の日も聞く（あとで決めてもいい）
   */
  const courseStep = () => {
    ctx.fold(true);
    ctx.tools.replaceChildren();
    void ctx.viewer.show({ systems: ["skeletal"], body: true });
    const recommend = recommendCourse(draft.grade, purposes);
    if (!coursePicked) picked = recommend;
    const purposeCards = PURPOSES.map((purpose) => {
      const on = purposes.includes(purpose.id);
      return h("button", {
        class: on ? "purpose-card on" : "purpose-card", type: "button", role: "checkbox", "aria-checked": String(on), "data-key": purpose.id,
        onClick: () => {
          purposes = on ? purposes.filter((id) => id !== purpose.id) : PURPOSES.map((item) => item.id).filter((id) => id === purpose.id || purposes.includes(id));
          render();
          ctx.panel.querySelector<HTMLElement>(`[data-key="${purpose.id}"]`)?.focus({ preventScroll: true });
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
          render();
          ctx.panel.querySelector<HTMLElement>(`[data-key="${course.id}"]`)?.focus({ preventScroll: true });
        },
      },
        h("span", { class: "course-radio", "aria-hidden": "true" }),
        h("span", { class: "course-text" },
          h("span", { class: "course-title" }, course.title, course.id === recommend ? h("span", { class: "course-badge" }, "おすすめ") : ""),
          h("span", { class: "course-sub" }, course.sub)),
      );
    });
    const begin = h("button", { class: "primary", type: "button" }, "この使い方で始める");
    begin.addEventListener("click", async () => {
      await setCourse(picked);
      await setPreference("purposes", purposes);
      if (purposes.includes("bone") && examDate) await setPreference("examDate", examDate);
      const first = nextLesson(await db.learned.toArray());
      // まだ何も学んでいなければ、最初のレッスンの3語だけを通す（終わりに「あなたの使い方」を出す）
      location.hash = first && !learned ? `#/learn/${first.id}/try` : "#/";
    });
    return [
      h("div", { class: "start-top" },
        h("button", { class: "start-back", type: "button", onClick: () => go("profile") }, "‹ 所属"), counter()),
      h("p", { class: "start-eyebrow" }, [draft.university, draft.faculty, draft.grade].join(" · ")),
      h("h2", { class: "start-title" }, "何のために使いますか？"),
      h("p", { class: "muted" }, "いくつでも選べます。選んだ目的に合わせて、使い方をご案内します。"),
      h("div", { class: "course-list", role: "group", "aria-label": "使う目的" }, ...purposeCards),
      purposes.includes("bone") ? h("label", { class: "start-exam" },
        h("span", {}, "骨学試験の日", h("small", {}, "決まっていれば。1日の目安を出します")), examInput) : "",
      h("h3", { class: "start-sub" }, "覚える量"),
      h("div", { class: "course-list", role: "radiogroup", "aria-label": "覚える量（コース）" }, ...cards),
      picked === "basic" && purposes.includes("bone") ? h("p", { class: "start-warn" }, "骨学試験と語根カードは「標準」と「すべての語」で使えます。") : "",
      h("p", { class: "muted start-note" }, "目的も覚える量も、あとで「記録 › 設定」から変えられます。学んだ記録は続きます。"),
      begin,
      h("p", { class: "muted start-note" }, "次に、3語だけの短いレッスンを試します（約1分）。"),
    ];
  };

  function render() {
    ctx.hint("");
    ctx.viewer.highlight([]);
    if (step === "name") {
      ctx.viewer.overview();
      ctx.viewer.spin(!matchMedia("(prefers-reduced-motion: reduce)").matches);
    }
    const parts = step === "name" ? nameStep() : step === "profile" ? profileStep() : courseStep();
    ctx.panel.replaceChildren(h("div", { class: `start start-${step}` }, ...parts));
  }
  render();
}
