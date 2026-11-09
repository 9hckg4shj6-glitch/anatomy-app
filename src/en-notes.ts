import enNotes from "../content/en-notes.json";
import { preferences } from "./settings";

/**
 * 説明の中の解剖の語に添えた英語（「脊柱（vertebral column）」。scripts/en-notes.mjs が content の説明に書きこむ）を、
 * 設定（preferences.enNotes）で出し入れする。添えない（ふだん）ときは、スクリプトが添えた文字列（content/en-notes.json）だけを外し、
 * もとから説明にあった（C1〜C7）や、添えた形と同じ文字列になる「頭側（cranial）とも言う」など（keep）は残す。
 */
const words = new Map<string, string>([
  ...enNotes.keep.map((text) => [text, text] as const),
  ...enNotes.added.map((text) => [text, text.replace(/（[A-Za-z][^（）]*）/g, "")] as const),
]);
/** keep を先に（同じ所から始まるときは keep が勝つ）。添えた文字列は長いものから並んでいる */
const pattern = new RegExp([...enNotes.keep, ...enNotes.added].map((text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "g");

/** 英語を添えない文（設定に関係なく） */
export function withoutEnglish(text: string): string {
  return /（[A-Za-z]/.test(text) ? text.replace(pattern, (match) => words.get(match) ?? match) : text;
}

/** 説明の文を、設定に合わせて英語つき・日本語だけにする */
export function noteText(text: string): string;
export function noteText(text: string | undefined): string | undefined;
export function noteText(text: string | undefined): string | undefined {
  return text === undefined || preferences.enNotes ? text : withoutEnglish(text);
}
