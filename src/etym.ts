import etymJson from "../content/etym-words.json";
import { termById, type Term } from "./content";
import type { Facet } from "./db";
import { ETYM_FACETS, pickChoices, shuffle } from "./study";

/**
 * 語源で単語（content/etym-words.json）。名前を部品に分け、部品の意味と日本語名の字を対応させて覚える
 * （sterno「胸骨」＋cleido「鎖骨」＋mastoid「乳様突起」＝胸鎖乳突筋）。部品そのもの（brachi-「腕」）を覚えるのは語根カード（src/roots.ts）。
 * 部品は [つづり, 意味, 日本語名の中の字, 由来] の4つ。つづりをつなぐと英語名（w があれば w、無ければ語の en）になる（空白・ハイフンは除いて比べる）。
 * 日本語名の中の字は、長いものから順に重ならない所を探して色を付ける（下唇下制筋の「下制」と「下」）。字が無い部品は空。
 * 由来が空の部品は、同じつづりの部品の由来を使う。
 * 学習の記録は語と同じ表に、語ID の代わりに "etym:<語ID>" で入れる（問い方は etymRead・etymBuild。部品が1つの語は etymRead だけ）。
 */
export interface EtymPart {
  /** 英語名の中のつづりのまま */
  text: string;
  meaning: string;
  /** 日本語名の中で、この部品にあたる字（無ければ空） */
  kanji: string;
  /** 由来（ラ＝ラテン語、ギ＝ギリシャ語） */
  from: string;
}

export interface EtymWord {
  key: string;
  term: Term;
  /** 部品に分ける英語名（語の en・enAlt・la のどれかの中にある形） */
  word: string;
  parts: EtymPart[];
  note: string;
  lesson: string;
  group: string;
}

export interface EtymLesson {
  id: string;
  title: string;
  lead: string;
  group: string;
  words: EtymWord[];
}

export interface EtymGroup {
  id: string;
  title: string;
  lead: string;
  lessons: EtymLesson[];
}

type RawPart = [text: string, meaning: string, kanji: string, from: string];

interface EtymFile {
  groups: {
    id: string;
    title: string;
    lead: string;
    lessons: { id: string; title: string; lead: string; words: { term: string; w?: string; parts: RawPart[]; note: string }[] }[];
  }[];
}

const PREFIX = "etym:";

export { ETYM_FACETS };

const data = etymJson as EtymFile;

// 由来が空の部品は、同じつづりの部品の由来で埋める（flexor は1語目にだけ書けばよい）
const fromOf = new Map<string, string>();
for (const raw of data.groups.flatMap((group) => group.lessons.flatMap((lesson) => lesson.words.flatMap((word) => word.parts)))) {
  if (raw[3] && !fromOf.has(raw[0].toLowerCase())) fromOf.set(raw[0].toLowerCase(), raw[3]);
}

export const etymGroups: EtymGroup[] = data.groups.map((group) => ({
  id: group.id,
  title: group.title,
  lead: group.lead,
  lessons: group.lessons.map((lesson) => ({
    id: lesson.id,
    title: lesson.title,
    lead: lesson.lead,
    group: group.id,
    // 内容の更新で消えた語は出さない（validate が止めるので、ふつうは無い）
    words: lesson.words.flatMap((raw) => {
      const term = termById.get(raw.term);
      if (!term) return [];
      return [{
        key: `${PREFIX}${raw.term}`,
        term,
        word: raw.w ?? term.en,
        parts: raw.parts.map(([text, meaning, kanji, from]) => ({ text, meaning, kanji, from: from || fromOf.get(text.toLowerCase()) || "" })),
        note: raw.note,
        lesson: lesson.id,
        group: group.id,
      }];
    }),
  })),
}));

export const etymLessons: EtymLesson[] = etymGroups.flatMap((group) => group.lessons);
export const etymLessonById = new Map(etymLessons.map((lesson) => [lesson.id, lesson]));
export const etymWords: EtymWord[] = etymLessons.flatMap((lesson) => lesson.words);
export const etymByKey = new Map(etymWords.map((word) => [word.key, word]));
const etymByTerm = new Map(etymWords.map((word) => [word.term.id, word]));

/** 記録に使うID（語IDと同じ所に入れる） */
export function etymKey(termId: string): string {
  return `${PREFIX}${termId}`;
}

export function isEtymKey(id: string): boolean {
  return id.startsWith(PREFIX);
}

/** 語源で単語に入っている語なら、その項目（語のカードから開くため） */
export function etymOfTerm(termId: string): EtymWord | undefined {
  return etymByTerm.get(termId);
}

/** レッスンの記録の名前（learned の unitId） */
export function etymUnitId(lesson: Pick<EtymLesson, "id">): string {
  return `etym-${lesson.id}`;
}

/** その語の問い方。部品が1つの語（coccyx など）は組み立てる問題が4択と同じになるので、部品から読むだけ */
export function etymFacetsOf(word: EtymWord): Facet[] {
  return word.parts.length > 1 ? ETYM_FACETS : ["etymRead"];
}

/** 英語名・日本語名の切れ目。part は部品の番号（部品でない空白・ハイフンや、どの部品にもあたらない字は null） */
export interface Segment {
  text: string;
  part: number | null;
}

/** 英語名を部品ごとに分ける（間の空白・ハイフンは part: null） */
export function wordSegments(word: Pick<EtymWord, "word" | "parts">): Segment[] {
  const out: Segment[] = [];
  const text = word.word;
  let pos = 0;
  const push = (segment: Segment) => {
    const last = out.at(-1);
    if (last && last.part === null && segment.part === null) last.text += segment.text;
    else out.push(segment);
  };
  word.parts.forEach((part, i) => {
    while (pos < text.length && /[\s-]/.test(text[pos])) push({ text: text[pos++], part: null });
    push({ text: text.slice(pos, pos + part.text.length), part: i });
    pos += part.text.length;
  });
  if (pos < text.length) push({ text: text.slice(pos), part: null });
  return out;
}

/** 日本語名を部品ごとに分ける。部品の字は長いものから順に、まだ使っていない所を探す（下唇下制筋の「下制」を先に、「下」はその後で） */
export function jaSegments(ja: string, parts: Pick<EtymPart, "kanji">[]): Segment[] {
  // 字の位置は indexOf と同じ数え方（UTF-16）にそろえる
  const chars = ja.split("");
  const owner: (number | null)[] = chars.map(() => null);
  const order = parts.map((part, i) => [part.kanji, i] as const).filter(([kanji]) => kanji).sort((a, b) => b[0].length - a[0].length);
  for (const [kanji, i] of order) {
    for (let from = 0; ; ) {
      const at = ja.indexOf(kanji, from);
      if (at < 0) break;
      if (owner.slice(at, at + kanji.length).every((value) => value === null)) {
        owner.fill(i, at, at + kanji.length);
        break;
      }
      from = at + 1;
    }
  }
  const out: Segment[] = [];
  chars.forEach((char, i) => {
    const last = out.at(-1);
    if (last && last.part === owner[i]) last.text += char;
    else out.push({ text: char, part: owner[i] });
  });
  return out;
}

const partKey = (part: Pick<EtymPart, "text">) => part.text.toLowerCase();

/** 部品のつづり → その部品を使う語 */
const wordsByPart = new Map<string, EtymWord[]>();
for (const word of etymWords) {
  for (const key of new Set(word.parts.map(partKey))) wordsByPart.set(key, [...(wordsByPart.get(key) ?? []), word]);
}

/**
 * 同じ部品を使うほかの語。同じ部品が多いほど、また使う語の少ない（特徴のある）部品ほど先に
 * （sternohyoid なら sternothyroid・thyrohyoid が、nerve だけ同じ語より先）
 */
export function relatedWords(word: EtymWord): EtymWord[] {
  const score = new Map<EtymWord, number>();
  for (const key of new Set(word.parts.map(partKey))) {
    const users = wordsByPart.get(key) ?? [];
    for (const other of users) {
      if (other !== word) score.set(other, (score.get(other) ?? 0) + 1 / users.length);
    }
  }
  return [...score].sort((a, b) => b[1] - a[1]).map(([other]) => other);
}

/** 同じつづりの部品を使う語の数（その部品を含めて） */
export function partUseCount(part: Pick<EtymPart, "text">): number {
  return wordsByPart.get(partKey(part))?.length ?? 0;
}

/**
 * 部品から読む問題の選択肢（語の記録のキー。表示は日本語名）。
 * 同じ部品を持つ語を先に入れ、部品を全部読まないと選べないようにする（sternohyoid に 胸骨甲状筋・甲状舌骨筋）。次に同じレッスンの語
 */
export function readChoices(word: EtymWord, random: () => number = Math.random): string[] {
  const mates = shuffle(etymLessonById.get(word.lesson)?.words ?? [], random);
  const near = [...new Set([...relatedWords(word).slice(0, 4), ...mates])].filter((other) => other !== word).slice(0, 6).map((other) => other.key);
  return pickChoices(word.key, near, etymWords.map((other) => other.key), (key) => etymByKey.get(key)?.term.ja ?? key, 4, random);
}

/**
 * 組み立てる問題の部品（正解の部品と、まぎらわしい部品を混ぜて並べる）。
 * まぎらわしい部品は、同じ部品を持つ語のほかの部品 → 同じレッスン → 同じ部 の順に。正解と同じつづりの部品は入れない（答えが2通りにならないように）。
 * 数は、正解が2つなら4つ、3つ以上なら3つ足す
 */
export function buildTiles(word: EtymWord, random: () => number = Math.random): string[] {
  const answer = word.parts.map((part) => part.text);
  const taken = new Set(answer.map((text) => text.toLowerCase()));
  const count = Math.max(3, 6 - answer.length);
  const lesson = etymLessonById.get(word.lesson)?.words ?? [];
  const group = etymWords.filter((other) => other.group === word.group);
  const pools = [relatedWords(word).slice(0, 8), lesson, group].map((list) => shuffle(list.flatMap((other) => other.parts.map((part) => part.text)), random));
  const extra: string[] = [];
  for (const text of pools.flat()) {
    if (extra.length >= count) break;
    const key = text.toLowerCase();
    if (taken.has(key)) continue;
    taken.add(key);
    extra.push(text);
  }
  return shuffle([...answer, ...extra], random);
}

/** 組み立てた並びが正しいか（大文字・小文字は区別しない） */
export function isBuilt(word: Pick<EtymWord, "parts">, picked: string[]): boolean {
  return picked.length === word.parts.length && picked.every((text, i) => text.toLowerCase() === word.parts[i].text.toLowerCase());
}
