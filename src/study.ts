import type { Term } from "./content";
import type { Facet, LearnedTerm, StoredSchedule } from "./db";
import { retrievability, State } from "./fsrs";

export const FACETS: Facet[] = [
  "locate", "point", "ja2en", "en2ja", "attach", "nerve", "action", "passage", "rootMeaning", "rootForm",
  "cloze", "read", "spell", "explain", "label", "annotate", "orient", "contrast", "order", "trace", "level", "landmark",
];

/** 語根カード（content/roots.json）の問い方 */
export const ROOT_FACETS: Facet[] = ["rootMeaning", "rootForm"];

/** 骨学試験（content/exam.json）の問い方 */
export const EXAM_FACETS: Facet[] = ["cloze", "read", "spell", "explain", "label", "annotate", "orient", "contrast", "order", "trace", "level", "landmark"];

/** 筋だけに付く問い方（起始・停止・支配神経・作用） */
export const MUSCLE_FACETS: Facet[] = ["attach", "nerve", "action"];

/** どの語にも付く基本の問い方。レッスンの確認テストで出せるのはこの4つ */
export const BASIC_FACETS: Facet[] = ["locate", "point", "ja2en", "en2ja"];

/** 語の問い方のうち、学ぶかどうかを選べるもの（設定・レッスン・復習・演習で共通。筋の3つはまとめて1つ） */
export const TERM_KINDS: { key: string; label: string; facets: Facet[] }[] = [
  { key: "locate", label: "位置→名前", facets: ["locate"] },
  { key: "point", label: "名前→位置", facets: ["point"] },
  { key: "ja2en", label: "日本語→英語", facets: ["ja2en"] },
  { key: "en2ja", label: "英語→日本語", facets: ["en2ja"] },
  { key: "muscle", label: "筋の起始・停止・神経・作用", facets: MUSCLE_FACETS },
  { key: "passage", label: "孔・溝を通るもの", facets: ["passage"] },
];

/** 語に付く問い方すべて（設定の「学ぶ問い方」の初め） */
export const TERM_FACETS: Facet[] = TERM_KINDS.flatMap((kind) => kind.facets);

export const facetLabels: Record<Facet, string> = {
  locate: "位置→名前",
  point: "名前→位置",
  ja2en: "日本語→英語",
  en2ja: "英語→日本語",
  attach: "起始・停止",
  nerve: "支配神経",
  action: "作用",
  passage: "通るもの",
  rootMeaning: "語根→意味",
  rootForm: "意味→語根",
  cloze: "穴埋め",
  read: "ラテン語→日本語",
  spell: "日本語→英語・ラテン語",
  explain: "短文記述",
  label: "番号→名前",
  annotate: "図に書き込む",
  orient: "骨と向き",
  contrast: "対で覚える",
  order: "並べる・選ぶ",
  trace: "3Dで押す",
  level: "目安→高さ",
  landmark: "高さ→目安",
};

/**
 * その語に出す問い方。隠れた部位（xray）と、部品を持たない基本の用語（figure。矢印・面・動きの図）・局所解剖（region）は
 * タップできないので「名前→位置」を出さない。
 * 筋の起始・停止・支配神経・作用と、孔・溝を通るもの（passes）は、場所を覚えてから（unlocked。unlockedTerms を見る）出す。
 * chosen は学ぶ問い方（設定の「学ぶ問い方」）。外した問い方は出さない。
 */
export function facetsFor(
  term: Pick<Term, "xray" | "nerve" | "figure" | "region" | "passes"> | undefined,
  unlocked = false,
  chosen: readonly Facet[] = FACETS,
): Facet[] {
  return FACETS.filter((facet) => {
    if (ROOT_FACETS.includes(facet) || EXAM_FACETS.includes(facet) || !chosen.includes(facet)) return false;
    if (MUSCLE_FACETS.includes(facet)) return !!term?.nerve && unlocked;
    if (facet === "passage") return !!term?.passes && unlocked;
    return !(facet === "point" && (term?.xray || term?.figure || term?.region));
  });
}

/**
 * 筋の3つと通るものを出してよい語（場所を覚えた語）。位置→名前を学ぶならそれが、学ばないなら選んだ基本の問い方のどれかが
 * 復習の段階（State.Review）に入った語
 */
export function unlockedTerms(schedules: StoredSchedule[], chosen: readonly Facet[] = FACETS): Set<string> {
  const keys = chosen.includes("locate") ? ["locate"] : BASIC_FACETS.filter((facet) => chosen.includes(facet));
  return new Set(schedules.filter((s) => keys.includes(s.facet) && s.state === State.Review).map((s) => s.termId));
}

/**
 * レッスンの確認テストで、その語に出す問い方。選んだ問い方（chosen）を語ごとに順に回し、その語に出せないもの
 * （隠れた部位の名前→位置など）は飛ばす。選んだものがどれも出せなければ、その語に出せる最初の問い方
 */
export function lessonFacet(available: Facet[], chosen: readonly Facet[], i: number): Facet {
  const usable = chosen.filter((facet) => available.includes(facet));
  return usable.length ? usable[i % usable.length] : (available[0] ?? "locate");
}

export interface QueueItem {
  termId: string;
  facet: Facet;
  isNew: boolean;
}

/**
 * 今日の出題順。期限の来た復習を古い順に出し、そのあと新しい問い方を1日の上限まで足す。
 * 新しい問い方は、レッスンで見た語のうちまだ一度も解いていないもの（見た順・問い方の順）。
 * aheadUntil を渡すと、まちがえて覚え直している途中（Learning・Relearning）の問題は、その時刻までに期限が来るものも出す
 * （復習の回の終わりに、まちがえた問題を待たずにもう一度解く）。
 */
export function buildQueue(
  learned: LearnedTerm[],
  schedules: StoredSchedule[],
  now: Date,
  newLimit: number,
  facetsOf: (termId: string) => Facet[] = () => facetsFor(undefined),
  aheadUntil?: Date,
): QueueItem[] {
  const learnedIds = new Set(learned.map((item) => item.termId));
  const relearning = (s: StoredSchedule) => s.state === State.Learning || s.state === State.Relearning;
  const due = schedules
    .filter((s) => learnedIds.has(s.termId) && s.state !== State.New
      && (new Date(s.due) <= now || (!!aheadUntil && relearning(s) && new Date(s.due) <= aheadUntil)))
    .sort((a, b) => a.due.localeCompare(b.due))
    .map((s) => ({ termId: s.termId, facet: s.facet, isNew: false }));
  const started = new Set(schedules.filter((s) => s.state !== State.New).map((s) => s.cardId));
  // レッスンごと（同じ時刻に学んだ語のまとまり）に、古いレッスンから出す。
  // 筋の起始・停止などは後から解禁されるので、新しいレッスンの基本の問題より先に出す（後回しにし続けない）
  const batches = new Map<string, QueueItem[]>();
  for (const item of [...learned].sort((a, b) => a.learnedAt.localeCompare(b.learnedAt) || a.termId.localeCompare(b.termId))) {
    const batch = batches.get(item.learnedAt) ?? [];
    for (const facet of facetsOf(item.termId)) {
      if (!started.has(`${item.termId}:${facet}`)) batch.push({ termId: item.termId, facet, isNew: true });
    }
    batches.set(item.learnedAt, batch);
  }
  const fresh = [...batches.values()].flatMap(interleave);
  return [...due, ...fresh.slice(0, Math.max(0, newLimit))];
}

// 同じ語の問い方が続くと直前の答えを覚えているだけになるので、問い方ごとに順に並べ替える
function interleave(items: QueueItem[]): QueueItem[] {
  return FACETS.flatMap((facet) => items.filter((item) => item.facet === facet));
}

/** 正解1つ＋紛らわしい選択肢。3Dで近くにある語を優先し、表示が同じになる語は除く。 */
export function pickChoices(
  answerId: string,
  neighbors: string[],
  pool: string[],
  display: (id: string) => string,
  count = 4,
  random: () => number = Math.random,
): string[] {
  const shown = new Set([display(answerId)]);
  const picked = [answerId];
  const near = shuffle(neighbors.slice(0, 6), random);
  const rest = shuffle(pool.filter((id) => !neighbors.includes(id)), random);
  for (const id of [...near, ...rest]) {
    if (picked.length >= count) break;
    if (id === answerId || shown.has(display(id))) continue;
    shown.add(display(id));
    picked.push(id);
  }
  return shuffle(picked, random);
}

export function shuffle<T>(items: T[], random: () => number = Math.random): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/** 語の覚え具合＝解いたことのある問い方の想起確率の平均。一度も解いていなければ null。 */
export function termMastery(schedules: StoredSchedule[], at = new Date()): number | null {
  const values = schedules.map((s) => retrievability(s, at)).filter((r): r is number => r !== null);
  if (!values.length) return null;
  return values.reduce((sum, r) => sum + r, 0) / values.length;
}

/** 日→英は、何度か正解して復習の段階に入ったら4択をやめてつづりを入力させる */
export function typesEnglish(schedule: StoredSchedule | undefined): boolean {
  return !!schedule && schedule.state === State.Review && schedule.reps >= 2;
}

export interface PracticeCandidate {
  termId: string;
  facet: Facet;
  /** 今思い出せる確率（一度も解いていなければ null） */
  recall: number | null;
  lapses: number;
}

/**
 * 範囲を選んだ演習の出題。weak なら苦手な順（思い出せる確率が低い・忘れた回数が多い・まだ解いていないものは真ん中）、
 * そうでなければ混ぜる。1周ごとに1つの語から1問ずつ取る（同じ語の問い方ばかりにならないように）。
 */
export function practiceQueue(candidates: PracticeCandidate[], count: number, weak: boolean, random: () => number = Math.random): QueueItem[] {
  const score = (c: PracticeCandidate) => (c.recall ?? 0.75) - Math.min(c.lapses, 5) * 0.05;
  const ordered = weak ? shuffle(candidates, random).sort((a, b) => score(a) - score(b)) : shuffle(candidates, random);
  const picked: PracticeCandidate[] = [];
  const used = new Set<string>();
  for (let round = 0; picked.length < count && round < 9; round++) {
    const taken = new Set<string>();
    for (const c of ordered) {
      if (picked.length >= count) break;
      const key = `${c.termId}:${c.facet}`;
      if (used.has(key) || taken.has(c.termId)) continue;
      used.add(key);
      taken.add(c.termId);
      picked.push(c);
    }
  }
  const items = picked.map((c) => ({ termId: c.termId, facet: c.facet, isNew: c.recall === null }));
  return weak ? items : shuffle(items, random);
}