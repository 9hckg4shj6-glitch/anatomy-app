import { h } from "../dom";
import type { MotionQuestion, Rng } from "../motion-quiz";
import type { AppContext } from "./context";

/**
 * 動きの図鑑の「確かめる」の欄（docs/動きの図鑑.md「品質の見直し」）。模型を止めて4択で問い、答えると説明を出す。
 * 問題の間は、答えが見えてしまう字幕・今の時期の欄・弁の札の開閉を伏せる（mask）。5問で区切り、正解の数を出す
 */
export function motionCheck(ctx: AppContext, options: {
  make: (rng: Rng) => MotionQuestion;
  /** 問題の時点へ模型を動かして止める */
  show: (question: MotionQuestion) => void;
  /** 答えの見える所を伏せる・戻す */
  mask: (on: boolean) => void;
  count?: number;
}): HTMLElement {
  const count = options.count ?? 5;
  const box = h("div", { class: "motion-check" });
  let seed = (Date.now() % 2147483646) + 1;
  const rng: Rng = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
  const setMask = (on: boolean) => {
    document.body.classList.toggle("motion-quiz", on);
    options.mask(on);
  };
  ctx.signal.addEventListener("abort", () => document.body.classList.remove("motion-quiz"), { once: true });

  const intro = () => {
    setMask(false);
    box.replaceChildren(
      h("p", { class: "home-note" }, `模型をある時点で止めて、その様子を問います（${count}問）。問題の間は、3Dの下の字幕と札の開・閉は伏せます。`),
      h("button", { class: "primary motion-check-start", type: "button", onClick: () => ask(0, 0, "") }, `${count}問に挑戦`),
    );
  };

  const ask = (index: number, right: number, last: string) => {
    // 同じ問題が続かないように（3回まで引き直す）
    let question = options.make(rng);
    for (let k = 0; k < 3 && question.prompt + question.choices[question.answer] === last; k++) question = options.make(rng);
    const key = question.prompt + question.choices[question.answer];
    setMask(true);
    options.show(question);
    const feedback = h("div", { class: "motion-check-feedback", "aria-live": "polite" });
    const buttons = question.choices.map((choice, i) => h("button", {
      class: "choice long", type: "button",
      onClick: () => {
        const ok = i === question.answer;
        for (const [k, button] of buttons.entries()) {
          (button as HTMLButtonElement).disabled = true;
          button.classList.toggle("right", k === question.answer);
          button.classList.toggle("wrong", k === i && !ok);
        }
        setMask(false);
        options.show(question);
        const done = index + 1 >= count;
        const score = right + (ok ? 1 : 0);
        feedback.replaceChildren(
          h("p", { class: ok ? "motion-check-ok" : "motion-check-ng" }, ok ? "✓ 正解" : `✕ 正解は「${question.choices[question.answer]}」`),
          h("p", {}, question.explain),
          done
            ? h("div", { class: "motion-check-end" },
              h("p", {}, h("b", {}, `${count}問中 ${score}問 正解`), score === count ? "　全問正解です。" : "　まちがえた所は、▶ で動かして確かめてみましょう。"),
              h("button", { class: "ghost-button", type: "button", onClick: () => ask(0, 0, "") }, "もう一度"),
              h("button", { class: "ghost-button", type: "button", onClick: intro }, "終える"))
            : h("button", { class: "primary", type: "button", onClick: () => ask(index + 1, score, key) }, "次の問題"),
        );
      },
    }, choice));
    box.replaceChildren(
      h("p", { class: "motion-check-count muted" }, `${index + 1} / ${count}`),
      h("p", { class: "prompt motion-check-prompt" }, question.prompt),
      h("div", { class: "choices" }, ...buttons),
      feedback,
      h("button", { class: "ghost-button motion-check-quit", type: "button", onClick: intro }, "やめる"),
    );
  };

  intro();
  return box;
}
