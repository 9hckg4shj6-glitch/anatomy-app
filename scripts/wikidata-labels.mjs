// 収録語を Wikidata（CC0）の日本語名・英語名・ラテン名・TA2 ID と突き合わせるための下調べ。
// FMA ID（語の fma か、英語名で BodyParts3D の部品表から引いたもの）で Wikidata を検索し、data-raw/wikidata.json に保存する。
// 結果は scripts/validate-content.mjs が docs/要確認用語.md の「Wikidata と表記が違う語」に使う（正解の基準ではない）。
// 使い方: npm run fetch:sources && node scripts/wikidata-labels.mjs
import fs from "node:fs";
import path from "node:path";
import { loadTerms } from "./build-models.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const RAW = path.join(ROOT, "data-raw/bp3d");

const fmaByName = new Map();
for (const file of ["isa_parts_list_e.txt", "partof_parts_list_e.txt"]) {
  const [, ...rows] = fs.readFileSync(path.join(RAW, file), "utf8").trim().split("\n");
  for (const row of rows) {
    const [fma, , en] = row.split("\t");
    if (en && !fmaByName.has(en.toLowerCase())) fmaByName.set(en.toLowerCase(), fma);
  }
}

const { terms } = loadTerms();
const fmaOf = new Map();
for (const term of terms) {
  // 部品が1つの語だけ部品名でも引く（手根骨のようなまとめ語で、最初の部品＝舟状骨を引かないように）
  const plain = term.parts.length === 1 && !/[*!]/.test(term.parts[0]) ? term.parts : [];
  const candidates = [term.fma, ...[term.en, ...(term.enAlt ?? []), ...plain].map((name) => fmaByName.get(name.toLowerCase()))];
  const fma = candidates.find((c) => c && /^FMA\d+$/.test(c));
  if (fma) fmaOf.set(term.id, fma);
}

const values = [...new Set(fmaOf.values())].map((fma) => `"${fma.slice(3)}"`).join(" ");
const query = `SELECT ?fma ?item ?ja ?en ?la ?ta2 (GROUP_CONCAT(DISTINCT ?alias; separator="|") AS ?aliases) WHERE {
  VALUES ?fma { ${values} }
  ?item wdt:P1402 ?fma .
  OPTIONAL { ?item rdfs:label ?ja FILTER(LANG(?ja) = "ja") }
  OPTIONAL { ?item rdfs:label ?en FILTER(LANG(?en) = "en") }
  OPTIONAL { ?item rdfs:label ?la FILTER(LANG(?la) = "la") }
  OPTIONAL { ?item wdt:P7173 ?ta2 }
  OPTIONAL { ?item skos:altLabel ?alias FILTER(LANG(?alias) = "ja") }
} GROUP BY ?fma ?item ?ja ?en ?la ?ta2`;

const response = await fetch("https://query.wikidata.org/sparql", {
  method: "POST",
  headers: {
    "Content-Type": "application/x-www-form-urlencoded",
    Accept: "application/sparql-results+json",
    "User-Agent": "anatomy-study-app/0.1 (term cross-check)",
  },
  body: new URLSearchParams({ query }),
});
if (!response.ok) throw new Error(`Wikidata: ${response.status} ${await response.text()}`);
const rows = (await response.json()).results.bindings;
const byFma = new Map();
for (const row of rows) {
  const key = `FMA${row.fma.value}`;
  if (byFma.has(key)) continue;
  byFma.set(key, {
    item: row.item.value.split("/").at(-1),
    ja: row.ja?.value ?? null,
    jaAliases: row.aliases?.value ? row.aliases.value.split("|") : [],
    en: row.en?.value ?? null,
    la: row.la?.value ?? null,
    ta2: row.ta2?.value ?? null,
  });
}

const out = {};
for (const term of terms) {
  const fma = fmaOf.get(term.id);
  out[term.id] = { fma: fma ?? null, ...(fma ? byFma.get(fma) : null) };
}
fs.writeFileSync(path.join(ROOT, "data-raw/wikidata.json"), `${JSON.stringify(out, null, 1)}\n`);
const found = Object.values(out).filter((v) => v.item).length;
const withJa = Object.values(out).filter((v) => v.ja).length;
console.log(`語 ${terms.length} / FMA ${fmaOf.size} / Wikidata ${found} / 日本語名あり ${withJa}`);
