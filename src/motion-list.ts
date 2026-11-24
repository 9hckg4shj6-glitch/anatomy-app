// 動きの図鑑の一覧（臓器の図からも使うので、動きの図鑑の本体 src/ui/motions.ts とは分けておく。本体は開いたときに読む）

/**
 * 動きの図鑑（#/motions、docs/動きの図鑑.md）。呼吸・心臓の拍動と心周期・刺激伝導系・肺循環と体循環を、
 * アプリの3Dの形を実測のデータとモデルで動かして見せる（計算は src/motions.ts）。
 * 一覧は #/motions、それぞれは #/motions/<ID>
 */
export interface MotionItem {
  id: string;
  ja: string;
  en: string;
  lead: string;
  color: string;
  /** 一覧の絵（24×24 の SVG の中身） */
  icon: string;
}

export const MOTIONS: MotionItem[] = [
  {
    id: "breathing", ja: "呼吸", en: "breathing", color: "#6fa8dc",
    lead: "横隔膜が下がり胸郭が広がって肺がふくらむ様子。実際の人の自由呼吸を撮った 4DMRI の動きで。",
    icon: `<path d="M12 3v7"/><path d="M12 10c-2 0-3 1.5-4.5 1.5C5 11.5 4 14 4 17c0 2 1.5 3 3 3 3 0 5-3 5-6"/><path d="M12 10c2 0 3 1.5 4.5 1.5 2.5 0 3.5 2.5 3.5 5.5 0 2-1.5 3-3 3-3 0-5-3-5-6"/>`,
  },
  {
    id: "heartbeat", ja: "心臓の拍動と心周期", en: "cardiac cycle", color: "#c8323c",
    lead: "4つの部屋が縮み、弁が開いて閉じ、血液が流れる1拍。圧・容積・心電図のグラフと一緒に。",
    icon: `<path d="M12 20s-7.5-4.6-7.5-10.2A4.2 4.2 0 0 1 12 7.2a4.2 4.2 0 0 1 7.5 2.6C19.5 15.4 12 20 12 20Z"/><path d="M5 12h3l1.5-3 2 6 1.5-3h6"/>`,
  },
  {
    id: "conduction", ja: "刺激伝導系と心電図", en: "conduction system", color: "#d9a514",
    lead: "洞房結節から房室結節・ヒス束・右脚と左脚・プルキンエ線維へ興奮が伝わる順と、心電図の波の対応。",
    icon: `<path d="M13 2 5 13h6l-1 9 8-12h-6l1-8Z"/>`,
  },
  {
    id: "circulation", ja: "肺循環と体循環", en: "pulmonary and systemic circulation", color: "#7a4fb5",
    lead: "血液が心臓から全身・肺を回って戻る道。動脈血（赤）と静脈血（青）が入れかわる所に注目。",
    icon: `<path d="M12 4a8 8 0 1 1-7.4 5"/><path d="m4 5 .6 4 4-.6"/><circle cx="12" cy="12" r="2.4"/>`,
  },
];
