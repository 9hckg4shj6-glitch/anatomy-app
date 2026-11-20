import {
  bucketOf, db, DEFAULT_STAMP, isDeviceSetting, nowIso, quietTransaction, setChangeLog, SYNCED_TABLES, type OutboxEntry, type SyncedTable,
} from "./db";

/**
 * 端末をまたぐ同期（docs/普段使い.md「端末をまたぐ（同期）」）。Google でログインした人の4つの表（覚え具合・解いた記録・学んだ語・設定）を、
 * 基礎医学演習アプリの Supabase の anatomy_sync（そちらの supabase/migrations/020_anatomy_sync.sql）と合わせる。
 * - 変えた行は db.ts が outbox に残す（ログインしたことのある端末だけ）。送るときはその時の行を読み、消した行は null を送る。
 * - サーバーは行を「束」（db.ts の bucketOf）にまとめ、同じ行は端末で変えた日時（c）の新しい方を残す。
 * - 受けるときは、前に受け取った番号（cursor）より後に変わった分だけ（自分の端末が送った分は除く）。
 *   まだ送っていない自分の変更の方が新しければ、受けた行は捨てて自分のを送る。
 * - 学んだ語は早い方の日時を残し、名前と所属の「送った版」（sentAt）は端末ごと（送り返さない）。
 * ログインやサーバーとのやりとりは src/account.ts。ここはサーバーを SyncServer として受け取る（テストでは手元の偽物）。
 */

/** 束の中の1行。c＝端末で変えた日時、v＝行（消したら null）、d＝送った端末、s＝サーバーが受けた順の番号 */
export interface SyncEntry {
  c: string;
  v: Record<string, unknown> | null;
  d?: string;
  s?: number;
}

export interface SyncBucket {
  bucket: string;
  entries: Record<string, SyncEntry>;
  /** 束の番号（最後に変わったときの番号） */
  seq: number;
  /** その受け取りで返す一番新しい番号（はじめのページで決まる） */
  head: number;
}

/**
 * 受け取りの1ページ: 束の番号が after より後の束を、番号の順に limit 束。中身は since より後で until（無ければ今の head）までに入った分
 * （device の端末が送った分は除く）
 */
export interface PullRequest {
  after: number;
  since: number;
  until: number | null;
  device: string;
  limit: number;
}

export interface SyncServer {
  push(buckets: Record<string, Record<string, SyncEntry>>): Promise<void>;
  pull(request: PullRequest): Promise<SyncBucket[]>;
}

/** この端末の記録の持ち主（最後にログインして結びつけたアカウント） */
export interface SyncOwner {
  id: string;
  email: string;
}

const OWNER = "sync.owner";
const DEVICE = "sync.device";
const CURSOR = "sync.cursor";
const LAST = "sync.lastAt";

const KEY_FIELD: Record<SyncedTable, string> = { schedules: "cardId", reviewEvents: "id", learned: "termId", settings: "key" };
const TABLE_OF: Record<string, SyncedTable> = { s: "schedules", e: "reviewEvents", l: "learned", c: "settings" };
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
/** 日時の分からない行（古い版の記録など）は、ほかの端末の行に負けるように古い日時にする */
const LONG_AGO = DEFAULT_STAMP;
/** 1回に送る行と束の数（サーバーは1回に500束・2MBまで） */
const PUSH_ROWS = 800;
const PUSH_BUCKETS = 400;

let listener: (() => void) | null = null;

const setting = async (key: string): Promise<unknown> => (await db.settings.get(key))?.value;
const putSetting = (key: string, value: unknown) => db.settings.put({ key, value, updatedAt: nowIso() });

export async function syncOwner(): Promise<SyncOwner | null> {
  const value = (await setting(OWNER)) as Partial<SyncOwner> | undefined;
  return value && typeof value.id === "string" ? { id: value.id, email: String(value.email ?? "") } : null;
}

/** 最後に同期し終えた日時（まだなら空） */
export async function lastSyncedAt(): Promise<string> {
  const value = await setting(LAST);
  return typeof value === "string" ? value : "";
}

export const pendingCount = (): Promise<number> => db.outbox.count();

/** 変えた行を残すたびに呼ぶ（account.ts が送る時を決める） */
export function onOutboxChange(fn: (() => void) | null): void {
  listener = fn;
  setChangeLog(logOn, fn);
}

let logOn = false;

/** 起動したとき: 前にログインしたことがあれば、変えた行を残し始める（ログアウトしていても、次にログインしたときに送るため） */
export async function resumeChangeLog(): Promise<SyncOwner | null> {
  const owner = await syncOwner();
  logOn = !!owner;
  setChangeLog(logOn, listener);
  return owner;
}

/**
 * はじめてログインした端末を、そのアカウントに結びつける。今ある記録をすべて「まだ送っていない変更」にして、
 * 日時は行の日時（覚え具合と設定は最後に変えた日時、解いた記録は解いた日時、学んだ語は学んだ日時）にする
 * （アカウントにある同じ行と、内容の新しい方が残るように。解いた記録は両方が残る）
 */
export async function bindOwner(owner: SyncOwner): Promise<void> {
  await db.transaction("rw", [db.schedules, db.reviewEvents, db.learned, db.settings, db.outbox], async () => {
    const [schedules, events, learned, settings] = await Promise.all([
      db.schedules.toArray(), db.reviewEvents.toArray(), db.learned.toArray(), db.settings.toArray(),
    ]);
    const stamp = (value: unknown) => (typeof value === "string" && ISO.test(value) ? value : LONG_AGO);
    const entries: OutboxEntry[] = [];
    const add = (table: SyncedTable, id: string, row: unknown, at: unknown) => {
      const bucket = bucketOf(table, id, row);
      if (bucket) entries.push({ key: `${table}\t${id}`, table, id, bucket, changedAt: stamp(at) });
    };
    for (const row of schedules) add("schedules", row.cardId, row, row.updatedAt);
    for (const row of events) add("reviewEvents", row.id, row, row.reviewedAt);
    for (const row of learned) add("learned", row.termId, row, row.learnedAt);
    for (const row of settings) if (!isDeviceSetting(row.key)) add("settings", row.key, row, row.updatedAt);
    await db.outbox.clear();
    await db.outbox.bulkPut(entries);
    const at = nowIso();
    await db.settings.bulkPut([
      { key: OWNER, value: owner, updatedAt: at },
      // 送った端末の印（束の1行ごとに入るので短く。同じ人の端末どうしで重ならなければよい）
      { key: DEVICE, value: crypto.randomUUID().replace(/-/g, "").slice(0, 12), updatedAt: at },
      { key: CURSOR, value: 0, updatedAt: at },
      { key: LAST, value: "", updatedAt: at },
    ]);
  });
  logOn = true;
  setChangeLog(true, listener);
  listener?.();
}

/**
 * この端末の学習の記録を消す（ログアウトして消すとき・別のアカウントの記録に切り替えるとき）。
 * 端末ID など端末ごとの設定は残し、同期の状態（sync.…）は消す。アカウントに送った記録はサーバーに残る
 */
export async function eraseLocal(): Promise<void> {
  logOn = false;
  setChangeLog(false, listener);
  await db.transaction("rw", [db.schedules, db.reviewEvents, db.learned, db.settings, db.outbox], async (tx) => {
    quietTransaction(tx);
    const keep = (await db.settings.toArray()).filter((row) => isDeviceSetting(row.key) && !row.key.startsWith("sync."));
    await Promise.all([db.schedules.clear(), db.reviewEvents.clear(), db.learned.clear(), db.settings.clear(), db.outbox.clear()]);
    await db.settings.bulkPut(keep);
  });
}

/** 1回の同期: 受けてから送る。受けて変わった表を返す */
export async function syncOnce(server: SyncServer): Promise<{ pulled: Set<SyncedTable>; pushed: number }> {
  const device = String((await setting(DEVICE)) ?? "");
  if (!device) throw new Error("この端末はまだアカウントに結びついていません");
  const pulled = await pullChanges(server, device);
  const pushed = await pushChanges(server, device);
  await putSetting(LAST, nowIso());
  return { pulled, pushed };
}

/**
 * 前回までに受け取った番号（cursor）より後に入った分を、ページに分けて受ける。1回の受け取りは、はじめのページで決まる head までの分
 * （ページの間に束が新しくなっても古い分を取りこぼさない）。終わったら cursor を head にする（途中でやめたら次は同じ所から受け直す）
 */
export async function pullChanges(server: SyncServer, device: string, limit = 20): Promise<Set<SyncedTable>> {
  const changed = new Set<SyncedTable>();
  const since = Number((await setting(CURSOR)) ?? 0) || 0;
  let after = since;
  let head: number | null = null;
  for (let page = 0; page < 1000; page++) {
    const buckets = await server.pull({ after, since, until: head, device, limit });
    if (!buckets.length) break;
    head ??= buckets[0].head;
    for (const table of await applyBuckets(buckets)) changed.add(table);
    after = Math.max(after, ...buckets.map((bucket) => bucket.seq));
    // サーバーが1ページを limit より小さく区切ることもあるので、空のページが来るまで続ける
  }
  if (head !== null && head > since) await putSetting(CURSOR, head);
  return changed;
}

/**
 * 送るための行。キー（束の中のキーと同じ）と、解いた記録の cardId（termId:facet）は送らない（サーバーの容量を抑える。受けたら toRow が戻す）。
 * 名前と所属の「送った版」は端末ごとなので外す
 */
function payload(table: SyncedTable, id: string, row: unknown): Record<string, unknown> | null {
  if (!row || typeof row !== "object") return null;
  const record: Record<string, unknown> = { ...(row as Record<string, unknown>) };
  delete record[KEY_FIELD[table]];
  if (table === "reviewEvents" && record.cardId === `${record.termId}:${record.facet}`) delete record.cardId;
  if (table === "settings" && id === "profile" && record.value && typeof record.value === "object") {
    const { sentAt: _sentAt, ...value } = record.value as Record<string, unknown>;
    record.value = value;
  }
  return record;
}

export async function pushChanges(server: SyncServer, device: string): Promise<number> {
  let pushed = 0;
  for (let round = 0; round < 500; round++) {
    const queued = await db.outbox.orderBy("bucket").limit(PUSH_ROWS).toArray();
    if (!queued.length) break;
    // 束が多すぎる（何百日分の解いた記録など）ときは、束の数で区切る
    const names = new Set<string>();
    const batch = queued.filter((entry) => {
      if (!names.has(entry.bucket) && names.size >= PUSH_BUCKETS) return false;
      names.add(entry.bucket);
      return true;
    });
    const rows = new Map<string, unknown>();
    for (const table of SYNCED_TABLES) {
      const ids = batch.filter((entry) => entry.table === table).map((entry) => entry.id);
      if (!ids.length) continue;
      const found = await db.table(table).bulkGet(ids);
      ids.forEach((id, i) => rows.set(`${table}\t${id}`, found[i]));
    }
    const buckets: Record<string, Record<string, SyncEntry>> = {};
    for (const entry of batch) {
      (buckets[entry.bucket] ??= {})[entry.id] = { c: entry.changedAt, v: payload(entry.table, entry.id, rows.get(entry.key)), d: device };
    }
    await server.push(buckets);
    // 送っている間にまた変えた行は、次に送る
    await db.transaction("rw", db.outbox, async () => {
      const now = await db.outbox.bulkGet(batch.map((entry) => entry.key));
      await db.outbox.bulkDelete(batch.filter((entry, i) => now[i]?.changedAt === entry.changedAt && now[i]?.bucket === entry.bucket).map((entry) => entry.key));
    });
    pushed += batch.length;
    if (queued.length < PUSH_ROWS && batch.length === queued.length) break;
  }
  return pushed;
}

/** キーの順によらない文字列（同じ行かを比べる。サーバーの jsonb はキーの順を変える） */
function stable(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) =>
    item && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : item);
}

/** 受けた行の形を確かめ、キーを入れる（形の違う行は受けない） */
function toRow(table: SyncedTable, id: string, value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = { ...(value as Record<string, unknown>), [KEY_FIELD[table]]: id };
  if (table === "reviewEvents" && row.cardId === undefined) row.cardId = `${row.termId}:${row.facet}`;
  const ok = table === "schedules" ? typeof row.termId === "string" && typeof row.facet === "string" && typeof row.due === "string"
    : table === "reviewEvents" ? typeof row.cardId === "string" && typeof row.reviewedAt === "string"
      : table === "learned" ? typeof row.learnedAt === "string"
        : "value" in row;
  return ok ? row : null;
}

/** 受けた行と端末の行を合わせる。pushBack は合わせた行をアカウントへ送り返すか */
function mergeRow(table: SyncedTable, id: string, local: Record<string, unknown> | undefined, remote: Record<string, unknown>): { row: Record<string, unknown>; pushBack: boolean } {
  // 学んだ語は早い方の日時（2つの端末で別々に学んでいたとき）
  if (table === "learned" && local && typeof local.learnedAt === "string" && local.learnedAt < String(remote.learnedAt)) {
    return { row: { ...remote, learnedAt: local.learnedAt }, pushBack: true };
  }
  // 名前と所属は、同じ版をこの端末から送ってあれば「送った版」を残す（無ければ次に開いたときにこの端末の分として送る。src/profile.ts）
  if (table === "settings" && id === "profile" && remote.value && typeof remote.value === "object") {
    const { sentAt: _sentAt, ...value } = remote.value as Record<string, unknown>;
    const mine = local?.value as Record<string, unknown> | undefined;
    if (mine?.sentAt && mine.savedAt === value.savedAt) value.sentAt = mine.sentAt;
    return { row: { ...remote, value }, pushBack: false };
  }
  return { row: remote, pushBack: false };
}

async function applyBuckets(buckets: SyncBucket[]): Promise<Set<SyncedTable>> {
  const byTable = new Map<SyncedTable, Map<string, SyncEntry>>();
  for (const { bucket, entries } of buckets) {
    const table = TABLE_OF[bucket.slice(0, 1)];
    if (!table || !entries || typeof entries !== "object") continue;
    const rows = byTable.get(table) ?? new Map<string, SyncEntry>();
    byTable.set(table, rows);
    for (const [id, entry] of Object.entries(entries)) {
      if (!entry || typeof entry.c !== "string" || (table === "settings" && isDeviceSetting(id))) continue;
      const before = rows.get(id);
      if (!before || entry.c > before.c) rows.set(id, entry);
    }
  }
  const changed = new Set<SyncedTable>();
  await db.transaction("rw", [db.schedules, db.reviewEvents, db.learned, db.settings, db.outbox], async (tx) => {
    quietTransaction(tx);
    for (const [table, rows] of byTable) {
      const ids = [...rows.keys()];
      const store = db.table(table);
      const [mine, locals] = await Promise.all([db.outbox.bulkGet(ids.map((id) => `${table}\t${id}`)), store.bulkGet(ids)]);
      const puts: Record<string, unknown>[] = [];
      const deletes: string[] = [];
      const done: string[] = [];
      const again: OutboxEntry[] = [];
      ids.forEach((id, i) => {
        const entry = rows.get(id)!;
        const queued = mine[i];
        // まだ送っていない自分の変更の方が新しい
        if (queued && queued.changedAt > entry.c) return;
        if (queued) done.push(queued.key);
        const local = locals[i] as Record<string, unknown> | undefined;
        if (entry.v === null) {
          if (local) deletes.push(id);
          return;
        }
        const remote = toRow(table, id, entry.v);
        if (!remote) return;
        const { row, pushBack } = mergeRow(table, id, local, remote);
        if (!local || stable(local) !== stable(row)) puts.push(row);
        const bucket = pushBack ? bucketOf(table, id, row) : null;
        if (bucket) again.push({ key: `${table}\t${id}`, table, id, bucket, changedAt: nowIso() });
      });
      if (puts.length) await store.bulkPut(puts);
      if (deletes.length) await store.bulkDelete(deletes);
      if (done.length) await db.outbox.bulkDelete(done);
      if (again.length) await db.outbox.bulkPut(again);
      if (puts.length || deletes.length) changed.add(table);
    }
  });
  return changed;
}
