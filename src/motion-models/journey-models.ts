import * as THREE from "three";
import type { Vec3 } from "../landmarks";
import { clear, curvePoints, glow, plastic, tube } from "./common";

/**
 * からだの旅（src/journeys.ts）の食べ物と痛みの信号の「わかりやすい模型」（cm。教科書の模式図を立体にした作り物）。
 * 道（segment）は管・線維の中心線で、旅をするもの（食べ物・信号）はこの線の上を進む。to は道の先（分かれ道ではいくつか）。
 * 前から見て、画面の左が体の右（x が負）
 */

export interface LineSegment {
  points: Vec3[];
  to: string[];
  /** 今通っている所の名前 */
  name: string;
  term?: string;
  color: string;
  radius: number;
  /** 管の濃さ（1 は不透明） */
  opacity?: number;
  /** 線維（光る線）として描く */
  fiber?: boolean;
}

export interface LineBlob {
  id: string;
  center: Vec3;
  /** 楕円体の半径 */
  size: Vec3;
  color: string;
  opacity: number;
}

export interface LineTag {
  text: string;
  at: Vec3;
  kind: "organ" | "vessel" | "note";
  /** 旅の所の ID（その所に着いたときに札を目立たせる） */
  stop?: string;
}

export interface LineModel {
  segments: Record<string, LineSegment>;
  blobs: LineBlob[];
  tags: LineTag[];
  /** 見る所: 名前・向き・寄り（region の部品に合わせる） */
  views: { label: string; from: Vec3; zoom: number; region?: string }[];
  /** 見る所の範囲（region → 道・かたまりの ID） */
  regions: Record<string, string[]>;
  /** 旅をするものの色 */
  traveler: string;
  /** 旅をするものの粒の大きさ（m） */
  dot: number;
}

// ---------------------------------------------------------------- 食べ物（消化管）

const GI = "#e59f8f";
const COLON = "#d69a6a";
const AIR = "#8fc1ec";

export const GUT_MODEL: LineModel = {
  traveler: "#ffcf4a",
  dot: 0.0034,
  segments: {
    mouth: { points: [[0, 29.6, 5.4], [0, 29.4, 3.6], [0, 29.0, 1.6]], to: ["pharynx"], name: "口腔", term: "oral-cavity", color: GI, radius: 0.7, opacity: 0.35 },
    pharynx: { points: [[0, 29.0, 1.6], [0, 28.5, 0.6], [0, 27.4, 0.2]], to: ["esophagus", "trachea", "nasal"], name: "咽頭", term: "pharynx", color: GI, radius: 0.8, opacity: 0.4 },
    nasal: { points: [[0, 27.4, 0.2], [0, 29.4, -0.4], [0, 31.2, 0], [0, 32.4, 1.4], [0, 32.8, 3.4]], to: [], name: "咽頭鼻部 → 鼻腔", term: "nasal-cavity", color: AIR, radius: 0.55, opacity: 0.35 },
    trachea: { points: [[0, 27.4, 0.2], [0, 26, 1.4], [0, 24, 1.8], [0, 18, 1.8], [0, 13.6, 1.6], [-2.4, 11.6, 1.4], [-5.2, 9.8, 1.0]], to: [], name: "喉頭 → 気管 → 右の主気管支", term: "trachea", color: AIR, radius: 0.55, opacity: 0.4 },
    esophagus: { points: [[0, 27.4, 0.2], [0, 25, -0.4], [0.2, 20, -0.6], [0.6, 13, -0.8], [1.4, 6, -0.6], [2.4, 1.4, -0.2]], to: ["stomach"], name: "食道", term: "esophagus", color: GI, radius: 0.55, opacity: 0.45 },
    stomach: { points: [[2.4, 1.4, -0.2], [4.2, 2.2, 0], [6.4, 0.6, 0.4], [6.8, -3, 0.8], [5.6, -6.6, 1.2], [2.8, -8.4, 1.4], [-0.2, -7.6, 1.4], [-1.6, -6, 1.2]], to: ["duodenum"], name: "胃", term: "stomach", color: "#e48b86", radius: 1.8, opacity: 0.3 },
    duodenum: { points: [[-1.6, -6, 1.2], [-3.4, -6.2, 0.6], [-4.4, -7.8, 0.2], [-4.5, -9.4, 0.1]], to: ["duodenum-2", "bile", "pancreatic-duct"], name: "十二指腸", term: "duodenum", color: GI, radius: 0.75, opacity: 0.4 },
    "duodenum-2": { points: [[-4.5, -9.4, 0.1], [-4.2, -11, 0], [-3.2, -12.4, 0], [-0.6, -12.8, 0], [1.6, -11.6, 0]], to: ["jejunum"], name: "十二指腸 → 十二指腸空腸曲", term: "duodenum", color: GI, radius: 0.75, opacity: 0.4 },
    bile: { points: [[-4.5, -9.4, 0.1], [-4.9, -7.6, -0.6], [-5.3, -5.4, -0.4], [-5.8, -4.2, 0.8], [-6.2, -3.6, 1.6]], to: [], name: "総胆管 → 胆嚢管 → 胆嚢", term: "bile-duct", color: "#5f9a4a", radius: 0.22, opacity: 0.7 },
    "pancreatic-duct": { points: [[-4.5, -9.4, 0.1], [-3, -9.6, -1.2], [0, -9.4, -1.6], [3.6, -8.8, -1.6], [6.2, -8, -1.4]], to: [], name: "膵管 → 膵臓", term: "pancreatic-duct", color: "#d9a93a", radius: 0.22, opacity: 0.7 },
    jejunum: {
      points: [[1.6, -11.6, 0], [4, -12.4, 1], [6.4, -13.4, 1.2], [4.2, -14.6, 1.4], [1.4, -14.2, 1.6], [0.2, -15.8, 1.6], [3, -16.8, 1.6], [6.2, -17, 1.4]],
      to: ["ileum"], name: "空腸", term: "jejunum", color: GI, radius: 0.6, opacity: 0.45,
    },
    ileum: {
      points: [[6.2, -17, 1.4], [3.6, -18.4, 1.6], [0.4, -18.6, 1.8], [-2.6, -17.8, 1.8], [-4, -19.6, 1.6], [-1.4, -20.8, 1.6], [1.2, -21.8, 1.4], [-1.6, -22.8, 1.2], [-4.4, -21.6, 0.8], [-5.4, -21.2, 0.6]],
      to: ["cecum"], name: "回腸", term: "ileum", color: "#e7ab92", radius: 0.6, opacity: 0.45,
    },
    cecum: { points: [[-5.4, -21.2, 0.6], [-6.2, -22.6, 0.6], [-6.6, -24, 0.6]], to: ["ascending", "appendix"], name: "回盲弁 → 盲腸", term: "cecum", color: COLON, radius: 1.15, opacity: 0.35 },
    appendix: { points: [[-6.6, -24, 0.6], [-5.8, -25.4, 0.8], [-4.6, -26, 0.8], [-3.8, -25.6, 0.8]], to: [], name: "虫垂", term: "appendix", color: COLON, radius: 0.3, opacity: 0.6 },
    ascending: { points: [[-6.6, -24, 0.6], [-7.4, -21, 0.4], [-7.8, -16, 0.2], [-7.6, -11.2, 0.2], [-6.6, -9.6, 0.6]], to: ["transverse"], name: "上行結腸", term: "ascending-colon", color: COLON, radius: 1.05, opacity: 0.32 },
    transverse: { points: [[-6.6, -9.6, 0.6], [-4, -11.4, 2.4], [0, -12, 2.8], [4, -11, 2.6], [7.4, -8.6, 1]], to: ["descending"], name: "横行結腸", term: "transverse-colon", color: COLON, radius: 1.0, opacity: 0.32 },
    descending: { points: [[7.4, -8.6, 1], [8.2, -12, 0.2], [8.4, -17, 0], [8.2, -21.6, 0]], to: ["sigmoid"], name: "下行結腸", term: "descending-colon", color: COLON, radius: 0.95, opacity: 0.32 },
    sigmoid: { points: [[8.2, -21.6, 0], [7, -24.2, 0.8], [4, -24.4, 1.2], [2.4, -23, 1], [1.2, -25, 0.4], [0.6, -26.6, 0]], to: ["rectum"], name: "S状結腸", term: "sigmoid-colon", color: COLON, radius: 0.9, opacity: 0.32 },
    rectum: { points: [[0.6, -26.6, 0], [0.2, -28.4, -1], [0, -30.4, -1], [0, -32, -0.4]], to: ["anal"], name: "直腸", term: "rectum", color: COLON, radius: 1.05, opacity: 0.35 },
    anal: { points: [[0, -32, -0.4], [0, -33.4, 0], [0, -34.6, 0.2]], to: [], name: "肛門管 → 肛門", term: "anal-canal", color: "#c98a70", radius: 0.5, opacity: 0.5 },
  },
  blobs: [
    { id: "head", center: [0, 31, 1.4], size: [5.6, 6.4, 6.6], color: "#e7c3a8", opacity: 0.07 },
    { id: "oral", center: [0, 29.5, 3.4], size: [2.4, 1.1, 2.4], color: "#e9a3a3", opacity: 0.22 },
    { id: "nose", center: [0, 32.8, 3.2], size: [1.2, 1.3, 2.4], color: "#b9d4ec", opacity: 0.22 },
    { id: "r-lung", center: [-6.6, 7.6, 0], size: [4.4, 6.6, 3.6], color: "#f2a2ac", opacity: 0.14 },
    { id: "l-lung", center: [6.6, 7.6, 0], size: [4.0, 6.4, 3.6], color: "#f2a2ac", opacity: 0.14 },
    { id: "liver", center: [-5, -2.6, 0.2], size: [6.2, 2.8, 3.4], color: "#a0584a", opacity: 0.22 },
    { id: "gallbladder", center: [-6.2, -3.6, 1.6], size: [0.9, 1.3, 0.9], color: "#6f9a4a", opacity: 0.4 },
    { id: "pancreas", center: [1.6, -9.2, -1.6], size: [5.4, 1.1, 1.1], color: "#e3c08a", opacity: 0.32 },
  ],
  tags: [
    { text: "口腔", at: [0, 28.2, 5.6], kind: "organ", stop: "mouth" },
    { text: "鼻腔", at: [0, 34.6, 3.6], kind: "organ", stop: "nasal" },
    { text: "咽頭", at: [-2.6, 27.8, 0], kind: "organ", stop: "pharynx" },
    { text: "気管", at: [1.8, 20, 1.8], kind: "vessel", stop: "lungs" },
    { text: "食道", at: [-1.8, 16, -0.6], kind: "organ", stop: "esophagus" },
    { text: "肺", at: [-8.6, 12.6, 0], kind: "note" },
    { text: "胃", at: [8.6, -1.8, 0.8], kind: "organ", stop: "stomach" },
    { text: "肝臓", at: [-9.6, -1.4, 0.2], kind: "organ" },
    { text: "胆嚢", at: [-8.6, -5, 1.6], kind: "organ", stop: "gallbladder" },
    { text: "十二指腸", at: [-6.6, -10.4, 0], kind: "organ", stop: "duodenum" },
    { text: "膵臓", at: [5.6, -6.6, -1.6], kind: "organ", stop: "pancreas" },
    { text: "空腸", at: [8.8, -14.4, 1.2], kind: "organ", stop: "jejunum" },
    { text: "回腸", at: [2.6, -20.4, 1.8], kind: "organ", stop: "ileum" },
    { text: "盲腸", at: [-9.8, -24, 0.6], kind: "organ", stop: "cecum" },
    { text: "虫垂", at: [-3.6, -27.4, 0.8], kind: "organ", stop: "appendix" },
    { text: "上行結腸", at: [-10.6, -17, 0.2], kind: "organ", stop: "ascending" },
    { text: "横行結腸", at: [0, -9.6, 3.4], kind: "organ", stop: "transverse" },
    { text: "下行結腸", at: [11, -16, 0], kind: "organ", stop: "descending" },
    { text: "S状結腸", at: [6.2, -26.6, 1.2], kind: "organ", stop: "sigmoid" },
    { text: "直腸", at: [-2.6, -30, -1], kind: "organ", stop: "rectum" },
    { text: "肛門", at: [2.4, -34.6, 0.2], kind: "organ", stop: "anus" },
  ],
  views: [
    { label: "全身", from: [0.12, 0.05, 1], zoom: 1 },
    { label: "口と咽頭", from: [1, 0.1, 0.25], zoom: 1, region: "head" },
    { label: "腹", from: [0.15, 0.08, 1], zoom: 1, region: "belly" },
  ],
  regions: {
    head: ["mouth", "pharynx", "nasal", "head"],
    belly: ["stomach", "duodenum", "duodenum-2", "jejunum", "ileum", "cecum", "ascending", "transverse", "descending", "sigmoid", "liver"],
  },
};

// ---------------------------------------------------------------- 痛みの信号（伝導路）

const NERVE = "#ffd23f";
const PAIN_FIBER = "#ff8a3d";
const TOUCH_FIBER = "#7ac7ff";
const MOTOR = "#e5655a";

export const PAIN_MODEL: LineModel = {
  traveler: "#fff4b8",
  dot: 0.0016,
  segments: {
    skin: { points: [[-27.9, -12.5, 1.5], [-27.4, -12.1, 1.4]], to: ["median"], name: "指先の受容器", term: "skin", color: NERVE, radius: 0.16, fiber: true },
    median: { points: [[-27.4, -12.1, 1.4], [-25, -10.6, 1.1], [-22, -9, 0.9], [-15, -5, 0.5], [-9, -1.5, 0.2], [-6, -0.2, 0], [-4.6, 0, 0]], to: ["posterior-root"], name: "正中神経 → 腕神経叢 → 脊髄神経", term: "median-nerve", color: NERVE, radius: 0.2, fiber: true },
    "posterior-root": { points: [[-4.6, 0, 0], [-3.4, 0.2, -1.0], [-1.6, 0.1, -1.0], [-0.9, 0, -0.9]], to: ["horn", "dc", "reflex"], name: "後根（脊髄神経節）", term: "posterior-root", color: NERVE, radius: 0.16, fiber: true },
    "anterior-root": { points: [[-0.8, 0, 0.8], [-3.2, 0, 0.9], [-4.6, 0, 0.1]], to: [], name: "前根", term: "anterior-root", color: MOTOR, radius: 0.14, fiber: true, opacity: 0.6 },
    reflex: { points: [[-0.9, 0, -0.9], [-0.7, 0.05, 0], [-0.8, 0, 0.8], [-3.2, 0, 0.9], [-4.6, 0, 0.3], [-9, -1.2, 0.6], [-11.4, -2.6, 0.9]], to: [], name: "介在ニューロン → 前角 → 前根 → 筋", term: "anterior-horn", color: MOTOR, radius: 0.12, fiber: true, opacity: 0.55 },
    horn: { points: [[-0.9, 0, -0.9], [-0.85, 0.2, -0.8], [-0.8, 0.3, -0.7]], to: ["stt"], name: "後角", term: "posterior-horn", color: PAIN_FIBER, radius: 0.12, fiber: true },
    stt: { points: [[-0.8, 0.3, -0.7], [-0.3, 0.6, 0.4], [0.4, 0.9, 0.8], [1.0, 1.4, 0.4], [1.0, 8, 0.4], [0.9, 17, 0.3], [0.8, 22, 0.2]], to: ["stt-thal", "stt-cb"], name: "前白交連 → 外側脊髄視床路", term: "lateral-spinothalamic-tract", color: PAIN_FIBER, radius: 0.16, fiber: true },
    dc: { points: [[-0.9, 0, -0.9], [-0.5, 0.4, -1.2], [-0.5, 10, -1.2], [-0.5, 17.6, -0.9]], to: ["nucleus"], name: "後索（楔状束）", term: "cuneate-fasciculus", color: TOUCH_FIBER, radius: 0.16, fiber: true },
    nucleus: { points: [[-0.5, 17.6, -0.9], [-0.5, 18, -0.85], [-0.5, 18.2, -0.8]], to: ["ml"], name: "楔状束核", term: "medulla-oblongata", color: TOUCH_FIBER, radius: 0.14, fiber: true },
    ml: { points: [[-0.5, 18.2, -0.8], [0.1, 18.7, -0.3], [0.6, 19.4, 0], [0.7, 22, 0.1]], to: ["ml-thal", "ml-cb"], name: "毛帯交叉 → 内側毛帯", color: TOUCH_FIBER, radius: 0.16, fiber: true },
    "stt-thal": { points: [[0.8, 22, 0.2], [1.1, 25, 0.1], [1.2, 26.8, 0]], to: ["thalamus"], name: "外側脊髄視床路（中脳）", term: "lateral-spinothalamic-tract", color: PAIN_FIBER, radius: 0.16, fiber: true },
    "ml-thal": { points: [[0.7, 22, 0.1], [1.0, 25, 0], [1.2, 26.8, 0]], to: ["thalamus"], name: "内側毛帯（中脳）", color: TOUCH_FIBER, radius: 0.16, fiber: true },
    "stt-cb": { points: [[0.8, 22, 0.2], [0.9, 21, -1.2], [1.2, 19.8, -2.8], [1.6, 19.4, -3.6]], to: ["cerebellum"], name: "小脳へ", term: "cerebellum", color: "#a7a2c8", radius: 0.12, fiber: true, opacity: 0.6 },
    "ml-cb": { points: [[0.7, 22, 0.1], [0.9, 21, -1.2], [1.2, 19.8, -2.8], [1.6, 19.4, -3.6]], to: ["cerebellum"], name: "小脳へ", term: "cerebellum", color: "#a7a2c8", radius: 0.12, fiber: true, opacity: 0.6 },
    cerebellum: { points: [[1.6, 19.4, -3.6], [2, 19.2, -4]], to: [], name: "小脳", term: "cerebellum", color: "#a7a2c8", radius: 0.12, fiber: true },
    thalamus: { points: [[1.2, 26.8, 0], [1.25, 27, -0.05], [1.3, 27.2, -0.1]], to: ["cortex", "motor"], name: "視床（後外側腹側核）", term: "thalamus", color: "#d08cf0", radius: 0.14, fiber: true },
    cortex: { points: [[1.3, 27.2, -0.1], [2.6, 29.4, -0.6], [4.6, 31.4, -1.0], [6, 31.6, -1.1]], to: [], name: "内包 → 中心後回", term: "postcentral-gyrus", color: "#d08cf0", radius: 0.16, fiber: true },
    motor: { points: [[1.3, 27.2, -0.1], [2.6, 29.4, 0.4], [4.6, 31.4, 1.0], [6, 31.6, 1.1]], to: [], name: "内包 → 中心前回", term: "precentral-gyrus", color: "#9aa7e8", radius: 0.12, fiber: true, opacity: 0.6 },
    // 形だけ（旅では通らない）: 脳回・脳幹・脊髄・腕
    "postcentral-gyrus": { points: [[0.4, 34.4, -1.1], [3.2, 34.2, -1.1], [5.6, 32.6, -1.1], [6.9, 29.6, -1.1]], to: [], name: "中心後回", term: "postcentral-gyrus", color: "#f0a23a", radius: 0.5, opacity: 0.75 },
    "precentral-gyrus": { points: [[0.4, 34.4, 1.2], [3.2, 34.2, 1.2], [5.6, 32.6, 1.2], [6.9, 29.6, 1.2]], to: [], name: "中心前回", term: "precentral-gyrus", color: "#7d8fdc", radius: 0.5, opacity: 0.75 },
    brainstem: { points: [[0, 26, 0], [0, 22, -0.1], [0, 17, -0.2]], to: [], name: "脳幹", term: "medulla-oblongata", color: "#e6cfc4", radius: 1.2, opacity: 0.16 },
    cord: { points: [[0, 17, -0.2], [0, 8, -0.2], [0, 0, -0.2], [0, -8, -0.2]], to: [], name: "脊髄", term: "spinal-cord", color: "#efe0c8", radius: 1.6, opacity: 0.14 },
    arm: { points: [[-6.4, 0.6, 0], [-15, -4.6, 0.4], [-22, -8.6, 0.8], [-25, -10.2, 1.0]], to: [], name: "右腕", term: "upper-limb", color: "#e7c3a8", radius: 1.4, opacity: 0.16 },
    finger: { points: [[-25.4, -10.8, 1.2], [-27.9, -12.5, 1.5]], to: [], name: "人差し指", term: "upper-limb", color: "#e7c3a8", radius: 0.42, opacity: 0.24 },
  },
  blobs: [
    { id: "r-hemisphere", center: [-3.6, 30, 0], size: [3.8, 4.6, 6.4], color: "#e3c2bd", opacity: 0.08 },
    { id: "l-hemisphere", center: [3.6, 30, 0], size: [3.8, 4.6, 6.4], color: "#e3c2bd", opacity: 0.14 },
    { id: "l-thalamus", center: [1.3, 27, 0], size: [1.0, 0.8, 1.5], color: "#c89ad6", opacity: 0.4 },
    { id: "r-thalamus", center: [-1.3, 27, 0], size: [1.0, 0.8, 1.5], color: "#c89ad6", opacity: 0.18 },
    { id: "cerebellum", center: [0, 19.4, -4], size: [4.4, 2.0, 2.2], color: "#d8b7a8", opacity: 0.22 },
    { id: "drg", center: [-3.3, 0.2, -1.0], size: [0.55, 0.42, 0.42], color: "#f2d36b", opacity: 0.6 },
    { id: "posterior-horn", center: [-0.85, 0.1, -0.8], size: [0.42, 0.6, 0.5], color: "#9b958c", opacity: 0.5 },
    { id: "anterior-horn", center: [-0.85, 0, 0.75], size: [0.5, 0.6, 0.5], color: "#9b958c", opacity: 0.5 },
    { id: "nucleus", center: [-0.5, 18, -0.85], size: [0.4, 0.5, 0.4], color: "#9b958c", opacity: 0.5 },
    { id: "hand", center: [-25.2, -10.4, 1.0], size: [1.6, 1.2, 0.6], color: "#e7c3a8", opacity: 0.22 },
    { id: "muscle", center: [-12.2, -3.0, 1.0], size: [2.6, 0.9, 0.9], color: MOTOR, opacity: 0.3 },
  ],
  tags: [
    { text: "人差し指", at: [-28.8, -13.8, 1.5], kind: "organ", stop: "finger" },
    { text: "正中神経", at: [-19, -5, 0.6], kind: "vessel", stop: "median" },
    { text: "筋", at: [-12.2, -4.6, 1.0], kind: "note", stop: "reflex" },
    { text: "脊髄神経節", at: [-3.6, 1.6, -1.0], kind: "vessel", stop: "root" },
    { text: "後角", at: [-2.2, -1.4, -0.8], kind: "vessel", stop: "horn" },
    { text: "前角", at: [-1.6, -1.6, 0.8], kind: "note" },
    { text: "脊髄", at: [2.8, -6, -0.2], kind: "organ" },
    { text: "後索", at: [-2.4, 8, -1.2], kind: "vessel", stop: "dc" },
    { text: "外側脊髄視床路", at: [3.8, 10, 0.4], kind: "vessel", stop: "stt" },
    { text: "延髄", at: [-2.8, 18, -0.2], kind: "note", stop: "nucleus" },
    { text: "内側毛帯", at: [2.8, 21, 0.1], kind: "vessel", stop: "ml" },
    { text: "小脳", at: [-3.4, 18, -4], kind: "organ", stop: "cerebellum" },
    { text: "視床", at: [3.2, 26, 0], kind: "organ", stop: "thalamus" },
    { text: "中心後回", at: [9.4, 30, -1.1], kind: "organ", stop: "cortex" },
    { text: "中心前回", at: [8.2, 34, 1.2], kind: "organ", stop: "motor" },
    { text: "大脳（右半球）", at: [-6.6, 35.4, 0], kind: "note" },
  ],
  views: [
    { label: "全体", from: [0.35, 0.12, 1], zoom: 1 },
    { label: "脊髄（腕の神経が入る高さ）", from: [0.45, 0.35, 0.85], zoom: 0.5, region: "cord" },
    { label: "脳", from: [0.7, 0.15, 0.7], zoom: 0.9, region: "brain" },
  ],
  regions: {
    cord: ["posterior-root", "anterior-root", "drg", "posterior-horn", "anterior-horn", "horn"],
    brain: ["l-hemisphere", "r-hemisphere", "cerebellum", "brainstem"],
  },
};

export const LINE_MODELS = { food: GUT_MODEL, pain: PAIN_MODEL } as const;

/** 道の中心線（なめらかにした点） */
export function segmentLine(segment: LineSegment): Vec3[] {
  return segment.points.length > 2 ? curvePoints(segment.points, Math.max(16, segment.points.length * 14)) : segment.points;
}

export interface BuiltLineModel {
  root: THREE.Group;
  /** region → その部品（寄って見るとき） */
  regions: Map<string, THREE.Object3D>;
  /** 道の材質（通った道を濃くする） */
  materials: Map<string, { material: THREE.MeshStandardMaterial | THREE.MeshBasicMaterial; base: number }>;
}

export function buildLineModel(model: LineModel): BuiltLineModel {
  const root = new THREE.Group();
  const parts = new Map<string, THREE.Object3D>();
  const materials: BuiltLineModel["materials"] = new Map();
  for (const [id, segment] of Object.entries(model.segments)) {
    const line = segmentLine(segment);
    const geometry = tube(line, segment.radius, Math.max(24, line.length * 2), segment.fiber ? 8 : 16);
    const material = segment.fiber
      ? glow(segment.color, segment.opacity ?? 0.85)
      : clear(segment.color, segment.opacity ?? 0.4);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.renderOrder = segment.fiber ? 5 : 3;
    mesh.userData.pick = id;
    root.add(mesh);
    parts.set(id, mesh);
    materials.set(id, { material, base: material.opacity });
  }
  for (const blob of model.blobs) {
    const material = blob.opacity >= 0.5 ? plastic(blob.color) : clear(blob.color, blob.opacity);
    if (blob.opacity >= 0.5) {
      material.transparent = true;
      material.opacity = blob.opacity;
    }
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 28, 20), material);
    mesh.scale.set(...blob.size);
    mesh.position.set(...blob.center);
    mesh.renderOrder = 2;
    mesh.userData.pick = blob.id;
    root.add(mesh);
    parts.set(blob.id, mesh);
  }
  const regions = new Map<string, THREE.Object3D>();
  root.updateMatrixWorld(true);
  for (const [region, ids] of Object.entries(model.regions)) {
    // 範囲の部品を囲む見えない箱（frameSchematic の only に渡す）
    const box = new THREE.Box3();
    for (const id of ids) {
      const part = parts.get(id);
      if (part) box.expandByObject(part);
    }
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const marker = new THREE.Mesh(new THREE.BoxGeometry(size.x || 1, size.y || 1, size.z || 1), new THREE.MeshBasicMaterial({ visible: false }));
    marker.position.copy(center);
    // 描かず、タップにも当たらない層に
    marker.layers.set(31);
    root.add(marker);
    regions.set(region, marker);
  }
  return { root, regions, materials };
}
