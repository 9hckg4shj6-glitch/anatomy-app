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
import { makePdf, mmToPx, paginate, pdfName, sharePdf } from "./print-pdf";
import { card, choiceRow, foot, group, row, segmented, toggleRow } from "./settings-kit";

/**
 * 印刷する（#/print。docs/普段使い.md「印刷する」）。2つのページに分ける。
 * - 選ぶページ（#/print）: 作るもの（平面図のプリント・語のテスト・語の一覧）と範囲・形を選ぶ。下に留めた帯の「見本を見る」で次へ。
 * - 見本のページ（#/print/preview）: 印刷する紙を A4 に分けて全部並べ、「印刷・PDFに保存」「PDFファイルを作る」。
 * "#/print/plate/<図ID>" はその図を選んで見本のページを開く（臓器の図の「この図を印刷する」）、
 * "#/print/star" は ★を付けた語の一覧を選んで選ぶページを開く
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
  /** 語のテストの順（ばらばらの順を、見本のページへ移っても・答えを付け外ししても変えない）。key は範囲と順の決め方 */
  order: { key: "", ids: [] as string[] },
};

const KINDS: { value: Kind; label: string }[] = [
  { value: "plates", label: "平面図" },
  { value: "test", label: "語のテスト" },
  { value: "list", label: "語の一覧" },
];
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
  /** 語のテスト・語の一覧に載せる語（テストのばらばらの順は state.order に覚えておく） */
  const wordItems = (): Term[] => {
    const items = rangeTerms(state.range);
    if (state.kind !== "test") return items;
    const key = JSON.stringify([state.range, [...state.lessonIds].sort(), state.shuffle, items.map((term) => term.id)]);
    if (state.order.key !== key) state.order = { key, ids: (state.shuffle ? shuffled(items) : items).map((term) => term.id) };
    const ordered = state.order.ids.map((id) => termById.get(id)!);
    return state.count ? ordered.slice(0, state.count) : ordered;
  };

  const plateList = (): PlatePrint[] => [...state.plateIds].flatMap((id) => {
    const found = plateById.get(id);
    const entry = index?.plates[id];
    if (!found || !entry) return [];
    const spec = fullOrgan(found.organ).plates.find((plate) => plate.id === id);
    return spec ? [{ spec, entry, organ: found.organ.ja }] : [];
  });

  /**
   * 選んだことから作る紙。pages は見本・印刷・PDF で同じものを作る関数、size は「図 3枚＋答え」のような量（空なら何も選んでいない）、
   * detail は見本のページの頭に出す、選んだ形の説明
   */
  const sheets = (): { pages: () => HTMLElement[]; size: string; detail: string } => {
    if (state.kind === "plates") {
      const list = plateList();
      const hide = state.hide, points = state.points;
      const withAnswers = state.answers && hide !== "none" && list.length > 0;
      return {
        pages: () => [...list.flatMap((plate) => platePages(plate, hide, points)), ...(withAnswers ? [plateAnswers(list)] : [])],
        size: list.length ? `図 ${list.length}枚${withAnswers ? "＋答え" : ""}${points && list.some((plate) => plate.spec.points?.length) ? "・要点つき" : ""}` : "",
        detail: `平面図のプリント・${hide === "none" ? "名前を隠さない" : `${HIDES.find((item) => item.value === hide)!.label}${hide === "all" ? "の名前" : ""}を隠す`}${points ? "・要点つき" : ""}`,
      };
    }
    const items = wordItems();
    const title = `${state.kind === "test" ? "語のテスト" : "語の一覧"}・${rangeTitle()}`;
    const { kind, ask, answers, note } = state;
    return {
      pages: () => kind === "test"
        ? [wordTest(title, items, ask, false), ...(answers ? [wordTest(title, items, ask, true)] : [])]
        : [wordList(title, items, { memo: (id) => markOf(id).memo.trim(), note })],
      size: items.length ? `${items.length}語${kind === "test" && answers ? "＋答え" : ""}` : "",
      detail: kind === "test" ? `${title}・${ask === "en" ? "英語を書く" : "日本語を書く"}` : `${title}${note ? "・説明つき" : ""}`,
    };
  };

  /**
   * ホーム画面に追加した iPhone・iPad のアプリか。印刷の画面を開けず（押しても何も起きない）、開いたかどうかも見分けられないので、
   * 印刷は試さずに、アプリの中で PDF を作って共有シート（「ファイルに保存」「プリント」）に渡す
   */
  const iosApp = isStandalone() && iosDevice() !== "";

  /** ボタンの下の説明 */
  const printNote = () => iosApp
    ? "「PDFファイルを作る」で A4 の PDF にします。できたら「PDFを保存・プリントする」から、ファイルに保存するかプリンタで印刷します。"
    : "印刷の画面で、プリンタを選ぶか「PDFとして保存」を選びます（iPhone・iPad は印刷の画面の共有 →「ファイルに保存」で PDF に）。用紙は A4 縦、倍率は100%で。「PDFファイルを作る」は印刷の画面を通さずに、見本と同じ A4 の PDF を作ります。";

  /** 印刷の画面が開かなかったときの案内（パソコン・Android など） */
  const printHelp = (): HTMLElement[] =>
    [h("p", {}, "印刷の画面が開かなかったときは、ブラウザのメニューの「印刷」（パソコンは ⌘P・Ctrl+P）を選んでください。この画面の紙がそのまま印刷されます。")];

  /**
   * 「印刷・PDFに保存」のボタンと、その下の案内。紙は先に入れ物へ入れて図を読んでおき（prepare）、押したらすぐ印刷の画面を開く
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
    const status = h("span", { class: "muted" }, label);
    const help = h("div", { class: "pp-help", role: "status" });
    const printButton = iosApp ? null : h("button", { class: "primary pp-print", type: "button", onClick: async () => {
      help.replaceChildren();
      clearTimeout(mountTimer);
      const root = mounted ?? (mounted = mountPrint(list()));
      if (!imagesReady(root)) {
        printButton!.disabled = true;
        status.textContent = "図を読み込んでいます…";
        await waitImages(root);
        printButton!.disabled = false;
        status.textContent = label;
        if (ctx.signal.aborted) return;
      }
      const opened = await openPrintDialog();
      if (!opened && !ctx.signal.aborted) help.replaceChildren(...printHelp());
    } }, "印刷・PDFに保存");
    // PDF を作るのは数秒かかり、その間に押した合図が切れるので、共有シートはできてからもう一度押して開く
    const pdfButton = h("button", { class: iosApp ? "primary pp-print" : "ghost-button pp-pdf", type: "button", onClick: async () => {
      help.replaceChildren();
      pdfButton.disabled = true;
      if (printButton) printButton.disabled = true;
      try {
        const pages = list();
        const name = pdfName(pages);
        const { blob, count } = await makePdf(pages, (done, total) => (status.textContent = `PDFを作っています… ${done} / ${total}枚`));
        if (ctx.signal.aborted) return;
        const save = h("button", { class: "primary pp-print", type: "button", onClick: () => void sharePdf(blob, name) },
          iosApp ? "PDFを保存・プリントする" : "PDFを保存する");
        help.replaceChildren(
          h("p", {}, `PDFができました（${count}枚・${(blob.size / 1024 / 1024).toFixed(1)}MB）。`),
          h("div", { class: "pp-actions" }, save),
          foot(iosApp ? "共有の一覧の「ファイルに保存」で PDF を保存、「プリント」でプリンタに印刷できます。" : "保存した PDF は、PDF を開くアプリから印刷できます。"));
      } catch (error) {
        console.error(error);
        help.replaceChildren(h("p", {}, "PDFを作れませんでした。図が多いときは、選ぶ図を減らしてもう一度試してください。"), h("p", { class: "muted" }, String(error)));
      } finally {
        pdfButton.disabled = false;
        if (printButton) printButton.disabled = false;
        status.textContent = label;
      }
    } }, "PDFファイルを作る");
    return [h("div", { class: "pp-actions" }, ...(printButton ? [printButton, pdfButton] : [pdfButton]), status), help];
  };

  if (arg === "preview" || arg.startsWith("plate/")) previewScreen();
  else chooseScreen();

  /** 選ぶページ（#/print）。見本は別のページ。下に留めた帯に、選んだ量と「見本を見る」 */
  function chooseScreen() {
    const form = h("div", {});
    const footSum = h("p", { class: "pp-foot-sum" });
    const next = h("a", { class: "primary", href: "#/print/preview" }, "見本を見る");
    ctx.panel.replaceChildren(
      h("div", { class: "home print-screen" },
        h("div", { class: "tab-head" }, h("h2", {}, "印刷する")),
        h("p", { class: "muted" }, "平面図の書き込みプリントや語のテストを、A4 の紙に印刷するか PDF に保存します。答えのページも付けられます。選んだら「見本を見る」で、印刷する紙を全部たしかめてから印刷します。"),
        form),
      h("div", { class: "panel-foot pp-foot" }, footSum, next));

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
      form.replaceChildren(h("div", { class: "set-groups" }, ...sections));
      const { size } = sheets();
      footSum.textContent = size ? `${size}を印刷します` : state.kind === "plates" ? "印刷する図を選んでください" : "印刷する語の範囲を選んでください";
      next.classList.toggle("is-disabled", !size);
      next.setAttribute("aria-disabled", String(!size));
    };

    /** 平面図のプリントの欄（図を選ぶ・隠すもの・答えと要点） */
    const plateForm = (plateIndex: PlateIndex): HTMLElement[] => {
      const chosen = plateList();
      const labelsOf = (id: string) => plateIndex.plates[id]?.labels.length ?? 0;
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
          toggleRow("要点も載せる", pointsNote(chosen), state.points, (value) => {
            state.points = value;
            render();
          })),
          foot(state.hide === "all" ? "番号の欄に日本語と英語を書きます" : state.hide === "ja" ? "英語を載せて、日本語を書きます" : state.hide === "en" ? "日本語を載せて、英語を書きます" : "名前を全部載せた、見て覚える用の紙です")),
      ];
    };

    /** 「要点も載せる」の説明。選んだ図に要点の無いものがあれば、その名前も（入れても変わらないので） */
    const pointsNote = (chosen: PlatePrint[]): string => {
      const without = chosen.filter((plate) => !plate.spec.points?.length).map((plate) => plate.spec.title);
      return `臓器の図の「この図の要点」を図の下に（図は少し小さくなり、入りきらなければ次の紙に）${without.length ? `。${without.join("・")}には要点がありません` : ""}`;
    };

    /** 語のテスト・語の一覧の欄（範囲・形） */
    const wordForm = (): HTMLElement[] => {
      const counts: Record<Range, number> = { star: rangeTerms("star").length, weak: rangeTerms("weak").length, learned: rangeTerms("learned").length, lessons: 0 };
      const items = rangeTerms(state.range);
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

    render();
  }

  /**
   * 見本のページ（#/print/preview）。印刷する紙を PDF と同じ分け方で A4 に分け、全部を欄の幅に縮めて並べる。
   * 下に留めた帯に「印刷・PDFに保存」「PDFファイルを作る」
   */
  function previewScreen() {
    const { pages, size, detail } = sheets();
    const box = h("div", { class: "pp-sheets" });
    const count = h("span", {});
    const chosen = state.kind === "plates" ? plateList() : [];
    ctx.panel.replaceChildren(
      h("div", { class: "home print-screen" },
        h("div", { class: "tab-head" }, h("h2", {}, "見本と印刷")),
        h("a", { class: "ghost-button pp-back", href: "#/print" }, size ? "‹ 選び直す・形を変える" : "‹ 印刷するものを選ぶ"),
        size ? h("div", { class: "pp-summary" },
          h("p", {}, h("b", {}, detail), h("br", {}), size, count),
          chosen.length ? h("div", { class: "pp-chosen" }, ...chosen.map((plate) => h("button", {
            class: "chip on", type: "button", "aria-label": `${plate.spec.title}を外す`,
            onClick: () => {
              state.plateIds.delete(plate.spec.id);
              previewScreen();
            },
          }, `${plate.organ} › ${plate.spec.title} ×`))) : "")
          : h("p", { class: "muted" }, "印刷するものがまだ選ばれていません。"),
        box,
        size ? foot(printNote()) : ""),
      size ? h("div", { class: "panel-foot pp-foot" }, ...printControls(pages, size)) : "");
    prepare(pages, Boolean(size));
    if (!size) return;

    // PDF と同じく A4 の高さで分ける（語の表は2枚目からも見出しをくり返す）。分けるには幅をそろえて測る所が要る
    const host = h("div", { class: "pp-render", "aria-hidden": "true" });
    document.body.append(host);
    const list = pages().flatMap((page) => paginate(page, host, mmToPx(297)));
    host.remove();
    count.textContent = `・A4 ${list.length}枚`;
    const frames = list.map((sheet, i) => {
      const frame = h("div", { class: "pp-sheet-frame" }, sheet);
      box.append(h("figure", { class: "pp-sheet" }, frame, h("figcaption", {}, `${i + 1} / ${list.length}枚目`)));
      return { frame, sheet };
    });
    /** 紙の幅（210mm）を欄の幅に縮める */
    const fit = () => {
      for (const { frame, sheet } of frames) {
        const scale = Math.min(1, frame.clientWidth / sheet.offsetWidth);
        sheet.style.transform = `scale(${scale})`;
        frame.style.height = `${sheet.offsetHeight * scale}px`;
      }
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(box);
    ctx.signal.addEventListener("abort", () => observer.disconnect(), { once: true });
  }
}

function shuffled<T>(list: T[]): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
