import Dexie, { type EntityTable } from "dexie";

/**
 * 語に付く問い方。locate＝位置→名前, point＝名前→位置, ja2en＝日→英, en2ja＝英→日（聞き取り）。
 * 筋にはさらに attach＝起始・停止, nerve＝支配神経, action＝作用 が付く。孔・溝には passage＝通るもの、
 * 向きのある語（content/directions.json にある語）には relation＝向き（ほかの部位のどちら側か）、ホルモンを出す器官には hormone＝ホルモン（このホルモンを出すのは？）が付く。
 * 語根カード（termId が "root:…"）は rootMeaning＝語根→意味, rootForm＝意味→語根。
 * 語源で単語（termId が "etym:…"）は etymRead＝部品から読む（英語名→日本語名）, etymBuild＝部品で組み立てる（日本語名→部品を順に）。
 * 骨学試験（termId が "exam:…"）は cloze＝A 穴埋め, read＝B ラ→日, spell＝B 日→英・ラ, explain＝C 短文記述,
 * label＝D 番号→名前, annotate＝D 図に書き込む, orient＝D 骨と向き。
 * 整理して覚える項目は contrast＝対で覚える, order＝数と並び（並べる・選ぶ）, trace＝数と並び（3Dで押す）,
 * level＝体表の目安（目安→高さ）, landmark＝体表の目安（高さ→目安）。
 */
export type Facet =
  | "locate" | "point" | "ja2en" | "en2ja" | "attach" | "nerve" | "action" | "passage" | "relation" | "hormone" | "rootMeaning" | "rootForm" | "etymRead" | "etymBuild"
  | "cloze" | "read" | "spell" | "explain" | "label" | "annotate" | "orient"
  | "contrast" | "order" | "trace" | "level" | "landmark";

export interface StoredSchedule {
  /** `${termId}:${facet}` */
  cardId: string;
  termId: string;
  facet: Facet;
  due: string;
  stability: number;
  difficulty: number;
  elapsedDays: number;
  scheduledDays: number;
  learningSteps: number;
  reps: number;
  lapses: number;
  state: number;
  lastReview: string | null;
  updatedAt: string;
}

export interface ReviewEvent {
  id: string;
  cardId: string;
  termId: string;
  facet: Facet;
  rating: number;
  reviewedAt: string;
  durationMs: number | null;
  /** その問い方を初めて解いた回か（1日の新規上限を数えるのに使う） */
  isNew: boolean;
  /** レッスンの確認テストか、復習か、範囲を選んだ演習か。新規上限は復習の分だけを数える。 */
  source: "lesson" | "review" | "practice";
}

/** レッスンで一度見た語。復習（演習）にはここにある語だけが出る。 */
export interface LearnedTerm {
  termId: string;
  unitId: string;
  learnedAt: string;
}

export interface SettingRecord {
  key: string;
  value: unknown;
  updatedAt: string;
}

/** 端末をまたいで同期する表（src/sync.ts） */
export const SYNCED_TABLES = ["schedules", "reviewEvents", "learned", "settings"] as const;
export type SyncedTable = (typeof SYNCED_TABLES)[number];

/**
 * まだ送っていない変更（Google でログインしたことのある端末だけ記録する。src/sync.ts）。
 * 同じ行は最後に変えた日時だけを残し、送るときにその時の行を読む（消した行は消したことを送る）
 */
export interface OutboxEntry {
  /** `${表}\t${行のキー}` */
  key: string;
  table: SyncedTable;
  id: string;
  /** サーバーでまとめる束（src/sync.ts の bucketOf） */
  bucket: string;
  changedAt: string;
}

export class AnatomyDatabase extends Dexie {
  schedules!: EntityTable<StoredSchedule, "cardId">;
  reviewEvents!: EntityTable<ReviewEvent, "id">;
  learned!: EntityTable<LearnedTerm, "termId">;
  settings!: EntityTable<SettingRecord, "key">;
  outbox!: EntityTable<OutboxEntry, "key">;

  constructor() {
    super("anatomy-study-v1");
    this.version(1).stores({
      schedules: "&cardId, termId, due, state",
      reviewEvents: "&id, cardId, termId, reviewedAt",
      learned: "&termId, unitId, learnedAt",
      settings: "&key",
    });
    this.version(2).stores({ outbox: "&key, bucket" });
  }
}

export const db = new AnatomyDatabase();

/**
 * アプリが自分で入れた初めの値（モードの初め・問い方を確かめた印など）の日時。ほかの端末で選んだ値に負けるように古くする
 * （設定は行の updatedAt で新しい方を決めるので。src/settings.ts の loadPreferences）
 */
export const DEFAULT_STAMP = "2000-01-01T00:00:00.000Z";

/**
 * 端末ごとの設定（同期しない・記録の書き出しにも入れない）: 端末ID・その日に開いたこと・「ホーム画面に追加」の案内・同期の状態（sync.…）
 */
const DEVICE_SETTINGS = new Set(["deviceId", "profileSeenDay", "installHintClosed", "installGuideSkipped"]);
export const isDeviceSetting = (key: string): boolean => DEVICE_SETTINGS.has(key) || key.startsWith("sync.");

/** FNV-1a（端末によらず同じ値。束を決める） */
function hash(text: string): number {
  let value = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) value = Math.imul(value ^ text.charCodeAt(i), 0x01000193);
  return value >>> 0;
}

/**
 * 行をサーバーのどの束に入れるか。解いた記録はその日（UTC）ごと、ほかはキーを散らす（数は変えない。変えると同じ行が2つの束に入る）。
 * 解いた記録の行が無ければ（消したあとで日が分からない）null
 */
export function bucketOf(table: SyncedTable, id: string, row?: unknown): string | null {
  if (table === "reviewEvents") {
    const at = (row as Partial<ReviewEvent> | undefined)?.reviewedAt;
    return typeof at === "string" && /^\d{4}-\d{2}-\d{2}T/.test(at) ? `e:${at.slice(0, 10)}` : null;
  }
  if (table === "schedules") return `s:${hash(id) % 64}`;
  if (table === "learned") return `l:${hash(id) % 16}`;
  return `c:${hash(id) % 8}`;
}

/** 変更を記録するか（Google でログインしたことのある端末だけ。src/sync.ts が起動したときに決める） */
let logging = false;
/** 同期で受けた変更を書くトランザクション（送り返さない） */
const quiet = new WeakSet<object>();
let onLogged: (() => void) | null = null;

export function setChangeLog(on: boolean, listener: (() => void) | null = null): void {
  logging = on;
  onLogged = listener;
}

/** このトランザクションで書いたものは、まだ送っていない変更にしない（同期で受けたものを書くとき・端末の記録を消すとき） */
export function quietTransaction(tx: { idbtrans: object }): void {
  quiet.add(tx.idbtrans);
}

const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const isSynced = (name: string): name is SyncedTable => (SYNCED_TABLES as readonly string[]).includes(name);

// 4つの表への書き込みを、まだ送っていない変更（outbox）に残す。どこで書いても漏れないように Dexie の一番下で受ける。
// outbox へは別のトランザクションで書く（書いている途中のトランザクションに outbox は入っていないので）
db.use({
  stack: "dbcore",
  name: "sync-outbox",
  create(down) {
    return {
      ...down,
      table(name) {
        const table = down.table(name);
        if (!isSynced(name)) return table;
        const keyPath = String(table.schema.primaryKey.keyPath);
        return {
          ...table,
          async mutate(req) {
            if (!logging || quiet.has(req.trans)) return table.mutate(req);
            // 解いた記録を消すときは、どの日の束かを消す前に読む
            const before = req.type === "delete" && name === "reviewEvents" ? await table.getMany({ trans: req.trans, keys: req.keys }) : null;
            const result = await table.mutate(req);
            let rows: { id: string; row: unknown }[] = [];
            if (req.type === "add" || req.type === "put") rows = req.values.map((row: Record<string, unknown>) => ({ id: String(row[keyPath]), row }));
            else if (req.type === "delete") rows = req.keys.map((key, i) => ({ id: String(key), row: before?.[i] }));
            const at = nowIso();
            const entries: OutboxEntry[] = [];
            rows.forEach(({ id, row }, i) => {
              if (result.failures[i] || (name === "settings" && isDeviceSetting(id))) return;
              const bucket = bucketOf(name, id, row);
              // 設定は行の updatedAt（アプリが入れた初めの値は古い日時なので、ほかの端末で選んだ値に負ける）
              const stamp = name === "settings" && req.type !== "delete" ? (row as Partial<SettingRecord> | undefined)?.updatedAt : undefined;
              const changedAt = typeof stamp === "string" && ISO_TIME.test(stamp) ? stamp : at;
              if (bucket) entries.push({ key: `${name}\t${id}`, table: name, id, bucket, changedAt });
            });
            if (entries.length) {
              void Dexie.ignoreTransaction(() => db.outbox.bulkPut(entries)).then(() => onLogged?.(), (error) => console.warn("outbox", error));
            }
            return result;
          },
        };
      },
    };
  },
});

export function nowIso(): string {
  return new Date().toISOString();
}

/**
 * レッスンで学んだ語（語根・骨学試験の項目も）を記録する。前に学んだものは、初めに学んだ日時のまま残す
 * （学び直しても「今日学んだ語」＝仕上げ（src/ui/review.ts）に移さない。docs/普段使い.md「はじめての人の使いにくさの見直し」）
 */
export async function markLearned(items: { termId: string; unitId: string }[], learnedAt = nowIso()): Promise<void> {
  const before = await db.learned.bulkGet(items.map((item) => item.termId));
  await db.learned.bulkPut(items.map((item, i) => ({ termId: item.termId, unitId: item.unitId, learnedAt: before[i]?.learnedAt ?? learnedAt })));
}
