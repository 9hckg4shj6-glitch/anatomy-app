import { h } from "../dom";
import { canUseExam } from "../profile";

/**
 * 使い方（#/guide）の図とアニメーション。docs/普段使い.md「使い方ガイド」。
 * 画面の見本は HTML と CSS（src/ui/guide.css）で描き、3Dの所はアプリの3Dを撮った絵（public/guide/*.webp。scripts/guide-images.mjs）を使う。
 * 動きは CSS のアニメーションで、画面に入っている間だけ動かす（watchDemos）。「視差効果を減らす」の端末では動かさず、止まった絵で見せる。
 * 中身はみな決まった文なので、見本の組み立てには innerHTML を使う（利用者の入れた文は入れない）
 */

const IMG = `${import.meta.env.BASE_URL}guide/`;

/** 動きを減らす設定の端末か */
export const reducedMotion = (): boolean => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

/** 下のタブの絵（index.html の #tabbar と同じ） */
const TAB_ICON = {
  today: `<rect x="4" y="5" width="16" height="15" rx="3"/><path d="M8 3v4M16 3v4M4 10h16"/>`,
  study: `<path d="M12 6.5C10 5 7.3 4.5 4 4.8v13.4c3.3-.3 6 .2 8 1.7 2-1.5 4.7-2 8-1.7V4.8c-3.3-.3-6 .2-8 1.7Z"/><path d="M12 6.5v13.4"/>`,
  look: `<circle cx="10.5" cy="10.5" r="6.2"/><path d="m15.2 15.2 5 5"/>`,
  records: `<path d="M4 20h16"/><path d="M7 17v-5M12 17V7M17 17v-8"/>`,
  settings: `<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>`,
};
export type GuideTab = keyof typeof TAB_ICON;
const TAB_NAMES: [GuideTab, string][] = [["today", "今日"], ["study", "学ぶ"], ["look", "調べる"], ["records", "記録"], ["settings", "設定"]];
const svg = (body: string, cls = "") => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">${body}</svg>`;

/** 見本の部品 */
const topBar = (back = "") => `<div class="gd-top">${back ? `<span class="gd-back">‹ ${back}</span>` : `<span class="gd-logo"></span><b>からだ見聞録</b>`}</div>`;
const tabBar = (on: GuideTab | "" = "today") => `<div class="gd-tabbar">${TAB_NAMES.map(([id, name]) => `<span class="gd-tab${id === on ? " on" : ""}" data-tab="${id}">${svg(TAB_ICON[id])}<i>${name}</i></span>`).join("")}</div>`;
const spinImg = (cls = "gd-spin") => `<div class="${cls}"><img src="${IMG}spin.webp" alt="" draggable="false"></div>`;
const finger = (cls = "") => `<span class="gd-finger ${cls}" aria-hidden="true"></span>`;
const ripple = (cls = "") => `<span class="gd-ripple ${cls}" aria-hidden="true"></span>`;
/** 4択。ok の選択肢に指とタップの輪を入れる（指は押す所の中に置き、そこを目がけて動く） */
const choices = (names: string[], ok: string, lang = "") => `<div class="gd-choices"${lang ? ` lang="${lang}"` : ""}>${names.map((name) => (name === ok ? `<span class="gd-ok">${name}${finger()}${ripple()}</span>` : `<span>${name}</span>`)).join("")}</div>`;

function block(cls: string, html: string, label?: string): HTMLElement {
  const box = h("div", { class: `gd-anim ${cls}`, ...(label ? { role: "img", "aria-label": label } : {}) });
  box.innerHTML = html;
  dropExam(box);
  return box;
}

/** 骨学試験を使えない名前の人には、見本の骨学試験の所（data-exam）を消す（src/profile.ts の canUseExam） */
function dropExam(root: HTMLElement): void {
  if (!canUseExam()) for (const element of root.querySelectorAll("[data-exam]")) element.remove();
}

/**
 * 画面に入っている間だけ動かす（.is-on）。外れると止まる。auto は画面に入ったときに呼ぶ（自動で進む見本）
 */
export function watchDemos(root: HTMLElement, signal: AbortSignal): void {
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) entry.target.classList.toggle("is-on", entry.isIntersecting);
  }, { threshold: 0.25 });
  for (const element of root.querySelectorAll(".gd-anim")) observer.observe(element);
  signal.addEventListener("abort", () => observer.disconnect(), { once: true });
}

/** はじめ: 回る骨格と、このアプリでできる3つ */
export function heroDemo(): HTMLElement {
  return block("gd-hero", `
    <div class="gd-hero-stage">${spinImg()}<span class="gd-hero-tag">3Dで回して見る</span></div>
    <ul class="gd-hero-points">
      <li><b><i>1</i>3Dで場所を見る</b><span>人体を回して・拡大して、骨や臓器がどこにあるかを見る。</span></li>
      <li><b><i>2</i>名前を覚える</b><span>3Dで光った所の名前を1語ずつ覚え、確認テストに答える。</span></li>
      <li><b><i>3</i>忘れる前に復習</b><span>覚えた語は、忘れかけたころに「今日の復習」に出る。</span></li>
    </ul>`);
}

/** 毎日の使い方: 今日を開く → 今日の復習を押す → 答える → おわり（12秒でくり返す） */
export function dayDemo(): HTMLElement {
  return block("gd-day gd-pair", `
    <div class="gd-phone" aria-hidden="true">
      ${topBar()}
      <div class="gd-scr gd-day-s1">
        <div class="gd-stage">${spinImg("gd-spin gd-spin-sm")}<div class="gd-syschips"><span class="on">骨格</span><span>関節</span><span>筋</span></div></div>
        <div class="gd-sheet">
          <p class="gd-kicker">今日の一手</p>
          <div class="gd-btn">今日の復習 <b>12問</b><span>→</span>${finger()}${ripple()}</div>
          <p class="gd-note">約4分・まちがえた語は最後にもう一度</p>
        </div>
        ${tabBar("today")}
      </div>
      <div class="gd-scr gd-day-s2">
        <div class="gd-qhead"><b>位置→名前</b><span>1 / 12</span></div>
        <div class="gd-stage gd-stage-img"><img src="${IMG}femur-hi.webp" alt="" draggable="false"></div>
        <p class="gd-q">オレンジ色の部位の名前は？</p>
        ${choices(["上腕骨", "大腿骨", "脛骨", "腓骨"], "大腿骨")}
        <div class="gd-result">正解<small>次の出題: 3日後</small></div>
      </div>
      <div class="gd-scr gd-day-s3">
        <div class="gd-done">
          <svg viewBox="0 0 48 48"><circle cx="24" cy="24" r="21"/><path d="m14 25 7 7 13-15"/></svg>
          <b>今日の復習おわり</b>
          <span>12 / 12 正解</span>
          <small>また明日、今日を開くだけ</small>
        </div>
      </div>
    </div>
    <ol class="gd-caps">
      <li class="gd-cap1"><b>「今日」を開く</b><span>アプリを開くと、いつもここ。</span></li>
      <li class="gd-cap2"><b>「今日の復習」を押す</b><span>押すとすぐ1問目。数はアプリが決めます。</span></li>
      <li class="gd-cap3"><b>答える</b><span>3Dで光った所の名前を選ぶ・名前の所をタップする。答えるたびに次に出る日が決まります。</span></li>
      <li class="gd-cap4"><b>おわり（3〜5分）</b><span>全部答えたら今日はおしまい。新しい語は「学ぶ」のレッスンで。</span></li>
    </ol>`, "毎日の使い方のアニメーション");
}

/** レッスンの4つの段（始めの画面・1語ずつ・確認テスト・復習に入る）。押して切りかえる。画面に入っている間は自動で進む */
const LESSON_STEPS: { title: string; text: string; screen: string }[] = [
  {
    title: "始めの画面",
    text: "レッスンの語の一覧と、確認テストの問い方。初めは 位置→名前・名前→位置・日本語→英語 の3つ。「確認テストだけ」で、見るのを飛ばして解くこともできます。",
    screen: `${topBar("学ぶ")}
      <div class="gd-stage gd-stage-img gd-stage-s"><img src="${IMG}femur-hi.webp" alt="" draggable="false"></div>
      <div class="gd-pad">
        <p class="gd-title">下肢の骨 <small>6語・約5分</small></p>
        <div class="gd-terms"><span>骨盤</span><span>大腿骨</span><span>膝蓋骨</span><span>脛骨</span><span>腓骨</span><span>足根骨</span></div>
        <p class="gd-label">確認テストの問い方</p>
        <div class="gd-toggles"><span class="on">位置→名前</span><span class="on">名前→位置</span><span class="on">日本語→英語</span><span>英語→日本語</span></div>
        <div class="gd-btn gd-btn-sm">始める<span>→</span>${finger()}${ripple()}</div>
        <div class="gd-btn gd-btn-ghost">確認テストだけ</div>
      </div>`,
  },
  {
    title: "1語ずつ見る",
    text: "光った所に名前が出ます。3Dは回したり拡大したりできます。カードは「覚えること」の1〜2文だけ読めば十分。🔊 で英語の発音も。",
    screen: `${topBar("学ぶ")}
      <div class="gd-stage gd-stage-img"><img src="${IMG}femur-hi.webp" alt="" draggable="false"><span class="gd-label3d gd-l2-label">大腿骨</span></div>
      <div class="gd-pad">
        <p class="gd-count"><b>下肢の骨</b><span>2 / 6</span></p>
        <div class="gd-card">
          <small>だいたいこつ・骨格系</small>
          <b class="gd-card-name">大腿骨</b>
          <span class="gd-card-en" lang="en">🔊 femur</span>
          <div class="gd-point"><i>覚えること</i>太ももの骨。体でいちばん長い骨。</div>
        </div>
        <div class="gd-navrow"><span class="gd-btn gd-btn-ghost">前へ</span><span class="gd-btn gd-btn-sm">次へ${finger()}${ripple()}</span></div>
      </div>`,
  },
  {
    title: "確認テスト",
    text: "見た語を、選んだ問い方で解きます。名前→位置は、3Dのその所をタップして青くし、もう一度タップか「これで答える」で答えます。答えた語から順に復習に入るので、途中でやめても大丈夫。",
    screen: `${topBar("学ぶ")}
      <div class="gd-qhead"><b>名前→位置</b><span>確認 3 / 12</span></div>
      <div class="gd-stage gd-stage-img gd-l3-stage"><img src="${IMG}femur.webp" alt="" draggable="false"><img class="gd-l3-hi" src="${IMG}femur-hi.webp" alt="" draggable="false">${finger()}${ripple()}</div>
      <div class="gd-pad">
        <p class="gd-q">「大腿骨」はどこ？</p>
        <p class="gd-note">3Dの上でタップして答える</p>
        <div class="gd-result gd-l3-ok">正解<small>次の出題: 1日後</small></div>
      </div>`,
  },
  {
    title: "復習に入る",
    text: "おわりの画面で、覚えた語が復習に入ったことがわかります。次からは「今日」の復習に出るので、毎日それを解くだけ。続けて次のレッスンへも進めます。",
    screen: `${topBar("学ぶ")}
      <div class="gd-pad gd-l4">
        <p class="gd-title">「下肢の骨」おわり</p>
        <p class="gd-big">確認テスト <b>11 / 12</b></p>
        <ul class="gd-joined">
          <li><span>大腿骨</span><i>復習へ</i></li><li><span>膝蓋骨</span><i>復習へ</i></li><li><span>脛骨</span><i>復習へ</i></li><li><span>腓骨</span><i>復習へ</i></li>
        </ul>
        <div class="gd-cal"><span class="on">今日</span><span>明日</span><span>3日後</span><span>1週間後</span></div>
        <div class="gd-navrow"><span class="gd-btn gd-btn-ghost">学ぶへ</span><span class="gd-btn gd-btn-sm">次のレッスン</span></div>
      </div>`,
  },
];

export function lessonDemo(signal: AbortSignal): HTMLElement {
  const phone = h("div", { class: "gd-phone gd-lesson-phone", "aria-hidden": "true" });
  const screens = LESSON_STEPS.map((step, i) => {
    const screen = h("div", { class: `gd-scr gd-l${i + 1}` });
    screen.innerHTML = step.screen;
    phone.append(screen);
    return screen;
  });
  const text = h("p", { class: "gd-stepper-text", "aria-live": "polite" });
  const buttons = LESSON_STEPS.map((step, i) => h("button", {
    class: "gd-stepper-tab", type: "button",
    onClick: () => { auto = false; show(i); },
  }, h("i", {}, String(i + 1)), h("span", {}, step.title)));
  const box = h("div", { class: "gd-anim gd-lesson gd-pair" },
    phone,
    h("div", { class: "gd-stepper" }, h("div", { class: "gd-stepper-tabs", role: "group", "aria-label": "レッスンの段" }, ...buttons), text,
      h("div", { class: "gd-stepper-nav" },
        h("button", { class: "ghost-button", type: "button", onClick: () => { auto = false; show((current + LESSON_STEPS.length - 1) % LESSON_STEPS.length); } }, "‹ 前"),
        h("button", { class: "ghost-button", type: "button", onClick: () => { auto = false; show((current + 1) % LESSON_STEPS.length); } }, "次 ›"))),
  );
  let current = 0;
  let auto = !reducedMotion();
  const show = (i: number) => {
    current = i;
    screens.forEach((screen, k) => {
      screen.classList.remove("is-active");
      if (k === i) {
        void screen.offsetWidth; // 段の中の動きを初めから
        screen.classList.add("is-active");
      }
    });
    buttons.forEach((button, k) => button.setAttribute("aria-pressed", String(k === i)));
    text.textContent = LESSON_STEPS[i].text;
  };
  show(0);
  const timer = window.setInterval(() => {
    if (auto && box.classList.contains("is-on")) show((current + 1) % LESSON_STEPS.length);
  }, 6000);
  signal.addEventListener("abort", () => window.clearInterval(timer), { once: true });
  return box;
}

/** 問い方の3つ（それぞれ6秒でくり返す） */
export function askDemos(): HTMLElement {
  return block("gd-asks", `
    <figure class="gd-ask">
      <div class="gd-ask-scr" aria-hidden="true">
        <div class="gd-stage gd-stage-img gd-glow"><img src="${IMG}femur-hi.webp" alt="" draggable="false"></div>
        <p class="gd-q">オレンジ色の部位の名前は？</p>
        ${choices(["上腕骨", "大腿骨", "脛骨", "腓骨"], "大腿骨")}
      </div>
      <figcaption><b>位置→名前</b>3Dで光った所の名前を4つから選ぶ。</figcaption>
    </figure>
    <figure class="gd-ask">
      <div class="gd-ask-scr" aria-hidden="true">
        <div class="gd-stage gd-stage-img gd-a2-stage"><img src="${IMG}femur.webp" alt="" draggable="false"><img class="gd-a2-hi" src="${IMG}femur-hi.webp" alt="" draggable="false"><span class="gd-label3d gd-a2-label">正解</span>${finger()}${ripple()}</div>
        <p class="gd-q">「大腿骨」はどこ？</p>
        <p class="gd-note">3Dの上でタップ（回す・拡大もできる）</p>
      </div>
      <figcaption><b>名前→位置</b>名前を見て、3Dのその所をタップする。青くなった所でよければ、もう一度タップか「これで答える」。</figcaption>
    </figure>
    <figure class="gd-ask">
      <div class="gd-ask-scr" aria-hidden="true">
        <div class="gd-prompt"><ruby>大腿骨<rt>だいたいこつ</rt></ruby></div>
        ${choices(["humerus", "femur", "tibia", "fibula"], "femur", "en")}
        <p class="gd-note">2回続けて正解すると、つづりを打つ問題に</p>
      </div>
      <figcaption><b>日本語→英語</b>英語名を選ぶ。慣れたらつづりを打つ。</figcaption>
    </figure>`);
}

/** 答えたあと（正解・惜しい・不正解）で次に出る日がどう変わるか */
export function outcomeTable(): HTMLElement {
  const box = h("div", { class: "gd-outcomes" });
  box.innerHTML = `
    <div class="gd-out ok"><b>正解</b><span>日をあけて出す。正解が続くほど、あく日が長くなる。</span></div>
    <div class="gd-out close"><b>惜しい・自信がなかった</b><span>正解より早めに出す。当てずっぽうで当たったら「自信がなかった」を押す。</span></div>
    <div class="gd-out ng"><b>不正解・わからない</b><span>新しい語は1分後、覚えた語は10分後に期限が来て、その回の終わりにもう一度出る。</span></div>`;
  return box;
}

/**
 * 復習のしくみの図: 思い出せる見込みが 90% まで下がるころに出し、思い出すたびに次までの日が長くなる。
 * 曲線は FSRS の忘れ方（R = (1 + 19/81・t/S)^-0.5。t = S で 90%）。安定度 S は 1・3・8・20日の例
 */
export function memoryChart(): HTMLElement {
  const W = 420, H = 240, left = 40, right = 10, top = 16, bottom = 30;
  const days = 34;
  const x = (t: number) => left + (t / days) * (W - left - right);
  const y = (r: number) => top + ((1 - r) / 0.5) * (H - top - bottom); // 50%〜100%
  const recall = (t: number, s: number) => (1 + (19 / 81) * (t / s)) ** -0.5;
  const stabilities = [1, 3, 8, 20, 60];
  let path = "";
  let start = 0;
  const reviews: number[] = [];
  for (const s of stabilities) {
    const span = Math.min(s, days - start);
    for (let k = 0; k <= 24; k++) {
      const t = (span * k) / 24;
      path += `${path ? "L" : "M"}${x(start + t).toFixed(1)} ${y(recall(t, s)).toFixed(1)} `;
    }
    if (start + s >= days) break;
    start += s;
    reviews.push(start);
    path += `L${x(start).toFixed(1)} ${y(1).toFixed(1)} `;
  }
  // 復習しなかったとき（学んだ日のあと何もしない）。50% まで
  const half = (81 / 19) * 3; // recall(t, 1) = 0.5 になる t
  let forget = "";
  for (let k = 0; k <= 40; k++) {
    const t = 1 + (k / 40) * (half - 1);
    forget += `${forget ? "L" : "M"}${x(t).toFixed(1)} ${y(recall(t, 1)).toFixed(1)} `;
  }
  const ticks = [0, 7, 14, 21, 28].map((d) => `<g class="gd-tick"><line x1="${x(d)}" x2="${x(d)}" y1="${y(0.5)}" y2="${y(0.5) + 4}"/><text x="${x(d)}" y="${y(0.5) + 18}">${d === 0 ? "学んだ日" : `${d}日`}</text></g>`).join("");
  const yTicks = [1, 0.9, 0.7, 0.5].map((r) => `<text class="gd-ytick" x="${left - 8}" y="${y(r) + 4}">${Math.round(r * 100)}%</text>`).join("");
  const dots = reviews.map((t, i) => `<g class="gd-dot" style="--i:${i}"><circle cx="${x(t)}" cy="${y(0.9)}" r="5"/><line x1="${x(t)}" x2="${x(t)}" y1="${y(0.9)}" y2="${y(1)}"/></g>`).join("");
  const box = block("gd-memory", `
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="思い出せる見込みの変わり方。復習のたびに次の復習までの日が 1日・3日・8日・20日 と長くなる">
      <line class="gd-axis" x1="${left}" x2="${W - right}" y1="${y(0.5)}" y2="${y(0.5)}"/>
      ${yTicks}${ticks}
      <line class="gd-line90" x1="${left}" x2="${W - right}" y1="${y(0.9)}" y2="${y(0.9)}"/>
      <text class="gd-line90-label" x="${W - right}" y="${y(0.9) + 16}">90%に下がるころに出す</text>
      <path class="gd-forget" d="${forget}" pathLength="1"/>
      <text class="gd-forget-label" x="${x(half) + 6}" y="${y(0.5) - 6}">復習しないと…</text>
      <path class="gd-curve" d="${path}" pathLength="1"/>
      ${dots}
    </svg>
    <p class="gd-gaps"><span class="gd-gaps-title">次の復習までの日（正解が続いたときの例）</span>${stabilities.slice(0, reviews.length).map((s, i) => `<b style="--i:${i}">${s}日</b>`).join("<i>→</i>")}<i>→</i><b style="--i:${reviews.length}">…</b></p>
    <p class="gd-memory-legend"><span class="gd-sw-curve"></span>思い出せる見込み（復習したとき）<span class="gd-sw-dot"></span>復習に出た日<span class="gd-sw-forget"></span>復習しないとき</p>`);
  return box;
}

/** 3Dの動かし方の4つ（スマホ・iPad とパソコンで説明を切りかえる） */
const GESTURES: { key: string; touch: [string, string]; mouse: [string, string]; stage: string }[] = [
  {
    key: "rotate",
    touch: ["回す", "1本指でドラッグ"], mouse: ["回す", "左ボタンでドラッグ"],
    stage: `${spinImg("gd-spin gd-g-rotate")}${finger("gd-g1-f")}`,
  },
  {
    key: "zoom",
    touch: ["拡大・縮小", "2本指でつまむ・広げる。指の所へ寄る"], mouse: ["拡大・縮小", "ホイールを回す。カーソルの所へ寄る"],
    stage: `<img class="gd-g-zoom" src="${IMG}femur.webp" alt="" draggable="false">${finger("gd-g2-f1")}${finger("gd-g2-f2 gd-two")}<span class="gd-wheel" aria-hidden="true"></span>`,
  },
  {
    key: "pan",
    touch: ["ずらす", "2本指でドラッグ"], mouse: ["ずらす", "右ボタンでドラッグ"],
    stage: `<img class="gd-g-pan" src="${IMG}femur.webp" alt="" draggable="false">${finger("gd-g3-f1")}${finger("gd-g3-f2 gd-two")}`,
  },
  {
    key: "tap",
    touch: ["名前を見る", "部位をタップ（図鑑・今日の人体）"], mouse: ["名前を見る", "部位をクリック。重ねるだけでも出る"],
    stage: `<img src="${IMG}femur.webp" alt="" draggable="false"><img class="gd-g4-hi" src="${IMG}femur-hi.webp" alt="" draggable="false"><span class="gd-label3d gd-g4-label">大腿骨</span>${finger("gd-g4-f")}${ripple("gd-g4-r")}`,
  },
];

export function gestureDemos(): HTMLElement {
  const coarse = window.matchMedia?.("(pointer: coarse)").matches ?? true;
  const grid = h("div", { class: "gd-gestures" });
  const tiles = GESTURES.map((gesture) => {
    const stage = h("div", { class: "gd-g-stage", "aria-hidden": "true" });
    stage.innerHTML = gesture.stage;
    const title = h("b", {});
    const how = h("span", {});
    grid.append(h("figure", { class: `gd-gesture gd-gesture-${gesture.key}` }, stage, h("figcaption", {}, title, how)));
    return { gesture, title, how };
  });
  const box = h("div", { class: "gd-anim gd-g" });
  const setMode = (mouse: boolean) => {
    box.classList.toggle("is-mouse", mouse);
    for (const { gesture, title, how } of tiles) {
      const [t, text] = mouse ? gesture.mouse : gesture.touch;
      title.textContent = t;
      how.textContent = text;
    }
    for (const button of switcher.querySelectorAll("button")) button.classList.toggle("on", (button.dataset.mode === "mouse") === mouse);
  };
  const switcher = h("div", { class: "chip-list gd-g-switch", role: "group", "aria-label": "使う端末" },
    h("button", { class: "chip", type: "button", "data-mode": "touch", onClick: () => setMode(false) }, "スマホ・iPad"),
    h("button", { class: "chip", type: "button", "data-mode": "mouse", onClick: () => setMode(true) }, "パソコン（マウス）"),
  );
  box.append(switcher, grid);
  setMode(!coarse);
  return box;
}

/** 向きの目印（前から見ているときは、体の右が画面の左） */
export function compassDemo(): HTMLElement {
  const box = h("div", { class: "gd-compass" });
  box.innerHTML = `
    <svg viewBox="0 0 220 150" role="img" aria-label="前から見ているとき、体の右は画面の左に来る">
      <circle class="gd-c-ring" cx="70" cy="75" r="58"/>
      <text class="gd-c-up" x="70" y="30">上</text><text class="gd-c-down" x="70" y="132">下</text>
      <text class="gd-c-right" x="26" y="80">右</text><text class="gd-c-left" x="114" y="80">左</text>
      <g class="gd-c-body"><circle cx="70" cy="47" r="7"/><path d="M60 58h20l3 30h-6l-1 30h-5l-1-26-1 26h-5l-1-30h-6z"/><path class="gd-c-rarm" d="M60 58l-6 32h5l4-24z"/></g>
      <text class="gd-c-cap" x="70" y="148">前から見ている</text>
      <path class="gd-c-arrow" d="M150 60h50M150 60l8-6M150 60l8 6"/>
      <text class="gd-c-note" x="175" y="84">画面の左が</text><text class="gd-c-note" x="175" y="100">体の右</text>
    </svg>
    <p>3Dの右上の目印は、今どちらから見ているかを示します。<b>前から見ているときは、体の右が画面の左</b>に来ます（オレンジ色が体の右）。向きを答える問題の間は隠れます。</p>`;
  return box;
}

/** 5つのタブの見本。タブを押す（または自動で）と中身が替わる */
const TAB_SCREENS: Record<GuideTab, string> = {
  today: `<div class="gd-stage">${spinImg("gd-spin gd-spin-sm")}</div>
    <div class="gd-sheet"><p class="gd-kicker">今日の一手</p><div class="gd-btn">今日の復習 <b>12問</b><span>→</span></div><p class="gd-note">続きから<span data-exam>・骨学試験まで○日</span></p></div>`,
  study: `<div class="gd-pad"><p class="gd-title">学ぶ</p>
    <div class="gd-next"><small>次のレッスン</small><b>下肢の骨</b><span class="gd-btn gd-btn-sm">始める<span>→</span></span></div>
    <ul class="gd-rows"><li><i style="--c:#c4663f"></i>すべてのレッスン</li><li><i style="--c:#b0453b"></i>臓器の図</li><li><i style="--c:#1f6f78"></i>演習</li><li data-exam><i style="--c:#6a5a9e"></i>骨学試験</li><li><i style="--c:#5b8a3a"></i>語根カード</li></ul></div>`,
  look: `<div class="gd-pad"><p class="gd-title">調べる</p>
    <div class="gd-search">${svg(TAB_ICON.look)}<span>だいたい</span></div>
    <ul class="gd-rows gd-hits"><li><b>大腿骨</b><small lang="en">femur</small></li><li><b>大腿動脈</b><small lang="en">femoral artery</small></li><li><b>大腿四頭筋</b><small lang="en">quadriceps femoris</small></li></ul>
    <ul class="gd-rows"><li><i style="--c:#1f6f78"></i>図鑑（3Dをタップ）</li><li><i style="--c:#c08a12"></i>★を付けた語</li></ul></div>`,
  records: `<div class="gd-pad"><p class="gd-title">記録</p>
    <div class="gd-week">${[3, 5, 2, 6, 4, 7, 5].map((n, i) => `<span style="--n:${n}"><i></i>${"月火水木金土日"[i]}</span>`).join("")}</div>
    <ul class="gd-rows"><li><i style="--c:#3a9d5d"></i>進捗（覚え具合を色で）</li></ul></div>`,
  settings: `<div class="gd-pad"><p class="gd-title">設定</p>
    <ul class="gd-rows"><li><i style="--c:#3d7a5a"></i>アカウントと同期</li><li><i style="--c:#c4663f"></i>コースと使う目的</li><li><i style="--c:#77736a"></i>1日の数・表示</li><li data-exam><i style="--c:#6a5a9e"></i>骨学試験の日</li><li><i style="--c:#77736a"></i>記録の書き出し</li><li><i style="--c:#1f6f78"></i>使い方・出典</li></ul></div>`,
};

/** 5つのタブの見本。select でそのタブにして止める（各タブの1行の説明の「くわしく ›」から #/guide/tabs/<タブ> で開いたとき） */
export type TabsDemo = HTMLElement & { select(tab: GuideTab): void };

export function isGuideTab(value: string): value is GuideTab {
  return TAB_NAMES.some(([id]) => id === value);
}

export function tabsDemo(signal: AbortSignal, describe: (tab: GuideTab) => HTMLElement, initial?: GuideTab): TabsDemo {
  const phone = h("div", { class: "gd-phone gd-tabs-phone", "aria-hidden": "true" });
  phone.innerHTML = `${topBar()}<div class="gd-scr is-active gd-tabs-scr"></div>${tabBar("today")}${finger("gd-tabs-f")}`;
  const screen = phone.querySelector<HTMLElement>(".gd-tabs-scr")!;
  const pointer = phone.querySelector<HTMLElement>(".gd-tabs-f")!;
  const side = h("div", { class: "gd-tabs-side", "aria-live": "polite" });
  const chips = TAB_NAMES.map(([id, name]) => h("button", {
    class: "chip", type: "button", onClick: () => { auto = false; show(id, false); },
  }, name));
  const box = h("div", { class: "gd-anim gd-tabs gd-pair" }, phone,
    h("div", {}, h("div", { class: "chip-list gd-tabs-chips", role: "group", "aria-label": "タブ" }, ...chips), side)) as HTMLElement as TabsDemo;
  // 1つのタブを開いて来たときは、自動では切りかえない
  let auto = !reducedMotion() && !initial;
  let index = 0;
  const show = (tab: GuideTab, tap: boolean) => {
    index = TAB_NAMES.findIndex(([id]) => id === tab);
    // 指をそのタブへ動かしてから切りかえる
    // 見本の画面の幅 220px を5つに分けたタブの真ん中
    pointer.style.setProperty("--x", `${index * 44 + 22}px`);
    pointer.classList.toggle("is-shown", tap);
    const swap = () => {
      for (const element of phone.querySelectorAll<HTMLElement>(".gd-tab")) element.classList.toggle("on", element.dataset.tab === tab);
      screen.innerHTML = TAB_SCREENS[tab];
      dropExam(screen);
      screen.classList.remove("is-in");
      void screen.offsetWidth;
      screen.classList.add("is-in");
    };
    if (tap) window.setTimeout(swap, 520);
    else swap();
    chips.forEach((chip, i) => chip.classList.toggle("on", i === index));
    side.replaceChildren(describe(tab));
  };
  show(initial ?? "today", false);
  box.select = (tab) => {
    auto = false;
    show(tab, false);
  };
  const timer = window.setInterval(() => {
    if (auto && box.classList.contains("is-on")) show(TAB_NAMES[(index + 1) % TAB_NAMES.length][0], true);
  }, 4200);
  signal.addEventListener("abort", () => window.clearInterval(timer), { once: true });
  return box;
}

/** 語のカードの見本と、番号つきの説明 */
const CARD_PARTS: [title: string, text: string][] = [
  ["読みと系統", "どの系統の語か。"],
  ["名前と ☆", "☆ を押すと★。★を付けた語は「調べる」に集まり、「演習」でまとめて解けます。"],
  ["英語と発音", "🔊 で読み上げ。設定で自動で鳴らすこともできます。"],
  ["語根", "英語名の部品。押すと意味と、同じ部品の語が出ます。"],
  ["覚えること", "まずはここだけ。1〜2文にまとめてあります。"],
  ["メモ", "「先生が出すと言った」など、自分の一言を残せます。"],
  ["くわしく", "くわしい説明・漢字・語源。開いたままにもできます。"],
];

export function cardDemo(): HTMLElement {
  const box = block("gd-cardwrap gd-pair", `
    <div class="gd-card gd-card-big" aria-hidden="true">
      <i class="gd-pin" style="--i:0;top:10px;left:-10px">1</i>
      <small>だいたいこつ・骨格系</small>
      <div class="gd-card-row"><b class="gd-card-name">大腿骨</b><span class="gd-star">☆</span><i class="gd-pin" style="--i:1;top:-4px;right:-10px">2</i></div>
      <div class="gd-card-row gd-rel"><span class="gd-speak">🔊</span><span class="gd-card-en" lang="en">femur</span><i class="gd-pin" style="--i:2;top:4px;right:-10px">3</i></div>
      <div class="gd-card-row gd-rel gd-root"><small>語根</small><u lang="en">femor-</u><span>大腿（もも）</span><i class="gd-pin" style="--i:3;top:0;right:-10px">4</i></div>
      <div class="gd-point gd-rel"><i>覚えること</i>太ももの骨。体でいちばん長い骨。<i class="gd-pin" style="--i:4;top:6px;right:-10px">5</i></div>
      <div class="gd-memo gd-rel"><small>メモ</small><span>自分の一言（先生が出すと言った、など）</span><i class="gd-pin" style="--i:5;top:6px;right:-10px">6</i></div>
      <div class="gd-more gd-rel">くわしく ▸<i class="gd-pin" style="--i:6;top:4px;right:-10px">7</i></div>
    </div>
    <ol class="gd-parts">${CARD_PARTS.map(([title, text], i) => `<li style="--i:${i}"><b>${title}</b><span>${text}</span></li>`).join("")}</ol>`, "語のカードの見本と、各部分の説明");
  return box;
}

/** そのほかの学び方（絵つきのカード） */
export function featureCards(): HTMLElement {
  const box = block("gd-features", `
    <a class="gd-feature" href="#/organs">
      <div class="gd-f-art gd-f-organ"><img src="${IMG}heart.webp" alt="" draggable="false"><span class="gd-f-cut"></span></div>
      <b>臓器の図</b><span>心臓・肺・脳などの立体を回し、切って中を見る。平面図で名前を確かめる。細胞と組織・発生もここ。</span>
    </a>
    <a class="gd-feature" href="#/drill">
      <div class="gd-f-art gd-f-drill"><span>終えたレッスン</span><span class="on">苦手な語</span><span>★を付けた語</span><span>範囲を細かく</span></div>
      <b>演習</b><span>範囲を選んで解き直す。試験の前の総ざらいに。答えは復習にも反映されます。</span>
    </a>
    <a class="gd-feature" href="#/exam" data-exam>
      <div class="gd-f-art gd-f-exam"><span><b>A</b>空欄</span><span><b>B</b>読み・書き</span><span><b>C</b>説明</span><span><b>D</b>図示</span></div>
      <b>骨学試験</b><span>骨学実習の試験の形式で練習。対で覚える語・数と並び・体表の目安も。（標準とすべての語）</span>
    </a>
    <a class="gd-feature" href="#/roots">
      <div class="gd-f-art gd-f-roots"><span lang="en"><u>femor</u>-al artery</span><i>＝</i><span><u>大腿</u>動脈</span></div>
      <b>語根カード</b><span>英語名を部品から読む。知らない語も意味の見当がつきます。（標準とすべての語）</span>
    </a>
    <a class="gd-feature" href="#/explore">
      <div class="gd-f-art gd-f-explore"><img src="${IMG}femur.webp" alt="" draggable="false"><span class="gd-label3d">大腿骨</span></div>
      <b>図鑑・調べる</b><span>3Dをタップして名前を見る。日本語・読み・英語・ラテン語からも引けます。</span>
    </a>
    <a class="gd-feature" href="#/progress">
      <div class="gd-f-art gd-f-progress"><img src="${IMG}progress.webp" alt="" draggable="false"><ul><li style="--c:#3a9d5d">覚えている</li><li style="--c:#e0b43a">あやしい</li><li style="--c:#d0503c">忘れかけ</li><li style="--c:#d9d4c7">まだ</li></ul></div>
      <b>進捗</b><span>覚え具合を人体の色で見る。薄い・赤い所から手を付けます。</span>
    </a>`);
  return box;
}
