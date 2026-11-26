import { speak } from "../audio";
import { systemById, termById, terms, type Term } from "../content";
import { beginnerPoints, isBeginner, isStandard, pointOf } from "../course";
import { h } from "../dom";
import { noteText } from "../en-notes";
import { examLoaded } from "../exam-lazy";
import { rootsOf, splitAtRoot, type Root } from "../roots";
import { markOf, setMark } from "../marks";
import { cutById, NERVE_CUTS } from "../nerve-cut";
import { preferences, setPreference } from "../settings";
import { INSERTION_COLOR, ORIGIN_COLOR, REGION_BOUND } from "../viewer";

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

/** 局所解剖の語の境界・中を通る語の一覧。open を渡すと（図鑑）タップでその語を開く */
function regionNotes(term: Term, open?: (word: Term) => void): HTMLElement | null {
  const region = term.region;
  if (!region) return null;
  const list = (ids: string[]) => {
    const words = ids.flatMap((id) => termById.get(id) ?? []);
    return open
      ? h("dd", { class: "chip-list" }, ...words.map((word) => h("button", { class: "chip", type: "button", onClick: () => open(word) }, word.ja)))
      : h("dd", {}, words.map((word) => word.ja).join("・"));
  };
  return h("dl", { class: "term-notes" },
    h("div", {}, h("dt", {}, h("span", { class: "swatch", style: `background:${REGION_BOUND}` }), region.boundsLabel ?? "境界"), list(region.bounds)),
    region.contents.length ? h("div", {}, h("dt", {}, region.contentsLabel ?? "通るもの"), list(region.contents)) : null,
  );
}

/**
 * 筋の「動きを見る」ボタン。play(true) で骨を動かして起始〜停止の距離の文を返し（骨格を読み込むときは後から）、play(false) でやめる。
 * 画面を替えると3Dの強調が替わって動きも止まるので、ボタンの表示だけを戻せばよい。
 */
function motionButton(play: (on: boolean) => string | Promise<string>): HTMLElement {
  let on = false;
  const note = h("p", { class: "muted motion-note" });
  const button = h("button", {
    class: "ghost-button", type: "button",
    onClick: () => {
      on = !on;
      const text = play(on);
      if (typeof text === "string") note.textContent = text;
      else void text.then((later) => (note.textContent = on ? later : ""));
      button.textContent = on ? "動きを止める" : "動きを見る";
      button.classList.toggle("on", on);
    },
  }, "動きを見る");
  return h("div", { class: "motion-row" }, button, note);
}

/** 説明の欄の「英語を併記」の切り替え（設定の「説明に英語を添える」と同じ）。押したら rerender で説明を作り直す */
function enToggle(rerender: () => void): HTMLElement {
  const on = preferences.enNotes;
  return h("div", { class: "en-toggle" },
    h("button", {
      class: on ? "chip on" : "chip", type: "button", "aria-pressed": String(on),
      title: "説明の中の解剖の語に英語を（）で添える",
      onClick: async () => {
        await setPreference("enNotes", !on);
        rerender();
      },
    }, on ? "英語を併記 ✓" : "英語を併記"),
  );
}

/** 「くわしく」を開いたままにするか（端末ごとの好み。開いて読む人は毎回開かなくて済むように） */
const MORE_KEY = "anatomy-term-more";
function moreOpen(): boolean {
  try {
    return localStorage.getItem(MORE_KEY) === "1";
  } catch {
    return false;
  }
}
function rememberMore(open: boolean): void {
  try {
    localStorage.setItem(MORE_KEY, open ? "1" : "0");
  } catch {
    // 覚えられないときはその場だけ
  }
}

/** ★（自分の印）の切りかえ。調べるの「★を付けた語」、演習の「★の語」に集まる */
function starButton(term: Term): HTMLElement {
  const button = h("button", { class: "star-button", type: "button" });
  const paint = () => {
    const on = markOf(term.id).starred;
    button.classList.toggle("on", on);
    button.setAttribute("aria-pressed", String(on));
    button.setAttribute("aria-label", on ? `${term.ja}の★を外す` : `${term.ja}に★を付ける`);
    button.title = on ? "★を外す" : "★を付ける（調べる・演習に集まる）";
    button.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3.8 2.5 5.2 5.7.8-4.1 4 1 5.7-5.1-2.7-5.1 2.7 1-5.7-4.1-4 5.7-.8z"/></svg>`;
  };
  button.addEventListener("click", async (event) => {
    // 答えの画面などで、押したことが下の要素（自動で次へ進むのを止めるなど）にも伝わるのはかまわない
    event.stopPropagation();
    const mark = markOf(term.id);
    // 押したらすぐ印を変える（保存はそのあと）
    const saving = setMark(term.id, { ...mark, starred: !mark.starred });
    paint();
    await saving;
  });
  paint();
  return button;
}

/** 自分の一言メモ（「先生が出すと言った」など）。押すと書く欄を開き、決めると残す */
function memoRow(term: Term): HTMLElement {
  const box = h("div", { class: "memo-row" });
  const show = () => {
    const memo = markOf(term.id).memo;
    box.replaceChildren(
      h("span", { class: "memo-label" }, "メモ"),
      memo ? h("span", { class: "memo-text" }, memo) : h("span", { class: "memo-text muted" }, "自分の一言（先生が出すと言った、など）"),
      h("button", { class: "text-button", type: "button", onClick: edit }, memo ? "直す" : "書く"),
    );
  };
  const edit = () => {
    const input = h("textarea", { class: "memo-input", rows: 2, maxlength: 200, "aria-label": `${term.ja}のメモ` }) as HTMLTextAreaElement;
    input.value = markOf(term.id).memo;
    const save = h("button", { class: "ghost-button", type: "button" }, "残す");
    save.addEventListener("click", async () => {
      await setMark(term.id, { ...markOf(term.id), memo: input.value });
      show();
    });
    box.replaceChildren(h("span", { class: "memo-label" }, "メモ"), input, save);
    input.focus();
  };
  show();
  return box;
}

/**
 * 語のカード。上から 名前と★ → 英語と発音・語根 → 説明（初心者モードは短い「覚えること」）→ 筋の起始・停止・神経・作用、通るもの・ホルモン
 * → 局所解剖の境界と通るもの → 自分のメモ → くわしく（漢字・語源・置き方・向き・英語の併記。開いたままにできる）。
 * 説明・作用の中の基本の用語はタップで意味を出す。open を渡すと（図鑑）、その用語を3Dで見るボタンも出す。
 * motion を渡すと、作用の動きのある筋に「動きを見る」を出す（骨を動かし、起始と停止を結ぶ帯が縮むのを示す）。
 * 初心者モードでは、覚えることだけを見せ、説明・起始停止なども「くわしく」の中にたたむ。compact は名前と英語だけ（正解したときの答え合わせ）
 */
export function termCard(term: Term, options: { compact?: boolean; open?: (word: Term) => void; motion?: (on: boolean) => string | Promise<string> } = {}): HTMLElement {
  const beginner = isBeginner();
  // 標準のコースでは、覚えることのある語（必修と基礎の語）は、覚えることを上に、説明を「くわしく」の中に（docs/学びやすさ.md の案4）
  const standard = isStandard() && !!pointOf(term.id);
  const brief = beginner || standard;
  const where = term.of ? `${termById.get(term.of)?.ja ?? ""}の部位` : systemById.get(term.system)?.ja ?? "";
  const gloss = h("div", { class: "gloss-box", hidden: true });
  const show = (word: Term) => {
    gloss.hidden = false;
    gloss.replaceChildren(
      h("div", { class: "gloss-head" },
        h("b", {}, word.ja), h("span", { lang: "en" }, word.en),
        h("button", { class: "gloss-close", type: "button", "aria-label": "閉じる", onClick: () => (gloss.hidden = true) }, "×"),
      ),
      h("p", {}, (beginner && beginnerPoints.get(word.id)) || (isStandard() && pointOf(word.id)) || noteText(word.note)),
      options.open ? h("button", { class: "ghost-button", type: "button", onClick: () => options.open!(word) }, word.figure?.motion ? "動きを3Dで見る" : "3Dで見る") : "",
    );
  };
  const linked = (text: string) => linkGlossary(text, term.id, show);
  const examCount = beginner ? 0 : examLoaded()?.data.examCountOf(term.id) ?? 0;
  const head = h("div", { class: "term-head" },
    h("div", { class: "term-name" },
      h("span", { class: "term-kicker" }, term.yomi, "・", where,
        examCount ? h("a", { class: "exam-mark", href: `#/exam/about/${term.id}`, title: "骨学試験に出た回数（A・B・C の合計）。押すとこの語の出る項目" }, `試験 ${examCount}回`) : null),
      h("span", { class: "term-ja" }, term.ja)),
    starButton(term),
  );
  const english = h("div", { class: "term-en" },
    h("button", { class: "speak", type: "button", "aria-label": "英語の発音を聞く", onClick: () => void speak(term) }, "🔊"),
    h("span", { lang: "en" }, term.en),
    !beginner && term.la && term.la.toLowerCase() !== term.en.toLowerCase() ? h("span", { class: "term-la", lang: "la" }, `（ラ）${term.la}`) : null,
  );
  if (options.compact) return h("article", { class: "term-card" }, head, english, gloss);

  // 自分で作った模式の立体（心臓の中・肺区域・胸膜・腎臓の中）は、本物の形と思わないように札を出す（docs/学びやすさ.md の案3）
  const schematic = term.schematic
    ? h("p", { class: "term-schematic" }, h("b", {}, "模式"), "3Dは位置と並びを示す模式の形で、実際の形とは違います。")
    : null;

  const point = beginnerPoints.get(term.id);
  const pointBox = (text: string | undefined, label: string) => text
    ? h("div", { class: "term-point" }, h("span", { class: "term-point-label" }, label), h("p", {}, ...linked(text)))
    : null;
  const muscle = !term.nerve ? null : h("dl", { class: "term-notes muscle-notes" },
    h("div", {}, h("dt", {}, h("span", { class: "swatch", style: `background:${ORIGIN_COLOR}` }), "起始"), h("dd", {}, term.origin)),
    h("div", {}, h("dt", {}, h("span", { class: "swatch", style: `background:${INSERTION_COLOR}` }), "停止"), h("dd", {}, term.insertion)),
    h("div", {}, h("dt", {}, "神経"), h("dd", {}, term.nerve)),
    h("div", {}, h("dt", {}, "作用"), h("dd", {}, ...linked(term.action ?? ""))),
  );
  const facts = [
    !term.passes ? null : h("dl", { class: "term-notes" }, h("div", {}, h("dt", {}, "通るもの"), h("dd", {}, ...linked(noteText(term.passes))))),
    !term.hormones ? null : h("dl", { class: "term-notes" }, h("div", {}, h("dt", {}, "ホルモン"), h("dd", {}, ...linked(term.hormones)))),
  ];
  /** くわしくの中身（漢字・語源・置き方・向き、初心者モードでは説明と筋なども）。英語の併記を切り替えたら作り直す */
  const details = (): (HTMLElement | null)[] => [
    enToggle(() => {
      box.replaceChildren(...details().filter((node) => node !== null));
      desc.replaceChildren(...linked(noteText(term.note)));
    }),
    h("dl", { class: "term-notes" },
      term.kanji ? h("div", {}, h("dt", {}, "漢字"), h("dd", {}, term.kanji)) : null,
      term.etym ? h("div", {}, h("dt", {}, "語源"), h("dd", {}, term.etym)) : null,
      term.la && term.la.toLowerCase() !== term.en.toLowerCase() && beginner ? h("div", {}, h("dt", {}, "ラテン"), h("dd", { lang: "la" }, term.la)) : null,
      brief ? h("div", {}, h("dt", {}, "説明"), h("dd", {}, ...linked(noteText(term.note)))) : null,
      // 骨の置き方（解剖学的正位の上下・前後・内外）と、ほかの部位から見た向き（向きの問い方の答え）
      term.placing ? h("div", {}, h("dt", {}, "置き方"), h("dd", {}, ...linked(noteText(term.placing)))) : null,
      term.toward ? h("div", {}, h("dt", {}, "向き"), h("dd", {}, ...linked(`${termById.get(term.toward.than)?.ja}の${termById.get(term.toward.dir)?.ja}。${noteText(term.toward.why)}`))) : null,
    ),
    ...(beginner ? [muscle, ...facts] : []),
  ];
  const box = h("div", { class: "term-details" });
  // 詳細モードの説明（英語の併記を切り替えたら、くわしくの中と一緒に作り直す）
  const desc = h("div", { class: "term-desc" }, ...linked(noteText(term.note)));
  const more = h("details", { class: "term-more", open: moreOpen() },
    h("summary", {}, brief ? "くわしく（漢字・語源・説明）" : "くわしく（漢字・語源・置き方）"));
  let filled = false;
  const fill = () => {
    if (more.open && !filled) {
      filled = true;
      box.append(...details().filter((node) => node !== null));
      more.append(box, beginner ? regionNotes(term, options.open) ?? "" : "");
    }
  };
  more.addEventListener("toggle", () => {
    fill();
    rememberMore(more.open);
  });
  fill();
  const motion = term.motion && options.motion ? motionButton(options.motion) : null;
  const cut = options.compact ? null : cutLink(term);
  if (beginner) {
    return h("article", { class: "term-card is-beginner" }, head, english, rootChips(term), schematic,
      pointBox(point, "覚えること") ?? h("div", { class: "term-point" }, h("span", { class: "term-point-label" }, "覚えること"),
        h("p", { class: "muted" }, "初心者コースには入っていない語です。くわしい説明は下から。")),
      motion, cut, memoRow(term), more, gloss);
  }
  if (standard) {
    // 標準のコース: 覚えること → 筋の起始・停止など・通るもの → 局所の境界 → メモ → くわしく（説明はここ）
    return h("article", { class: "term-card is-standard" }, head, english, rootChips(term), schematic,
      pointBox(pointOf(term.id), "覚えること"),
      muscle, ...facts, motion, cut, regionNotes(term, options.open), memoRow(term), more, gloss);
  }
  // 詳細モードは説明がそのまま「覚えること」（初心者コースの短い point と重なるので、point は出さない）
  return h("article", { class: "term-card" }, head, english, rootChips(term), schematic,
    desc,
    muscle, ...facts, motion, cut, regionNotes(term, options.open), memoRow(term), more, gloss);
}

/** 神経の語と、その神経で動く筋の語に「神経を切ると」への入口（src/ui/nerve-cut.ts） */
function cutLink(term: Term): HTMLElement | null {
  const cut = cutById.get(term.id) ?? (term.nerve ? NERVE_CUTS.find((item) => item.motor.includes(term.nerve!)) : undefined);
  if (!cut) return null;
  const nerve = termById.get(cut.id)?.ja ?? "";
  return h("a", { class: "term-cut-link", href: `#/cut/${cut.id}` },
    h("span", { "aria-hidden": "true" }, "✂"),
    h("span", {}, cut.id === term.id ? "この神経を切ると何が起こる？" : `${nerve}を切ると、この筋は？`),
    h("small", {}, cut.sign));
}
