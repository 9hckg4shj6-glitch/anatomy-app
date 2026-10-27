import { speak } from "../audio";
import { systemById, termById, terms, type Term } from "../content";
import { h } from "../dom";
import { rootsOf, splitAtRoot, type Root } from "../roots";
import { INSERTION_COLOR, ORIGIN_COLOR } from "../viewer";

/**
 * 説明・作用の中の基本の用語（「外転」「内側」など2文字以上。1文字の「上」「浅」は上腕・浅層などに紛れるので除く）。
 * 長い語から探す（「正中矢状面」を「矢状面」より先に）。
 */
const glossary = terms.filter((term) => term.figure && term.ja.length >= 2).sort((a, b) => b.ja.length - a.ja.length);
const glossaryByJa = new Map(glossary.map((term) => [term.ja, term]));
const glossaryPattern = glossary.length ? new RegExp(glossary.map((term) => term.ja).join("|"), "g") : null;

/** 文の中の基本の用語をタップできるボタンにする（その語自身の説明の中では除く） */
function linkGlossary(text: string, self: string, show: (word: Term) => void): (Node | string)[] {
  if (!glossaryPattern) return [text];
  const out: (Node | string)[] = [];
  let last = 0;
  for (const match of text.matchAll(glossaryPattern)) {
    const word = glossaryByJa.get(match[0])!;
    if (word.id === self) continue;
    out.push(text.slice(last, match.index), h("button", { class: "gloss", type: "button", onClick: () => show(word) }, match[0]));
    last = match.index + match[0].length;
  }
  out.push(text.slice(last));
  return out;
}

/** 英語名の中の語根を太字にする */
export function markedRoot(text: string, root: Root): HTMLElement {
  const parts = splitAtRoot(text, root);
  return h("span", { lang: "en", class: "root-word" }, ...(parts ? [parts[0], h("b", {}, parts[1]), parts[2]] : [text]));
}

/** 英語名に含まれる語根（タップで意味）。語根カード（content/roots.json）に無ければ出さない */
function rootChips(term: Term): HTMLElement | null {
  const list = rootsOf(term);
  if (!list.length) return null;
  const box = h("div", { class: "gloss-box", hidden: true });
  return h("div", { class: "root-chips" },
    h("span", { class: "muted" }, "語根"),
    ...list.map((root) => h("button", {
      class: "gloss", type: "button", lang: "en",
      onClick: () => {
        box.hidden = false;
        box.replaceChildren(
          h("div", { class: "gloss-head" }, h("b", { lang: "en" }, root.root), h("span", {}, root.meaning),
            h("button", { class: "gloss-close", type: "button", "aria-label": "閉じる", onClick: () => (box.hidden = true) }, "×")),
          h("p", {}, markedRoot(term.en, root), "　", root.note),
          h("a", { href: "#/roots" }, "語根カードの一覧へ"),
        );
      },
    }, root.root)),
    box,
  );
}

/**
 * 語の中身（日本語・読み・英語・ラテン語・漢字の意味・語源・説明、筋なら起始・停止・支配神経・作用）。
 * 説明・作用の中の基本の用語はタップで意味を出す。open を渡すと（図鑑）、その用語を3Dで見るボタンも出す。
 * 英語名に含まれる語根（brachi-「腕」など）もタップで意味を出す。
 */
export function termCard(term: Term, options: { compact?: boolean; open?: (word: Term) => void } = {}): HTMLElement {
  const where = term.of ? `${termById.get(term.of)?.ja ?? ""}の部位` : systemById.get(term.system)?.ja ?? "";
  const gloss = h("div", { class: "gloss-box", hidden: true });
  const show = (word: Term) => {
    gloss.hidden = false;
    gloss.replaceChildren(
      h("div", { class: "gloss-head" },
        h("b", {}, word.ja), h("span", { lang: "en" }, word.en),
        h("button", { class: "gloss-close", type: "button", "aria-label": "閉じる", onClick: () => (gloss.hidden = true) }, "×"),
      ),
      h("p", {}, word.note),
      options.open ? h("button", { class: "ghost-button", type: "button", onClick: () => options.open!(word) }, word.figure?.motion ? "動きを3Dで見る" : "3Dで見る") : "",
    );
  };
  const linked = (text: string) => linkGlossary(text, term.id, show);
  return h("article", { class: "term-card" },
    h("div", { class: "term-head" },
      h("ruby", { class: "term-ja" }, term.ja, h("rt", {}, term.yomi)),
      h("span", { class: "term-system" }, where),
    ),
    h("div", { class: "term-en" },
      h("button", { class: "speak", type: "button", "aria-label": "英語の発音を聞く", onClick: () => void speak(term) }, "🔊"),
      h("span", { lang: "en" }, term.en),
      term.la && term.la.toLowerCase() !== term.en.toLowerCase() ? h("span", { class: "term-la", lang: "la" }, `（ラ）${term.la}`) : null,
    ),
    options.compact ? null : rootChips(term),
    options.compact ? null : h("dl", { class: "term-notes" },
      term.kanji ? h("div", {}, h("dt", {}, "漢字"), h("dd", {}, term.kanji)) : null,
      term.etym ? h("div", {}, h("dt", {}, "語源"), h("dd", {}, term.etym)) : null,
      h("div", {}, h("dt", {}, "説明"), h("dd", {}, ...linked(term.note))),
    ),
    options.compact || !term.nerve ? null : h("dl", { class: "term-notes muscle-notes" },
      h("div", {}, h("dt", {}, h("span", { class: "swatch", style: `background:${ORIGIN_COLOR}` }), "起始"), h("dd", {}, term.origin)),
      h("div", {}, h("dt", {}, h("span", { class: "swatch", style: `background:${INSERTION_COLOR}` }), "停止"), h("dd", {}, term.insertion)),
      h("div", {}, h("dt", {}, "神経"), h("dd", {}, term.nerve)),
      h("div", {}, h("dt", {}, "作用"), h("dd", {}, ...linked(term.action ?? ""))),
    ),
    gloss,
  );
}
