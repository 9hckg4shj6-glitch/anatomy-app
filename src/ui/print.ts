import { loadPlateIndex, organs, systems, termById, type PlateIndex, type Term, type Unit } from "../content";
import { courseTerms, courseUnits, inCourse } from "../course";
import { db } from "../db";
import { h } from "../dom";
import { markOf, starredIds } from "../marks";
import { fullOrgan } from "../organ-details";
import type { AppContext } from "./context";
import { iosDevice, isStandalone } from "../install";
import {
  imagesReady, mountPrint, openPrintDialog, plateAnswers, platePages, unmountPrint, waitImages, wordList, wordTest,
  type PlatePrint, type PrintHide, type WordAsk,
} from "./print-sheet";
import { card, choiceRow, foot, group, row, segmented, toggleRow } from "./settings-kit";

/**
 * 印刷する（#/print。docs/普段使い.md「印刷する」）。作るものを選び（平面図のプリント・語のテスト・語の一覧）、
 * 範囲と形を決めて「印刷・PDFに保存」。下に1枚目の見本を出す。
 * "#/print/plate/<図ID>" は平面図のプリントでその図を選んで開く（臓器の図の「この図を印刷する」）、
 * "#/print/star" は ★を付けた語の一覧で開く。
 * "#/print/go?…" は選んだものをアドレスに書いた印刷だけの画面（ホーム画面の iPhone のアプリは印刷の画面を開けないので、Safari へ送る。sheetHash）
 */
type Kind = "plates" | "test" | "list";
type Range = "star" | "weak" | "learned" | "lessons";

/** 選んだこと（この画面を離れても、アプリを開いている間は覚えておく） */
const state = {
  kind: "plates" as Kind,
  plateIds: new Set<string>(),
  hide: "all" as PrintHide,
  answers: true,
  points: false,
  range: "star" as Range,
  lessonIds: new Set<string>(),
  ask: "en" as WordAsk,
  count: 30,
  shuffle: true,
  note: false,
  /** 開いている臓器・系統の欄（選ぶたびに描き直しても閉じないように） */
  open: new Set<string>(),
  query: "",
};

const KINDS: { value: Kind; label: string }[] = [
  { value: "plates", label: "平面図" },
  { value: "test", label: "語のテスト" },
  { value: "list", label: "語の一覧" },
];
const HIDE_VALUES: PrintHide[] = ["all", "ja", "en", "none"];
const HIDES: { value: PrintHide; label: string }[] = [
  { value: "all", label: "全部" },
  { value: "ja", label: "日本語" },
  { value: "en", label: "英語" },
  { value: "none", label: "隠さない" },
];

export async function printScreen(ctx: AppContext, arg: string): Promise<void> {
  /** 先に入れ物へ入れた紙（prepare）と、入れるまでの待ち */
  let mounted: HTMLElement | null = null;
  let mountTimer = 0;
  ctx.fold(true);
  ctx.hint("");
  void ctx.viewer.show({ systems: ["skeletal"], body: true });
  ctx.viewer.highlight([]);
  ctx.viewer.overview();
  if (arg.startsWith("plate/")) {
    state.kind = "plates";
    state.plateIds.add(arg.slice("plate/".length));
  } else if (arg === "star") {
    state.kind = "list";
    state.range = "star";
  }
  const [index, learned, schedules] = await Promise.all([
    loadPlateIndex().catch(() => null), db.learned.toArray(), db.schedules.toArray(),
  ]);
  if (ctx.signal.aborted) return;
  ctx.signal.addEventListener("abort", () => {
    clearTimeout(mountTimer);
    unmountPrint();
  }, { once: true });

  // 図の一覧（画像のある図だけ。手で描いた模式図「血液の流れ」は紙にしない）
  const plateOrgans = organs.map((organ) => ({ organ, plates: organ.plates.filter((plate) => index?.plates[plate.id]) })).filter((item) => item.plates.length);
  const plateById = new Map(plateOrgans.flatMap(({ organ, plates }) => plates.map((plate) => [plate.id, { organ, plate }] as const)));
  for (const id of state.plateIds) if (!plateById.has(id)) state.plateIds.delete(id);
  if (state.open.size === 0) for (const id of state.plateIds) state.open.add(`organ:${plateById.get(id)!.organ.id}`);

  // 語の範囲
  const order = new Map(courseTerms().map((term, i) => [term.id, i]));
  const byCourse = (ids: Iterable<string>) => [...new Set(ids)].filter((id) => inCourse(id) && termById.has(id))
    .sort((a, b) => (order.get(a) ?? 1e9) - (order.get(b) ?? 1e9)).map((id) => termById.get(id)!);
  const lapses = new Map<string, number>();
  for (const schedule of schedules) if (schedule.lapses > 0) lapses.set(schedule.termId, (lapses.get(schedule.termId) ?? 0) + schedule.lapses);
  const learnedIds = new Set(learned.map((item) => item.termId));
  const units = courseUnits();
  const rangeTerms = (range: Range): Term[] => {
    if (range === "star") return byCourse(starredIds());
    if (range === "weak") return byCourse(lapses.keys()).sort((a, b) => (lapses.get(b.id) ?? 0) - (lapses.get(a.id) ?? 0));
    if (range === "learned") return byCourse(learnedIds);
    return byCourse(units.filter((unit) => state.lessonIds.has(unit.id)).flatMap((unit) => unit.terms.map((term) => term.id)));
  };
  const rangeTitle = (): string => {
    if (state.range === "star") return "★を付けた語";
    if (state.range === "weak") return "まちがえたことのある語";
    if (state.range === "learned") return "学んだ語";
    const chosen = units.filter((unit) => state.lessonIds.has(unit.id));
    return chosen.length === 1 ? chosen[0].title : `選んだレッスン（${chosen.length}）`;
  };

  /** 語のテスト・語の一覧の今の中身（Safari へ送るときにアドレスに書く） */
  let words: { title: string; items: Term[] } = { title: "", items: [] };

  /** 今選んでいるものを書いたアドレス（#/print/go?…）。語は ID で送る（Safari とアプリでは記録が別なので、★やメモも書く） */
  const sheetHash = (): string => {
    const params = new URLSearchParams({ k: state.kind, a: state.answers ? "1" : "0" });
    if (state.kind === "plates") {
      params.set("p", [...state.plateIds].join(","));
      params.set("h", state.hide);
      params.set("pt", state.points ? "1" : "0");
    } else {
      params.set("title", words.title);
      params.set("t", words.items.map((term) => term.id).join(","));
      if (state.kind === "test") params.set("ask", state.ask);
      else {
        params.set("n", state.note ? "1" : "0");
        const memos = Object.fromEntries(words.items.map((term) => [term.id, markOf(term.id).memo.trim()]).filter(([, memo]) => memo));
        if (Object.keys(memos).length) params.set("m", JSON.stringify(memos));
      }
    }
    return `#/print/go?${params.toString()}`;
  };

  /** 印刷の画面が開かなかったときの案内 */
  const printHelp = (): HTMLElement[] => {
    if (isStandalone() && iosDevice()) {
      const url = `${location.origin}${location.pathname}${sheetHash()}`;
      const copied = h("span", { class: "muted" }, "");
      return [
        h("p", {}, "ホーム画面に追加したアプリからは、iPhone・iPad の決まりで印刷の画面を開けません。",
          "同じ紙を Safari で開いて印刷してください（選んだものはそのまま送ります）。"),
        h("div", { class: "pp-actions" },
          h("a", { class: "primary pp-print", href: `x-safari-${url}` }, "Safari で開いて印刷する"),
          h("button", { class: "ghost-button", type: "button", onClick: async () => {
            try {
              await navigator.clipboard.writeText(url);
              copied.textContent = "コピーしました";
            } catch {
              copied.textContent = "コピーできませんでした";
            }
          } }, "アドレスをコピー"), copied),
        foot("Safari が開かないとき（iOS 16 まで）は、コピーしたアドレスを Safari のアドレス欄に貼り付けて開きます。"),
      ];
    }
    return [h("p", {}, "印刷の画面が開かなかったときは、ブラウザのメニューの「印刷」（パソコンは ⌘P・Ctrl+P）を選んでください。この画面で選んだ紙がそのまま印刷されます。")];
  };

  /**
   * 「印刷・PDFに保存」のボタンと、その下の案内。紙は選ぶたびに先に入れ物へ入れて図を読んでおき（prepare）、押したらすぐ印刷の画面を開く
   */
  const prepare = (list: () => HTMLElement[], ready: boolean) => {
    clearTimeout(mountTimer);
    mounted = null;
    if (!ready) {
      unmountPrint();
      return;
    }
    mountTimer = window.setTimeout(() => {
      if (!ctx.signal.aborted) mounted = mountPrint(list());
    }, 250);
  };
  const printControls = (list: () => HTMLElement[], label: string) => {
    const status = h("span", { class: "muted" }, label || "印刷するものを選んでください");
    const help = h("div", { class: "pp-help", role: "status" });
    const button = h("button", { class: "primary pp-print", type: "button", disabled: !label, onClick: async () => {
      help.replaceChildren();
      clearTimeout(mountTimer);
      const root = mounted ?? (mounted = mountPrint(list()));
      if (!imagesReady(root)) {
        button.disabled = true;
        status.textContent = "図を読み込んでいます…";
        await waitImages(root);
        button.disabled = false;
        status.textContent = label;
        if (ctx.signal.aborted) return;
      }
      const opened = await openPrintDialog();
      if (!opened && !ctx.signal.aborted) help.replaceChildren(...printHelp());
    } }, "印刷・PDFに保存");
    return [h("div", { class: "pp-actions" }, button, status), help];
  };

  const preview = h("div", { class: "pp-preview" });
  const form = h("div", {});
  const root = h("div", { class: "home print-screen" },
    h("div", { class: "tab-head" }, h("h2", {}, "印刷する")),
    h("p", { class: "muted" }, "平面図の書き込みプリントや語のテストを、A4 の紙に印刷するか PDF に保存します。答えのページも付けられます。"),
    form);
  ctx.panel.replaceChildren(root);

  const plateList = (): PlatePrint[] => [...state.plateIds].flatMap((id) => {
    const found = plateById.get(id);
    const entry = index?.plates[id];
    if (!found || !entry) return [];
    const spec = fullOrgan(found.organ).plates.find((plate) => plate.id === id);
    return spec ? [{ spec, entry, organ: found.organ.ja }] : [];
  });

  /** 印刷する紙（見本と印刷で同じものを使う。語のテストのばらばらの順も同じに） */
  let pages: () => HTMLElement[] = () => [];
  let size = "";

  const render = () => {
    const sections: HTMLElement[] = [
      group("作るもの", {}, card(row("種類", undefined, segmented("作るもの", KINDS, state.kind, (value) => {
        state.kind = value;
        render();
      }), true)), foot(state.kind === "plates"
        ? "平面図の名前を番号の空欄にしたプリント。番号の欄に名前を書きます"
        : state.kind === "test" ? "語を並べた表に、英語か日本語を書くテスト" : "語の日本語・読み・英語の一覧（★のメモや説明も）")),
    ];
    if (state.kind === "plates" && index) sections.push(...plateForm(index));
    if (state.kind === "plates" && !index) sections.push(h("p", { class: "muted" }, "平面図を読み込めませんでした。オフラインのときは、一度つないでから開いてください。"));
    if (state.kind !== "plates") sections.push(...wordForm());

    form.replaceChildren(h("div", { class: "set-groups" }, ...sections,
      h("section", { class: "set-group" },
        h("h3", { class: "set-title" }, "見本（1枚目）"),
        preview,
        ...printControls(pages, size),
        foot("印刷の画面で、プリンタを選ぶか「PDFとして保存」を選びます（iPhone・iPad は印刷の画面の共有 →「ファイルに保存」で PDF に）。用紙は A4 縦、倍率は100%で。"))));
    showPreview();
  };

  /** 平面図のプリントの欄（図を選ぶ・隠すもの・答えと要点） */
  const plateForm = (plateIndex: PlateIndex): HTMLElement[] => {
    const chosen = plateList();
    const labelsOf = (id: string) => plateIndex.plates[id]?.labels.length ?? 0;
    pages = () => {
      const list = plateList();
      return [...list.flatMap((plate) => platePages(plate, state.hide, state.points)), ...(state.answers && state.hide !== "none" && list.length ? [plateAnswers(list)] : [])];
    };
    size = chosen.length ? `図 ${chosen.length}枚${state.answers && state.hide !== "none" ? "＋答え" : ""}` : "";

    const toggle = (id: string) => {
      if (state.plateIds.has(id)) state.plateIds.delete(id);
      else state.plateIds.add(id);
      render();
    };
    const plateRow = (organ: string, plate: { id: string; title: string }, withOrgan: boolean) =>
      choiceRow(withOrgan ? `${organ} › ${plate.title}` : plate.title, "", state.plateIds.has(plate.id), true, () => toggle(plate.id), `名前 ${labelsOf(plate.id)}`);
    const query = state.query.trim().toLowerCase();
    const search = h("input", {
      class: "pp-search", type: "search", placeholder: "図や臓器の名前で探す（例: 心臓・断面）", value: state.query, "aria-label": "図を探す",
      onInput: () => {
        state.query = search.value;
        render();
        const again = form.querySelector<HTMLInputElement>(".pp-search");
        again?.focus();
        again?.setSelectionRange(again.value.length, again.value.length);
      },
    });
    const matches = query ? plateOrgans.flatMap(({ organ, plates }) => plates
      .filter((plate) => `${organ.ja}${organ.yomi}${organ.en}${plate.title}`.toLowerCase().includes(query))
      .map((plate) => plateRow(organ.ja, plate, true))) : [];
    const organList = plateOrgans.map(({ organ, plates }) => {
      const key = `organ:${organ.id}`;
      const picked = plates.filter((plate) => state.plateIds.has(plate.id)).length;
      const details = h("details", { class: "pp-group", open: state.open.has(key) },
        h("summary", {}, h("span", {}, organ.ja), h("span", { class: "muted" }, picked ? `${picked} / ${plates.length}枚` : `${plates.length}枚`)),
        ...plates.map((plate) => plateRow(organ.ja, plate, false)));
      details.addEventListener("toggle", () => (details.open ? state.open.add(key) : state.open.delete(key)));
      return details;
    });
    return [
      group(`図を選ぶ${chosen.length ? `（${chosen.length}枚）` : ""}`, {},
        chosen.length ? h("div", { class: "pp-chosen" },
          ...chosen.map((plate) => h("button", { class: "chip on", type: "button", "aria-label": `${plate.spec.title}を外す`, onClick: () => toggle(plate.spec.id) }, `${plate.spec.title} ×`)),
          h("button", { class: "chip", type: "button", onClick: () => {
            state.plateIds.clear();
            render();
          } }, "すべて外す")) : "",
        search,
        query
          ? card(...(matches.length ? matches : [h("p", { class: "muted pp-empty" }, "見つかりませんでした")]))
          : h("div", { class: "set-card pp-groups" }, ...organList),
        foot("1枚の紙に図を1つ。いくつ選んでも、答えは最後にまとめて付きます")),
      group("隠すもの", {},
        card(row("名前を隠す", undefined, segmented("隠すもの", HIDES, state.hide, (value) => {
          state.hide = value;
          render();
        }), true),
        state.hide !== "none" ? toggleRow("答えのページを付ける", "最後のページに、番号と名前（日本語・英語）", state.answers, (value) => {
          state.answers = value;
          render();
        }) : "",
        toggleRow("要点も載せる", "臓器の図の「この図の要点」を図の下に（図は少し小さくなります）", state.points, (value) => {
          state.points = value;
          render();
        })),
        foot(state.hide === "all" ? "番号の欄に日本語と英語を書きます" : state.hide === "ja" ? "英語を載せて、日本語を書きます" : state.hide === "en" ? "日本語を載せて、英語を書きます" : "名前を全部載せた、見て覚える用の紙です")),
    ];
  };

  /** 語のテスト・語の一覧の欄（範囲・形） */
  const wordForm = (): HTMLElement[] => {
    const counts: Record<Range, number> = { star: rangeTerms("star").length, weak: rangeTerms("weak").length, learned: rangeTerms("learned").length, lessons: 0 };
    let items = rangeTerms(state.range);
    if (state.kind === "test") {
      if (state.shuffle) items = shuffled(items);
      if (state.count) items = items.slice(0, state.count);
    }
    const title = `${state.kind === "test" ? "語のテスト" : "語の一覧"}・${rangeTitle()}`;
    const fixed = items;
    words = { title, items: fixed };
    pages = () => state.kind === "test"
      ? [wordTest(title, fixed, state.ask, false), ...(state.answers ? [wordTest(title, fixed, state.ask, true)] : [])]
      : [wordList(title, fixed, { memo: (id) => markOf(id).memo.trim(), note: state.note })];
    size = items.length ? `${items.length}語${state.kind === "test" && state.answers ? "＋答え" : ""}` : "";

    const pick = (range: Range) => () => {
      state.range = range;
      render();
    };
    const ranges = card(
      choiceRow("★を付けた語", "図鑑や語のカードで☆を押した語。メモも一覧に載ります", state.range === "star", false, pick("star"), `${counts.star}語`),
      choiceRow("まちがえたことのある語", "復習・演習でまちがえた回数の多い順", state.range === "weak", false, pick("weak"), `${counts.weak}語`),
      choiceRow("学んだ語", "レッスンで学んだ語すべて（コースの順）", state.range === "learned", false, pick("learned"), `${counts.learned}語`),
      choiceRow("レッスンを選ぶ", "系統ごとのレッスンから", state.range === "lessons", false, pick("lessons"), state.lessonIds.size ? `${state.lessonIds.size}レッスン` : ""));
    const empty = !items.length ? foot(state.range === "star" ? "★を付けた語はまだありません。図鑑の語のカードの☆で付けられます"
      : state.range === "weak" ? "まちがえた語はまだありません"
        : state.range === "learned" ? "まだ学んだ語がありません。レッスンを1つ学ぶと選べます" : "下からレッスンを選んでください", "pp-warn") : "";
    const sections = [group("範囲", {}, ranges, empty)];
    if (state.range === "lessons") sections.push(lessonPicker());
    if (state.kind === "test") {
      sections.push(group("形", {}, card(
        row("書くもの", undefined, segmented("書くもの", [{ value: "en" as WordAsk, label: "英語を書く" }, { value: "ja" as WordAsk, label: "日本語を書く" }], state.ask, (value) => {
          state.ask = value;
          render();
        }), true),
        row("数", undefined, segmented("数", [{ value: 20, label: "20語" }, { value: 30, label: "30語" }, { value: 50, label: "50語" }, { value: 0, label: "すべて" }], state.count, (value) => {
          state.count = value;
          render();
        }), true),
        toggleRow("ばらばらの順にする", "オフなら範囲の順（まちがえた語はまちがえた回数の多い順）", state.shuffle, (value) => {
          state.shuffle = value;
          render();
        }),
        toggleRow("答えのページを付ける", "最後に、答えを書いた同じ表", state.answers, (value) => {
          state.answers = value;
          render();
        }))));
    } else {
      sections.push(group("形", {}, card(
        toggleRow("説明も載せる", "語の説明を英語の右に（紙が多くなります）", state.note, (value) => {
          state.note = value;
          render();
        })), foot("★のメモは、メモがあればいつも載ります")));
    }
    return sections;
  };

  /** レッスンを選ぶ（系統ごとにたたむ） */
  const lessonPicker = (): HTMLElement => {
    const bySystem = systems.map((system) => ({ system, list: units.filter((unit) => unit.system === system.id) })).filter((item) => item.list.length);
    const toggle = (unit: Unit) => {
      if (state.lessonIds.has(unit.id)) state.lessonIds.delete(unit.id);
      else state.lessonIds.add(unit.id);
      render();
    };
    return group("レッスン", {}, h("div", { class: "set-card pp-groups" }, ...bySystem.map(({ system, list }) => {
      const key = `system:${system.id}`;
      const picked = list.filter((unit) => state.lessonIds.has(unit.id)).length;
      const details = h("details", { class: "pp-group", open: state.open.has(key) },
        h("summary", {}, h("span", { class: "pp-swatch", style: `background:${system.color}` }), h("span", {}, system.ja),
          h("span", { class: "muted" }, picked ? `${picked} / ${list.length}` : `${list.length}レッスン`)),
        ...list.map((unit) => choiceRow(unit.title, "", state.lessonIds.has(unit.id), true, () => toggle(unit), `${unit.terms.filter((term) => inCourse(term.id)).length}語`)));
      details.addEventListener("toggle", () => (details.open ? state.open.add(key) : state.open.delete(key)));
      return details;
    })), state.lessonIds.size ? h("button", { class: "ghost-button pp-clear", type: "button", onClick: () => {
      state.lessonIds.clear();
      render();
    } }, "選んだレッスンをすべて外す") : "");
  };

  /** 1枚目の見本（紙の幅を欄の幅に縮める） */
  const fit = () => {
    const sheet = preview.firstElementChild as HTMLElement | null;
    if (!sheet || !sheet.classList.contains("pp-page")) {
      preview.style.height = "";
      return;
    }
    const scale = Math.min(1, preview.clientWidth / sheet.offsetWidth);
    sheet.style.transform = `scale(${scale})`;
    preview.style.height = `${Math.min(sheet.offsetHeight * scale, 640)}px`;
  };
  const showPreview = () => {
    prepare(pages, Boolean(size));
    const first = size ? pages()[0] : undefined;
    preview.replaceChildren(first ?? h("p", { class: "muted pp-empty" }, "選ぶと、ここに1枚目の見本が出ます"));
    preview.classList.toggle("is-empty", !first);
    fit();
    for (const img of preview.querySelectorAll("img")) img.addEventListener("load", fit, { once: true });
  };
  /** アドレスに書いた紙だけを出す画面（#/print/go?…。Safari で開く） */
  function goScreen() {
    const params = new URLSearchParams(location.hash.split("?").slice(1).join("?"));
    const kind = (["plates", "test", "list"] as Kind[]).find((value) => value === params.get("k")) ?? "plates";
    const answers = params.get("a") !== "0";
    let list: () => HTMLElement[] = () => [];
    let label = "";
    if (kind === "plates") {
      state.plateIds = new Set((params.get("p") ?? "").split(",").filter((id) => plateById.has(id)));
      const hide = HIDE_VALUES.find((value) => value === params.get("h")) ?? "all";
      const plates = plateList();
      list = () => [...plates.flatMap((plate) => platePages(plate, hide, params.get("pt") === "1")), ...(answers && hide !== "none" && plates.length ? [plateAnswers(plates)] : [])];
      label = plates.length ? `図 ${plates.length}枚${answers && hide !== "none" ? "＋答え" : ""}` : "";
    } else {
      const items = (params.get("t") ?? "").split(",").map((id) => termById.get(id)).filter((term): term is Term => Boolean(term));
      const title = params.get("title") || (kind === "test" ? "語のテスト" : "語の一覧");
      let memos: Record<string, string> = {};
      try {
        memos = JSON.parse(params.get("m") ?? "{}") as Record<string, string>;
      } catch {
        memos = {};
      }
      const ask: WordAsk = params.get("ask") === "ja" ? "ja" : "en";
      list = () => kind === "test"
        ? [wordTest(title, items, ask, false), ...(answers ? [wordTest(title, items, ask, true)] : [])]
        : [wordList(title, items, { memo: (id) => String(memos[id] ?? ""), note: params.get("n") === "1" })];
      label = items.length ? `${items.length}語${kind === "test" && answers ? "＋答え" : ""}` : "";
    }
    pages = list;
    size = label;
    ctx.panel.replaceChildren(h("div", { class: "home print-screen" },
      h("div", { class: "tab-head" }, h("h2", {}, "印刷する")),
      h("p", { class: "muted" }, label ? "アプリで選んだ紙です。下のボタンで印刷するか、印刷の画面で PDF に保存します。" : "印刷するものが見つかりませんでした。アプリの「印刷する」で選び直してください。"),
      h("div", { class: "set-groups" }, h("section", { class: "set-group" },
        h("h3", { class: "set-title" }, "見本（1枚目）"),
        preview,
        ...printControls(list, label),
        foot("印刷の画面で、プリンタを選ぶか「PDFとして保存」を選びます（iPhone・iPad は印刷の画面の共有 →「ファイルに保存」で PDF に）。用紙は A4 縦、倍率は100%で。"),
        h("a", { class: "ghost-button pp-clear", href: "#/print" }, "選び直す")))));
    showPreview();
  }

  const observer = new ResizeObserver(fit);
  observer.observe(preview);
  ctx.signal.addEventListener("abort", () => observer.disconnect(), { once: true });

  if (arg.startsWith("go?")) goScreen();
  else render();
}

function shuffled<T>(list: T[]): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
