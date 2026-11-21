/**
 * 肺循環と体循環の「1滴を追う」（docs/動きの図鑑.md「品質の見直し」）。光る粒1つが、右心房 → 右心室 → 肺動脈 → 肺 → 肺静脈 →
 * 左心房 → 左心室 → 大動脈 → 臓器 → 静脈 → 右心房と1周する道順と、字幕に出す「駅」（いくつかの道をまとめた名前）
 */

/** 行き先（体循環で通る臓器の毛細血管） */
export const DESTINATIONS = [
  { id: "head-c", ja: "脳" },
  { id: "r-arm-c", ja: "腕" },
  { id: "gut-c", ja: "腸と肝臓" },
  { id: "r-kidney-c", ja: "腎臓" },
  { id: "l-leg-c", ja: "脚" },
] as const;

/** a から b への一番短い道順（a と b を含む）。next は道・たまりの行き先 */
export function shortestRoute(next: (id: string) => string[], a: string, b: string): string[] | null {
  const back = new Map<string, string | null>([[a, null]]);
  const queue = [a];
  while (queue.length) {
    const id = queue.shift()!;
    if (id === b) {
      const route: string[] = [];
      for (let at: string | null = b; at !== null; at = back.get(at) ?? null) route.unshift(at);
      return route;
    }
    for (const to of next(id)) {
      if (back.has(to)) continue;
      back.set(to, id);
      queue.push(to);
    }
  }
  return null;
}

/** stops を順に通って1周する道順（最後の stop は初めと同じ。返す道順に最後は入れない） */
export function loopRoute(next: (id: string) => string[], stops: string[]): string[] {
  const route: string[] = [];
  for (let i = 0; i + 1 < stops.length; i++) {
    const part = shortestRoute(next, stops[i], stops[i + 1]);
    if (!part) throw new Error(`道が見つからない: ${stops[i]} → ${stops[i + 1]}`);
    route.push(...part.slice(0, -1));
  }
  return route;
}

export interface Station {
  key: string;
  /** 帯に出す短い名前 */
  label: string;
  title: string;
  note: string;
  circuit: "systemic" | "pulmonary";
}

const S = (label: string, title: string, note: string, circuit: Station["circuit"] = "systemic") => ({ label, title, note, circuit });

/** 駅の名前と一言 */
export const STATIONS: Record<string, Omit<Station, "key">> = {
  ra: S("右心房", "右心房", "全身から戻った静脈血がたまる。三尖弁が開くと右心室へ。"),
  rv: S("右心室", "右心室（肺循環の始まり）", "三尖弁から入り、心室が縮むと肺動脈弁を通って肺動脈へ押し出される。", "pulmonary"),
  pa: S("肺動脈", "肺動脈", "静脈血を肺へ運ぶ（動脈なのに静脈血が流れる）。", "pulmonary"),
  lungc: S("肺", "肺の毛細血管", "肺胞のまわりで二酸化炭素を出し、酸素を受け取る → 動脈血になる。", "pulmonary"),
  pv: S("肺静脈", "肺静脈", "動脈血を左心房へ運ぶ（静脈なのに動脈血が流れる）。", "pulmonary"),
  la: S("左心房", "左心房（肺循環の終わり）", "肺から戻った動脈血がたまる。僧帽弁が開くと左心室へ。", "pulmonary"),
  lv: S("左心室", "左心室（体循環の始まり）", "僧帽弁から入り、心室が縮むと大動脈弁を通って大動脈へ押し出される。"),
  ao: S("大動脈", "大動脈", "動脈血を全身へ送る。心室が縮むたびに速くなる（拍動）。"),
  "head-a": S("頸動脈", "総頸動脈", "大動脈弓から分かれて頭へ。"),
  "head-c": S("脳", "脳の毛細血管", "脳に酸素と栄養を渡し、二酸化炭素を受け取る → 静脈血になる。"),
  "head-v": S("頸静脈", "内頸静脈", "頭の静脈血を上大静脈へ戻す。"),
  "arm-a": S("腕の動脈", "鎖骨下動脈 → 腋窩動脈 → 上腕動脈", "大動脈弓の枝から腕へ。"),
  "arm-c": S("腕", "腕の毛細血管", "腕の筋や皮膚に酸素を渡し、二酸化炭素を受け取る → 静脈血になる。"),
  "arm-v": S("腕の静脈", "腕の静脈 → 腕頭静脈", "腕の静脈血を上大静脈へ戻す。"),
  svc: S("上大静脈", "上大静脈", "上半身の静脈血を右心房へ戻す。"),
  "gut-a": S("腸の動脈", "上腸間膜動脈", "腹大動脈から分かれて腸へ。"),
  "gut-c": S("腸", "腸の毛細血管", "腸に酸素を渡し、吸収した栄養を受け取る → 静脈血になる。"),
  portal: S("門脈", "門脈", "腸からの栄養の多い静脈血を、心臓へ戻す前に肝臓へ運ぶ。"),
  "liver-c": S("肝臓", "肝臓の類洞（毛細血管）", "門脈と肝動脈の血液が流れ、栄養をたくわえ・解毒する。そのあと肝静脈から下大静脈へ。"),
  "renal-a": S("腎動脈", "腎動脈", "腹大動脈から分かれて腎臓へ（心拍出量の約2割）。"),
  "kidney-c": S("腎臓", "腎臓の毛細血管（糸球体など）", "糸球体で血液をこして尿のもとを作る → 静脈血になる。"),
  "renal-v": S("腎静脈", "腎静脈", "腎臓の静脈血を下大静脈へ戻す。"),
  "leg-a": S("脚の動脈", "総腸骨動脈 → 大腿動脈", "大動脈が左右に分かれて脚へ。"),
  "leg-c": S("脚", "脚の毛細血管", "脚の筋や皮膚に酸素を渡し、二酸化炭素を受け取る → 静脈血になる。"),
  "leg-v": S("脚の静脈", "大腿静脈 → 総腸骨静脈", "脚の静脈血を下大静脈へ戻す。"),
  ivc: S("下大静脈", "下大静脈", "下半身の静脈血を右心房へ戻す。"),
};

/** 道・たまりの ID → 駅 */
export function stationOf(id: string): string {
  if (id === "tv") return "rv";
  if (id === "mv") return "lv";
  if (id === "pt" || id === "rpa" || id === "lpa") return "pa";
  if (id.endsWith("-lung-c")) return "lungc";
  if (/^[rl][si]pv$/.test(id)) return "pv";
  if (id === "aorta" || id === "desc" || id.startsWith("aorta-")) return "ao";
  if (id === "bct" || id === "lsa" || /^[rl]-arm-a$/.test(id)) return "arm-a";
  if (id === "lcca") return "head-a";
  if (/^[rl]-arm-[cv]$/.test(id)) return `arm-${id.slice(-1)}`;
  if (/^[rl]-renal-[av]$/.test(id)) return `renal-${id.slice(-1)}`;
  if (/^[rl]-kidney-c$/.test(id)) return "kidney-c";
  if (/^[rl]-leg-[acv]$/.test(id)) return `leg-${id.slice(-1)}`;
  if (id.startsWith("ivc")) return "ivc";
  return id;
}

/** 道順を駅にまとめる。first は駅の初めの道順の番号 */
export function stationsOf(route: string[]): (Station & { first: number; count: number })[] {
  const out: (Station & { first: number; count: number })[] = [];
  route.forEach((id, i) => {
    const key = stationOf(id);
    const last = out[out.length - 1];
    if (last && last.key === key) last.count++;
    else out.push({ key, ...(STATIONS[key] ?? S(key, key, "")), first: i, count: 1 });
  });
  return out;
}
