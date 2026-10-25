type Child = Node | string | number | null | undefined | false;
type Props = Record<string, unknown>;

/** 小さな DOM 組み立て。on〜 はイベント、class は className、それ以外は属性（文字列以外はプロパティ）。 */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false) continue;
    if (key.startsWith("on") && typeof value === "function") element.addEventListener(key.slice(2).toLowerCase(), value as EventListener);
    else if (key === "class") element.className = String(value);
    else if (typeof value !== "string" && key in element) (element as unknown as Props)[key] = value;
    else element.setAttribute(key, value === true ? "" : String(value));
  }
  element.append(...children.filter((child): child is Node | string | number => child != null && child !== false).map((child) => (typeof child === "number" ? String(child) : child)));
  return element;
}

/** 画面を離れたら（signal が abort されたら）待ちをやめる */
export function until<T>(signal: AbortSignal, register: (resolve: (value: T) => void) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    register(resolve);
  });
}
