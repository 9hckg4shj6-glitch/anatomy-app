// 内容（content/）の検査と、docs/要確認用語.md の生成。npm run build の最初に走る。
// - 全語に日本語・読み・英語・説明があるか、ID・日本語名が重複していないか、読みがひらがなだけか
// - public/models/index.json が今の内容から作られているか（語を足したら npm run build:models が要る）
// - check: true の語と、Wikidata（data-raw/wikidata.json があれば）と表記が違う語を一覧にする
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

const ROOT = path.resolve(import.meta.dirname, "..");
const errors = [];

const word = z.string().regex(/^[a-z][a-z' -]*[a-z]$/, "英語は小文字の英字・空白・ハイフンだけ");
const Term = z.strictObject({
  id: z.string().regex(/^[a-z0-9-]+$/),
  ja: z.string().min(1),
  yomi: z.string().regex(/^[ぁ-ゖー]+$/, "読みはひらがなだけ"),
  en: word,
  enAlt: z.array(word).optional(),
  la: z.string().min(1).optional(),
  parts: z.array(z.string().min(1)).min(1).optional(),
  of: z.string().optional(),
  fma: z.string().regex(/^FMA\d+$/).optional(),
  level: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  kanji: z.string().min(1).optional(),
  etym: z.string().min(1).optional(),
  note: z.string().min(10),
  color: z.string().regex(/^#[0-9a-f]{6}$/).optional(),
  xray: z.literal(true).optional(),
  check: z.literal(true).optional(),
  origin: z.string().min(2).optional(),
  insertion: z.string().min(2).optional(),
  originAt: z.array(z.string()).min(1).optional(),
  insertionAt: z.array(z.string()).min(1).optional(),
  nerve: z.string().min(2).optional(),
  action: z.string().min(2).optional(),
}).refine((term) => term.parts || term.of, "parts か of のどちらかが要る");
const TermFile = z.strictObject({
  system: z.string(),
  units: z.array(z.strictObject({ id: z.string().regex(/^[a-z0-9-]+$/), title: z.string().min(1), terms: z.array(Term).min(1) })).min(1),
});

const systems = JSON.parse(fs.readFileSync(path.join(ROOT, "content/systems.json"), "utf8"));
const terms = [];
const unitIds = new Set();
for (const system of systems) {
  const file = path.join(ROOT, `content/terms/${system.id}.json`);
  if (!fs.existsSync(file)) continue;
  const parsed = TermFile.safeParse(JSON.parse(fs.readFileSync(file, "utf8")));
  if (!parsed.success) {
    for (const issue of parsed.error.issues) errors.push(`${system.id}.json ${issue.path.join(".")}: ${issue.message}`);
    continue;
  }
  if (parsed.data.system !== system.id) errors.push(`${system.id}.json: system が ${parsed.data.system} になっています`);
  for (const unit of parsed.data.units) {
    if (unitIds.has(unit.id)) errors.push(`レッスンIDが重複: ${unit.id}`);
    unitIds.add(unit.id);
    for (const term of unit.terms) terms.push({ ...term, system: system.id });
  }
}

const seen = new Map();
for (const term of terms) {
  if (seen.has(term.id)) errors.push(`語IDが重複: ${term.id}`);
  seen.set(term.id, term);
}
for (const system of systems) {
  const names = new Map();
  for (const term of terms.filter((t) => t.system === system.id)) {
    if (names.has(term.ja)) errors.push(`${system.ja}で日本語名が重複: ${term.ja}（${names.get(term.ja)} と ${term.id}）`);
    names.set(term.ja, term.id);
  }
}

// 骨の部位（of）と筋の起始・停止（originAt / insertionAt）の参照先、ピン（content/pins.json）
const pins = JSON.parse(fs.readFileSync(path.join(ROOT, "content/pins.json"), "utf8"));
const point = z.tuple([z.number(), z.number(), z.number()]);
const Pin = z.strictObject({ at: z.array(point).min(1), r: z.number().min(0.002).max(0.06), n: point.optional(), v: point.optional() });
for (const term of terms) {
  if (term.of) {
    const parent = seen.get(term.of);
    if (!parent || parent.of) errors.push(`${term.id}: of「${term.of}」が骨の語ではありません`);
    const pin = Pin.safeParse(pins[term.id]);
    if (!pin.success) errors.push(`${term.id}: content/pins.json のピンが無いか形が違います（#/admin のピン打ちツールで打つ）`);
  }
  for (const id of [...(term.originAt ?? []), ...(term.insertionAt ?? [])]) {
    if (!seen.get(id)?.of) errors.push(`${term.id}: 起始・停止の「${id}」が骨の部位の語ではありません`);
  }
  if ((term.origin || term.insertion || term.nerve || term.action) && !(term.origin && term.insertion && term.nerve && term.action)) {
    errors.push(`${term.id}: 起始・停止・支配神経・作用は4つそろえて書く`);
  }
}
for (const id of Object.keys(pins)) if (!seen.get(id)?.of) errors.push(`content/pins.json: 「${id}」は骨の部位の語ではありません`);

// 筋の付着面（scripts/za/attachments.mjs が作る）。筋と骨の語IDが今の内容にあるか
const attachmentsFile = path.join(ROOT, "public/models/attachments-za.json");
if (fs.existsSync(attachmentsFile)) {
  for (const [id, entry] of Object.entries(JSON.parse(fs.readFileSync(attachmentsFile, "utf8")))) {
    if (!seen.get(id)?.nerve) errors.push(`attachments-za.json: 「${id}」は筋の語ではありません`);
    for (const [on] of [...(entry.origin ?? []), ...(entry.insertion ?? [])]) {
      const bone = seen.get(on);
      if (!bone || bone.system !== "skeletal" || bone.of) errors.push(`attachments-za.json: ${id} の「${on}」は骨の語ではありません`);
    }
  }
}

const indexFile = path.join(ROOT, "public/models/index.json");
if (!fs.existsSync(indexFile)) errors.push("public/models/index.json がありません。npm run build:models を実行してください");
else {
  const index = JSON.parse(fs.readFileSync(indexFile, "utf8"));
  const stale = terms.filter((term) => !index.terms[term.id]?.elements.length).map((term) => term.id);
  const removed = Object.keys(index.terms).filter((id) => !seen.has(id));
  if (stale.length || removed.length) {
    errors.push(`3Dモデルが内容と合っていません（未作成: ${stale.join(", ") || "なし"} / 削除済み: ${removed.join(", ") || "なし"}）。npm run build:models を実行してください`);
  }
  for (const [id, system] of Object.entries(index.systems)) {
    for (const url of [system.url, system.za?.url].filter(Boolean)) {
      if (!fs.existsSync(path.join(ROOT, "public", url))) errors.push(`${id} の GLB がありません: ${url}`);
    }
  }
}

// docs/要確認用語.md
const wikidataFile = path.join(ROOT, "data-raw/wikidata.json");
const wikidata = fs.existsSync(wikidataFile) ? JSON.parse(fs.readFileSync(wikidataFile, "utf8")) : null;
const systemJa = new Map(systems.map((s) => [s.id, s.ja]));
const row = (cells) => `| ${cells.join(" | ")} |`;
const flagged = terms.filter((term) => term.check);
const differs = wikidata
  ? terms.filter((term) => {
    const w = wikidata[term.id];
    return w?.ja && w.ja !== term.ja && !w.jaAliases?.includes(term.ja);
  })
  : [];
const lines = [
  "# 要確認用語",
  "",
  "`npm run validate:content` が自動で作るファイル。手で書きかえない。",
  "教科書（日本解剖学会『解剖学用語 改訂13版』準拠のもの）で確かめ、直すときは content/terms/*.json を書きかえる。確かめ終えた語は `check` を消す。",
  "",
  "## 全体の表記方針",
  "",
  "- 「頚」を使う（頚椎・総頚動脈）。「頸」と書く教科書もある。",
  "- 「殿」を使う（大殿筋）。「臀」は旧表記。",
  "- 同じ名前の骨は（手）（足）を付けて区別している（舟状骨・指骨）。",
  "- 同じ名前の骨の部位は（骨名）を付けて区別している（内側上顆（上腕骨）・茎状突起（橈骨））。",
  "",
  `## 確かめてほしい語（${flagged.length}語）`,
  "",
  row(["日本語", "読み", "英語", "系統", "説明"]),
  row(["---", "---", "---", "---", "---"]),
  ...flagged.map((t) => row([t.ja, t.yomi, t.en, systemJa.get(t.system), t.note])),
  "",
];
if (wikidata) {
  lines.push(
    `## Wikidata と日本語名が違う語（${differs.length}語・参考）`,
    "",
    "Wikidata は誰でも編集できるので正解の基準ではない。表記の揺れ（臀/殿、頸/頚）も含む。",
    "",
    row(["このアプリ", "Wikidata", "英語", "系統"]),
    row(["---", "---", "---", "---"]),
    ...differs.map((t) => row([t.ja, wikidata[t.id].ja, t.en, systemJa.get(t.system)])),
    "",
  );
}
fs.mkdirSync(path.join(ROOT, "docs"), { recursive: true });
fs.writeFileSync(path.join(ROOT, "docs/要確認用語.md"), `${lines.join("\n")}`);

if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}
console.log(`内容OK: ${terms.length}語 / レッスン ${unitIds.size} / 要確認 ${flagged.length}語${wikidata ? ` / Wikidataと違う ${differs.length}語` : ""}`);
