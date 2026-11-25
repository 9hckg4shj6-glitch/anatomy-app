import { h } from "../dom";
import { iosBrowser, iosDevice } from "../install";

type Device = "iphone" | "ipad";
type Browser = ReturnType<typeof iosBrowser>;

/**
 * 「ホーム画面に追加」の案内のページ（iPhone・iPad のブラウザで、はじめて開いたときの最初の画面。#/start/install でいつでも）。
 * ブラウザとホーム画面のアプリでは記録が別々になり、Safari のままだとしばらく開かないと記録が消されることもあるので、
 * 何も入れる前に追加してもらう。手順は iOS 26 の Safari（iPhone は下の「…」→ 共有、iPad は上の共有ボタン）に合わせ、
 * 古い iOS の共有ボタン（□↑）とも読めるように書く。iPhone と iPad は見分けを間違えることがあるので、切り替えも置く。
 * 中の絵はみな決まった SVG なので innerHTML で入れる（利用者の入れた文は入れない）
 */
export function installGuide(): HTMLElement {
  let device: Device = iosDevice() === "ipad" ? "ipad" : "iphone";
  const browser = iosBrowser();
  const box = h("div", { class: "ig" });

  const render = () => {
    const tabs = h("div", { class: "segments ig-device", role: "group", "aria-label": "端末" },
      ...(["iphone", "ipad"] as const).map((id) => h("button", {
        class: id === device ? "segment on" : "segment", type: "button", "aria-pressed": String(id === device),
        onClick: () => { device = id; render(); },
      }, id === "iphone" ? "iPhone" : "iPad")));
    box.replaceChildren(
      h("p", { class: "start-eyebrow" }, "はじめに・1分"),
      h("h2", { class: "start-title" }, "ホーム画面に追加してから始めましょう"),
      h("p", { class: "ig-lead" }, "アプリのように、ホーム画面のアイコンから開けるようになります。App Store からのインストールはいりません。"),
      h("ul", { class: "ig-why" },
        h("li", {}, h("b", {}, "記録が消えにくい"), h("span", {}, "ブラウザのままだと、しばらく開かない間に、保存した記録が消されることがあります")),
        h("li", {}, h("b", {}, "全画面で広く"), h("span", {}, "アドレスの帯が消えて、3D がそのぶん大きく見えます")),
        h("li", {}, h("b", {}, "先に追加する"), h("span", {}, "ブラウザとホーム画面のアプリでは記録が別々です。ここで始めると、追加したあと最初からになります"))),
      h("div", { class: "ig-head" }, h("h3", { class: "start-sub" }, "追加のしかた", h("small", {}, browserName(browser))), tabs),
      h("ol", { class: "ig-steps" }, ...steps(device, browser).map((step, i) => h("li", { class: "ig-step" },
        figure(step.art),
        h("div", { class: "ig-text" },
          h("span", { class: "ig-num", "aria-hidden": "true" }, String(i + 1)),
          h("p", {}, ...step.text),
          step.extra ?? "")))),
      h("p", { class: "muted ig-note" }, "ボタンの帯が見当たらないときは、画面の下の端を軽く押すと出てきます。"),
    );
  };
  render();
  return box;
}

function browserName(browser: Browser): string {
  return browser === "chrome" ? "Chrome の場合" : browser === "inapp" ? "アプリの中で開いている場合" : browser === "other" ? "" : "Safari の場合";
}

interface Step {
  art: string;
  text: (Node | string)[];
  extra?: Node;
}

/** 端末とブラウザごとの手順。いちばん多い iPhone の Safari を基本にする */
function steps(device: Device, browser: Browser): Step[] {
  const b = (text: string) => h("b", {}, text);
  const first: Step[] = [];
  if (browser === "inapp") {
    // LINE などのアプリの中のページからは追加できない。Safari で開き直してもらう（アドレスをコピーしておけば貼るだけ）
    const copy = h("button", { class: "ghost-button ig-copy", type: "button" }, "このページのアドレスをコピー");
    copy.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(location.href.split("#")[0]);
        copy.textContent = "コピーしました。Safari のアドレスの欄に貼ってください";
      } catch {
        copy.textContent = "コピーできませんでした。メニューから「Safari で開く」を選んでください";
      }
    });
    first.push({
      art: ART.inapp,
      text: ["今は LINE などのアプリの中で開いています。ここからは追加できないので、画面の端の ", b("…"), " や共有のマークから ",
        b("「Safari で開く」"), "（「ブラウザで開く」）を選びます。開いたら、下の 2 から。"],
      extra: copy,
    });
  }
  const shareArt = browser === "chrome" ? ART.chrome : device === "ipad" ? ART.ipadShare : ART.iphoneShare;
  const shareText: (Node | string)[] = browser === "chrome"
    ? ["画面の上のアドレスの欄の右にある ", b("共有ボタン（□↑）"), " を押します。"]
    : browser === "other"
      ? ["ブラウザのメニュー（", b("…"), " や ", b("≡"), "）を開き、", b("「共有」"), " を押します。"]
      : device === "ipad"
        ? ["画面の上の右にある ", b("共有ボタン（□↑）"), " を押します。"]
        : ["画面の下の右にある ", b("「…」"), " を押し、", b("「共有」"), " を押します（下に ", b("□↑"), " が見えていれば、それを押します）。"];
  return [
    ...first,
    { art: shareArt, text: shareText },
    {
      art: ART.sheet,
      text: ["出てきた一覧を上へ動かし、", b("「ホーム画面に追加」"), " を押します。無いときは、", b("「その他」"), "（「さらに表示」）の中にあります。"],
    },
    {
      art: ART.add,
      text: [b("「Web アプリとして開く」"), " はオンのまま、右上の ", b("「追加」"), " を押します（オンとオフの欄が無ければ、そのまま「追加」）。"],
    },
    {
      art: ART.home,
      text: ["ホーム画面に増えた ", b("「からだ見聞録」"), " のアイコンから開いて始めます。このページは閉じてかまいません。"],
    },
  ];
}

function figure(svg: string): HTMLElement {
  const box = h("div", { class: "ig-art", "aria-hidden": "true" });
  box.innerHTML = svg;
  return box;
}

/* ここから絵（iPhone は 104×146・iPad は右上の 136×100 に切り取る）。.ig-art の CSS で色を付ける: f 枠・s 画面・l 線・t 字・k 押すところ（橙の輪）・a アプリの色 */
const SHARE = (x: number, y: number) =>
  `<g class="l" transform="translate(${x} ${y})"><path d="M-5 -1v8h10v-8"/><path d="M0 -8v10M-3.5 -4.5 0 -8l3.5 3.5"/></g>`;
const RING = (x: number, y: number, r = 13) => `<circle class="k" cx="${x}" cy="${y}" r="${r}"/>`;

const ART = {
  /** iPhone の Safari（iOS 26 の下の帯: ‹・アドレス・…） */
  iphoneShare: `<svg viewBox="68 2 104 146">
    <rect class="f" x="70" y="4" width="100" height="142" rx="16"/><rect class="s" x="76" y="10" width="88" height="130" rx="11"/>
    <rect class="b" x="84" y="24" width="72" height="8" rx="3"/><rect class="b" x="84" y="38" width="56" height="8" rx="3"/><rect class="b" x="84" y="52" width="64" height="30" rx="4"/>
    <rect class="bar" x="80" y="112" width="80" height="26" rx="13"/>
    <path class="l" d="M92 120l-5 5 5 5"/><rect class="pill" x="100" y="117" width="38" height="16" rx="8"/>
    <text class="t xs" x="119" y="128.5" text-anchor="middle">karada</text>
    <g class="t"><circle cx="146" cy="125" r="1.6"/><circle cx="151" cy="125" r="1.6"/><circle cx="156" cy="125" r="1.6"/></g>
    ${RING(151, 125, 11)}
  </svg>`,
  /** iPad の Safari（上の帯の右に共有ボタン） */
  ipadShare: `<svg viewBox="92 6 136 100">
    <rect class="f" x="16" y="10" width="208" height="134" rx="14"/><rect class="s" x="24" y="18" width="192" height="118" rx="8"/>
    <rect class="bar" x="24" y="18" width="192" height="30" rx="8"/>
    <rect class="pill" x="96" y="25" width="58" height="16" rx="8"/><text class="t xs" x="104" y="36.5">karada</text>
    <g transform="translate(176 34) scale(1.3)">${SHARE(0, 0)}</g>${RING(176, 33, 13)}
    <path class="l" d="M202 28v10M197 33h10"/>
    <rect class="b" x="104" y="62" width="70" height="10" rx="3"/><rect class="b" x="104" y="80" width="100" height="40" rx="5"/>
  </svg>`,
  /** Chrome（上のアドレスの欄の右に共有ボタン） */
  chrome: `<svg viewBox="68 2 104 146">
    <rect class="f" x="70" y="4" width="100" height="142" rx="16"/><rect class="s" x="76" y="10" width="88" height="130" rx="11"/>
    <rect class="pill" x="82" y="18" width="76" height="18" rx="9"/><text class="t xs" x="106" y="30.5" text-anchor="middle">karada</text>
    ${SHARE(146, 27)}${RING(146, 27, 11)}
    <rect class="b" x="84" y="48" width="72" height="8" rx="3"/><rect class="b" x="84" y="62" width="64" height="40" rx="4"/>
  </svg>`,
  /** 共有の一覧（ホーム画面に追加） */
  sheet: `<svg viewBox="68 2 104 146">
    <rect class="f" x="70" y="4" width="100" height="142" rx="16"/><rect class="s" x="76" y="10" width="88" height="130" rx="11"/>
    <rect class="sheet" x="76" y="34" width="88" height="106" rx="11"/>
    <rect class="row" x="82" y="44" width="76" height="20" rx="5"/><text class="t xs" x="88" y="57.5">コピー</text>
    <rect class="row" x="82" y="68" width="76" height="20" rx="5"/><text class="t xs" x="88" y="81.5">ブックマーク</text>
    <rect class="row hot" x="82" y="92" width="76" height="20" rx="5"/><text class="t xs strong" x="84" y="105.5" textLength="72" lengthAdjust="spacingAndGlyphs">ホーム画面に追加</text>
    <rect class="row" x="82" y="116" width="76" height="20" rx="5"/><text class="t xs" x="88" y="129.5">その他</text>
    <rect class="k-box" x="79" y="89" width="82" height="26" rx="7"/>
  </svg>`,
  /** 追加の画面（Web アプリとして開く・追加） */
  add: `<svg viewBox="68 2 104 146">
    <rect class="f" x="70" y="4" width="100" height="142" rx="16"/><rect class="s" x="76" y="10" width="88" height="130" rx="11"/>
    <text class="t xs muted" x="82" y="28">キャンセル</text><text class="t xs strong" x="158" y="28" text-anchor="end">追加</text>${RING(149, 24, 12)}
    <rect class="a" x="82" y="40" width="24" height="24" rx="6"/><rect class="row" x="110" y="44" width="48" height="16" rx="4"/>
    <text class="t xs" x="113" y="55.5">からだ…</text>
    <rect class="row" x="82" y="74" width="76" height="22" rx="5"/><text class="t xs" x="86" y="88.5">Webアプリ</text>
    <rect class="on" x="136" y="79" width="18" height="12" rx="6"/><circle class="knob" cx="148" cy="85" r="4.5"/>
  </svg>`,
  /** ホーム画面（からだ見聞録のアイコン） */
  home: `<svg viewBox="68 2 104 146">
    <rect class="f" x="70" y="4" width="100" height="142" rx="16"/><rect class="s home" x="76" y="10" width="88" height="130" rx="11"/>
    ${[0, 1, 2, 3].flatMap((c) => [0, 1].map((r) => `<rect class="ic" x="${83 + c * 20}" y="${22 + r * 26}" width="14" height="14" rx="4"/>`)).join("")}
    <rect class="a" x="83" y="74" width="14" height="14" rx="4"/>
    <g transform="translate(90 81) rotate(-45) scale(0.5)" class="mark"><rect x="-7" y="-1.6" width="14" height="3.2" rx="1"/><circle cx="-7" cy="-2" r="2.4"/><circle cx="-7" cy="2" r="2.4"/><circle cx="7" cy="-2" r="2.4"/><circle cx="7" cy="2" r="2.4"/></g>
    ${RING(90, 81, 12)}
  </svg>`,
  /** LINE などのアプリの中のページ（右上の … から Safari で開く） */
  inapp: `<svg viewBox="68 2 104 146">
    <rect class="f" x="70" y="4" width="100" height="142" rx="16"/><rect class="s" x="76" y="10" width="88" height="130" rx="11"/>
    <rect class="bar" x="76" y="10" width="88" height="22" rx="11"/>
    <path class="l" d="M84 17l8 8M92 17l-8 8"/>
    <g class="t"><circle cx="146" cy="21" r="1.6"/><circle cx="151" cy="21" r="1.6"/><circle cx="156" cy="21" r="1.6"/></g>${RING(151, 21, 10)}
    <rect class="sheet" x="96" y="38" width="64" height="34" rx="6"/><text class="t xs strong" x="128" y="59" text-anchor="middle">Safariで開く</text>
    <rect class="b" x="84" y="84" width="72" height="8" rx="3"/><rect class="b" x="84" y="98" width="64" height="30" rx="4"/>
  </svg>`,
};
