import { h } from "../dom";
import type { AppContext } from "./context";

const SOURCES: [string, string, string][] = [
  ["3Dモデル", "BodyParts3D, © The Database Center for Life Science licensed under CC Attribution 4.0 International", "https://dbarchive.biosciencedbc.jp/en/bodyparts3d/lic.html"],
  ["3Dモデル（広背筋・表情筋・末梢神経・脳神経・肺の葉・動脈の枝・靱帯・リンパ節など）", "Z-Anatomy（Lluís Vinent Juanico ほか, CC BY-SA 4.0）", "https://github.com/LluisV/Z-Anatomy"],
  ["3Dモデルの変換方法（参考）", "ashemag/human-atlas（MIT License）", "https://github.com/ashemag/human-atlas"],
  ["臓器の図（心臓の前・前の壁を外した図・四腔断）", "Patrick J. Lynch, medical illustrator（CC BY 2.5）", "https://commons.wikimedia.org/wiki/File:Heart_anterior_exterior_view.jpg"],
  ["臓器の図（心臓の後ろ）", "BruceBlaus / Blausen Medical（CC BY-SA 3.0）", "https://commons.wikimedia.org/wiki/File:Rear_view_of_a_human_heart_*_Vista_posterior_de_un_coraz%C3%B3n_humano.png"],
  ["臓器の図（心臓の弁・胃の内面と筋層・小腸の絨毛と腸腺）", "OpenStax College, Anatomy & Physiology（CC BY 3.0）", "https://commons.wikimedia.org/wiki/File:2011_Heart_Valves.jpg"],
  ["臓器の図（前から見た肺と気管支）", "Patrick J. Lynch, medical illustrator（CC BY 2.5）", "https://commons.wikimedia.org/wiki/File:Lungs_diagram_detailed.svg"],
  ["臓器の図（肝臓・胆道と膵臓・腎臓から尿道まで・脳の正中断）", "BruceBlaus（CC BY-SA 4.0）", "https://commons.wikimedia.org/wiki/File:Brain_Anatomy_(Sagittal).png"],
  ["臓器の図（腎臓の断面・小腸と大腸・鼻腔と口腔と咽頭の正中断・骨迷路と膜迷路）", "BruceBlaus / Blausen Medical（CC BY 3.0）", "https://commons.wikimedia.org/wiki/File:Blausen_0593_KidneyAnatomy_02.png"],
  ["臓器の図（眼球の水平断）", "Rhcastilhos, Jmarchn（CC BY-SA 3.0）", "https://commons.wikimedia.org/wiki/File:Schematic_diagram_of_the_human_eye_en.svg"],
  ["臓器の図（眼筋）", "Hariadhi（CC BY-SA 4.0）", "https://commons.wikimedia.org/wiki/File:Extraocular_muscles_svg_hariadhi.svg"],
  ["臓器の図（涙器）", "FML, Erin Silversmith（CC BY-SA 2.5）", "https://commons.wikimedia.org/wiki/File:Tear_system.svg"],
  ["臓器の図（外耳・中耳・内耳）", "Lars Chittka, Axel Brockmann（CC BY 2.5）", "https://commons.wikimedia.org/wiki/File:Anatomy_of_the_Human_Ear_blank.svg"],
  ["臓器の図（鼻腔の外側の壁・副鼻腔・耳小骨と内耳・直腸と肛門管）", "Laboratoires Servier, Servier Medical Art（CC BY-SA 3.0）", "https://commons.wikimedia.org/wiki/File:Respiratory_system_-_Nasal_cavity_--_Smart-Servier.png"],
  ["臓器の図（鼻中隔と血管）", "FirstAdmiral（CC BY-SA 3.0 DE）", "https://commons.wikimedia.org/wiki/File:Locus_Kiesselbachii_Shematic_EN.svg"],
  ["臓器の図（蝸牛の断面）", "Oarih, Fred the Oyster（CC BY-SA 3.0）", "https://commons.wikimedia.org/wiki/File:Cochlea-crosssection.svg"],
  ["臓器の図（胃の動脈）", "Mikael Häggström（パブリックドメイン）", "https://commons.wikimedia.org/wiki/File:Stomach_blood_supply.svg"],
  ["臓器の図（上腸間膜動脈と結腸）", "John Charles Boileau Grant『An Atlas of Anatomy』1962（パブリックドメイン）", "https://commons.wikimedia.org/wiki/File:Grant_1962_162.png"],
  ["臓器の図（喉頭）", "Olek Remesz（CC BY-SA 2.5）", "https://commons.wikimedia.org/wiki/File:Larynx_external_en.svg"],
  ["臓器の図（男性の骨盤の正中断）", "R. Dewaele ほか, Bioscope, Université de Genève（CC BY-SA 4.0）", "https://commons.wikimedia.org/wiki/File:Male_genital_system_-_Sagittal_view.svg"],
  ["臓器の図（脊髄の横断面）", "Polarlys（CC BY 2.5）", "https://commons.wikimedia.org/wiki/File:Medulla_spinalis_-_Section_-_English.svg"],
  ["臓器の図（脊髄の伝導路）", "Polarlys, Mikael Häggström（CC BY-SA 3.0）", "https://commons.wikimedia.org/wiki/File:Spinal_cord_tracts_-_English.svg"],
  ["臓器の図（胃の区分・大脳の外側面）", "Henry Vandyke Carter『Gray's Anatomy』の図を SVG にしたもの（Mysid ほか、パブリックドメイン）", "https://commons.wikimedia.org/wiki/File:Gray728.svg"],
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
    h("p", { class: "muted" }, "日本語の用語は日本解剖学会『解剖学用語 改訂13版』の表記に合わせています。3Dモデルは BodyParts3D を軽量化・座標変換して使っています（骨・脳などは、4.0 より細かい 3.0 の形を 4.0 の形に重ねて使っています）。BodyParts3D に無い構造は Z-Anatomy の形を BodyParts3D の骨に合わせて変形・軽量化して加えました（筋の付着面も Z-Anatomy から作っています）。この変形した形（models/ の名前が -za で終わるファイル）は CC BY-SA 4.0 です。臓器の図の平面図（plates/）は、上の作者のイラストを Wikimedia Commons から取り、背景を切り抜いたもの（四腔断は心尖が下になるよう上下を反転、英語のラベルと引き出し線は消し、図の外の部分は切り出し、胃の区分の図は胃に色を付けた。図ごとの変えた所は平面図の欄に出しています）で、元の図と同じライセンスです（CC BY-SA の図は CC BY-SA）。心臓の心室の壁は、BodyParts3D で1つの形を右心室・左心室に分けて使っています。学習用であり、診断・治療に使うものではありません。"),
    h("p", {}, h("a", { href: "#/" }, "ホームへ")),
  );
}
