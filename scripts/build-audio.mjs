// 収録語の英語の発音を Kokoro-82M（Apache-2.0, onnx-community/Kokoro-82M-v1.0-ONNX）で作り、public/audio/ に置く。
// 出力: public/audio/<語ID>.<ハッシュ>.m4a と public/audio/index.json（{ 語ID: パス }）。アプリ側は src/audio.ts。
// 発音は単語ごとに espeak（kokoro-js と同じ phonemizer）で発音記号にし、医学英語で読み違える単語は
// content/pronunciation.json の辞書の発音記号に置きかえてから Kokoro に読ませる。
// 同じ発音記号・声・速さの音声は data-raw/audio-cache/ から使い回すので、語を足したときは足した分だけ作る。
// WAV → AAC の変換に macOS の afconvert を使う。使い方: npm run build:audio
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { KokoroTTS } from "kokoro-js";
import { phonemize } from "phonemizer";
import { loadTerms } from "./build-models.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const OUT = path.join(ROOT, "public/audio");
const CACHE = path.join(ROOT, "data-raw/audio-cache");
const VOICE = "af_heart";
const SPEED = 0.9;

const { words } = JSON.parse(fs.readFileSync(path.join(ROOT, "content/pronunciation.json"), "utf8"));
const { terms } = loadTerms();

// kokoro-js の phonemize と同じ後処理（r→ɹ など）をして、Kokoro の発音記号の語彙に合わせる
async function phonemesOf(text) {
  const parts = [];
  for (const word of text.toLowerCase().split(/\s+/)) {
    parts.push(words[word] ?? (await phonemize(word, "en-us")).join(" ").replace(/ʲ/g, "j").replace(/r/g, "ɹ").replace(/x/g, "k").replace(/ɬ/g, "l"));
  }
  return parts.join(" ");
}
fs.mkdirSync(CACHE, { recursive: true });

let tts = null;
const manifest = {};
const keys = new Map();
let made = 0;
for (const [i, term] of terms.entries()) {
  const phonemes = await phonemesOf(term.en);
  const key = createHash("sha1").update(`${phonemes}|${VOICE}|${SPEED}`).digest("hex").slice(0, 16);
  keys.set(term.id, key);
  const cached = path.join(CACHE, `${key}.m4a`);
  if (!fs.existsSync(cached)) {
    tts ??= await KokoroTTS.from_pretrained("onnx-community/Kokoro-82M-v1.0-ONNX", { dtype: "q8", device: "cpu" });
    const wav = path.join(CACHE, `${key}.wav`);
    const { input_ids } = tts.tokenizer(phonemes, { truncation: true });
    await (await tts.generate_from_ids(input_ids, { voice: VOICE, speed: SPEED })).save(wav);
    execFileSync("afconvert", ["-f", "m4af", "-d", "aac", "-b", "48000", "-c", "1", wav, cached]);
    fs.rmSync(wav);
    made++;
    if (made % 20 === 0) console.log(`${i + 1} / ${terms.length}`);
  }
  const bytes = fs.readFileSync(cached);
  manifest[term.id] = `audio/${term.id}.${createHash("sha1").update(bytes).digest("hex").slice(0, 10)}.m4a`;
}

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
let total = 0;
for (const term of terms) {
  fs.copyFileSync(path.join(CACHE, `${keys.get(term.id)}.m4a`), path.join(ROOT, "public", manifest[term.id]));
  total += fs.statSync(path.join(ROOT, "public", manifest[term.id])).size;
}
fs.writeFileSync(path.join(OUT, "index.json"), `${JSON.stringify(manifest)}\n`);
console.log(`音声 ${terms.length}語（新しく作った ${made}語）/ 合計 ${(total / 1024 / 1024).toFixed(2)} MB`);
