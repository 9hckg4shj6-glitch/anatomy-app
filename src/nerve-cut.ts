import type { Motion } from "./content";
import type { Vec3 } from "./landmarks";

/**
 * 神経を切ると何が起こる？（#/cut。src/ui/nerve-cut.ts）: 神経を1本選んで切ると、その神経が動かす筋が灰色になり、できなくなる動きと徴候が出る。
 * 逆に、症状から「どの神経？」を当てる問いにもする（#/cut/quiz）。
 *
 * 筋は筋の語の「神経」（term.nerve）と合わせる。motor にその神経だけで動く筋の「神経」の書き方を並べ、いちばん上で切る所（sites[0]）で
 * それらの筋がすべて止まることを tests/nerve-cut.test.ts で確かめる（筋の語を直したのに、ここが古いままにならないように）。
 * 先の所で切るときは、そこより上で分かれる枝の筋は残る（spared に書く）。
 * 説明の第一の参考書は『解剖学講義』。臨床の言葉（下垂手・猿手・鷲手など）は医療系1年生が授業で出会うものに限る
 */

/** 切る所。lost は動かなくなる筋（灰色）、weak はほかの神経も来るので弱まる筋（うすい灰色） */
export interface CutSite {
  id: string;
  /** 切る所の名前 */
  ja: string;
  /** 切る所の目安の骨の部位（content/pins.json）。2つなら真ん中。神経の上でここにいちばん近い点に印を置く。無ければ神経の真ん中 */
  near?: string[];
  /** よくある原因 */
  cause: string;
  lost: string[];
  weak?: string[];
  /** 残る動き（そこより上で分かれる枝・ほかの神経） */
  spared?: string;
  /** できなくなる動き。by はふだんのその動きを骨の動きで見せる筋（term.motion がある筋） */
  cannot: { text: string; by?: string }[];
  /** 徴候。pose は手足の形（ふつう → 切ったあと）を骨の姿勢で見せる */
  signs: { ja: string; text: string; pose?: Motion }[];
  /** 感覚が鈍くなる所 */
  numb: string;
  note?: string;
  /** 当てる問いの症状（「どの神経？」） */
  asks: string[];
  /** 3Dを映す向き（体の座標。右側を見る。x が負＝体の右、z が正＝前） */
  from: Vec3;
}

export type CutRegion = "upper" | "lower" | "head";

export const CUT_REGIONS: { id: CutRegion; ja: string }[] = [
  { id: "upper", ja: "上肢" },
  { id: "lower", ja: "下肢" },
  { id: "head", ja: "頭と首" },
];

export interface NerveCut {
  /** 神経の語ID（図鑑で開く・3Dで光らせる） */
  id: string;
  region: CutRegion;
  /** 神経の根（脊髄神経の高さ・脳神経の番号） */
  roots: string;
  /** 一覧に出す、いちばん目立つ症状 */
  sign: string;
  /** この神経だけで動く筋の「神経」の書き方（筋の語の term.nerve） */
  motor: string[];
  sites: CutSite[];
}

const FRONT: Vec3 = [-0.35, 0.12, 1];
const BACK: Vec3 = [-0.4, 0.15, -1];
const SIDE: Vec3 = [-1, 0.12, 0.25];

/** 腕を前に出し、手のひらを下に向けた形（下垂手・下垂指を見せる） */
const ARM_FORWARD = { "shoulder-flex": 70, forearm: 80 };
/** 歩くときのように脚を上げた形（下垂足を見せる） */
const LEG_LIFTED = { "hip-flex": 30, knee: 45 };

const WRIST_DROP = {
  ja: "下垂手",
  text: "腕を前に出して手首を上げようとしても、手首と指の付け根が伸びず、手がだらりと垂れる。",
  pose: { from: { ...ARM_FORWARD, "wrist-flex": -15, fingers: -5 }, to: { ...ARM_FORWARD, "wrist-flex": 65, fingers: 35 } },
};
const FOOT_DROP = {
  ja: "下垂足",
  text: "足首をそらす筋（前脛骨筋など）が働かず、脚を上げるとつま先が垂れて、少し内へ向く。",
  pose: { from: { ...LEG_LIFTED, ankle: 10 }, to: { ...LEG_LIFTED, ankle: -35, subtalar: 15 } },
};
const APE_HAND = {
  ja: "猿手",
  text: "母指球がやせて平らになり、母指が手のひらと同じ面に並んで、ほかの指と向き合わせられない（対立できない）。",
};
const FROMENT = {
  ja: "フロマン徴候",
  text: "紙を母指と示指の間にはさんで引っぱると、母指内転筋の代わりに長母指屈筋（正中神経）で押さえるので、母指の先の関節が曲がる。",
};
const KNEE_GIVE = {
  ja: "膝くずれ",
  text: "立つと膝がかくんと折れやすく、階段を上れない。手で太ももを押さえて膝を伸ばしたまま歩く。膝蓋腱反射も出ない。",
};

/** 足の裏の筋（内側・外側足底神経） */
const PLANTAR = [
  "abductor-hallucis", "flexor-digitorum-brevis", "flexor-hallucis-brevis", "quadratus-plantae", "abductor-digiti-minimi-of-foot",
  "flexor-digiti-minimi-brevis-of-foot", "opponens-digiti-minimi-of-foot", "adductor-hallucis", "dorsal-interossei-of-foot", "plantar-interossei", "lumbricals-of-foot",
];
/** 下腿の後ろの筋（脛骨神経） */
const CALF = ["triceps-surae", "plantaris", "popliteus", "tibialis-posterior", "flexor-digitorum-longus", "flexor-hallucis-longus"];
/** 下腿の前・外側と足の甲の筋（深・浅腓骨神経） */
const FIBULAR = [
  "tibialis-anterior", "extensor-digitorum-longus", "extensor-hallucis-longus", "fibularis-tertius", "extensor-digitorum-brevis", "extensor-hallucis-brevis",
  "fibularis-longus", "fibularis-brevis",
];
/** 前腕の後ろの深い筋（後骨間神経） */
const DEEP_EXTENSORS = [
  "extensor-digitorum", "extensor-digiti-minimi", "extensor-carpi-ulnaris", "abductor-pollicis-longus", "extensor-pollicis-brevis", "extensor-pollicis-longus", "extensor-indicis",
];
/** 手の中の尺骨神経の筋（深枝） */
const ULNAR_HAND = ["hypothenar-muscles", "palmar-interossei", "dorsal-interossei-of-hand", "adductor-pollicis"];
/** 顔の表情筋など（顔面神経） */
const FACIAL = [
  "frontalis", "occipitalis", "temporoparietalis", "corrugator-supercilii", "procerus", "orbicularis-oculi", "nasalis", "depressor-septi-nasi",
  "levator-labii-superioris-alaeque-nasi", "levator-labii-superioris", "zygomaticus-major", "zygomaticus-minor", "levator-anguli-oris", "risorius",
  "buccinator", "orbicularis-oris", "depressor-anguli-oris", "depressor-labii-inferioris", "mentalis", "platysma", "stylohyoid", "posterior-belly-of-digastric",
];

export const NERVE_CUTS: NerveCut[] = [
  // ---- 上肢 ----
  {
    id: "axillary-nerve", region: "upper", roots: "C5・C6", sign: "腕を横に上げられない", motor: ["腋窩神経"],
    sites: [{
      id: "neck", ja: "上腕骨の外科頚のまわり", near: ["surgical-neck"], from: [-0.75, 0.2, -0.7],
      cause: "上腕骨外科頚の骨折、肩関節の脱臼。神経は外科頚の後ろを巻くように回る。",
      lost: ["deltoid", "teres-minor"],
      spared: "棘上筋（肩甲上神経）が残るので、始めの15°ほどは腕を横に上げられる。外旋は棘下筋が残る。",
      cannot: [
        { text: "腕を横に上げる（肩関節の外転）。15°ほどから先が上がらない", by: "deltoid" },
        { text: "腕を前や後ろへ振る力が弱まる（三角筋の前部・後部）" },
        { text: "腕を外へひねる力が少し弱まる（小円筋）" },
      ],
      signs: [{ ja: "肩の丸みが消える", text: "三角筋がやせて肩峰が出っぱり、肩が角ばって見える。" }],
      numb: "肩の外側の手のひら大の所（上外側上腕皮神経）",
      asks: [
        "肩を脱臼したあと、腕を横に上げられず、肩の外側の皮膚の感覚が鈍い人がいます。",
        "上腕骨の外科頚を骨折したあと、肩の丸みが消えて角ばってきた人がいます。",
      ],
    }],
  },
  {
    id: "musculocutaneous-nerve", region: "upper", roots: "C5〜C7", sign: "肘を曲げる力が弱い", motor: ["筋皮神経"],
    sites: [{
      id: "arm", ja: "上腕の上部（烏口腕筋を貫く所）", near: ["coracoid-process"], from: FRONT,
      cause: "単独で傷つくのはまれ。肩の前の刺し傷、肩の脱臼、重い物を持ち上げたときの引きのばし。",
      lost: ["biceps-brachii", "coracobrachialis"], weak: ["brachialis"],
      spared: "肘は腕橈骨筋と上腕筋の一部（どちらも橈骨神経）で、弱いながら曲げられる。回外は回外筋（橈骨神経）が残る。",
      cannot: [
        { text: "肘を曲げる力が弱まる（とくに手のひらを上に向けたとき）", by: "biceps-brachii" },
        { text: "前腕を外へひねる（回外）力が弱まる。ねじを右に回すような動き" },
      ],
      signs: [{ ja: "上腕二頭筋反射が消える", text: "肘の前の上腕二頭筋の腱をたたいても、肘が曲がらない（C5・C6 の反射）。" }],
      numb: "前腕の外側（親指側）の皮膚（筋皮神経の続きの外側前腕皮神経）",
      asks: ["肘を曲げる力と前腕を回外する力が弱く、前腕の外側（親指側）の皮膚がしびれる人がいます。"],
    }],
  },
  {
    id: "radial-nerve", region: "upper", roots: "C5〜T1", sign: "下垂手", motor: ["橈骨神経"],
    sites: [
      {
        id: "axilla", ja: "腋窩（わきの下）", near: ["surgical-neck"], from: BACK,
        cause: "松葉杖を脇の下に押し当てて体重をかける（松葉杖麻痺）、上腕の上部の骨折。",
        lost: ["triceps-brachii", "anconeus", "brachioradialis", "extensor-carpi-radialis-longus", "extensor-carpi-radialis-brevis", "supinator", ...DEEP_EXTENSORS],
        cannot: [
          { text: "肘を伸ばす", by: "triceps-brachii" },
          { text: "手首をそらす（背屈）", by: "extensor-carpi-radialis-longus" },
          { text: "指の付け根（MP関節）を伸ばす", by: "extensor-digitorum" },
          { text: "母指を伸ばす・横へ広げる", by: "extensor-pollicis-longus" },
          { text: "前腕を外へひねる（回外）力が弱まる（上腕二頭筋が残る）" },
        ],
        signs: [WRIST_DROP],
        numb: "上腕と前腕の後ろ側、手の甲の親指側（とくに母指と示指の間）",
        asks: ["松葉杖を脇の下に当てて歩いていたら、肘も手首も伸ばせなくなった人がいます。"],
      },
      {
        id: "groove", ja: "上腕の中ほど（橈骨神経溝）", near: ["radial-groove"], from: BACK,
        cause: "上腕骨の骨幹部の骨折、腕を椅子の背にかけたまま眠る（土曜の夜の麻痺）、腕枕。神経は上腕骨の後ろの溝に沿って巻く。",
        lost: ["brachioradialis", "extensor-carpi-radialis-longus", "extensor-carpi-radialis-brevis", "supinator", ...DEEP_EXTENSORS],
        spared: "上腕三頭筋の枝は溝より上で分かれるので、肘は伸ばせる。",
        cannot: [
          { text: "手首をそらす（背屈）", by: "extensor-carpi-radialis-longus" },
          { text: "指の付け根（MP関節）を伸ばす", by: "extensor-digitorum" },
          { text: "母指を伸ばす・横へ広げる", by: "extensor-pollicis-longus" },
          { text: "前腕を外へひねる（回外）力が弱まる（上腕二頭筋が残る）" },
        ],
        signs: [WRIST_DROP],
        numb: "手の甲の親指側（母指と示指の間がいちばんはっきり）",
        asks: [
          "上腕骨の骨幹部を骨折したあと、手首と指の付け根が伸ばせず手が垂れる人がいます。肘は伸ばせます。",
          "お酒を飲んで腕を椅子の背にかけたまま眠ったら、翌朝、手首が上がらなくなっていた人がいます。",
        ],
      },
      {
        id: "forearm", ja: "前腕の上部（回外筋の中＝後骨間神経）", near: ["neck-of-radius"], from: BACK,
        cause: "橈骨頭の骨折・脱臼、回外筋の入り口での締めつけ。",
        lost: DEEP_EXTENSORS,
        spared: "腕橈骨筋と長・短橈側手根伸筋の枝は肘のあたりで分かれるので、手首はそらせる（尺側手根伸筋が働かないので親指側へ傾く）。回外筋は残ることが多い。感覚の枝（浅枝）は分かれたあとなので、しびれはない。",
        cannot: [
          { text: "指の付け根（MP関節）を伸ばす", by: "extensor-digitorum" },
          { text: "母指を伸ばす・横へ広げる", by: "extensor-pollicis-longus" },
        ],
        signs: [{
          ja: "下垂指",
          text: "手首はそらせるのに、指の付け根（MP関節）が伸びず、指だけが垂れる。",
          pose: { from: { ...ARM_FORWARD, "wrist-flex": -25, fingers: -10 }, to: { ...ARM_FORWARD, "wrist-flex": -25, "wrist-dev": 12, fingers: 60 } },
        }],
        numb: "しびれはない（感覚の枝は肘で分かれたあと）",
        asks: ["橈骨頭を脱臼したあと、手首はそらせるのに指の付け根が伸ばせない人がいます。手のしびれはありません。"],
      },
    ],
  },
  {
    id: "median-nerve", region: "upper", roots: "C6〜T1", sign: "猿手・祝福の手", motor: ["正中神経"],
    sites: [
      {
        id: "elbow", ja: "肘のあたり（上腕の下部）", near: ["medial-epicondyle-of-humerus"], from: FRONT,
        cause: "上腕骨の顆上骨折（子どもに多い）、肘の前の切り傷。",
        lost: ["pronator-teres", "pronator-quadratus", "flexor-carpi-radialis", "palmaris-longus", "flexor-digitorum-superficialis", "flexor-pollicis-longus", "abductor-pollicis-brevis", "opponens-pollicis"],
        weak: ["flexor-digitorum-profundus", "flexor-pollicis-brevis", "lumbricals-of-hand"],
        spared: "深指屈筋の尺側半分（環指・小指）と尺側手根屈筋は尺骨神経なので、環指・小指は曲がり、手首も小指側へは曲げられる。",
        cannot: [
          { text: "前腕を内へひねる（回内）", by: "pronator-teres" },
          { text: "示指と中指を曲げる", by: "flexor-digitorum-superficialis" },
          { text: "母指の先を曲げる", by: "flexor-pollicis-longus" },
          { text: "母指をほかの指と向き合わせる（対立）", by: "opponens-pollicis" },
        ],
        signs: [
          { ja: "祝福の手", text: "こぶしを握ろうとすると、環指・小指は曲がるのに、示指と中指が伸びたまま残る（祝福するときの手の形に似る）。" },
          APE_HAND,
        ],
        numb: "手のひらの親指側（母指から環指の親指側の半分まで）と、その指先の甲側",
        asks: ["上腕骨の顆上骨折のあと、こぶしを握ろうとすると示指と中指だけが伸びたまま残る子どもがいます。"],
      },
      {
        id: "wrist", ja: "手首（手根管）", near: ["carpal-groove"], from: [-0.25, 0.1, 1],
        cause: "手根管症候群（手の使いすぎ・妊娠・透析など）。手根管は手根骨と屈筋支帯で囲まれたせまいトンネルで、9本の腱と正中神経が通る。",
        lost: ["abductor-pollicis-brevis", "opponens-pollicis"], weak: ["flexor-pollicis-brevis", "lumbricals-of-hand"],
        spared: "前腕の筋の枝は手首より上で分かれるので、手首と指は曲げられ、回内もできる。",
        cannot: [
          { text: "母指をほかの指と向き合わせる（対立）", by: "opponens-pollicis" },
          { text: "母指を手のひらから垂直に立てる（掌側外転）", by: "abductor-pollicis-brevis" },
        ],
        signs: [APE_HAND],
        numb: "母指から環指の親指側半分の、手のひら側の指（夜や明け方に強い）。手のひらの付け根は、掌枝が手根管の外を通るので保たれる",
        asks: ["夜になると親指から薬指の手のひら側がしびれ、母指球がやせてきた人がいます。手のひらの付け根の感覚は保たれています。"],
      },
    ],
  },
  {
    id: "ulnar-nerve", region: "upper", roots: "C8・T1", sign: "鷲手", motor: ["尺骨神経"],
    sites: [
      {
        id: "elbow", ja: "肘の内側（尺骨神経溝）", near: ["groove-for-ulnar-nerve"], from: [-0.2, 0.15, -1],
        cause: "上腕骨の内側上顆の骨折、肘をついて長く押す、肘部管症候群。ここをぶつけると小指へびりっと響く。",
        lost: ["flexor-carpi-ulnaris", ...ULNAR_HAND], weak: ["flexor-digitorum-profundus", "flexor-pollicis-brevis", "lumbricals-of-hand"],
        cannot: [
          { text: "指を広げる・閉じる（骨間筋）" },
          { text: "母指を示指へ寄せる（紙をはさむ）", by: "adductor-pollicis" },
          { text: "手首を小指側へ曲げる力が弱まる", by: "flexor-carpi-ulnaris" },
          { text: "環指・小指の先を曲げる力が弱まる（深指屈筋の尺側）" },
        ],
        signs: [
          { ja: "鷲手", text: "環指と小指の付け根（MP関節）が反り、指の関節（PIP・DIP）が曲がったままになる。骨間筋・虫様筋が働かず、指伸筋と深指屈筋に引かれるため。肘での障害では深指屈筋の尺側も弱まるので、手首での障害より軽い。" },
          FROMENT,
        ],
        numb: "小指と、環指の小指側の半分（手のひら側も甲側も）",
        asks: [
          "肘の内側を強く打ったあと、指を広げたり閉じたりできず、小指と環指の小指側がしびれる人がいます。",
          "紙を親指と示指ではさんで引っぱると、親指の先の関節が曲がってしまう人がいます。",
        ],
      },
      {
        id: "wrist", ja: "手首の小指側（尺骨神経管）", near: ["hook-of-hamate"], from: [-0.25, 0.1, 1],
        cause: "自転車のハンドルで手首の小指側を長く押す、手首の小指側の切り傷・ガングリオン。",
        lost: ULNAR_HAND, weak: ["flexor-pollicis-brevis", "lumbricals-of-hand"],
        spared: "尺側手根屈筋と深指屈筋の枝は前腕で分かれるので残る。深指屈筋が指先を強く曲げるので、鷲手はかえってはっきり出る。",
        cannot: [
          { text: "指を広げる・閉じる（骨間筋）" },
          { text: "母指を示指へ寄せる（紙をはさむ）", by: "adductor-pollicis" },
        ],
        signs: [
          { ja: "鷲手", text: "環指と小指の付け根（MP関節）が反り、指の関節（PIP・DIP）が強く曲がる。深指屈筋が残るので、肘での障害よりはっきり出る。" },
          FROMENT,
        ],
        numb: "小指と環指の小指側の、手のひら側。手の甲は、手背枝が手首より上で分かれるので保たれる",
        asks: ["長い距離を自転車で走ったあと、環指と小指が鷲の爪のように曲がり、小指の手のひら側がしびれる人がいます。手の甲の感覚は保たれています。"],
      },
    ],
  },
  {
    id: "long-thoracic-nerve", region: "upper", roots: "C5〜C7", sign: "翼状肩甲", motor: ["長胸神経"],
    sites: [{
      id: "chest", ja: "胸の横（前鋸筋の表面）", from: SIDE,
      cause: "腋窩のリンパ節を取る手術（乳がん）、重い荷物を肩にかけ続ける。神経が胸の横の表面を長く走るので傷つきやすい。",
      lost: ["serratus-anterior"],
      cannot: [
        { text: "肩甲骨を前へ引き、上へ回す（腕を頭の上まで上げる・前へ押す）", by: "serratus-anterior" },
      ],
      signs: [{ ja: "翼状肩甲", text: "壁を両手で押すと、肩甲骨の内側縁が背中から鳥の翼のように浮き上がる。" }],
      numb: "なし（筋だけに行く神経）",
      asks: ["乳がんで腋窩のリンパ節を取る手術を受けたあと、壁を押すと肩甲骨が翼のように浮く人がいます。"],
    }],
  },
  // ---- 下肢 ----
  {
    id: "femoral-nerve", region: "lower", roots: "L2〜L4", sign: "膝を伸ばせない", motor: ["大腿神経"],
    sites: [
      {
        id: "pelvis", ja: "骨盤の中（腸骨筋の前）", near: ["iliac-fossa"], from: FRONT,
        cause: "腸腰筋の中の出血（血液を固まりにくくする薬を飲んでいる人）、骨盤や腰の手術。",
        lost: ["iliacus", "pectineus", "sartorius", "quadriceps-femoris"],
        spared: "大腰筋（腰神経叢の枝）が残るので、股関節は弱いながら曲げられる。",
        cannot: [
          { text: "膝を伸ばす", by: "quadriceps-femoris" },
          { text: "股関節を曲げる力が弱まる（大腰筋が残る）", by: "iliacus" },
        ],
        signs: [KNEE_GIVE],
        numb: "大腿の前と内側、下腿と足の内側（伏在神経）",
        asks: ["血液を固まりにくくする薬を飲んでいて腸腰筋に出血したあと、膝が伸ばせず、太ももの前がしびれる人がいます。"],
      },
      {
        id: "groin", ja: "鼡径靱帯の下（大腿三角）", near: ["anterior-superior-iliac-spine", "pubic-tubercle"], from: FRONT,
        cause: "鼡径部の刺し傷、股関節の手術、大腿動脈へのカテーテル（神経は動脈のすぐ外側を通る）。",
        lost: ["sartorius", "quadriceps-femoris", "pectineus"],
        spared: "腸骨筋の枝は骨盤の中で分かれるので、股関節は曲げられる。",
        cannot: [{ text: "膝を伸ばす", by: "quadriceps-femoris" }],
        signs: [KNEE_GIVE],
        numb: "大腿の前と内側、下腿と足の内側（伏在神経）",
        asks: ["股関節の手術のあと、膝が伸ばせず、立つと膝がかくんと折れる人がいます。膝蓋腱反射が出ません。"],
      },
    ],
  },
  {
    id: "obturator-nerve", region: "lower", roots: "L2〜L4", sign: "脚を内へ寄せられない", motor: ["閉鎖神経"],
    sites: [{
      id: "canal", ja: "閉鎖管（骨盤の出口）", near: ["obturator-groove"], from: FRONT,
      cause: "骨盤の骨折、難産（胎児の頭で骨盤の壁に押しつけられる）、骨盤の手術・腫瘍。",
      lost: ["adductor-longus", "adductor-brevis", "adductor-minimus", "gracilis", "obturator-externus"], weak: ["adductor-magnus"],
      spared: "大内転筋のハムストリング部（坐骨神経）と恥骨筋（大腿神経）が残る。",
      cannot: [
        { text: "脚を内側へ寄せる（股関節の内転）。脚を組む", by: "adductor-longus" },
      ],
      signs: [{ ja: "脚が外へ振れる", text: "脚を内へ寄せられないので、歩くと脚が外へ開いて回るように出る。" }],
      numb: "大腿の内側の中ほど（閉鎖神経の皮枝）",
      asks: ["難産のあと、脚を内側に寄せられず、太ももの内側がしびれる人がいます。"],
    }],
  },
  {
    id: "superior-gluteal-nerve", region: "lower", roots: "L4〜S1", sign: "トレンデレンブルグ徴候", motor: ["上殿神経"],
    sites: [{
      id: "notch", ja: "大坐骨孔（梨状筋の上）", near: ["greater-sciatic-notch"], from: BACK,
      cause: "殿部への筋肉注射の位置がずれる、股関節の手術。注射は殿部の外側上の所にする。",
      lost: ["gluteus-medius", "gluteus-minimus", "tensor-fasciae-latae"],
      cannot: [
        { text: "脚を横へ開く（股関節の外転）", by: "gluteus-medius" },
        { text: "片足で立ったとき、骨盤を水平に保つ" },
      ],
      signs: [{ ja: "トレンデレンブルグ徴候", text: "麻痺した側の脚で片足立ちすると、反対側の骨盤が下がる。歩くたびに体が左右に揺れる（中殿筋歩行）。" }],
      numb: "なし（筋だけに行く神経）",
      asks: ["殿部に筋肉注射を受けたあと、その側の脚で片足立ちすると、反対側の骨盤が下がる人がいます。"],
    }],
  },
  {
    id: "sciatic-nerve", region: "lower", roots: "L4〜S3", sign: "膝から下が動かない",
    motor: [
      "坐骨神経（脛骨神経部）", "坐骨神経（総腓骨神経部）", "坐骨神経（長頭は脛骨神経部、短頭は総腓骨神経部）",
      "脛骨神経", "深腓骨神経", "浅腓骨神経", "内側足底神経", "外側足底神経", "内側足底神経（第1）・外側足底神経（第2〜第4）",
    ],
    sites: [{
      id: "buttock", ja: "殿部（梨状筋の下）", near: ["ischial-tuberosity", "greater-trochanter"], from: BACK,
      cause: "殿部への筋肉注射の位置がずれる、股関節の後方脱臼、骨盤の骨折。",
      lost: ["hamstrings", "short-head-of-biceps-femoris", ...CALF, ...FIBULAR, ...PLANTAR], weak: ["adductor-magnus"],
      spared: "大腿四頭筋（大腿神経）が残るので膝は伸ばせ、膝を固めて立つことはできる。",
      cannot: [
        { text: "膝を曲げる", by: "hamstrings" },
        { text: "足首をそらす", by: "tibialis-anterior" },
        { text: "つま先立ち（足首を伸ばす）", by: "triceps-surae" },
        { text: "足の指を動かす" },
      ],
      signs: [FOOT_DROP],
      numb: "膝から下のほぼすべて（下腿と足の内側だけは伏在神経で保たれる）",
      asks: ["殿部への注射のあと、膝を曲げる力が弱く、足首も足の指もまったく動かせなくなった人がいます。"],
    }],
  },
  {
    id: "common-fibular-nerve", region: "lower", roots: "L4〜S2", sign: "下垂足・鶏歩", motor: ["深腓骨神経", "浅腓骨神経"],
    sites: [{
      id: "neck", ja: "腓骨頚のまわり（膝の外側）", near: ["neck-of-fibula"], from: [-1, 0.15, 0.5],
      cause: "足を組んで座る、膝の外側を押すギプスや装具、長く寝たきり、腓骨頭の骨折。神経は腓骨頚の外側の皮膚のすぐ下を巻く。",
      lost: FIBULAR,
      spared: "大腿二頭筋短頭の枝は大腿で分かれるので残る。足首を伸ばす（底屈）・内へ返す筋（脛骨神経）も残る。",
      cannot: [
        { text: "足首をそらす（背屈）", by: "tibialis-anterior" },
        { text: "足の指をそらす", by: "extensor-digitorum-longus" },
        { text: "足の裏を外へ向ける（外反）", by: "fibularis-longus" },
      ],
      signs: [
        FOOT_DROP,
        { ja: "鶏歩", text: "つま先が床に引っかからないよう、膝を高く上げて歩く（ニワトリの歩き方に似る）。" },
      ],
      numb: "下腿の外側と足の甲（母趾と第2趾の間だけは深腓骨神経）",
      asks: [
        "足を組んで長く座っていたら、つま先が上がらなくなり、足の甲がしびれる人がいます。",
        "膝の外側にギプスが当たっていたあと、つま先が床に引っかかるので、膝を高く上げて歩く人がいます。",
      ],
    }],
  },
  {
    id: "tibial-nerve", region: "lower", roots: "L4〜S3", sign: "つま先立ちができない",
    motor: ["脛骨神経", "内側足底神経", "外側足底神経", "内側足底神経（第1）・外側足底神経（第2〜第4）"],
    sites: [
      {
        id: "knee", ja: "膝の裏（膝窩）", near: ["popliteal-surface"], from: BACK,
        cause: "膝の裏の深い切り傷、膝関節の脱臼。",
        lost: [...CALF, ...PLANTAR],
        cannot: [
          { text: "つま先立ち（足首を伸ばす＝底屈）", by: "triceps-surae" },
          { text: "足の指を曲げる", by: "flexor-digitorum-longus" },
          { text: "足の裏を内へ向ける（内反）", by: "tibialis-posterior" },
        ],
        signs: [
          { ja: "アキレス腱反射が消える", text: "アキレス腱をたたいても、足首が動かない（S1 の反射）。" },
          { ja: "踵足", text: "足首を蹴り出せず、かかとで歩くようになる。前の筋に引かれて、足は甲側へ反りやすい。" },
        ],
        numb: "足の裏（と、下腿の後ろ外側〈腓腹神経〉）",
        asks: ["膝の裏を深く切ったあと、つま先立ちができず、足の裏の感覚がない人がいます。"],
      },
      {
        id: "ankle", ja: "内くるぶしの後ろ（足根管）", near: ["malleolar-groove-of-tibia"], from: [0.8, 0.1, -0.35],
        cause: "足根管症候群（足首の捻挫のあと・ガングリオン・扁平足など）。",
        lost: PLANTAR,
        spared: "下腿の筋の枝は膝の近くで分かれるので、つま先立ちはできる。",
        cannot: [
          { text: "足の指を広げる・寄せる" },
          { text: "足の指の付け根を曲げる" },
        ],
        signs: [{ ja: "足の裏の痛み", text: "足の裏がしびれ、焼けるように痛む。内くるぶしの後ろをたたくと足の裏へ響く。" }],
        numb: "足の裏（かかとの皮膚は踵骨枝が足根管より上で分かれることが多く、保たれやすい）",
        asks: ["足首の捻挫のあと、内くるぶしの後ろをたたくと足の裏へびりっと響き、足の裏がしびれる人がいます。つま先立ちはできます。"],
      },
    ],
  },
  // ---- 頭と首 ----
  {
    id: "facial-nerve", region: "head", roots: "第VII脳神経", sign: "顔の片側が動かない", motor: ["顔面神経"],
    sites: [{
      id: "foramen", ja: "茎乳突孔を出た所（耳の下）", near: ["stylomastoid-foramen"], from: [-0.25, 0.05, 1],
      cause: "ベル麻痺（多くはウイルスによる神経の腫れ）、耳下腺の手術・腫瘍、顔の深い切り傷。",
      lost: FACIAL,
      cannot: [
        { text: "額にしわを寄せる・眉を上げる" },
        { text: "目を固く閉じる" },
        { text: "口をとがらす・口笛を吹く・頬をふくらませる" },
        { text: "歯を見せて笑う（口角を上げる）" },
      ],
      signs: [
        { ja: "兎眼", text: "目を閉じようとしても閉じきれず、眼球が上に回って白目が見える（ベル現象）。涙があふれ、目が乾く。" },
        { ja: "口角が下がる", text: "麻痺した側の口角が下がり、食べ物が頬と歯の間にたまる。水を飲むと口の端からこぼれる。" },
      ],
      numb: "なし（顔の感覚は三叉神経）。顔面神経管の中で傷つくと、舌の前2/3の味覚（鼓索神経）・涙・音が響く（アブミ骨筋）も加わる",
      note: "脳の障害（大脳から顔面神経核への道）では、額のしわは寄せられる。額の筋は左右両方の大脳から命令を受けるため。顔面神経そのものの障害では額も動かない。",
      asks: ["朝起きたら顔の片側が動かず、額にしわを寄せられず、目も閉じきれない人がいます。"],
    }],
  },
  {
    id: "oculomotor-nerve", region: "head", roots: "第III脳神経", sign: "眼瞼下垂・瞳孔が開く", motor: ["動眼神経"],
    sites: [{
      id: "skull", ja: "頭蓋の中（海綿静脈洞のそば）", from: [-0.3, 0.1, 1],
      cause: "脳動脈瘤（内頚動脈と後交通動脈の分かれ目）による圧迫、糖尿病、頭の外傷。",
      lost: ["superior-rectus", "inferior-rectus", "medial-rectus", "inferior-oblique", "levator-palpebrae-superioris"],
      spared: "外側直筋（外転神経）と上斜筋（滑車神経）が残るので、眼球は外下方へ引かれる。",
      cannot: [
        { text: "眼球を内・上・下へ向ける" },
        { text: "まぶたを上げる" },
        { text: "瞳孔を小さくする・近くに目の焦点を合わせる" },
      ],
      signs: [
        { ja: "眼瞼下垂", text: "上眼瞼挙筋が働かず、上まぶたが垂れて目が開かない。" },
        { ja: "外下方を向く", text: "残った外側直筋と上斜筋に引かれ、眼球が外下方を向いたままになる。物が二つに見える。" },
        { ja: "瞳孔が開く", text: "瞳孔を小さくする副交感神経（動眼神経副核から）も通るので、瞳孔が開き、光を当てても縮まない。" },
      ],
      numb: "なし",
      asks: ["まぶたが垂れ、目が外下方を向いたまま、瞳孔が開いている人がいます。"],
    }],
  },
  {
    id: "abducens-nerve", region: "head", roots: "第VI脳神経", sign: "外を見られない（内斜視）", motor: ["外転神経"],
    sites: [{
      id: "skull", ja: "頭蓋の中（脳幹から海綿静脈洞まで）", from: [-0.3, 0.1, 1],
      cause: "頭蓋の中の圧が高まる（脳の腫れ・出血・腫瘍）、頭の外傷。頭蓋の中を長く走るので傷つきやすい。",
      lost: ["lateral-rectus"],
      cannot: [{ text: "眼球を外へ向ける" }],
      signs: [{ ja: "内斜視", text: "眼球が内側へ寄り、外（麻痺した側）を見ようとすると物が二つに見える。" }],
      numb: "なし",
      asks: ["眼球が内側に寄って、横（外側）を見ると物が二重に見える人がいます。"],
    }],
  },
  {
    id: "trochlear-nerve", region: "head", roots: "第IV脳神経", sign: "下を見ると物が二つに", motor: ["滑車神経"],
    sites: [{
      id: "skull", ja: "頭蓋の中（脳幹の背側から出た所）", from: [-0.3, 0.1, 1],
      cause: "頭の打撲（いちばん細く、脳幹の背側から出て長く走る）。",
      lost: ["superior-oblique"],
      cannot: [{ text: "眼球を内下方へ向ける（下を見る）" }],
      signs: [{ ja: "下を見ると二重", text: "階段を下りるときや本を読むときに物が二つに見える。首を麻痺していない側へ傾けると楽になる。" }],
      numb: "なし",
      asks: ["頭を打ったあと、階段を下りるときに物が二重に見え、首を傾けると楽になる人がいます。"],
    }],
  },
  {
    id: "hypoglossal-nerve", region: "head", roots: "第XII脳神経", sign: "舌が麻痺した側へ曲がる", motor: ["舌下神経"],
    sites: [{
      id: "neck", ja: "首の上部（下顎の下）", from: [-0.6, 0, 1],
      cause: "首の手術（頚動脈の手術など）、頭蓋底の腫瘍。",
      lost: ["genioglossus", "hyoglossus"],
      cannot: [{ text: "舌をまっすぐ前へ出す・左右へ動かす" }],
      signs: [{ ja: "舌が麻痺した側へ曲がる", text: "舌を出すと、麻痺した側へ曲がる。麻痺していない側のオトガイ舌筋だけが舌を前へ押し出すため。麻痺した側の舌はやせる。" }],
      numb: "なし（舌の感覚は舌神経・舌咽神経）",
      asks: ["舌を出すと片側へ曲がり、その側の舌がやせている人がいます。"],
    }],
  },
  {
    id: "recurrent-laryngeal-nerve", region: "head", roots: "第X脳神経（迷走神経）の枝", sign: "声がかすれる", motor: ["反回神経（下喉頭神経）"],
    sites: [{
      id: "neck", ja: "首の下部（気管と食道の間の溝）", from: [-0.4, 0.05, 1],
      cause: "甲状腺の手術。左は大動脈弓の下を回って上るので、大動脈瘤・肺がん・食道がんでも傷つく。",
      lost: ["posterior-cricoarytenoid", "lateral-cricoarytenoid", "thyroarytenoid", "vocalis", "transverse-arytenoid", "oblique-arytenoid", "aryepiglottic"],
      spared: "輪状甲状筋（声帯を張る）は上喉頭神経の外枝なので残る。",
      cannot: [
        { text: "声帯を開く（後輪状披裂筋。息を吸うとき）" },
        { text: "声帯を閉じる・声帯の張りを細かく変える" },
      ],
      signs: [{ ja: "嗄声", text: "片側では声がかすれる。両側だと声帯が開かず、息が苦しくなる。" }],
      numb: "声帯より下の喉頭の粘膜",
      asks: ["甲状腺の手術のあと、声がかすれるようになった人がいます。"],
    }],
  },
  {
    id: "accessory-nerve", region: "head", roots: "第XI脳神経", sign: "肩をすくめられない", motor: ["副神経・頚神経叢（C2〜4）"],
    sites: [{
      id: "neck", ja: "首の横（後頚三角）", from: [-1, 0.1, -0.35],
      cause: "首のリンパ節の手術や生検。後頚三角では神経が皮膚のすぐ下を通る。",
      lost: ["trapezius"],
      spared: "胸鎖乳突筋の枝は後頚三角に入る前に分かれるので、首は回せる。",
      cannot: [
        { text: "肩をすくめる（肩甲骨を上げる）", by: "descending-part-of-trapezius" },
        { text: "腕を頭の上まで上げる（肩甲骨を上へ回す）", by: "trapezius" },
      ],
      signs: [{ ja: "肩が下がる", text: "麻痺した側の肩が下がり、肩甲骨が外へずれる。重い物を持つと肩が痛む。" }],
      numb: "なし",
      asks: ["首のリンパ節の生検のあと、肩をすくめられず、肩が下がってきた人がいます。首を回すことはできます。"],
    }],
  },
];

export const cutById = new Map(NERVE_CUTS.map((cut) => [cut.id, cut]));

/** 当てる問い（症状 → 神経）。choices は答えと同じ体の部分から3つ（足りなければほかから） */
export interface CutQuestion {
  cut: NerveCut;
  site: CutSite;
  ask: string;
  choices: NerveCut[];
}

/** 問いを count 問作る。random を渡すと決まった並びにできる（テスト用） */
export function cutQuestions(count: number, random: () => number = Math.random, region?: CutRegion): CutQuestion[] {
  const shuffle = <T>(list: T[]): T[] => {
    const out = [...list];
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  };
  const pool = NERVE_CUTS.filter((cut) => !region || cut.region === region)
    .flatMap((cut) => cut.sites.flatMap((site) => site.asks.map((ask) => ({ cut, site, ask }))));
  // 同じ神経が続きすぎないよう、まず神経ごとに1問ずつ、足りなければ残りから
  const first: typeof pool = [];
  const rest: typeof pool = [];
  const seen = new Set<string>();
  for (const item of shuffle(pool)) {
    if (seen.has(item.cut.id)) rest.push(item);
    else {
      seen.add(item.cut.id);
      first.push(item);
    }
  }
  return [...first, ...rest].slice(0, count).map(({ cut, site, ask }) => {
    const same = shuffle(NERVE_CUTS.filter((other) => other !== cut && other.region === cut.region));
    const others = shuffle(NERVE_CUTS.filter((other) => other !== cut && other.region !== cut.region));
    return { cut, site, ask, choices: shuffle([cut, ...[...same, ...others].slice(0, 3)]) };
  });
}
