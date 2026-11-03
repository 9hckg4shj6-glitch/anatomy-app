import { h } from "../dom";
import type { AppContext } from "./context";

const SOURCES: [string, string, string][] = [
  ["3Dモデル", "BodyParts3D, © The Database Center for Life Science licensed under CC Attribution 4.0 International", "https://dbarchive.biosciencedbc.jp/en/bodyparts3d/lic.html"],
  ["3Dモデル（広背筋・表情筋・末梢神経・脳神経・肺の葉・動脈の枝・靱帯・リンパ節など）", "Z-Anatomy（Lluís Vinent Juanico ほか, CC BY-SA 4.0）", "https://github.com/LluisV/Z-Anatomy"],
  ["3Dモデルの変換方法（参考）", "ashemag/human-atlas（MIT License）", "https://github.com/ashemag/human-atlas"],
  ["臓器の図（心臓の前・前の壁を外した図・四腔断）", "Patrick J. Lynch, medical illustrator（CC BY 2.5）", "https://commons.wikimedia.org/wiki/File:Heart_anterior_exterior_view.jpg"],
  ["臓器の図（心臓の後ろ）", "BruceBlaus / Blausen Medical（CC BY-SA 3.0）", "https://commons.wikimedia.org/wiki/File:Rear_view_of_a_human_heart_*_Vista_posterior_de_un_coraz%C3%B3n_humano.png"],
  ["臓器の図（心臓の弁）", "OpenStax College, Anatomy & Physiology（CC BY 3.0）", "https://commons.wikimedia.org/wiki/File:2011_Heart_Valves.jpg"],
  ["用語の下調べ", "Wikidata（CC0）", "https://www.wikidata.org/"],
  ["英語名・ラテン名の基準", "Terminologia Anatomica 2nd ed.（FIPAT, 2019）", "https://fipat.library.dal.ca/TA2"],
  ["英語の発音（作成時に使用）", "Kokoro-82M（Apache License 2.0）", "https://huggingface.co/hexgrad/Kokoro-82M"],
];

export function credits(ctx: AppContext): void {
  ctx.hint("");
  ctx.panel.replaceChildren(
    h("h2", {}, "出典・クレジット"),
    h("dl", { class: "credits" }, ...SOURCES.flatMap(([what, text, url]) => [
      h("dt", {}, what),
      h("dd", {}, h("a", { href: url, target: "_blank", rel: "noopener" }, text)),
    ])),
    h("p", { class: "muted" }, "日本語の用語は日本解剖学会『解剖学用語 改訂13版』の表記に合わせています。3Dモデルは BodyParts3D を軽量化・座標変換して使っています（骨・脳などは、4.0 より細かい 3.0 の形を 4.0 の形に重ねて使っています）。BodyParts3D に無い構造は Z-Anatomy の形を BodyParts3D の骨に合わせて変形・軽量化して加えました（筋の付着面も Z-Anatomy から作っています）。この変形した形（models/ の名前が -za で終わるファイル）は CC BY-SA 4.0 です。臓器の図の心臓の平面図（plates/）は、上の作者のイラストを Wikimedia Commons から取り、背景を切り抜いたもの（四腔断は心尖が下になるよう上下を反転、弁の図は英語のラベルと引き出し線を消した）で、元の図と同じライセンスです（後ろから見た図は CC BY-SA 3.0）。心臓の心室の壁は、BodyParts3D で1つの形を右心室・左心室に分けて使っています。学習用であり、診断・治療に使うものではありません。"),
    h("p", {}, h("a", { href: "#/" }, "ホームへ")),
  );
}
