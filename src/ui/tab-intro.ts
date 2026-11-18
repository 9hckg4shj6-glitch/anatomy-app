import { db, nowIso } from "../db";
import { h } from "../dom";

export type TabName = "today" | "study" | "look" | "records";

/** 各タブの1行の説明（そのタブで何ができるか） */
const TEXTS: Record<TabName, [title: string, text: string]> = {
  today: ["今日", "毎日ここから。覚えた語の復習が1タップで始まります。人体の部位をタップすると図鑑で開きます。"],
  study: ["学ぶ", "新しい語はレッスンで。臓器の図・演習・骨学試験・語根カードもここから選びます。"],
  look: ["調べる", "授業や実習の合間に、日本語・英語からすぐ1語を引けます。☆を付けた語もここに集まります。"],
  records: ["記録", "続けた日と覚え具合（進捗）、コース・目的・試験の日などの設定。使い方もここにあります。"],
};

/** この回数だけ見たら出さない（閉じればすぐ出さない） */
const SHOW_TIMES = 5;
/** db.settings のキー。タブごとに見た回数（閉じたら -1） */
const KEY = "tabIntros";

/** 使い方の「はじめの案内をもう一度出す」 */
export async function resetTabIntros(): Promise<void> {
  await db.settings.delete(KEY);
}

/**
 * タブの一番上に出す1行の説明（docs/普段使い.md「はじめての人への案内」）。はじめのうちだけ出し、× で閉じる。
 * 見た回数を数え、SHOW_TIMES 回で出さなくなる。出さないときは空文字
 */
export async function tabIntro(tab: TabName): Promise<HTMLElement | ""> {
  const saved = (await db.settings.get(KEY))?.value;
  const counts: Partial<Record<TabName, number>> = saved && typeof saved === "object" ? { ...(saved as Record<TabName, number>) } : {};
  const seen = counts[tab] ?? 0;
  if (seen < 0 || seen >= SHOW_TIMES) return "";
  counts[tab] = seen + 1;
  void db.settings.put({ key: KEY, value: counts, updatedAt: nowIso() });
  const [title, text] = TEXTS[tab];
  const box = h("aside", { class: "tab-intro", "aria-label": `${title}のタブについて` },
    h("p", {}, h("b", {}, `${title}：`), text, " ", h("a", { href: "#/guide" }, "使い方 ›")),
    h("button", {
      class: "tab-intro-close", type: "button", "aria-label": "この説明を閉じる", title: "閉じる",
      onClick: () => {
        counts[tab] = -1;
        void db.settings.put({ key: KEY, value: counts, updatedAt: nowIso() });
        box.remove();
      },
    }, "×"),
  );
  return box;
}
