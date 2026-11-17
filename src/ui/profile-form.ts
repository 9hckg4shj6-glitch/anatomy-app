import { h } from "../dom";
import { cleanText, type Profile } from "../profile";
import { FACULTIES, GRADES, MED_UNIVERSITIES, OTHER_GRADE, REGIONS } from "../universities";

type Field = "university" | "faculty" | "grade";

const ICONS: Record<Field, string> = {
  university: "M3 10l9-5 9 5-9 5-9-5z M7 12.5V17c3 2 7 2 10 0v-4.5",
  faculty: "M4 6.5C6.5 5 9.5 5 12 6.5 14.5 5 17.5 5 20 6.5V19c-2.5-1.5-5.5-1.5-8 0-2.5-1.5-5.5-1.5-8 0z M12 6.5V19",
  grade: "M4 20h16 M7 17v-4 M12 17V9 M17 17V5",
};
const LABELS: Record<Field, string> = { university: "大学", faculty: "学部・学科", grade: "学年" };

const icon = (path: string) => {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
  p.setAttribute("d", path);
  svg.append(p);
  return svg;
};

/**
 * 所属の3つの欄（大学・学部学科・学年）を1枚の表に畳んだもの。行を押すと下から一覧（シート）が出て、選ぶと閉じる。
 * 大学は打たずに選ぶ（医学部のある大学を地方 → 都道府県ごと。一覧に無ければ名前を書く）。missing なら空の行を赤く
 */
export function profileFields(value: Partial<Profile>, onPick: (patch: Partial<Profile>) => void, signal: AbortSignal, missing = false): HTMLElement {
  const row = (field: Field) => {
    const current = value[field] ?? "";
    const bad = missing && !current;
    return h("button", {
      class: "profile-row", type: "button", "aria-haspopup": "dialog",
      onClick: () => openSheet(field, current, (picked) => onPick({ [field]: picked }), signal),
    },
      h("span", { class: "profile-icon" }, icon(ICONS[field])),
      h("span", { class: "profile-text" },
        h("span", { class: "profile-label" }, LABELS[field]),
        h("span", { class: current ? "profile-value" : bad ? "profile-value empty bad" : "profile-value empty" }, current || (bad ? "選んでください" : "未選択"))),
    );
  };
  return h("div", { class: "profile-fields" }, row("university"), row("faculty"), row("grade"));
}

/** 下から出る一覧。選ぶか、閉じるか、画面を離れると消える */
function openSheet(field: Field, current: string, pick: (value: string) => void, signal: AbortSignal): void {
  const dialog = h("dialog", { class: "sheet", "aria-label": `${LABELS[field]}を選ぶ` });
  const close = () => {
    if (dialog.open) dialog.close();
    dialog.remove();
  };
  const choose = (picked: string) => {
    close();
    pick(picked);
  };
  dialog.addEventListener("close", () => dialog.remove());
  // 一覧の外（暗い所）を押すと閉じる
  dialog.addEventListener("click", (event) => { if (event.target === dialog) close(); });
  signal.addEventListener("abort", close, { once: true });

  const head = h("div", { class: "sheet-head" },
    h("span", { class: "sheet-grip", "aria-hidden": "true" }),
    h("div", { class: "sheet-title-row" },
      h("h2", { class: "sheet-title" }, `${LABELS[field]}を選ぶ`),
      h("button", { class: "sheet-close", type: "button", onClick: close }, "閉じる")));

  const option = (label: string, sub = "") => h("button", {
    class: label === current ? "sheet-option on" : "sheet-option", type: "button", role: "option", "aria-selected": String(label === current),
    onClick: () => choose(label),
  }, h("span", { class: "sheet-option-text" }, h("span", {}, label), sub ? h("small", {}, sub) : ""), label === current ? h("span", { class: "sheet-check", "aria-hidden": "true" }, "✓") : "");

  let body: HTMLElement;
  if (field === "university") {
    const list = h("div", { class: "sheet-list", role: "listbox", "aria-label": "大学" });
    const anchors = new Map<string, HTMLElement>();
    for (const [region, prefs] of REGIONS) {
      const title = h("p", { class: "sheet-region" }, region);
      anchors.set(region, title);
      list.append(title);
      for (const pref of prefs) {
        const names = MED_UNIVERSITIES.filter(([, p]) => p === pref);
        if (!names.length) continue;
        list.append(h("p", { class: "sheet-group" }, pref), ...names.map(([name]) => option(name)));
      }
    }
    // 一覧に無い大学は名前を書く（医学部の無い大学の看護・リハビリなど）
    const known = MED_UNIVERSITIES.some(([name]) => name === current);
    const input = h("input", {
      class: "sheet-input", type: "text", maxlength: "60", placeholder: "大学名（例：〇〇大学）", value: known ? "" : current, "aria-label": "一覧に無い大学の名前",
    }) as HTMLInputElement;
    const other = h("form", {
      class: "sheet-other", hidden: !(current && !known),
      onSubmit: (event: Event) => {
        event.preventDefault();
        const name = cleanText(input.value, 60);
        if (name) choose(name);
        else input.focus();
      },
    }, input, h("button", { class: "primary", type: "submit" }, "決める"));
    list.append(
      h("button", {
        class: "sheet-option sheet-more", type: "button",
        onClick: () => { other.hidden = false; input.focus(); other.scrollIntoView({ block: "nearest" }); },
      }, "一覧に無い大学（名前を書く）"),
      other,
    );
    const jump = h("div", { class: "sheet-jump", role: "group", "aria-label": "地方へ移る" },
      ...REGIONS.map(([region]) => h("button", {
        class: "chip", type: "button",
        onClick: () => list.scrollBy({ top: anchors.get(region)!.getBoundingClientRect().top - list.getBoundingClientRect().top - 4, behavior: "smooth" }),
      }, region)));
    body = h("div", { class: "sheet-body" }, h("p", { class: "sheet-note" }, "医学部のある大学（82校）を地方ごとに並べています"), jump, list);
    // 選んである大学が見えるように
    requestAnimationFrame(() => list.querySelector<HTMLElement>(".sheet-option.on")?.scrollIntoView({ block: "center" }));
  } else if (field === "faculty") {
    body = h("div", { class: "sheet-list", role: "listbox", "aria-label": "学部・学科" }, ...FACULTIES.map(([label, sub]) => option(label, sub)));
  } else {
    const grid = h("div", { class: "sheet-grades", role: "listbox", "aria-label": "学年" }, ...GRADES.map((grade) => h("button", {
      class: grade === current ? "sheet-grade on" : "sheet-grade", type: "button", role: "option", "aria-selected": String(grade === current),
      onClick: () => choose(grade),
    }, grade)));
    body = h("div", { class: "sheet-body sheet-pad" }, grid, h("button", {
      class: current === OTHER_GRADE ? "sheet-grade wide on" : "sheet-grade wide", type: "button", onClick: () => choose(OTHER_GRADE),
    }, "その他（既卒・社会人・教員など）"));
  }
  dialog.append(head, body);
  document.body.append(dialog);
  dialog.showModal();
}
