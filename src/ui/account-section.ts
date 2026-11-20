import { account, accountAvailable, inAppBrowser, signIn, signOut, switchToSignedInAccount, syncNow } from "../account";
import { h } from "../dom";

/**
 * 設定の「アカウントと同期」（#/settings/account。docs/普段使い.md「端末をまたぐ（同期）」）。
 * ログインしていない・ログイン中・この端末に別のアカウントの記録がある、の3つで中身を替える。状態が変わるたびに描き直す
 */
export function accountSection(signal: AbortSignal): HTMLElement {
  const box = h("section", { class: "settings account", id: "settings-account" });
  let asking = false;
  const render = () => box.replaceChildren(h("h3", {}, "アカウントと同期"), ...parts(() => {
    asking = !asking;
    render();
  }, asking));
  render();
  window.addEventListener("anatomy:account", render, { signal });
  return box;
}

/** Google の「G」（ログインのボタン） */
const GOOGLE_G = `<svg viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.6 13.3l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z"/><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 2.9-2.2 5.4-4.7 7.1l7.6 5.9c4.4-4.1 6.9-10.1 6.9-17.5z"/><path fill="#FBBC05" d="M10.5 28.6c-.5-1.4-.8-3-.8-4.6s.3-3.2.8-4.6l-7.9-6.1C1 16.6 0 20.2 0 24s1 7.4 2.6 10.7l7.9-6.1z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.6-5.9c-2.1 1.4-4.9 2.3-8.3 2.3-6.3 0-11.6-4.1-13.5-9.9l-7.9 6.1C6.6 42.6 14.6 48 24 48z"/></svg>`;

export function googleButton(label = "Google でログイン"): HTMLElement {
  const button = h("button", { class: "google-button", type: "button", onClick: () => void signIn() });
  button.innerHTML = GOOGLE_G;
  button.append(h("span", {}, label));
  return button;
}

/** LINE などのアプリの中のブラウザでは Google がログインを断るので、先に知らせる */
export function inAppNote(): HTMLElement | string {
  return inAppBrowser()
    ? h("p", { class: "drill-note" }, "LINE などのアプリの中で開いたページでは、Google にログインできません。右上のメニューから「ブラウザで開く」を選び、Safari や Chrome で開いてからログインしてください。")
    : "";
}

function when(iso: string): string {
  if (!iso) return "";
  const at = new Date(iso);
  const time = at.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
  return at.toDateString() === new Date().toDateString() ? `今日 ${time}` : `${at.getMonth() + 1}月${at.getDate()}日 ${time}`;
}

function statusLine(): HTMLElement {
  const pending = account.pending ? `（まだ送っていない変更 ${account.pending.toLocaleString()}件）` : "";
  const text = account.phase === "syncing" ? "同期しています…"
    : account.phase === "offline" ? `通信できないため、つながったら同期します${pending}。`
      : account.phase === "not-ready" ? "同期のサーバーの準備がまだです。準備ができしだい、自動で同期を始めます（記録はこの端末に残っています）。"
        : account.phase === "error" ? `同期できませんでした: ${account.message}`
          : account.lastAt ? `最後に同期: ${when(account.lastAt)}${pending}` : "まだ同期していません。";
  return h("p", { class: account.phase === "error" || account.phase === "not-ready" ? "account-status is-warn" : "account-status", "aria-live": "polite" }, text);
}

function parts(toggleAsk: () => void, asking: boolean): (HTMLElement | string)[] {
  if (account.status === "unavailable" || !accountAvailable()) {
    return [h("p", { class: "muted" }, "この版ではログインできません。記録をほかの端末へ移すときは、下の「記録の書き出し・読み込み」を使ってください。")];
  }
  const message = account.message && account.status !== "signed-in" ? h("p", { class: "drill-note", role: "alert" }, account.message) : "";
  if (account.status === "loading") return [h("p", { class: "muted" }, "ログインを確かめています…")];

  if (account.status === "guest") {
    const owner = account.owner;
    return [
      h("p", {}, "Google でログインすると、同じアカウントのスマホ・iPad・PC で、学んだ記録（覚え具合・解いた記録・★とメモ・設定）が同じになります。"),
      message,
      inAppNote(),
      googleButton(),
      owner
        ? h("p", { class: "muted" }, `前に ${owner.email || "Google のアカウント"} でログインしていました。同じアカウントでログインし直すと、そのあとに学んだ分${account.pending ? `（${account.pending.toLocaleString()}件）` : ""}も送ります。`)
        : h("p", { class: "muted" }, "はじめてログインすると、この端末の記録とアカウントの記録を合わせます（どちらも消えません）。ログインしなくても、この端末だけで今までどおり使えます。"),
      h("p", { class: "muted" }, "ログインに使うのは名前とメールアドレスだけです。記録は端末をまたぐためだけに保存し、集計には使いません。"),
    ];
  }

  const user = account.user!;
  const who = h("p", { class: "profile-summary" }, h("b", {}, user.name || user.email), user.name ? h("span", {}, user.email) : "");

  if (account.status === "conflict") {
    const ownerEmail = account.owner?.email || "別の Google アカウント";
    return [
      who,
      h("p", { class: "drill-note", role: "alert" }, `この端末には、前にログインした ${ownerEmail} の記録があります。今は ${user.email} でログインしています。`),
      h("button", {
        class: "primary", type: "button",
        onClick: async () => {
          const lost = account.pending ? `\nまだ送っていない変更 ${account.pending.toLocaleString()}件は失われます。` : "";
          if (!confirm(`この端末の記録を消して、${user.email} の記録に切り替えます。${ownerEmail} の記録はアカウントに残っています。${lost}\nよろしいですか？`)) return;
          await switchToSignedInAccount();
        },
      }, `${user.email} の記録に切り替える`),
      h("button", { class: "ghost-button", type: "button", onClick: () => void signOut(false) }, `ログアウトする（${ownerEmail} の記録のまま）`),
    ];
  }

  const logout = asking
    ? h("div", { class: "account-logout" },
      h("p", {}, "ログアウトしたあと、この端末の記録をどうしますか？"),
      h("button", { class: "ghost-button", type: "button", onClick: () => void signOut(false) }, "残す（この端末だけで続ける）"),
      h("button", {
        class: "ghost-button is-danger", type: "button",
        onClick: () => {
          if (!confirm("この端末の記録を消してログアウトします。アカウントに送った記録は残り、もう一度ログインすれば戻ります。よろしいですか？")) return;
          void signOut(true);
        },
      }, "この端末から消す（共用の端末など）"),
      h("button", { class: "text-button", type: "button", onClick: toggleAsk }, "やめる"))
    : "";
  return [
    who,
    h("p", { class: "muted" }, "このアカウントでログインした端末どうしで、記録が自動で同じになります（学んでいる間は少しずつ、アプリを開いたときと閉じたときにも）。"),
    statusLine(),
    asking ? "" : h("div", { class: "nav-row account-actions" },
      h("button", { class: "ghost-button", type: "button", disabled: account.phase === "syncing", onClick: () => void syncNow() }, "今すぐ同期"),
      h("button", { class: "ghost-button", type: "button", onClick: toggleAsk }, "ログアウト")),
    logout,
  ];
}
