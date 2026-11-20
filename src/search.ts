import { terms, type Term, type Unit } from "./content";
import { courseUnits, inCourse } from "./course";

/** 検索の表記ゆれをそろえる（大文字・小文字、カタカナ→ひらがな、全角英数→半角） */
export function normalize(text: string): string {
  return text.normalize("NFKC").toLowerCase().replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
}

/** 教科書で字の違う漢字（頸と頚など）と、読みの「ぢ・づ」。語の表記（content/terms）の側にそろえる */
const VARIANTS: Record<string, string> = { 頸: "頚", 彎: "弯", 鉤: "鈎", 鼠: "鼡", 軀: "躯", 臟: "臓", 體: "体", 髓: "髄", 脉: "脈", ぢ: "じ", づ: "ず" };
const VARIANT_PATTERN = new RegExp(`[${Object.keys(VARIANTS).join("")}]`, "g");
/** 区切り（空白・中黒・ハイフン・かっこ・点など）。sacro-iliac と sacroiliac、「上腕 骨」と「上腕骨」を同じにする */
const SEPARATORS = /[\s・･\-‐–—'’.,、。()（）［］[\]/／~〜]/g;

/** normalize のうえ、字の違いをそろえる（区切りは残す。結果の行で当たった所を示すため） */
export function foldKeep(text: string): string {
  return normalize(text).replace(VARIANT_PATTERN, (c) => VARIANTS[c]);
}

/** 比べるための形（foldKeep のうえ、区切りを除く） */
export function fold(text: string): string {
  return foldKeep(text).replace(SEPARATORS, "");
}

// ---- ローマ字（英字の入力のまま読みで探す: jouwan → じょうわん） ----

const VOWELS = "aiueo";
const ROWS: Record<string, string> = {
  "": "あいうえお", k: "かきくけこ", s: "さしすせそ", t: "たちつてと", n: "なにぬねの", h: "はひふへほ", m: "まみむめも",
  r: "らりるれろ", g: "がぎぐげご", z: "ざじずぜぞ", d: "だじずでど", b: "ばびぶべぼ", p: "ぱぴぷぺぽ",
};
const ROMAJI = new Map<string, string>();
for (const [consonant, kana] of Object.entries(ROWS)) [...VOWELS].forEach((vowel, i) => ROMAJI.set(consonant + vowel, kana[i]));
for (const [key, kana] of Object.entries({
  ya: "や", yu: "ゆ", yo: "よ", wa: "わ", wo: "を", shi: "し", chi: "ち", tsu: "つ", fu: "ふ", ji: "じ", si: "し", ti: "ち", tu: "つ", hu: "ふ", zi: "じ",
  fa: "ふぁ", fi: "ふぃ", fe: "ふぇ", fo: "ふぉ", she: "しぇ", je: "じぇ", che: "ちぇ", "-": "ー", "n'": "ん", nn: "ん",
})) ROMAJI.set(key, kana);
// 拗音（きゃ・しゃ・じゃ・ちゃ など）
for (const [head, kana] of Object.entries({ ky: "き", gy: "ぎ", sy: "し", sh: "し", zy: "じ", jy: "じ", j: "じ", ty: "ち", cy: "ち", ch: "ち", ny: "に", hy: "ひ", by: "び", py: "ぴ", my: "み", ry: "り", dy: "じ" })) {
  ROMAJI.set(`${head}a`, `${kana}ゃ`);
  ROMAJI.set(`${head}u`, `${kana}ゅ`);
  ROMAJI.set(`${head}o`, `${kana}ょ`);
}

/**
 * ローマ字をひらがなに（打ちかけの最後の子音は捨てる）。ローマ字として読めない並び（arm・ulna など）は null。
 * 最後の n は「ん」とする（打ちかけの「な行」かもしれないので、呼ぶ側で n を捨てた形でも探す）
 */
export function romajiToKana(text: string): string | null {
  if (!/^[a-z'-]+$/.test(text)) return null;
  let out = "";
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    const next = text[i + 1];
    // 子音が2つ続くと「っ」（nn は「ん」）
    if (next === c && c !== "n" && !VOWELS.includes(c) && /[a-z]/.test(c)) {
      out += "っ";
      i++;
      continue;
    }
    // 母音・y の前でない n は「ん」
    if (c === "n" && next !== undefined && !VOWELS.includes(next) && next !== "y" && next !== "n" && next !== "'") {
      out += "ん";
      i++;
      continue;
    }
    const key = [3, 2, 1].map((size) => text.slice(i, i + size)).find((part) => ROMAJI.has(part));
    if (key) {
      out += ROMAJI.get(key);
      i += key.length;
      continue;
    }
    const rest = text.slice(i);
    if (rest === "n") return `${out}ん`;
    // 打ちかけ（最後の1〜2字の子音）だけは捨ててよい
    if (rest.length <= 2 && /^[bcdfghjkmprstwyz]+$/.test(rest)) return out;
    return null;
  }
  return out;
}

// ---- 語を探す ----

/** どこで当たったか（結果の行に、ラテン語や英語の別名・メモで当たったことを添える） */
export type Via = "ja" | "yomi" | "romaji" | "en" | "enAlt" | "la" | "memo" | "words";

export interface Hit {
  term: Term;
  score: number;
  via: Via;
  /** 今のコースの語か（コースの外の語は「調べる」だけで、コースの語の後に出す） */
  inCourse: boolean;
}

interface Folded {
  ja: string;
  yomi: string;
  en: string;
  /** 英語の語の頭（"head of humerus" の head・of・humerus）。語の頭に当たると、途中に当たるより上に */
  enWords: string[];
  enAlt: string[];
  la: string;
}

let foldedTerms: Map<string, Folded> | null = null;
function foldedOf(term: Term): Folded {
  foldedTerms ??= new Map(terms.map((item) => [item.id, {
    ja: fold(item.ja),
    yomi: fold(item.yomi),
    en: fold(item.en),
    enWords: normalize(`${item.en} ${(item.enAlt ?? []).join(" ")} ${item.la ?? ""}`).split(/[\s\-/(),]+/).filter(Boolean),
    enAlt: (item.enAlt ?? []).map(fold),
    la: fold(item.la ?? ""),
  }]));
  return foldedTerms.get(term.id)!;
}

/** 1つの表記への当たり方（同じ 100・頭から 80・途中 40。当たらなければ 0） */
function scoreText(value: string, query: string): number {
  if (!value || !query) return 0;
  if (value === query) return 100;
  if (value.startsWith(query)) return 80;
  return value.includes(query) ? 40 : 0;
}

function scoreTerm(term: Term, query: string, kana: string[], tokens: string[], memo: string): [number, Via] {
  const folded = foldedOf(term);
  let best: [number, Via] = [0, "ja"];
  const consider = (score: number, via: Via) => {
    if (score > best[0]) best = [score, via];
  };
  consider(scoreText(folded.ja, query), "ja");
  consider(scoreText(folded.yomi, query), "yomi");
  // 英語は日本語より少しだけ下に（同じ当たり方なら日本語の当たった語が先）。英語の語の頭は 60
  consider(scoreText(folded.en, query) - 1, "en");
  if (folded.enWords.some((word) => word.startsWith(query))) consider(59, "en");
  for (const alt of folded.enAlt) consider(scoreText(alt, query) - 3, "enAlt");
  consider(scoreText(folded.la, query) - 3, "la");
  // ローマ字で打った読み（英語で当たる方が先）
  for (const reading of kana) consider(scoreText(folded.yomi, reading) - 2, "romaji");
  if (memo && fold(memo).includes(query)) consider(30, "memo");
  // 空白で区切ったとき（「上腕 動脈」）は、どの言葉もどこかに当たる語
  if (!best[0] && tokens.length > 1 && tokens.every((token) => [folded.ja, folded.yomi, folded.en, folded.la, ...folded.enAlt].some((text) => text.includes(token)))) consider(25, "words");
  return best;
}

/**
 * 日本語・読み・英語（別名）・ラテン語・ローマ字の読み・自分のメモから語を探し、当たり方のよい順に並べる。
 * 名前がそのまま同じ語 → コースの語 → コースの外の語 の順で、その中は当たり方のよい順、同じなら必修・基礎の語 → 短い名前。
 * all を付けるとコースの外の語も（「調べる」）
 */
export function lookup(query: string, options: { all?: boolean; memo?: (termId: string) => string } = {}): Hit[] {
  const q = fold(query);
  if (!q) return [];
  const romaji = romajiToKana(q);
  // 最後の n は「ん」と「な行の打ちかけ」の両方で探す（kan → かん・か）
  const kana = romaji && romaji.length >= 2 ? [romaji, ...(q.endsWith("n") && !q.endsWith("nn") ? [romaji.slice(0, -1)] : [])].filter((text) => text.length >= 2) : [];
  const tokens = normalize(query).split(/\s+/).map(fold).filter(Boolean);
  const hits: Hit[] = [];
  terms.forEach((term) => {
    const own = inCourse(term.id);
    if (!own && !options.all) return;
    const [score, via] = scoreTerm(term, q, kana, tokens, options.memo?.(term.id) ?? "");
    if (score > 0) hits.push({ term, score, via, inCourse: own });
  });
  const order = new Map(terms.map((term, i) => [term.id, i]));
  // 名前がそのまま同じ語はいちばん上、ほかはコースの語をすべて先に（コースの外の語は、頭から当たっても後ろ）
  const band = (hit: Hit) => (hit.score >= 97 ? 0 : hit.inCourse ? 1 : 2);
  return hits.sort((a, b) =>
    band(a) - band(b)
    || b.score - a.score
    || a.term.level - b.term.level
    || a.term.ja.length - b.term.ja.length
    || order.get(a.term.id)! - order.get(b.term.id)!);
}

/** 日本語・読み・英語・ラテン語のどれかに当たる語を、当たり方のよい順に（query は normalize したもの）。初心者モードでは初心者コースの語から */
export function searchTerms(query: string): Term[] {
  return lookup(query).map((hit) => hit.term);
}

/** query が value のどこかに、何字のまちがいで入っているか（部分の編集距離） */
function substringDistance(query: string, value: string): number {
  let previous = new Array<number>(value.length + 1).fill(0);
  for (let i = 1; i <= query.length; i++) {
    const current = [i];
    for (let j = 1; j <= value.length; j++) {
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (query[i - 1] === value[j - 1] ? 0 : 1));
    }
    previous = current;
  }
  return Math.min(...previous);
}

/**
 * 見つからなかったときの「もしかして」（1〜2字ちがいで近い語。3字より短いときは出さない）。
 * 打ちまちがい（上椀骨・humerous）や、読みの思い違い（けいこつ↔けいこつ）を拾う
 */
export function suggest(query: string, limit = 5): Term[] {
  const q = fold(query);
  if (q.length < 3) return [];
  const allowed = q.length >= 7 ? 2 : 1;
  const romaji = romajiToKana(q);
  const queries = [q, ...(romaji && romaji.length >= 3 ? [romaji] : [])];
  const found: { term: Term; distance: number }[] = [];
  for (const term of terms) {
    const folded = foldedOf(term);
    const distance = Math.min(...queries.flatMap((text) => [folded.ja, folded.yomi, folded.en, ...folded.enAlt].filter(Boolean).map((value) => substringDistance(text, value))));
    if (distance <= allowed) found.push({ term, distance });
  }
  return found
    .sort((a, b) => a.distance - b.distance || Number(inCourse(b.term.id)) - Number(inCourse(a.term.id)) || a.term.level - b.term.level || a.term.ja.length - b.term.ja.length)
    .slice(0, limit)
    .map((item) => item.term);
}

/** 題かまとまりの名前に当たるレッスン（今のモードのレッスンから） */
export function searchUnits(query: string): Unit[] {
  const q = fold(query);
  return courseUnits().filter((unit) => fold(`${unit.title}${unit.group ?? ""}`).includes(q));
}
