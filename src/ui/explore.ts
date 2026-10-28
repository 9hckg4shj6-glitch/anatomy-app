import { autoSpeak } from "../audio";
import { isDrawn, landmarksOf, loadAttachments, pins, regionSystems, systems, termById, terms, units, type Term } from "../content";
import { db, nowIso } from "../db";
import { h } from "../dom";
import { landmarkAt } from "../landmarks";
import { relatedTerms } from "../related";
import type { Vec3 } from "../landmarks";
import type { Section } from "../viewer";
import { motionPlayer, type AppContext } from "./context";
import { attachMarks } from "./quiz";
import { termCard } from "./term-card";

/** 神経から支配する筋を示すとき、神経に付ける色 */
const NERVE_MARK = "#ffd43b";

const SECTION_AXES: { axis: Section["axis"]; label: string; keep: Section["keep"] }[] = [
  { axis: "y", label: "水平断", keep: 1 },
  { axis: "x", label: "矢状断", keep: -1 },
  { axis: "z", label: "前頭断", keep: -1 },
];

const OPEN_FOLDERS = "exploreOpenFolders";
const VIEWS = "exploreViews";

/** はがした語（隠す・薄くする）。押した順に並べ、「1つ戻す」で新しいものから戻す */
interface Peel {
  id: string;
  fade: boolean;
}

/** 名前を付けて残した図鑑の表示（出している系統・皮膚・はがした語・選んだ語・断面・視点） */
interface SavedView {
  id: string;
  name: string;
  systems: string[];
  body: boolean;
  peeled: Peel[];
  selected: string | null;
  section: Section | null;
  camera: [Vec3, Vec3];
  savedAt: string;
}

/** 図鑑：系統を選んで自由に回し、タップした部位や検索した語を調べる。termId があればその語を選んで開く */
export async function explore(ctx: AppContext, termId = ""): Promise<void> {
  const { viewer, panel, tools, index } = ctx;
  const [attachments, openSetting, viewsSetting] = await Promise.all([loadAttachments(), db.settings.get(OPEN_FOLDERS), db.settings.get(VIEWS)]);
  // 局所解剖は3Dの部品を持たないが、語の一覧を出すために系統のボタンに入れる（語を選ぶと、境界と中を通る語の系統を読み込む）
  const available = systems.filter((system) => index.systems[system.id] || system.id === "regional");
  const opened = termById.get(termId);
  const shown = new Set([opened && index.systems[opened.system] ? opened.system : available[0]?.id ?? "skeletal"]);
  let body = true;
  let selected: Term | null = null;
  let isolate = false;
  let attach = false;
  /** 神経が支配する筋をまとめて示しているとき、その筋 */
  let group: Term[] = [];
  let section: Section | null = null;
  let peeled: Peel[] = [];
  let views = Array.isArray(viewsSetting?.value) ? (viewsSetting.value as SavedView[]) : [];

  const paint = () => {
    if (selected && group.length) viewer.highlight(group.map((term) => term.id), { isolate: true, marks: [[selected.id, NERVE_MARK]] });
    else if (selected && attach) viewer.highlight([selected.id], { isolate: true, marks: attachMarks(selected), seeThrough: true });
    else viewer.highlight(selected ? [selected.id] : [], { isolate: isolate && !!selected });
  };

  const apply = async () => {
    await viewer.show({ systems: [...shown], body });
    paint();
    renderTools();
  };

  const renderTools = () => {
    tools.replaceChildren(
      ...available.map((system) => h("button", {
        class: shown.has(system.id) ? "chip on" : "chip", type: "button",
        onClick: () => {
          if (shown.has(system.id) && shown.size > 1) shown.delete(system.id);
          else shown.add(system.id);
          void apply();
        },
      }, system.ja)),
      h("button", { class: body ? "chip on" : "chip", type: "button", onClick: () => { body = !body; void apply(); } }, "皮膚"),
      h("button", { class: section ? "chip on" : "chip", type: "button", onClick: () => toggleSection() }, "断面"),
    );
  };

  // 断面: 初めは体全体を出して、選んでいる語（無ければ心臓）の高さで水平に切る。語を選んでいればそのまわりに寄る
  const sectionBox = h("div", { class: "section-box", hidden: true });
  const faceSection = () => {
    const center = selected ? index.terms[selected.id]?.center : undefined;
    viewer.viewSection(true, center, center ? 0.09 : undefined);
  };
  const toggleSection = () => {
    // 断面では切り口で見えるので、隠れた語でも周りを薄くしない（ここで断面を消すときだけ、もとの見せ方に戻す）
    isolate = !!section && (!!selected?.xray || !!selected?.of);
    if (section) {
      section = null;
      viewer.setSection(null);
      viewer.overview();
    } else {
      for (const system of available) if (system.id !== "joints" && system.id !== "lymphatic") shown.add(system.id);
      const center = index.terms[selected?.id ?? "heart"]?.center ?? index.terms.heart.center;
      section = { axis: "y", at: center[1], keep: 1 };
      void apply();
      viewer.setSection(section);
      faceSection();
      ctx.hint("切り口をタップで名前を表示");
    }
    paint();
    renderSection();
    renderTools();
  };
  const renderSection = () => {
    sectionBox.hidden = !section;
    if (!section) return;
    const current = section;
    const k = "xyz".indexOf(current.axis);
    const [lo, hi] = index.bounds;
    const slider = h("input", {
      type: "range", min: String(lo[k]), max: String(hi[k]), step: "0.002", value: String(current.at), "aria-label": "切る位置",
      onInput: () => {
        section = { ...current, at: Number(slider.value) };
        viewer.setSection(section);
      },
    });
    const ends = { y: ["足", "頭"], x: ["右", "左"], z: ["後ろ", "前"] }[current.axis];
    sectionBox.replaceChildren(
      h("div", { class: "chip-list" }, ...SECTION_AXES.map((option) => h("button", {
        class: option.axis === current.axis ? "chip on" : "chip", type: "button",
        onClick: () => {
          const center = index.terms[selected?.id ?? "heart"]?.center ?? index.terms.heart.center;
          section = { axis: option.axis, at: center["xyz".indexOf(option.axis)], keep: option.keep };
          viewer.setSection(section);
          faceSection();
          renderSection();
        },
      }, option.label))),
      h("label", { class: "section-slider" }, h("span", {}, ends[0]), slider, h("span", {}, ends[1])),
      h("div", { class: "nav-row" },
        h("button", { class: "ghost-button", type: "button", onClick: () => { section = { ...current, keep: current.keep === 1 ? -1 : 1 }; viewer.setSection(section); faceSection(); renderSection(); } }, "反対側を残す"),
        h("button", { class: "ghost-button", type: "button", onClick: faceSection }, "切り口を正面に"),
      ),
      current.axis === "y" ? h("p", { class: "muted" }, current.keep === 1 ? "下から見ています（CTと同じ向き：前が上、本人の右が左）。" : "上から見ています（前が上、本人の右が右）。") : "",
    );
  };

  // はがす: 表の筋などを隠したり薄くしたりして、奥の構造を見てタップできるようにする（アトラスの「隠す」「薄くする」）
  const peelBox = h("div", { class: "section-box peel-box", hidden: true });
  const applyPeel = () => {
    viewer.setPeel(peeled.filter((item) => !item.fade).map((item) => item.id), peeled.filter((item) => item.fade).map((item) => item.id));
    renderPeel();
  };
  const peel = (term: Term, fade: boolean) => {
    peeled = [...peeled.filter((item) => item.id !== term.id), { id: term.id, fade }];
    applyPeel();
    select(null);
    ctx.hint(`${term.ja}を${fade ? "薄くした" : "隠した"}。奥の部位をタップできる`);
  };
  const unpeel = (id?: string) => {
    peeled = id ? peeled.filter((item) => item.id !== id) : [];
    applyPeel();
    render();
  };
  const renderPeel = () => {
    peelBox.hidden = !peeled.length;
    if (!peeled.length) return;
    const faded = peeled.filter((item) => item.fade).length;
    peelBox.replaceChildren(
      h("p", { class: "peel-title" }, `隠した ${peeled.length - faded}・薄くした ${faded}`, h("span", { class: "muted" }, "（押すとその語だけ戻す）")),
      h("div", { class: "chip-list" }, ...peeled.map((item) => h("button", {
        class: item.fade ? "chip peeled faded" : "chip peeled", type: "button", onClick: () => unpeel(item.id),
      }, termById.get(item.id)?.ja ?? item.id))),
      h("div", { class: "nav-row" },
        h("button", { class: "ghost-button", type: "button", onClick: () => unpeel(peeled[peeled.length - 1].id) }, "1つ戻す"),
        h("button", { class: "ghost-button", type: "button", onClick: () => unpeel() }, "全部戻す"),
        h("button", { class: "ghost-button", type: "button", onClick: saveView }, "表示を保存"),
      ),
    );
  };

  // 表示の保存: 今の表示に名前を付けて残し、一覧の「保存した表示」から開き直す（記録の書き出しにも入る）
  const storeViews = () => db.settings.put({ key: VIEWS, value: views, updatedAt: nowIso() });
  const saveView = () => {
    const first = termById.get(peeled[0]?.id ?? "");
    const name = window.prompt("この表示の名前", selected?.ja ?? (first ? `${first.ja}をはがした所` : `表示 ${views.length + 1}`))?.trim();
    if (!name) return;
    views = [{
      id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, name,
      systems: [...shown], body, peeled, selected: selected?.id ?? null, section, camera: viewer.view, savedAt: nowIso(),
    }, ...views];
    void storeViews();
    openIds.add(VIEWS);
    void db.settings.put({ key: OPEN_FOLDERS, value: [...openIds], updatedAt: nowIso() });
    if (!search.value.trim()) renderList();
    ctx.hint(`「${name}」を保存した。一覧の「保存した表示」から開ける`);
  };
  const openView = async (view: SavedView) => {
    shown.clear();
    for (const id of view.systems) if (available.some((system) => system.id === id)) shown.add(id);
    if (!shown.size) shown.add(available[0]?.id ?? "skeletal");
    body = view.body;
    peeled = view.peeled.filter((item) => termById.has(item.id));
    section = view.section;
    viewer.setSection(section);
    renderSection();
    applyPeel();
    await apply();
    select(termById.get(view.selected ?? "") ?? null);
    viewer.setView(view.camera);
    ctx.hint(`「${view.name}」を開いた`);
  };
  const removeView = (view: SavedView) => {
    if (!window.confirm(`「${view.name}」を消しますか？`)) return;
    views = views.filter((item) => item.id !== view.id);
    void storeViews();
    renderList();
  };
  const viewRows = () => h("div", { class: "saved-views" },
    h("p", { class: "muted" }, "系統の組み合わせ・隠した部位・断面・視点を、名前を付けて残せます。"),
    h("button", { class: "ghost-button", type: "button", onClick: saveView }, "今の表示を保存"),
    views.length ? h("ul", { class: "term-list" }, ...views.map((view) => h("li", { class: "view-row" },
      h("button", { type: "button", class: "term-row", onClick: () => void openView(view) },
        h("span", {}, view.name), h("span", { class: "en" }, view.savedAt.slice(0, 10))),
      h("button", { type: "button", class: "view-delete", "aria-label": `${view.name}を消す`, onClick: () => removeView(view) }, "×"),
    ))) : "",
  );

  const select = (term: Term | null) => {
    selected = term;
    // 隠れた部位と骨・器官の部位は周りを半透明にして見せる（断面のときは切り口で見えるので薄くしない）
    isolate = !section && (!!term?.xray || !!term?.of);
    attach = false;
    group = [];
    paint();
    viewer.setLabel(term?.id ?? null, term?.ja ?? "");
    if (term) {
      // 基本の用語（方向・面・運動）は骨格の上に図を描く。局所解剖は境界と中を通る語の系統と骨格を見せる
      const needed = term.figure ? ["skeletal"] : term.region ? [term.system, "skeletal", ...regionSystems(term.region)] : [term.system];
      if (needed.some((system) => !shown.has(system))) {
        for (const system of needed) shown.add(system);
        void apply();
      }
      if (!section) viewer.focus(term.id, 3.2);
      autoSpeak(term);
    }
    render();
    // 一覧や部位の一覧から選んだとき、説明が見えるように上へ戻す（スマホでは画面全体、PCでは右の欄）
    panel.scrollTop = 0;
    window.scrollTo({ top: 0 });
  };

  const showGroup = (list: Term[]) => {
    group = list;
    for (const term of list) shown.add(term.system);
    void apply();
    viewer.overview();
    render();
  };

  const search = h("input", { class: "search", type: "search", placeholder: "日本語・読み・英語・ラテン語で検索", "aria-label": "検索" });
  const list = h("div", { class: "explore-list" });
  const detail = h("div", { class: "detail" });
  /** 一覧の行（選んだ語の行を強調するため） */
  const rows = new Map<string, HTMLElement>();
  // 開いたフォルダーは覚えておき、図鑑に戻ったときも開いたままにする
  const openIds = new Set(Array.isArray(openSetting?.value) ? (openSetting.value as string[]) : []);

  const termRows = (items: Term[]) => h("ul", { class: "term-list" }, ...items.map((term) => {
    const row = h("button", { type: "button", class: term === selected ? "term-row on" : "term-row", onClick: () => select(term) },
      h("span", {}, term.ja), h("span", { class: "en", lang: "en" }, term.en));
    rows.set(term.id, row);
    return h("li", {}, row);
  }));
  const folder = (id: string, className: string, title: (Node | string)[], summary: string, content: () => HTMLElement) => {
    // 中身は開いたときに作る（全部で千語を超えるので）
    const box = h("details", {
      class: className, open: openIds.has(id),
      ontoggle: () => {
        if (box.open && box.children.length < 2) box.append(content());
        if (box.open === openIds.has(id)) return;
        if (box.open) openIds.add(id);
        else openIds.delete(id);
        void db.settings.put({ key: OPEN_FOLDERS, value: [...openIds], updatedAt: nowIso() });
      },
    },
      h("summary", {}, h("span", { class: "folder-title" }, ...title), h("span", { class: "folder-count" }, summary)),
    );
    if (box.open) box.append(content());
    return box;
  };

  /** 一覧: 検索したときは当てはまる語を並べ、ふだんは系統→レッスンのフォルダーにまとめる */
  const renderList = () => {
    const query = normalize(search.value.trim());
    rows.clear();
    if (query) {
      const matches = terms.filter((term) => [term.ja, term.yomi, term.en, term.la ?? "", ...(term.enAlt ?? [])].some((text) => normalize(text).includes(query)));
      list.replaceChildren(matches.length ? termRows(matches) : h("p", { class: "muted" }, "見つかりませんでした。"));
      return;
    }
    list.replaceChildren(folder(VIEWS, "system folder", ["保存した表示"], `${views.length}件`, viewRows), ...systems.flatMap((system) => {
      const inSystem = units.filter((unit) => unit.system === system.id);
      if (!inSystem.length) return [];
      const total = inSystem.reduce((sum, unit) => sum + unit.terms.length, 0);
      return [folder(system.id, "system folder",
        [h("span", { class: "swatch", style: `background:${system.color}` }), system.ja],
        `${inSystem.length}レッスン・${total}語`,
        () => h("div", { class: "subfolders" }, ...inSystem.map((unit) =>
          folder(unit.id, "subfolder", [unit.title], `${unit.terms.length}語`, () => termRows(unit.terms)))),
      )];
    }));
  };

  const chips = (items: Term[]) => h("div", { class: "chip-list" },
    ...items.map((item) => h("button", { class: "chip", type: "button", onClick: () => select(item) }, item.ja)));

  const render = () => {
    for (const [id, row] of rows) row.classList.toggle("on", id === selected?.id);
    if (!selected) {
      detail.replaceChildren(h("p", { class: "muted" }, section ? "切り口や3Dの部位をタップするか、下の系統のフォルダーや検索から選んでください。" : "3Dの部位をタップするか、下の系統のフォルダーや検索から選んでください。"));
      return;
    }
    const term = selected;
    const parts = landmarksOf(term.id);
    const parent = term.of ? termById.get(term.of) : null;
    const attachable = !!(term.originAt?.length || term.insertionAt?.length || viewer.hasAttachments(term.id));
    const related = relatedTerms(term, attachments).filter((relation) => relation.list.length);
    // 骨の部位は骨ごとはがす。基本の用語・局所解剖は3Dの部品を持たないのではがせない
    const peelTarget = parent ?? term;
    const peelable = !isDrawn(peelTarget) && !!index.terms[peelTarget.id]?.elements.length;
    const peeledNow = peeled.some((item) => item.id === peelTarget.id);
    const whose = parent ? `${parent.ja}を` : "";
    detail.replaceChildren(h("div", {},
      termCard(term, {
        open: select,
        // 筋の動きは骨格を表示に加えてから
        motion: motionPlayer(ctx, term, shown.has("skeletal") ? undefined : async () => {
          shown.add("skeletal");
          await apply();
        }),
      }),
      parts.length ? h("h3", {}, `${term.ja}の部位`) : "",
      parts.length ? chips(parts) : "",
      ...related.flatMap((relation) => [
        h("h3", {}, `${relation.title}（${relation.list.length}）`),
        chips(relation.list),
        relation.group ? h("button", {
          class: group.length ? "ghost-button on" : "ghost-button", type: "button",
          onClick: () => (group.length ? select(term) : showGroup(relation.list)),
        }, group.length ? "神経だけを見る" : "支配する筋をまとめて3Dで見る（神経は黄）") : "",
      ]),
      h("div", { class: "nav-row" },
        parent ? h("button", { class: "ghost-button", type: "button", onClick: () => select(parent) }, `${parent.ja}を見る`) : null,
        attachable ? h("button", {
          class: attach ? "ghost-button on" : "ghost-button", type: "button",
          onClick: () => {
            attach = !attach;
            paint();
            render();
          },
        }, attach ? "起始・停止を隠す" : "起始・停止を骨で見る") : null,
        !parent && !attachable && !isDrawn(term) ? h("button", {
          class: "ghost-button", type: "button",
          onClick: () => {
            isolate = !isolate;
            paint();
            render();
          },
        }, isolate ? "まわりも表示" : "この部位だけ表示") : null,
        h("button", { class: "ghost-button", type: "button", onClick: () => { select(null); if (section) viewer.viewSection(); else viewer.overview(); } }, "選択をやめる"),
      ),
      peelable ? h("div", { class: "nav-row peel-row" }, ...(peeledNow
        ? [h("button", { class: "ghost-button", type: "button", onClick: () => unpeel(peelTarget.id) }, `${whose}もとに戻す`)]
        : [
          h("button", { class: "ghost-button", type: "button", onClick: () => peel(peelTarget, false) }, `${whose}隠す`),
          h("button", { class: "ghost-button", type: "button", onClick: () => peel(peelTarget, true) }, `${whose}薄くする`),
        ])) : "",
    ));
  };
  search.addEventListener("input", renderList);

  /** 部品のその点にある語。骨・器官の部位（ピン）の上なら、骨・器官ではなく部位 */
  const termAt = (elementId: string | null, point: Vec3 | null): Term | null => {
    const termId = elementId ? viewer.termsOf(elementId)[0] : null;
    const parts = elementId && point ? terms.filter((term) => term.of && pins[term.id] && index.terms[term.id]?.elements.includes(elementId)) : [];
    const part = point ? landmarkAt(point, parts, 0.002) : null;
    return part ?? (termId ? termById.get(termId) ?? null : null);
  };
  viewer.onPick = (elementId, point) => select(termAt(elementId, point));
  viewer.onHover = (elementId, point) => termAt(elementId, point)?.ja ?? null;
  ctx.hint("タップで名前を表示");
  panel.replaceChildren(sectionBox, peelBox, detail, search, list);
  renderList();
  render();
  await apply();
  if (opened) select(opened);
  // レッスンや問題から来たときのカメラが残らないよう、全身から始める
  else viewer.overview();
}

/** 検索の表記ゆれをそろえる（大文字・小文字、カタカナ→ひらがな、全角英数→半角） */
function normalize(text: string): string {
  return text.normalize("NFKC").toLowerCase().replace(/[\u30a1-\u30f6]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
}
