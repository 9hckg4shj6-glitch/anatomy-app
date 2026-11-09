// 説明（詳細モード）の中の解剖の語に、その英語を（）で添える。
// 対象: 語の説明 note・置き方 placing・通るもの passes、レッスンの初めの説明 intro、臓器の図の about・colorNote・ラベルの note、
// 骨学試験の note・points、向きの問い方の why。初心者コースの「覚えること」（content/beginner.json）は変えない。
// 英語は scripts/en-gloss.txt（先に使う）と語の見出し（ja と en）から。漢字・カタカナの続き（第1胸椎・S状結腸などを含む）を1語として引き、
// 表に無い続きには添えない（「大腿骨頭」の中の「大腿骨」だけに添えるようなことはしない）。
// 同じ説明（1つの語・レッスン・臓器・項目）の中では最初の1回だけ添え、その語自身（見出し）には添えない。
// 添えた英語は外してから添え直すので、何度実行してもよい。説明を書き足したり表を変えたりしたら実行する
// （表の英語を書きかえたときは、古い英語は外れないので、先に古い行のまま --strip で外す）。
// 添えた「語（英語）」の一覧を content/en-notes.json に書く（アプリは英語を添えない設定のとき、表示でこれだけを外す。KEEP は残す）。
// 使い方: node scripts/en-notes.mjs（--check は書きこまず、添え直すと変わる所があれば失敗する。--report は語ごとの例を出す。--strip は添えた英語を外す）
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const CHECK = process.argv.includes("--check");
const REPORT = process.argv.includes("--report");
const STRIP = process.argv.includes("--strip");

const RUN_CHAR = "\\u4e00-\\u9fff々ヶ\\u30a1-\\u30faー";
const RUN = new RegExp(`(?:[A-Z]{1,4}(?=[\\u4e00-\\u9fff]))?(?:第[0-9]+(?:[〜・]第?[0-9]+)*)?[${RUN_CHAR}]+`, "g");
const IS_RUN = new RegExp(`^${RUN.source}$`);
const RUN_CHAR_AT = new RegExp(`[${RUN_CHAR}]`);
/** 1文字の語の後ろに来てよい文字（助詞・句読点）。「足す」「手前」の「足」「手」には添えない */
const AFTER_SINGLE = /^(?:[のはがをにとでへもや・、。（）「」]|$)/;
/** すでに英語が添えてある */
const HAS_EN = /^（[A-Za-z]/;

// 英語の表: 語の見出し、その上に en-gloss.txt
const dict = new Map();
const headJa = new Map();
for (const file of fs.readdirSync(path.join(ROOT, "content/terms"))) {
  for (const unit of JSON.parse(fs.readFileSync(path.join(ROOT, "content/terms", file), "utf8")).units) {
    for (const term of unit.terms) headJa.set(term.ja, [...(headJa.get(term.ja) ?? []), term.en]);
  }
}
for (const [ja, ens] of headJa) {
  // 1文字の見出し（上・前・橋など）と、同じ日本語で英語が2つある見出し（筋突起など）は en-gloss.txt に書いたときだけ
  if (ja.length > 1 && new Set(ens).size === 1 && !ja.includes("（")) dict.set(ja, ens[0]);
}
/**
 * 文脈で英語の変わる語: 「前枝@神経の」（直前がその文字列）・「錐体#nervous」（その系統のファイル。exam・organs・directions も）・
 * 「舟状骨%距骨,踵骨」（同じ文（。で区切る）にどれかの語がある）
 */
const contexts = new Map();
for (const line of fs.readFileSync(path.join(ROOT, "scripts/en-gloss.txt"), "utf8").split("\n")) {
  if (!line.trim() || line.startsWith("#")) continue;
  const [key, en] = line.split("|");
  if (!key || !en) throw new Error(`en-gloss.txt の行が読めない: ${line}`);
  const [, ja, mark, where] = key.match(/^([^@#%]+)(?:([@#%])(.+))?$/);
  if (mark) {
    const context = mark === "@" ? { before: where, en } : mark === "#" ? { systems: where.split(","), en } : { sentence: where.split(","), en };
    contexts.set(ja, [...(contexts.get(ja) ?? []), context]);
    if (!dict.has(ja)) dict.set(ja, "-");
  } else dict.set(ja, en);
}
// 前の文字列の条件は長いものから、系統と文の条件はその後
for (const list of contexts.values()) list.sort((a, b) => (b.before?.length ?? 0) - (a.before?.length ?? 0));
/** いま書き換えているファイルの系統 */
let system = "";
function englishOf(word, before, after) {
  const sentence = before.slice(before.lastIndexOf("。") + 1) + after.slice(0, after.includes("。") ? after.indexOf("。") : after.length);
  const hit = contexts.get(word)?.find((c) =>
    c.before ? before.endsWith(c.before) : c.systems ? c.systems.includes(system) : c.sentence.some((w) => sentence.includes(w)));
  const en = hit?.en ?? dict.get(word);
  return en && en !== "-" ? en : null;
}
const strip = (text) => text.replace(/（[A-Za-z][^（）]*）/g, "");
for (const [ja, en] of [...dict, ...[...contexts].flatMap(([ja, list]) => list.map((c) => [ja, c.en]))]) {
  if (en.startsWith("=") && strip(en.slice(1)) !== ja) throw new Error(`書き換えが元の語と違う: ${ja} → ${en}`);
}
/** このスクリプトが添えた英語（語（英語）と書き換え）。添え直す前に外すので、表を変えて実行し直せば元の文から作り直したのと同じになる */
const ownPairs = [...dict, ...[...contexts].flatMap(([ja, list]) => list.map((c) => [ja, c.en]))]
  .filter(([, en]) => en !== "-")
  .map(([ja, en]) => [en.startsWith("=") ? en.slice(1) : `${ja}（${en}）`, ja])
  .sort((a, b) => b[0].length - a[0].length);
const unannotate = (text) => ownPairs.reduce((out, [annotated, ja]) => (out.includes(annotated) ? out.split(annotated).join(ja) : out), text);
/** 漢字・カタカナの続きでない語（ひらがなを含むもの・6歳臼歯など）は文字列のまま探す。長いものから */
const phrases = [...dict.keys()].filter((ja) => dict.get(ja) !== "-" || contexts.has(ja)).filter((ja) => !IS_RUN.test(ja)).sort((a, b) => b.length - a.length);
const PHRASE = phrases.length ? new RegExp(phrases.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "g") : null;

/**
 * もとから説明に書いてあった英語で、このスクリプトが添える形と同じ文字列になるもの。外さず、アプリでも英語を添えない設定のとき残す。
 * 前後の文字まで含めて書く（ほかの所の「頭側（cranial）」は添えたものとして外す）
 */
const KEEP = [
  "頭側（cranial）とも言う", "尾側（caudal）とも言う", "腹側（ventral）とも言う", "背側（dorsal）とも言う", "吻側（rostral）と言う",
  "手の舟状骨（scaphoid）と足の舟状骨（navicular）",
];
const keepFound = new Set();
/** KEEP の文字列を、語の続きにならない記号に置き換えておく（添え直しの間は触らない） */
const protect = (text) => KEEP.reduce((out, keep, i) => (out.includes(keep) ? (keepFound.add(keep), out.split(keep).join(`\uE000${i}\uE001`)) : out), text);
const restore = (text) => text.replace(/\uE000(\d+)\uE001/g, (_, i) => KEEP[Number(i)]);

const examples = new Map();
let added = 0;
/** 実際に添えた「語（英語）」→ 語。content/en-notes.json に書き、アプリは英語を添えない設定のときこれだけを外す（src/en-notes.ts）。もとからの（scaphoid）などは残す */
const used = new Map();

/** 1つの説明の中の文に英語を添える。seen はその説明の中ですでに添えた語、self は見出し */
function annotate(text, seen, self) {
  const spans = [];
  if (PHRASE) {
    for (const m of text.matchAll(PHRASE)) {
      const before = strip(text.slice(0, m.index)).at(-1) ?? "", after = text[m.index + m[0].length] ?? "";
      // 漢字の語の一部（「大内くるぶし」など）は除く
      if (RUN_CHAR_AT.test(m[0][0]) && RUN_CHAR_AT.test(before)) continue;
      if (RUN_CHAR_AT.test(m[0].at(-1)) && RUN_CHAR_AT.test(after)) continue;
      // ひらがなだけの語（のど・すね）は、前が漢字でなく後ろが助詞か句読点のときだけ（「どの骨のどの面」の「のど」は除く）
      if (/^[\u3040-\u309f]+$/.test(m[0]) && (RUN_CHAR_AT.test(before) || !AFTER_SINGLE.test(text.slice(m.index + m[0].length)))) continue;
      spans.push([m.index, m[0]]);
    }
  }
  const inPhrase = (i, len) => spans.some(([s, w]) => i < s + w.length && s < i + len);
  for (const m of text.matchAll(RUN)) if (!inPhrase(m.index, m[0].length)) spans.push([m.index, m[0], true]);
  spans.sort((a, b) => a[0] - b[0]);

  let out = "", last = 0;
  for (const [i, word, isRun] of spans) {
    const en = englishOf(word, text.slice(0, i), text.slice(i + word.length));
    if (!en) continue;
    const rest = text.slice(i + word.length);
    if (isRun && word.length === 1 && (!AFTER_SINGLE.test(rest) || /[0-9つ]/.test(text[i - 1] ?? ""))) continue;
    if (word === self || HAS_EN.test(rest)) { seen.add(word); continue; }
    if (seen.has(word)) continue;
    seen.add(word);
    const replaced = en.startsWith("=") ? en.slice(1) : `${word}（${en}）`;
    used.set(replaced, word);
    out += text.slice(last, i) + replaced;
    last = i + word.length;
    added++;
    if (REPORT) {
      const list = examples.get(word) ?? [];
      if (list.length < 6) list.push(`${en}: ${text.slice(Math.max(0, i - 12), i + word.length + 8)}`);
      examples.set(word, list);
    }
  }
  return out + text.slice(last);
}

/** ファイルの書式を崩さないよう、変えた文字列だけを前から順に置き換える */
function rewrite(file, edit) {
  const full = path.join(ROOT, file);
  system = path.basename(file, ".json");
  const raw = fs.readFileSync(full, "utf8");
  const changes = [];
  const json = JSON.parse(raw);
  edit(json, (text, seen, self) => {
    if (typeof text !== "string") return;
    const next = restore(STRIP ? unannotate(protect(text)) : annotate(unannotate(protect(text)), seen, self));
    changes.push([text, next]);
  });
  let out = "", cursor = 0;
  for (const [before, after] of changes) {
    const quoted = JSON.stringify(before);
    const at = raw.indexOf(quoted, cursor);
    if (at < 0) throw new Error(`${file}: 文字列が見つからない: ${before.slice(0, 30)}`);
    out += raw.slice(cursor, at) + JSON.stringify(after);
    cursor = at + quoted.length;
  }
  out += raw.slice(cursor);
  const changed = changes.filter(([a, b]) => a !== b).length;
  if (changed && !CHECK) fs.writeFileSync(full, out);
  return changed;
}

/** obj の keys を、ファイルの中の順に put する（文字列の配列も） */
function putKeys(obj, keys, put, seen, self) {
  for (const key of Object.keys(obj)) {
    if (!keys.includes(key)) continue;
    for (const text of [obj[key]].flat()) put(text, seen, self);
  }
}
let changed = 0;
const termJa = new Map();
for (const file of fs.readdirSync(path.join(ROOT, "content/terms")).sort()) {
  changed += rewrite(`content/terms/${file}`, (json, put) => {
    for (const unit of json.units) {
      putKeys(unit, ["intro"], put, new Set());
      for (const term of unit.terms) {
        termJa.set(term.id, term.ja);
        putKeys(term, ["note", "placing", "passes"], put, new Set(), term.ja);
      }
    }
  });
}
changed += rewrite("content/organs.json", (json, put) => {
  for (const organ of json.organs) {
    const seen = new Set();
    for (const key of Object.keys(organ)) {
      if (key === "about" || key === "colorNote") put(organ[key], seen, organ.ja);
      if (key !== "plates") continue;
      for (const plate of organ.plates) {
        const own = new Set();
        for (const part of Object.keys(plate)) {
          if (part === "note" || part === "points") putKeys(plate, [part], put, own);
          if (part === "labels") for (const label of plate.labels) putKeys(label, ["note"], put, new Set(), label.ja ?? termJa.get(label.term));
        }
      }
    }
  }
});
changed += rewrite("content/exam.json", (json, put) => {
  for (const list of Object.values(json)) {
    for (const item of list) putKeys(item, ["note", "points"], put, new Set(), item.ja ?? termJa.get(item.term));
  }
});
changed += rewrite("content/directions.json", (json, put) => {
  for (const fact of json.facts) putKeys(fact, ["why"], put, new Set());
});

// 添えた文字列の一覧（長いものから。同じ長さは文字順）。語は英語の（）を外せば戻る
for (const [annotated, word] of used) if (strip(annotated) !== word) throw new Error(`英語を外すと語に戻らない: ${annotated}`);
for (const keep of KEEP) if (!keepFound.has(keep)) throw new Error(`KEEP の文字列が説明に無い: ${keep}`);
const pairsFile = path.join(ROOT, "content/en-notes.json");
const list = (texts) => `[\n${texts.map((text) => `  ${JSON.stringify(text)}`).join(",\n")}\n]`;
const pairsJson = `{\n"keep": ${list(KEEP)},\n"added": ${list([...used.keys()].sort((a, b) => b.length - a.length || (a < b ? -1 : 1)))}\n}\n`;
const pairsChanged = !fs.existsSync(pairsFile) || fs.readFileSync(pairsFile, "utf8") !== pairsJson;
if (pairsChanged && CHECK) changed++;
if (pairsChanged && !CHECK) fs.writeFileSync(pairsFile, pairsJson);

if (REPORT) for (const [word, list] of [...examples].sort((a, b) => a[0].localeCompare(b[0], "ja"))) console.log(`${word}\t${list.join(" ／ ")}`);
console.log(CHECK ? `添え直すと変わる説明 ${changed} 件` : `書き換えた説明 ${changed} 件（添えてある英語 ${added} 個）`);
if (CHECK && changed) process.exit(1);
