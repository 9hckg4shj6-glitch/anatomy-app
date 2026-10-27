import rootsJson from "../content/roots.json";
import { terms, type Term } from "./content";

/**
 * 語根カード（content/roots.json）。brachi-「腕」のような語根を覚えると、英語名の意味が分かって覚えやすくなる。
 * match は英語名（en・enAlt、la: true ならラテン語名も）から例の語を拾う正規表現（大文字・小文字を区別しない）。
 * 学習の記録は語と同じ表に、語ID の代わりに "root:<id>" で入れる（問い方は rootMeaning・rootForm）。
 */
export interface Root {
  id: string;
  root: string;
  match: string;
  la?: boolean;
  meaning: string;
  from: string;
  note: string;
  group: string;
}

export interface RootUnit {
  id: string;
  title: string;
  group: string;
  roots: Root[];
}

interface RootFile {
  groups: { id: string; title: string; roots: Omit<Root, "group">[] }[];
}

/** 1つのレッスンに入れる語根の数（グループが長いときは分ける） */
const LESSON_SIZE = 11;
const PREFIX = "root:";

const data = rootsJson as RootFile;

export const roots: Root[] = data.groups.flatMap((group) => group.roots.map((root) => ({ ...root, group: group.id })));
export const rootByKey = new Map(roots.map((root) => [rootKey(root), root]));

export const rootUnits: RootUnit[] = data.groups.flatMap((group) => {
  const count = Math.ceil(group.roots.length / LESSON_SIZE);
  // 同じくらいの数ずつに分ける（32 → 11・11・10）
  const size = Math.ceil(group.roots.length / count);
  return Array.from({ length: count }, (_, i) => ({
    id: `roots-${group.id}-${i + 1}`,
    title: count > 1 ? `${group.title} ${i + 1}` : group.title,
    group: group.id,
    roots: roots.filter((root) => root.group === group.id).slice(i * size, (i + 1) * size),
  }));
});
export const rootUnitById = new Map(rootUnits.map((unit) => [unit.id, unit]));

/** 記録に使うID（語IDと同じ所に入れる） */
export function rootKey(root: Pick<Root, "id">): string {
  return `${PREFIX}${root.id}`;
}

export function isRootKey(id: string): boolean {
  return id.startsWith(PREFIX);
}

function pattern(root: Root): RegExp {
  return new RegExp(root.match, "i");
}

function names(term: Term, root: Root): string[] {
  return [term.en, ...(term.enAlt ?? []), ...(root.la && term.la ? [term.la] : [])];
}

const exampleCache = new Map<string, Term[]>();

/**
 * 語根を含む語。必修の語・部位でない語を先に、日本語名が同じ語は1つにする。
 * 基本の用語（方向・運動）も例になる（外転 abduction など）。
 */
export function examplesOf(root: Root, pool: Term[] = terms): Term[] {
  const cached = pool === terms ? exampleCache.get(root.id) : undefined;
  if (cached) return cached;
  const re = pattern(root);
  const seen = new Set<string>();
  const found = pool
    .filter((term) => names(term, root).some((name) => re.test(name)))
    .sort((a, b) => a.level - b.level || Number(!!a.of) - Number(!!b.of))
    .filter((term) => !seen.has(term.ja) && seen.add(term.ja));
  if (pool === terms) exampleCache.set(root.id, found);
  return found;
}

/** 語の英語名に含まれる語根。例の少ない（特徴のある）語根から max 個（arteri- のようにどの動脈にも付くものは後回し） */
export function rootsOf(term: Term, max = 3): Root[] {
  return roots
    .filter((root) => names(term, root).some((name) => pattern(root).test(name)))
    .sort((a, b) => examplesOf(a).length - examplesOf(b).length)
    .slice(0, max);
}

/** 英語名の中の語根の部分を [前, 語根, 後] に分ける（強調して見せる）。当たらなければ null */
export function splitAtRoot(text: string, root: Root): [string, string, string] | null {
  const match = pattern(root).exec(text);
  if (!match || !match[0]) return null;
  return [text.slice(0, match.index), match[0], text.slice(match.index + match[0].length)];
}

/** 出題に使う例の語（英語名の中に語根が見える語）。無ければ null */
export function exampleFor(root: Root, random: () => number = Math.random): Term | null {
  const visible = examplesOf(root).filter((term) => splitAtRoot(term.en, root));
  const list = visible.length ? visible : examplesOf(root);
  return list.length ? list[Math.floor(random() * Math.min(list.length, 6))] : null;
}
