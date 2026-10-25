import { h } from "./dom";

/** Chrome（Android・PC）が出す「インストールできます」の合図。ホームの案内のボタンから使う */
interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

let deferred: InstallPromptEvent | null = null;

/** 起動してすぐ呼ぶ（合図はホームを描く前に来ることがある） */
export function watchInstallPrompt(): void {
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault(); // ブラウザの自動の案内の代わりに、ホームの案内から出す
    deferred = event as InstallPromptEvent;
    window.dispatchEvent(new Event("anatomy:installable"));
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    window.dispatchEvent(new Event("anatomy:installable"));
  });
}

/** ホーム画面から開いているか */
export function isStandalone(): boolean {
  return matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
}

function isIos(): boolean {
  // iPadOS の Safari は Mac として名乗るので、タッチの有無で見分ける
  return /iPhone|iPad|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
}

/**
 * ホーム画面に追加する案内。iOS は共有ボタンからの手順を、Chrome は追加のボタンを出す。
 * それ以外（PC の Safari・Firefox など）とホーム画面から開いているときは何も出さない。
 */
export function installHint(signal: AbortSignal, onClose: () => void): HTMLElement {
  const box = h("aside", { class: "install" });
  const close = () => h("button", { class: "close", type: "button", "aria-label": "案内を閉じる", onClick: () => { box.hidden = true; onClose(); } }, "×");
  const render = () => {
    if (isStandalone()) box.replaceChildren();
    else if (deferred) {
      const add = h("button", {
        class: "primary", type: "button",
        onClick: async () => {
          const event = deferred;
          deferred = null;
          await event?.prompt();
          render();
        },
      }, "ホーム画面に追加");
      box.replaceChildren(h("p", {}, "ホーム画面に追加すると、アプリとして全画面で開け、通信のない所でも使えます。", h("br"), add), close());
    } else if (isIos()) {
      box.replaceChildren(
        h("p", {}, "共有ボタン（Safari では", h("b", {}, " □↑ "), "）から「ホーム画面に追加」でアプリとして使えます。",
          "Safari とホーム画面のアプリでは学習の記録が別々になるので、追加してから始めるのがおすすめです。"),
        close(),
      );
    } else box.replaceChildren();
    box.hidden = !box.childNodes.length;
  };
  window.addEventListener("anatomy:installable", render, { signal });
  render();
  return box;
}
