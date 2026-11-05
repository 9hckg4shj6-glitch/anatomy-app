import type { Term, Unit } from "./content";
import { courseTerms, courseUnits } from "./course";

/** 検索の表記ゆれをそろえる（大文字・小文字、カタカナ→ひらがな、全角英数→半角） */
export function normalize(text: string): string {
  return text.normalize("NFKC").toLowerCase().replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
}

/** 日本語・読み・英語・ラテン語のどれかに当たる語（query は normalize したもの）。初心者モードでは初心者コースの語から */
export function searchTerms(query: string): Term[] {
  return courseTerms().filter((term) => [term.ja, term.yomi, term.en, term.la ?? "", ...(term.enAlt ?? [])].some((text) => normalize(text).includes(query)));
}

/** 題かまとまりの名前に当たるレッスン（今のモードのレッスンから） */
export function searchUnits(query: string): Unit[] {
  return courseUnits().filter((unit) => normalize(`${unit.title} ${unit.group ?? ""}`).includes(query));
}
