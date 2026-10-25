/** 英語のつづりの答え合わせ。大文字小文字・ハイフン・余分な空白は区別しない。 */
export function normalizeEnglish(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[‐-―−-]/g, " ")
    .replace(/[’'.,]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** 隣り合う2文字の入れ替えも1回と数える編集距離（Damerau–Levenshtein の簡易版） */
export function editDistance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

export type EnglishResult = "correct" | "close" | "wrong";

/** 1文字違い（5文字以上の語）は「惜しい」 */
export function checkEnglish(input: string, accepted: string[]): EnglishResult {
  const answer = normalizeEnglish(input);
  if (!answer) return "wrong";
  const targets = accepted.map(normalizeEnglish);
  if (targets.includes(answer)) return "correct";
  if (targets.some((target) => target.length >= 5 && editDistance(answer, target) === 1)) return "close";
  return "wrong";
}
