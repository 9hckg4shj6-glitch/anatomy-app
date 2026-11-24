import { canUseExam } from "./profile";

/**
 * 骨学試験の項目のデータ（content/exam.json）と画面は、開いたときに読む別のファイル（2026-11-24 初めの読み込みを軽くする）。
 * 骨学試験を使える人（canUseExam）なら、画面を作る前に読んでおき（src/main.ts の route）、今日・記録・復習・語のカードは
 * examLoaded() で同期して使う。使えない人は読まない
 */
type ExamModules = { data: typeof import("./exam"); ui: typeof import("./ui/exam") };

let loaded: ExamModules | null = null;
let loading: Promise<ExamModules> | null = null;

export function loadExam(): Promise<ExamModules> {
  loading ??= Promise.all([import("./exam"), import("./ui/exam")])
    .then(([data, ui]) => (loaded = { data, ui }))
    .catch((error: unknown) => {
      loading = null; // 回線が切れていたなど。次に開いたときにもう一度
      throw error;
    });
  return loading;
}

/** 読み込んだ骨学試験（使える人で、読み込み済みのとき。そうでなければ null） */
export function examLoaded(): ExamModules | null {
  return canUseExam() ? loaded : null;
}
