import type { Term } from "./content";
import { preferences } from "./settings";

// scripts/build-audio.mjs が作る { 語ID: "audio/<語ID>.<ハッシュ>.mp3" }。無ければブラウザの読み上げで代わりにする。
let manifest: Promise<Record<string, string>> | null = null;
let current: HTMLAudioElement | null = null;

export function loadAudioManifest(): Promise<Record<string, string>> {
  manifest ??= fetch(`${import.meta.env.BASE_URL}audio/index.json`)
    .then((response) => (response.ok ? response.json() : {}))
    .catch(() => ({}));
  return manifest;
}

export async function speak(term: Pick<Term, "id" | "en">): Promise<void> {
  current?.pause();
  window.speechSynthesis?.cancel();
  const file = (await loadAudioManifest())[term.id];
  if (file) {
    current = new Audio(`${import.meta.env.BASE_URL}${file}`);
    try {
      await current.play();
      return;
    } catch {
      // 自動再生の制限などで鳴らなければ読み上げへ
    }
  }
  if (!("speechSynthesis" in window)) return;
  const utterance = new SpeechSynthesisUtterance(term.en);
  utterance.lang = "en-US";
  utterance.rate = 0.85;
  speechSynthesis.speak(utterance);
}

/**
 * 自動で鳴らすのを止めている間か。はじめにの3語は、鳴らすかどうかを聞く前なので鳴らさない
 * （目的と覚える量の画面で選ぶ。docs/普段使い.md「はじめての人の使いにくさの見直し」）
 */
let held = false;

export function holdAutoSpeak(on: boolean): void {
  held = on;
}

/** 画面を開いたときや答え合わせのときに自動で鳴らす（設定で切れる。🔊のボタンは speak で鳴らす） */
export function autoSpeak(term: Pick<Term, "id" | "en">): void {
  if (preferences.autoSpeak && !held) void speak(term);
}
