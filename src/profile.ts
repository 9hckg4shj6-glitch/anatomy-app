import { db, nowIso } from "./db";

/**
 * 名前と所属（スタート画面で入れる。docs/普段使い.md「スタート画面」）。端末の中（db.settings の profile）に置き、
 * 管理者のデータ収集のため、基礎医学演習アプリの Supabase（019_anatomy_profiles.sql）へ送る。学習の記録は送らない。
 * 送れなかったとき（オフラインなど）は、次に開いたときにもう一度送る。
 */
export interface Profile {
  name: string;
  university: string;
  faculty: string;
  grade: string;
}

interface StoredProfile extends Profile {
  /** 最後に直した日時 */
  savedAt: string;
  /** 最後にサーバーへ送れた版（savedAt と同じなら送り済み） */
  sentAt?: string;
}

const PROFILE = "profile";
const DEVICE = "deviceId";
const SEEN_DAY = "profileSeenDay";
export const NAME_MAX = 24;

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/** 制御文字を除いて前後の空白を取り、長さをそろえる */
export function cleanText(raw: string, max: number): string {
  // eslint-disable-next-line no-control-regex
  return raw.replace(/[\x00-\x1f\x7f]/g, "").trim().slice(0, max);
}

export async function loadProfile(): Promise<StoredProfile | null> {
  const value = (await db.settings.get(PROFILE))?.value as StoredProfile | undefined;
  const profile = value && typeof value === "object" && typeof value.name === "string" ? value : null;
  examOpen = examAllowedFor(profile?.name);
  return profile;
}

/**
 * 骨学試験を見せる名前（一旦、名前に「シマエナガ」を含む人だけ。2026-11-19）。
 * 半角カナ・ひらがなでも同じに数える。ほかの人には学ぶ・今日・記録・設定・復習・語のカード・使い方の骨学試験を出さず、#/exam も開けない
 */
const EXAM_NAME = "シマエナガ";
let examOpen = false;

export function examAllowedFor(name: string | undefined): boolean {
  if (!name) return false;
  const katakana = name.normalize("NFKC").replace(/[\u3041-\u3096]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60));
  return katakana.includes(EXAM_NAME);
}

/** 今の名前で骨学試験を使えるか（起動したときと名前を直したときに loadProfile で決まる） */
export const canUseExam = (): boolean => examOpen;

/** 名前と所属がそろっているか（スタート画面を出すかどうか） */
export function profileComplete(profile: Partial<Profile> | null): profile is Profile {
  return !!(profile?.name && profile.university && profile.faculty && profile.grade);
}

/**
 * はじめにの3語（#/learn/<TRIAL_LESSON>/try）を、名前を入れる前に始めたことを残す db.settings のキー。
 * 3語を学んだあとも「はじめての人」として、名前・所属のあとに目的と覚える量を聞く（今まで使っていた人とは分ける）
 */
export const START_TRIAL_KEY = "startTrial";
/** はじめにの3語のレッスン（初心者コースの「脚の骨」。大腿骨・膝蓋骨・脛骨は正面から見えて、3Dをタップして答えられる） */
export const TRIAL_LESSON = "b-skel-leg";

/**
 * スタート画面（#/start）を出すか。名前と所属がまだか、はじめての人（何も学んでいないか、はじめにの3語だけ）がまだコースを選んでいないとき。
 * docs/普段使い.md「はじめての人の使いにくさの見直し」
 */
export function needsStart(profile: Partial<Profile> | null, learnedCount: number, trialStarted: boolean, course: string): boolean {
  return !profileComplete(profile) || (!course && (!learnedCount || trialStarted));
}

/** 保存して、そろっていれば送る（送るのは待たない） */
export async function saveProfile(next: Partial<Profile>): Promise<void> {
  const before = await loadProfile();
  const merged: StoredProfile = {
    name: "", university: "", faculty: "", grade: "", ...before,
    ...Object.fromEntries(Object.entries(next).map(([k, v]) => [k, cleanText(String(v ?? ""), k === "name" ? NAME_MAX : 60)])),
    savedAt: nowIso(),
  };
  await db.settings.put({ key: PROFILE, value: merged, updatedAt: merged.savedAt });
  examOpen = examAllowedFor(merged.name);
  if (profileComplete(merged)) void sendProfile();
}

/** 端末ID（推測できない乱数。はじめて使うときに作る） */
export async function deviceId(): Promise<string> {
  const saved = (await db.settings.get(DEVICE))?.value;
  if (typeof saved === "string" && saved) return saved;
  const id = crypto.randomUUID();
  await db.settings.put({ key: DEVICE, value: id, updatedAt: nowIso() });
  return id;
}

async function rpc(name: string, body: Record<string, unknown>): Promise<boolean> {
  if (!url || !key || navigator.onLine === false) return false;
  try {
    const response = await fetch(`${url}/rest/v1/rpc/${name}`, {
      method: "POST",
      headers: { apikey: key, authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return response.ok;
  } catch {
    return false;
  }
}

let sending: Promise<void> | null = null;

/** まだ送っていない版があれば送る */
export function sendProfile(): Promise<void> {
  sending ??= (async () => {
    const profile = await loadProfile();
    if (!profileComplete(profile) || profile.sentAt === profile.savedAt) return;
    const ok = await rpc("anatomy_profile_set", {
      p_device_id: await deviceId(), p_name: profile.name, p_university: profile.university, p_faculty: profile.faculty, p_grade: profile.grade,
    });
    if (!ok) return;
    // 送っている間に直していたら、その版はまだ送っていないことにする
    const now = await loadProfile();
    if (now?.savedAt === profile.savedAt) await db.settings.put({ key: PROFILE, value: { ...now, sentAt: profile.savedAt }, updatedAt: now.savedAt });
  })().finally(() => { sending = null; });
  return sending;
}

/** 起動したとき: 送っていない所属を送り、その日にはじめて開いたことを残す（1日1回） */
export async function profileOnLaunch(today = new Date()): Promise<void> {
  const profile = await loadProfile();
  if (!profileComplete(profile)) return;
  await sendProfile();
  const day = `${today.getFullYear()}-${today.getMonth() + 1}-${today.getDate()}`;
  if ((await db.settings.get(SEEN_DAY))?.value === day) return;
  if (await rpc("anatomy_seen", { p_device_id: await deviceId() })) await db.settings.put({ key: SEEN_DAY, value: day, updatedAt: nowIso() });
}
