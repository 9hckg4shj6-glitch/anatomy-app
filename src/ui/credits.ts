import { h } from "../dom";
import type { AppContext } from "./context";

const SOURCES: [string, string, string][] = [
  ["3Dモデル", "BodyParts3D, © The Database Center for Life Science licensed under CC Attribution 4.0 International", "https://dbarchive.biosciencedbc.jp/en/bodyparts3d/lic.html"],
  ["3Dモデルの変換方法（参考）", "ashemag/human-atlas（MIT License）", "https://github.com/ashemag/human-atlas"],
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
    h("p", { class: "muted" }, "日本語の用語は日本解剖学会『解剖学用語 改訂13版』の表記に合わせています。3Dモデルは BodyParts3D を軽量化・座標変換して使っています。学習用であり、診断・治療に使うものではありません。"),
    h("p", {}, h("a", { href: "#/" }, "ホームへ")),
  );
}
