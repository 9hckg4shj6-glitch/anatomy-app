import { speak } from "../audio";
import { systemById, termById, type Term } from "../content";
import { h } from "../dom";
import { INSERTION_COLOR, ORIGIN_COLOR } from "../viewer";

/** 語の中身（日本語・読み・英語・ラテン語・漢字の意味・語源・説明、筋なら起始・停止・支配神経・作用） */
export function termCard(term: Term, options: { compact?: boolean } = {}): HTMLElement {
  const where = term.of ? `${termById.get(term.of)?.ja ?? ""}の部位` : systemById.get(term.system)?.ja ?? "";
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
    options.compact ? null : h("dl", { class: "term-notes" },
      term.kanji ? h("div", {}, h("dt", {}, "漢字"), h("dd", {}, term.kanji)) : null,
      term.etym ? h("div", {}, h("dt", {}, "語源"), h("dd", {}, term.etym)) : null,
      h("div", {}, h("dt", {}, "説明"), h("dd", {}, term.note)),
    ),
    options.compact || !term.nerve ? null : h("dl", { class: "term-notes muscle-notes" },
      h("div", {}, h("dt", {}, h("span", { class: "swatch", style: `background:${ORIGIN_COLOR}` }), "起始"), h("dd", {}, term.origin)),
      h("div", {}, h("dt", {}, h("span", { class: "swatch", style: `background:${INSERTION_COLOR}` }), "停止"), h("dd", {}, term.insertion)),
      h("div", {}, h("dt", {}, "神経"), h("dd", {}, term.nerve)),
      h("div", {}, h("dt", {}, "作用"), h("dd", {}, term.action)),
    ),
  );
}
