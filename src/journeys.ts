/**
 * からだの旅（#/journey。docs/普段使い.md「からだの旅」）。血液の1滴・食べ物・痛みの信号になって、分かれ道ごとに次の名前を選んで進む。
 * 旅は「所（stop）」のつながり。所は模型の道（at）の終わりにあり、分かれ道（fork）の選択肢を選ぶとその先の所へ動く。
 * 選択肢は3つの形: 正しい道（目当てに向かう）・違う所に着く道（to が行き先 dest の所。着いたら分かれ道に戻る）・
 * つながっていない道（blocked。動かずにその場で理由を出す）。目当て（mission）の通る所（checkpoints）へ向かうかで正しいかを決める
 */

export type JourneyId = "blood" | "food" | "pain";

export interface JourneyOption {
  /** ボタンの名前（器官・血管・神経の名前） */
  label: string;
  /** 図鑑の語 */
  term?: string;
  /** 進む先の所 */
  to?: string;
  /** つながっていない理由（動かない） */
  blocked?: string;
  /** 選んだあとに出す一言（正しくても違っても） */
  why?: string;
}

export interface JourneyStop {
  id: string;
  title: string;
  /** 着いたときの説明 */
  note: string;
  term?: string;
  /** 模型の道・たまりの ID（その終わりで止まる）。前の所からの道順は模型の道のつながりで決める */
  at: string;
  /** 行き先（ほかの目当ての途中で着くと、そこで止まり分かれ道に戻る） */
  dest?: boolean;
  /** 違う道を選んで着いたときの一言 */
  arrive?: string;
  /** 分かれ道（無ければ旅の終わり） */
  fork?: { prompt: string; options: JourneyOption[] };
}

export interface JourneyMission {
  id: string;
  /** 「〇〇へ」の〇〇（分かれ道の問いの {goal} に入る） */
  label: string;
  /** 通る所（順に）。最後が旅の終わり */
  checkpoints: string[];
  /** はじめの一言 */
  lead: string;
  /** 終わったときの一言 */
  done: string;
}

export interface Journey {
  id: JourneyId;
  title: string;
  /** 一覧の説明 */
  sub: string;
  /** 旅をするもの（「1滴」「食べ物」「信号」）。3Dの札と「〇〇は今」 */
  traveler: string;
  start: string;
  stops: JourneyStop[];
  missions: JourneyMission[];
  /** 一覧の色 */
  color: string;
  /** 模型の注（出典・作り物であること） */
  credit: string;
  /** 目当てと違う道を選んで動かないときの一言（{goal} に目当て） */
  offRoute: string;
}

const RETURN = "静脈血になった。右心房へ戻る道は？";
const tissue = (place: string) => `${place}の細胞に酸素と栄養を渡し、二酸化炭素と老廃物を受け取る → 静脈血（青）になる。`;

// ---------------------------------------------------------------- 血液の1滴

const BLOOD: Journey = {
  id: "blood",
  title: "血液の1滴の旅",
  sub: "右心房から肺を回り、選んだ臓器へ。分かれ道で血管の名前を選ぶ",
  traveler: "1滴",
  offRoute: "この道は{goal}へは通じていない。",
  color: "#c2493a",
  start: "ra",
  credit: "模型は動きの図鑑「肺循環と体循環」のわかりやすい模型（教科書の模式図にならった作り物）。1滴は拍動と弁の開き（ModularCirc の Korakianitis & Shi (2006) のモデルの値）に合わせて進む。",
  missions: [
    { id: "brain", label: "脳の左半分", checkpoints: ["brain", "home"], lead: "左の大脳に酸素を届けて、右心房へ戻ろう。", done: "左総頚動脈 → 内頚動脈で脳へ。脳は心拍出量の約15%を受け取る。" },
    { id: "r-arm", label: "右腕", checkpoints: ["r-arm", "home"], lead: "右腕の筋に酸素を届けて、右心房へ戻ろう。", done: "右腕へは腕頭動脈 → 右鎖骨下動脈 → 腋窩動脈 → 上腕動脈。左腕と違い、腕頭動脈を通る。" },
    { id: "l-arm", label: "左腕", checkpoints: ["l-arm", "home"], lead: "左腕の筋に酸素を届けて、右心房へ戻ろう。", done: "左腕へは大動脈弓から直接出る左鎖骨下動脈。右腕と違い、腕頭動脈を通らない。" },
    { id: "gut", label: "小腸", checkpoints: ["gut", "home"], lead: "小腸に酸素を届け、吸収した栄養を受け取って、右心房へ戻ろう。", done: "腸の静脈血は門脈で肝臓を通ってから戻る。毛細血管を2回通る特別な道。" },
    { id: "r-kidney", label: "右の腎臓", checkpoints: ["r-kidney", "home"], lead: "右の腎臓で血液をこして、右心房へ戻ろう。", done: "腎臓は心拍出量の約20%を受け取り、1日に約150 Lの原尿をこし出す。" },
    { id: "l-kidney", label: "左の腎臓", checkpoints: ["l-kidney", "home"], lead: "左の腎臓で血液をこして、右心房へ戻ろう。", done: "左の腎静脈は腹大動脈の前を横切って下大静脈へ入るので、右より長い。" },
    { id: "r-leg", label: "右脚", checkpoints: ["r-leg", "home"], lead: "右脚の筋に酸素を届けて、右心房へ戻ろう。", done: "腹大動脈は第4腰椎の高さで左右の総腸骨動脈に分かれる。脚へは外腸骨動脈 → 大腿動脈。" },
    { id: "l-leg", label: "左脚", checkpoints: ["l-leg", "home"], lead: "左脚の筋に酸素を届けて、右心房へ戻ろう。", done: "脚の静脈血は大腿静脈 → 外腸骨静脈 → 総腸骨静脈 → 下大静脈と上る。静脈弁が逆流を防ぐ。" },
  ],
  stops: [
    {
      id: "ra", title: "右心房", term: "right-atrium", at: "ra",
      note: "全身から戻った静脈血（酸素の少ない血液・青）がたまる所。ここから出発。",
      fork: {
        prompt: "右心房から右心室へ。通る弁は？",
        options: [
          { label: "三尖弁", term: "tricuspid-valve", to: "rv", why: "右心房と右心室の間の弁。尖が3枚。" },
          { label: "僧帽弁", term: "mitral-valve", blocked: "僧帽弁は左心房と左心室の間の弁（尖が2枚）。右心房からは通れない。" },
          { label: "肺動脈弁", term: "pulmonary-valve", blocked: "肺動脈弁は右心室の出口（右心室と肺動脈幹の間）。右心房の出口ではない。" },
          { label: "大動脈弁", term: "aortic-valve", blocked: "大動脈弁は左心室の出口。右心房とはつながっていない。" },
        ],
      },
    },
    {
      id: "rv", title: "右心室", term: "right-ventricle", at: "rv",
      note: "三尖弁を通って入った。心室が縮むと、出口の弁が開いて押し出される。",
      fork: {
        prompt: "右心室が縮む。押し出される先の血管は？",
        options: [
          { label: "肺動脈幹", term: "pulmonary-trunk", to: "pt", why: "肺動脈弁を通って肺動脈幹へ。ここから肺循環。" },
          { label: "大動脈", term: "ascending-aorta", blocked: "大動脈は左心室から出る血管。右心室からは肺へ向かう血管しか出ない。" },
          { label: "上大静脈", term: "superior-vena-cava", blocked: "上大静脈は右心房へ入ってくる血管。心室から出る血管は動脈だけ。" },
          { label: "肺静脈", term: "pulmonary-veins", blocked: "肺静脈は肺から左心房へ戻る血管。右心室とはつながっていない。" },
        ],
      },
    },
    {
      id: "pt", title: "肺動脈幹", term: "pulmonary-trunk", at: "pt",
      note: "静脈血を肺へ運ぶ。動脈なのに静脈血が流れる（動脈＝心臓から出ていく血管）。",
      fork: {
        prompt: "肺動脈幹が左右に分かれる。どちらの肺へ行く？",
        options: [
          { label: "右肺動脈", term: "right-pulmonary-artery", to: "r-lung", why: "右肺動脈は大動脈弓の下をくぐって右肺へ。どちらの肺でも酸素を受け取れる。" },
          { label: "左肺動脈", term: "left-pulmonary-artery", to: "l-lung", why: "左肺動脈は短く、すぐ左肺へ。どちらの肺でも酸素を受け取れる。" },
        ],
      },
    },
    ...(["r", "l"] as const).map((side): JourneyStop => ({
      id: `${side}-lung`, title: side === "r" ? "右肺の毛細血管" : "左肺の毛細血管", term: "capillary", at: `${side}-lung-c`,
      note: "肺胞のまわりの毛細血管で、二酸化炭素を出し、酸素を受け取る（ガス交換）→ 動脈血（赤）になった。",
      fork: {
        prompt: "動脈血になった。心臓へ戻る血管は？",
        options: [
          { label: "肺静脈", term: "pulmonary-veins", to: "la", why: "左右2本ずつ、計4本の肺静脈が左心房へ入る。静脈なのに動脈血が流れる。" },
          { label: "肺動脈", term: "pulmonary-artery", blocked: "肺動脈は心臓から肺へ向かう血管（今来た道）。血液は逆には流れない。" },
          { label: "上大静脈", term: "superior-vena-cava", blocked: "上大静脈は頭と腕の静脈血を右心房へ戻す血管。肺とはつながっていない。" },
        ],
      },
    })),
    {
      id: "la", title: "左心房", term: "left-atrium", at: "la",
      note: "肺から戻った動脈血がたまる。肺循環の終わり。",
      fork: {
        prompt: "左心房から左心室へ。通る弁は？",
        options: [
          { label: "僧帽弁", term: "mitral-valve", to: "lv", why: "左心房と左心室の間の弁（二尖弁）。尖が2枚。" },
          { label: "三尖弁", term: "tricuspid-valve", blocked: "三尖弁は右心房と右心室の間。左心房からは通れない。" },
          { label: "大動脈弁", term: "aortic-valve", blocked: "大動脈弁は左心室の出口。左心房の出口ではない。" },
        ],
      },
    },
    {
      id: "lv", title: "左心室", term: "left-ventricle", at: "lv",
      note: "体循環の始まり。全身へ送るので壁がいちばん厚く、圧は約120 mmHg（右心室の約5倍）。",
      fork: {
        prompt: "左心室が縮む。押し出される先の血管は？",
        options: [
          { label: "上行大動脈", term: "ascending-aorta", to: "arch", why: "大動脈弁を通って上行大動脈へ。根もとから冠状動脈が出て、心臓自身にも血液を送る。" },
          { label: "肺動脈幹", term: "pulmonary-trunk", blocked: "肺動脈幹は右心室から出る血管。" },
          { label: "肺静脈", term: "pulmonary-veins", blocked: "肺静脈は左心房へ入ってくる血管（今来た道）。" },
        ],
      },
    },
    {
      id: "arch", title: "大動脈弓", term: "aortic-arch", at: "aorta",
      note: "上行大動脈が左後ろへアーチを描いて曲がる所。上へ3本の枝が出て、本体は胸大動脈となって下る。",
      fork: {
        prompt: "{goal}へ行くには、どの血管へ？",
        options: [
          { label: "腕頭動脈", term: "brachiocephalic-trunk", to: "r-arm", why: "大動脈弓の1本目の枝（右側だけにある）。右鎖骨下動脈（右腕へ）と右総頚動脈（脳の右半分へ）に分かれる。" },
          { label: "左総頚動脈", term: "common-carotid-artery", to: "brain", why: "大動脈弓の2本目の枝。内頚動脈（脳へ）と外頚動脈（顔へ）に分かれる。" },
          { label: "左鎖骨下動脈", term: "subclavian-artery", to: "l-arm", why: "大動脈弓の3本目の枝。腋窩動脈 → 上腕動脈と名前を変えて左腕へ。" },
          { label: "胸大動脈", term: "thoracic-aorta", to: "abd", why: "大動脈の本体。胸の後ろを下り、横隔膜の大動脈裂孔を通って腹大動脈になる。腹と脚へ向かう。" },
        ],
      },
    },
    {
      id: "abd", title: "腹大動脈", term: "abdominal-aorta", at: "aorta-1",
      note: "横隔膜を通り抜けて腹へ。腹の臓器への枝を出しながら下る。",
      fork: {
        prompt: "{goal}へ行く枝は？",
        options: [
          { label: "上腸間膜動脈", term: "superior-mesenteric-artery", to: "gut", why: "腹大動脈の前から出て、小腸と大腸の右半分へ。" },
          { label: "右腎動脈", term: "renal-artery", to: "r-kidney", why: "腹大動脈の横から出る。右の腎動脈は下大静脈の後ろを通る。" },
          { label: "左腎動脈", term: "renal-artery", to: "l-kidney", why: "腹大動脈の横から出て左の腎臓へ。" },
          { label: "総腸骨動脈", term: "common-iliac-artery", to: "iliac", why: "腹大動脈の終わり（第4腰椎の高さ）で左右に分かれる。骨盤と脚へ。" },
        ],
      },
    },
    {
      id: "iliac", title: "腹大動脈の分かれ目", term: "common-iliac-artery", at: "aorta-3",
      note: "第4腰椎の高さで、腹大動脈が左右の総腸骨動脈に分かれる。",
      fork: {
        prompt: "{goal}へは、どちらへ？",
        options: [
          { label: "右総腸骨動脈", term: "common-iliac-artery", to: "r-leg", why: "外腸骨動脈 → 鼡径靱帯の下をくぐって大腿動脈になり、右脚へ。" },
          { label: "左総腸骨動脈", term: "common-iliac-artery", to: "l-leg", why: "外腸骨動脈 → 鼡径靱帯の下をくぐって大腿動脈になり、左脚へ。" },
        ],
      },
    },
    {
      id: "brain", title: "脳の毛細血管", term: "cerebrum", at: "head-c", dest: true,
      note: tissue("脳"), arrive: "脳に着いた。左総頚動脈 → 内頚動脈と進むと脳へ。",
      fork: {
        prompt: RETURN,
        options: [
          { label: "上大静脈", term: "superior-vena-cava", to: "home", why: "脳の静脈血は硬膜静脈洞 → 内頚静脈 → 腕頭静脈 → 上大静脈と戻る。" },
          { label: "下大静脈", term: "inferior-vena-cava", blocked: "下大静脈が集めるのは横隔膜より下（腹と脚）の静脈血。頭からは上大静脈。" },
          { label: "門脈", term: "hepatic-portal-vein", blocked: "門脈が集めるのは消化管と脾臓の静脈血（肝臓へ運ぶ）。頭の血液は入らない。" },
        ],
      },
    },
    ...(["r", "l"] as const).map((side): JourneyStop => ({
      id: `${side}-arm`, title: side === "r" ? "右腕の毛細血管" : "左腕の毛細血管", term: "upper-limb", at: `${side}-arm-c`, dest: true,
      note: tissue(side === "r" ? "右腕の筋や皮膚" : "左腕の筋や皮膚"),
      arrive: side === "r" ? "右腕に着いた。腕頭動脈 → 右鎖骨下動脈と進むと右腕へ。" : "左腕に着いた。左鎖骨下動脈は左腕への道。",
      fork: {
        prompt: RETURN,
        options: [
          { label: "上大静脈", term: "superior-vena-cava", to: "home", why: "腕の静脈血は上腕静脈 → 腋窩静脈 → 鎖骨下静脈 → 腕頭静脈 → 上大静脈と戻る。" },
          { label: "下大静脈", term: "inferior-vena-cava", blocked: "下大静脈が集めるのは横隔膜より下の静脈血。腕からは上大静脈。" },
          { label: "肺静脈", term: "pulmonary-veins", blocked: "肺静脈は肺から左心房へ戻る血管。腕の血液は入らない。" },
        ],
      },
    })),
    {
      id: "gut", title: "小腸の毛細血管", term: "small-intestine", at: "gut-c", dest: true,
      note: "小腸の壁に酸素を渡し、吸収したブドウ糖やアミノ酸を受け取る → 栄養の多い静脈血になる。",
      arrive: "小腸に着いた。上腸間膜動脈は腸への道。",
      fork: {
        prompt: "栄養の多い静脈血。まず向かうのは？",
        options: [
          { label: "門脈", term: "hepatic-portal-vein", to: "liver", why: "上腸間膜静脈と脾静脈が合わさって門脈になり、肝臓へ入る。栄養をまず肝臓で処理する。" },
          { label: "下大静脈", term: "inferior-vena-cava", blocked: "腸の静脈血は下大静脈へ直接は入らない。先に門脈で肝臓を通る。" },
          { label: "腎静脈", term: "renal-vein", blocked: "腎静脈は腎臓の静脈血を運ぶ血管。腸とはつながっていない。" },
        ],
      },
    },
    {
      id: "liver", title: "肝臓の類洞", term: "liver", at: "liver-c",
      note: "門脈（栄養）と肝動脈（酸素）の血液が類洞で混ざって流れる。肝細胞が栄養をたくわえ、毒を分解する。",
      fork: {
        prompt: "肝臓を出た血液が通る静脈は？",
        options: [
          { label: "肝静脈", term: "hepatic-veins", to: "home", why: "類洞 → 中心静脈 → 肝静脈（3本）→ すぐ下大静脈へ入り、右心房へ。" },
          { label: "門脈", term: "hepatic-portal-vein", blocked: "門脈は肝臓へ入ってくる側（今来た道）。" },
          { label: "上大静脈", term: "superior-vena-cava", blocked: "上大静脈は頭と腕の静脈血を集める。肝臓の血液は下大静脈へ。" },
        ],
      },
    },
    ...(["r", "l"] as const).map((side): JourneyStop => ({
      id: `${side}-kidney`, title: side === "r" ? "右の腎臓の毛細血管" : "左の腎臓の毛細血管", term: "kidney", at: `${side}-kidney-c`, dest: true,
      note: "糸球体で血液をこして原尿をつくり、尿細管のまわりの毛細血管で水や栄養を取り戻す → 静脈血になる。",
      arrive: side === "r" ? "右の腎臓に着いた。腎動脈は腹大動脈の横から出る。" : "左の腎臓に着いた。腎動脈は腹大動脈の横から出る。",
      fork: {
        prompt: RETURN,
        options: [
          { label: "下大静脈", term: "inferior-vena-cava", to: "home", why: side === "r" ? "右腎静脈は短く、すぐ下大静脈へ。" : "左腎静脈は腹大動脈の前を横切って下大静脈へ（右より長い）。" },
          { label: "門脈", term: "hepatic-portal-vein", blocked: "門脈に入るのは消化管と脾臓の静脈血だけ。腎臓の血液は入らない。" },
          { label: "上大静脈", term: "superior-vena-cava", blocked: "上大静脈は横隔膜より上（頭と腕）の静脈血を集める。" },
        ],
      },
    })),
    ...(["r", "l"] as const).map((side): JourneyStop => ({
      id: `${side}-leg`, title: side === "r" ? "右脚の毛細血管" : "左脚の毛細血管", term: "lower-limb", at: `${side}-leg-c`, dest: true,
      note: tissue(side === "r" ? "右脚の筋や皮膚" : "左脚の筋や皮膚"),
      arrive: side === "r" ? "右脚に着いた。右総腸骨動脈は右脚への道。" : "左脚に着いた。左総腸骨動脈は左脚への道。",
      fork: {
        prompt: RETURN,
        options: [
          { label: "下大静脈", term: "inferior-vena-cava", to: "home", why: "大腿静脈 → 外腸骨静脈 → 総腸骨静脈 → 下大静脈。脚の筋が縮むと静脈が押され、静脈弁で上へ送られる。" },
          { label: "上大静脈", term: "superior-vena-cava", blocked: "上大静脈は頭と腕の静脈血を集める。脚からは下大静脈。" },
          { label: "門脈", term: "hepatic-portal-vein", blocked: "門脈に入るのは消化管と脾臓の静脈血だけ。" },
        ],
      },
    })),
    {
      id: "home", title: "右心房（1周）", term: "right-atrium", at: "ra",
      note: "体を1周して右心房に戻った。安静時、血液は約1分で体を1周する。",
    },
  ],
};

// ---------------------------------------------------------------- 食べ物

const FOOD: Journey = {
  id: "food",
  title: "食べ物の旅",
  sub: "口から肛門まで。飲み込む・胃・小腸・大腸の順に、次の器官を選ぶ",
  traveler: "食べ物",
  offRoute: "この道は{goal}へは通じていない。",
  color: "#c07a2c",
  start: "mouth",
  credit: "模型は教科書の模式図にならった作り物です（器官の大きさ・位置は分かりやすさを優先）。",
  missions: [
    { id: "all", label: "肛門", checkpoints: ["anus"], lead: "ひと口の食べ物になって、口から肛門まで進もう。", done: "消化管は口から肛門まで1本の管。長さは生きている人で約5〜6 m、食べてから出るまで1〜3日かかる。" },
  ],
  stops: [
    {
      id: "mouth", title: "口腔", term: "oral-cavity", at: "mouth",
      note: "歯でかみ砕き（咀嚼）、唾液のアミラーゼでデンプンの分解が始まる。舌で丸めて奥へ送る。",
      fork: {
        prompt: "飲み込む（嚥下）。舌が食べ物を押しこむ先は？",
        options: [
          { label: "咽頭", term: "pharynx", to: "pharynx", why: "口腔の奥は咽頭（咽頭口部）。ここからは自分の意志では止められない（嚥下反射）。" },
          { label: "気管", term: "trachea", blocked: "口腔から気管へ直接の道は無い。気管の入口（喉頭）は咽頭の下にある。" },
          { label: "食道", term: "esophagus", blocked: "食道は咽頭の下から始まる。口腔とは直接つながっていない。" },
        ],
      },
    },
    {
      id: "pharynx", title: "咽頭", term: "pharynx", at: "pharynx",
      note: "食べ物の道と空気の道が交わる所。上は鼻腔、前下は喉頭、後ろ下は食道へ通じる。",
      fork: {
        prompt: "咽頭から3方向へ道がある。食べ物が進むのは？",
        options: [
          { label: "食道", term: "esophagus", to: "esophagus", why: "咽頭喉頭部の後ろから食道へ。飲み込む瞬間だけ食道の入口がゆるむ。" },
          { label: "喉頭", term: "larynx", to: "lungs", why: "喉頭は空気の道。飲み込むときは喉頭が上がり、喉頭蓋が入口にふたをする。" },
          { label: "鼻腔", term: "nasal-cavity", to: "nasal", why: "咽頭鼻部から上は鼻腔。飲み込むときは軟口蓋が上がって鼻への道をふさぐ。" },
        ],
      },
    },
    {
      id: "lungs", title: "気管に入った（誤嚥）", term: "trachea", at: "trachea", dest: true,
      note: "", arrive: "喉頭から気管に入ってしまった（誤嚥）。せきこんで外へ出す。お年寄りでは誤嚥性肺炎のもとになる。右の主気管支の方が太く垂直に近いので、右の肺に入りやすい。",
    },
    {
      id: "nasal", title: "鼻腔に入った", term: "nasal-cavity", at: "nasal", dest: true,
      note: "", arrive: "咽頭鼻部を上って鼻腔に入ってしまった（むせて鼻から出る）。ふつうは飲み込むとき軟口蓋が上がって鼻への道をふさぐ。",
    },
    {
      id: "esophagus", title: "食道", term: "esophagus", at: "esophagus",
      note: "長さ約25 cmの筋の管。蠕動で約10秒で胃へ送る（逆立ちしていても進む）。気管の後ろを下り、横隔膜の食道裂孔を通る。",
      fork: {
        prompt: "食道の下の出口（噴門）の先は？",
        options: [
          { label: "胃", term: "stomach", to: "stomach", why: "噴門は胃の入口。ふだんは閉じていて、胃の中身の逆流を防ぐ。" },
          { label: "十二指腸", term: "duodenum", blocked: "十二指腸は胃の出口（幽門）の先。食道とは直接つながっていない。" },
          { label: "気管", term: "trachea", blocked: "気管は食道の前を並んで下るが、つながっていない。" },
        ],
      },
    },
    {
      id: "stomach", title: "胃", term: "stomach", at: "stomach",
      note: "胃酸（塩酸）で殺菌し、ペプシンでタンパク質を分解し始める。2〜4時間ためて、どろどろの粥状にしてから少しずつ送る。",
      fork: {
        prompt: "胃の出口（幽門）の先は？",
        options: [
          { label: "十二指腸", term: "duodenum", to: "duodenum", why: "幽門括約筋がゆるむたびに、少しずつ十二指腸へ送られる。" },
          { label: "空腸", term: "jejunum", blocked: "空腸は十二指腸の先。幽門のすぐ先は十二指腸。" },
          { label: "横行結腸", term: "transverse-colon", blocked: "横行結腸は胃の下にぶら下がる大腸。胃とはつながっていない。" },
        ],
      },
    },
    {
      id: "duodenum", title: "十二指腸", term: "duodenum", at: "duodenum",
      note: "長さ約25 cm（指12本分）のC字の管。下行部の大十二指腸乳頭から胆汁（脂肪を乳化）と膵液（消化酵素）が流れこむ。",
      fork: {
        prompt: "大十二指腸乳頭には胆汁と膵液の出口がある。食べ物が進むのは？",
        options: [
          { label: "空腸", term: "jejunum", to: "jejunum", why: "十二指腸空腸曲を曲がって空腸へ。ここから腸間膜にぶら下がり、よく動く。" },
          { label: "総胆管", term: "bile-duct", to: "gallbladder", why: "総胆管は胆汁が肝臓・胆嚢から十二指腸へ流れ出る道。" },
          { label: "膵管", term: "pancreatic-duct", to: "pancreas", why: "膵管は膵液が膵臓から十二指腸へ流れ出る道。" },
        ],
      },
    },
    {
      id: "gallbladder", title: "胆嚢に着いた", term: "gallbladder", at: "bile", dest: true,
      note: "", arrive: "総胆管を逆に上って胆嚢に着いてしまった。総胆管は胆汁が十二指腸へ流れ出る道で、ふだん食べ物は入らない（乳頭の括約筋が閉じている）。胆嚢は肝臓がつくった胆汁をためて濃くする袋。",
    },
    {
      id: "pancreas", title: "膵臓に着いた", term: "pancreas", at: "pancreatic-duct", dest: true,
      note: "", arrive: "膵管を逆に上って膵臓に着いてしまった。膵管は膵液（トリプシン・リパーゼ・アミラーゼなど）が十二指腸へ流れ出る道で、食べ物は入らない。",
    },
    {
      id: "jejunum", title: "空腸", term: "jejunum", at: "jejunum",
      note: "小腸の初めの約2/5。輪状ひだと絨毛で広い面をつくり、栄養の吸収の中心。左上の腹にある。",
      fork: {
        prompt: "空腸の次は？",
        options: [
          { label: "回腸", term: "ileum", to: "ileum", why: "空腸と回腸のはっきりした境は無い。小腸の残り約3/5が回腸。" },
          { label: "盲腸", term: "cecum", blocked: "盲腸は大腸の始まり。小腸の終わり（回腸）から入る。" },
          { label: "十二指腸", term: "duodenum", blocked: "十二指腸は今来た道。蠕動で口側から肛門側へ一方通行に進む。" },
        ],
      },
    },
    {
      id: "ileum", title: "回腸", term: "ileum", at: "ileum",
      note: "右下の腹にある小腸の終わりの部分。ビタミンB12と胆汁酸を吸収する。リンパ小節が集まったパイエル板がある。",
      fork: {
        prompt: "回腸の終わり（回盲弁）を通ると、どこへ？",
        options: [
          { label: "盲腸", term: "cecum", to: "cecum", why: "回腸は右下の腹で大腸の盲腸に横から入る（回腸口・回盲弁）。弁が大腸からの逆流を防ぐ。" },
          { label: "直腸", term: "rectum", blocked: "直腸は大腸の終わり。回腸がつながるのは大腸の始まり。" },
          { label: "S状結腸", term: "sigmoid-colon", blocked: "S状結腸は左下の腹の大腸。回腸は右下で大腸に入る。" },
        ],
      },
    },
    {
      id: "cecum", title: "盲腸", term: "cecum", at: "cecum",
      note: "大腸の始まり。回腸口より下の行き止まりの袋で、下端から虫垂が出る。",
      fork: {
        prompt: "盲腸から先へ。進むのは？",
        options: [
          { label: "上行結腸", term: "ascending-colon", to: "ascending", why: "盲腸から腹の右側を上るのが上行結腸。" },
          { label: "虫垂", term: "appendix", to: "appendix", why: "虫垂は盲腸の下端から出る細い管（長さ6〜8 cm）。先は閉じている。" },
          { label: "下行結腸", term: "descending-colon", blocked: "下行結腸は腹の左側を下る大腸。上行結腸と横行結腸を通った先。" },
        ],
      },
    },
    {
      id: "appendix", title: "虫垂に入った", term: "appendix", at: "appendix", dest: true,
      note: "", arrive: "虫垂に入って行き止まり。虫垂の入口がふさがって中で細菌が増えると虫垂炎（右下の腹の痛み・マックバーニー点）。リンパ組織が多い。",
    },
    {
      id: "ascending", title: "上行結腸", term: "ascending-colon", at: "ascending",
      note: "腹の右側を上る。大腸では水分と電解質を吸収し、液状の内容物を固めていく。後腹壁に固定されている。",
      fork: {
        prompt: "肝臓の下で左へ曲がる（右結腸曲）。次は？",
        options: [
          { label: "横行結腸", term: "transverse-colon", to: "transverse", why: "腹を右から左へ横切る大腸。" },
          { label: "下行結腸", term: "descending-colon", blocked: "下行結腸は横行結腸の先。" },
          { label: "十二指腸", term: "duodenum", blocked: "十二指腸は上行結腸の近くにあるが、つながっていない（小腸の初め）。" },
        ],
      },
    },
    {
      id: "transverse", title: "横行結腸", term: "transverse-colon", at: "transverse",
      note: "胃の下を右から左へ横切る。横行結腸間膜でぶら下がり、よく動く。",
      fork: {
        prompt: "脾臓の近くで下へ曲がる（左結腸曲）。次は？",
        options: [
          { label: "下行結腸", term: "descending-colon", to: "descending", why: "腹の左側を下る大腸。" },
          { label: "S状結腸", term: "sigmoid-colon", blocked: "S状結腸は下行結腸の先。" },
          { label: "上行結腸", term: "ascending-colon", blocked: "上行結腸は今来た道（右側）。" },
        ],
      },
    },
    {
      id: "descending", title: "下行結腸", term: "descending-colon", at: "descending",
      note: "腹の左側を下る。上行結腸と同じく後腹壁に固定されている（二次的な腹膜後器官）。",
      fork: {
        prompt: "左下の腹（骨盤の入口）まで来た。次は？",
        options: [
          { label: "S状結腸", term: "sigmoid-colon", to: "sigmoid", why: "S字に曲がる大腸。S状結腸間膜でぶら下がり、動きやすい。" },
          { label: "直腸", term: "rectum", blocked: "直腸はS状結腸の先。" },
          { label: "盲腸", term: "cecum", blocked: "盲腸は右下の腹にある大腸の始まり。" },
        ],
      },
    },
    {
      id: "sigmoid", title: "S状結腸", term: "sigmoid-colon", at: "sigmoid",
      note: "便をためておく所。大腸がんができやすい場所の1つ。",
      fork: {
        prompt: "S状結腸の先は？",
        options: [
          { label: "直腸", term: "rectum", to: "rectum", why: "第3仙椎の高さから直腸になる。仙骨の前をまっすぐ下る。" },
          { label: "肛門管", term: "anal-canal", blocked: "肛門管は直腸の先。" },
          { label: "膀胱", term: "urinary-bladder", blocked: "膀胱は直腸の前にある、尿をためる別の袋。腸とはつながっていない。" },
        ],
      },
    },
    {
      id: "rectum", title: "直腸", term: "rectum", at: "rectum",
      note: "便がたまって壁がのびると、便意を感じる（排便反射）。",
      fork: {
        prompt: "最後の出口へ。通るのは？",
        options: [
          { label: "肛門管", term: "anal-canal", to: "anus", why: "肛門管は約3〜4 cm。内肛門括約筋（自分では動かせない）と外肛門括約筋（自分で締められる）が囲む。" },
          { label: "膀胱", term: "urinary-bladder", blocked: "膀胱は直腸の前にある別の袋。" },
          { label: "S状結腸", term: "sigmoid-colon", blocked: "S状結腸は今来た道。" },
        ],
      },
    },
    {
      id: "anus", title: "肛門", term: "anus", at: "anal",
      note: "口から肛門まで、1本の管を通り抜けた。",
    },
  ],
};

// ---------------------------------------------------------------- 痛みの信号

const PAIN: Journey = {
  id: "pain",
  title: "痛みの信号の旅",
  sub: "指先から脊髄を通って脳まで。根・後角・伝導路・視床の順に選ぶ",
  traveler: "信号",
  offRoute: "{goal}の信号はこの道を通らない。",
  color: "#b8862b",
  start: "finger",
  credit: "模型は教科書の伝導路の模式図にならった作り物です（脊髄と脳は大きく、腕は短くしてある）。右の人差し指から、反対側（左）の大脳へ。",
  missions: [
    {
      id: "pain", label: "痛み", checkpoints: ["stt", "cortex"],
      lead: "右の人差し指の先に針が刺さった。痛みの信号になって、脳まで届けよう。",
      done: "痛みと温度の道（外側脊髄視床路）: 後角で乗りかえ、すぐ反対側へ渡って上る。視床でもう一度乗りかえて中心後回へ。3つのニューロンをつなぐ。",
    },
    {
      id: "touch", label: "触った感じ", checkpoints: ["dc", "cortex"],
      lead: "右の人差し指で物にそっと触れた。触った感じ（触覚・振動）の信号になって、脳まで届けよう。",
      done: "触覚と位置の道（後索–内側毛帯路）: 同じ側の後索を上り、延髄で乗りかえて反対側へ。痛みの道とは交叉する高さが違う。",
    },
  ],
  stops: [
    {
      id: "finger", title: "人差し指の皮膚", term: "skin", at: "skin",
      note: "皮膚の受容器が刺激を電気の信号（活動電位）に変える。痛みは自由神経終末、触った感じはマイスナー小体などが受け取る。",
      fork: {
        prompt: "人差し指の手のひら側の感覚を運ぶ神経は？",
        options: [
          { label: "正中神経", term: "median-nerve", to: "median", why: "正中神経は母指から薬指の母指側半分までの手のひら側を受け持つ。" },
          { label: "尺骨神経", term: "ulnar-nerve", blocked: "尺骨神経が受け持つのは小指と、薬指の小指側半分。" },
          { label: "橈骨神経", term: "radial-nerve", blocked: "橈骨神経が受け持つのは手の甲の母指側。手のひら側の指先は受け持たない。" },
        ],
      },
    },
    {
      id: "median", title: "正中神経", term: "median-nerve", at: "median",
      note: "1本目のニューロン（1次ニューロン）の長い線維。腕を上り、腕神経叢を通って頚の脊髄神経（C6〜C8）になる。細胞体は脊髄神経節にある。",
      fork: {
        prompt: "脊髄神経が脊髄に入る直前で2本の根に分かれる。感覚の信号が通るのは？",
        options: [
          { label: "後根", term: "posterior-root", to: "root", why: "感覚の線維は後根から入る（ベル–マジャンディの法則）。後根には脊髄神経節がある。" },
          { label: "前根", term: "anterior-root", blocked: "前根は脊髄から出ていく運動の線維の道。感覚の信号は入れない。" },
        ],
      },
    },
    {
      id: "root", title: "後根（脊髄神経節）", term: "posterior-root", at: "posterior-root",
      note: "脊髄神経節を通って、脊髄の後ろ側から入った。ここから先、痛みと触った感じで道が分かれる。",
      fork: {
        prompt: "{goal}の信号が脊髄に入って向かうのは？",
        options: [
          { label: "後角", term: "posterior-horn", to: "horn", why: "痛みと温度の線維は、入った高さの後角ですぐ2次ニューロンに乗りかえる。" },
          { label: "後索", term: "posterior-funiculus", to: "dc", why: "触覚・振動・位置の線維は、乗りかえずに同じ側の後索をそのまま上る。" },
          { label: "前角", term: "anterior-horn", to: "reflex", why: "前角には筋を動かす運動ニューロンがある。" },
        ],
      },
    },
    {
      id: "reflex", title: "前角から筋へ（反射）", term: "anterior-horn", at: "reflex", dest: true,
      note: "", arrive: "介在ニューロンを通って前角の運動ニューロンへ伝わり、前根から筋へ。腕の筋が縮んで手を引っこめた（屈曲反射）。脳を通らないので速いが、これだけでは「痛い」とは感じない。",
    },
    {
      id: "horn", title: "後角", term: "posterior-horn", at: "horn",
      note: "ここで2本目のニューロン（2次ニューロン）に乗りかえた（シナプス）。",
      fork: {
        prompt: "2次ニューロンの線維が上る道は？",
        options: [
          { label: "外側脊髄視床路（反対側）", term: "lateral-spinothalamic-tract", to: "stt", why: "前白交連を通ってすぐ反対側へ渡り、側索を上る。" },
          { label: "外側脊髄視床路（同じ側）", term: "lateral-spinothalamic-tract", blocked: "痛みの線維は、入った高さ（1〜2髄節上まで）で反対側へ渡ってから上る。脊髄の右半分が傷つくと、左側の痛みが分からなくなる（ブラウン–セカール症候群）。" },
          { label: "後索", term: "posterior-funiculus", blocked: "後索を上るのは触覚・振動・位置の線維。痛みの線維は後索を通らない。" },
        ],
      },
    },
    {
      id: "stt", title: "外側脊髄視床路", term: "lateral-spinothalamic-tract", at: "stt",
      note: "反対側（左）の側索を上ってきた。延髄・橋・中脳を通り抜けて、もうすぐ間脳。",
      fork: {
        prompt: "線維が着いて、3本目のニューロンに乗りかえる所は？",
        options: [
          { label: "視床", term: "thalamus", to: "thalamus", why: "視床（後外側腹側核）は、においを除く全身の感覚が大脳へ行く前の中継所。" },
          { label: "小脳", term: "cerebellum", to: "cerebellum", why: "小脳へ行くのは脊髄小脳路（筋や関節の位置の情報）。" },
          { label: "中心後回", term: "postcentral-gyrus", blocked: "大脳皮質へ行く前に、視床で乗りかえる。" },
        ],
      },
    },
    {
      id: "dc", title: "後索（楔状束）", term: "cuneate-fasciculus", at: "dc",
      note: "同じ側（右）の後索を上ってきた。腕からの線維は外側の楔状束、脚からの線維は内側の薄束を通る。",
      fork: {
        prompt: "延髄で2次ニューロンに乗りかえる核は？",
        options: [
          { label: "楔状束核", term: "cuneate-fasciculus", to: "nucleus", why: "楔状束の線維は延髄の楔状束核で乗りかえる。" },
          { label: "薄束核", term: "gracile-fasciculus", blocked: "薄束核で乗りかえるのは、脚（下半身）から薄束を上ってきた線維。" },
          { label: "視床", term: "thalamus", blocked: "後索の線維は、視床へ行く前に延髄で乗りかえる。" },
        ],
      },
    },
    {
      id: "nucleus", title: "楔状束核（延髄）", term: "medulla-oblongata", at: "nucleus",
      note: "延髄で2次ニューロンに乗りかえた。",
      fork: {
        prompt: "2次ニューロンの線維は延髄で反対側へ渡る（毛帯交叉）。上る道は？",
        options: [
          { label: "内側毛帯", to: "ml", why: "交叉した線維は内側毛帯となって脳幹を上る。" },
          { label: "外側脊髄視床路", term: "lateral-spinothalamic-tract", blocked: "外側脊髄視床路は痛みと温度の道（脊髄の後角で乗りかえた線維）。" },
          { label: "後索", term: "posterior-funiculus", blocked: "後索は今来た道。乗りかえた線維は反対側へ渡る。" },
        ],
      },
    },
    {
      id: "ml", title: "内側毛帯", at: "ml",
      note: "反対側（左）の内側毛帯を上ってきた。延髄・橋・中脳を通り抜けて、もうすぐ間脳。",
      fork: {
        prompt: "線維が着いて、3本目のニューロンに乗りかえる所は？",
        options: [
          { label: "視床", term: "thalamus", to: "thalamus", why: "触った感じも、視床（後外側腹側核）で乗りかえる。" },
          { label: "小脳", term: "cerebellum", to: "cerebellum", why: "小脳へ行くのは脊髄小脳路（筋や関節の位置の情報）。" },
          { label: "中心後回", term: "postcentral-gyrus", blocked: "大脳皮質へ行く前に、視床で乗りかえる。" },
        ],
      },
    },
    {
      id: "cerebellum", title: "小脳に着いた", term: "cerebellum", at: "cerebellum", dest: true,
      note: "", arrive: "小脳に着いてしまった。小脳へ行くのは脊髄小脳路で、筋や関節の位置の情報を運び、動きをなめらかにするのに使う。意識にはのぼらないので、ここでは痛みも触った感じも分からない。",
    },
    {
      id: "thalamus", title: "視床", term: "thalamus", at: "thalamus",
      note: "視床（後外側腹側核）で3本目のニューロン（3次ニューロン）に乗りかえた。",
      fork: {
        prompt: "3次ニューロンの線維は内包を通って大脳皮質へ。着くのは？",
        options: [
          { label: "中心後回", term: "postcentral-gyrus", to: "cortex", why: "中心溝の後ろの中心後回が一次体性感覚野。" },
          { label: "中心前回", term: "precentral-gyrus", to: "motor", why: "中心溝の前の中心前回は一次運動野。" },
          { label: "小脳", term: "cerebellum", blocked: "小脳は視床の先ではない。視床から大脳皮質へ。" },
        ],
      },
    },
    {
      id: "motor", title: "中心前回に着いた", term: "precentral-gyrus", at: "motor", dest: true,
      note: "", arrive: "中心前回（一次運動野）に着いてしまった。ここは筋へ命令を出す所（錐体路の始まり）。感覚の終点は、中心溝をはさんで後ろの中心後回。",
    },
    {
      id: "cortex", title: "中心後回（一次体性感覚野）", term: "postcentral-gyrus", at: "cortex",
      note: "ここで初めて感じる。手や指を受け持つ所は広い（体部位局在・ペンフィールドの小人）ので、どの指か細かく分かる。",
    },
  ],
};

export const JOURNEYS: Journey[] = [BLOOD, FOOD, PAIN];
export const journeyById = new Map(JOURNEYS.map((journey) => [journey.id, journey]));

export function stopOf(journey: Journey, id: string): JourneyStop {
  const stop = journey.stops.find((s) => s.id === id);
  if (!stop) throw new Error(`所が無い: ${journey.id}/${id}`);
  return stop;
}

/** from から target へ、分かれ道の選択肢をたどって行けるか（ほかの行き先 dest の先へは進まない） */
export function reaches(journey: Journey, from: string, target: string): boolean {
  const seen = new Set<string>();
  const queue = [from];
  while (queue.length) {
    const id = queue.shift()!;
    if (id === target) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    const stop = stopOf(journey, id);
    if (stop.dest && id !== from) continue;
    for (const option of stop.fork?.options ?? []) if (option.to && !option.blocked) queue.push(option.to);
  }
  return false;
}

/** 今向かっている通る所（checkpoints の何番目か）での、その選択肢の結果 */
export type OptionResult = "right" | "dest" | "blocked";

export function optionResult(journey: Journey, mission: JourneyMission, checkpoint: number, option: JourneyOption): OptionResult {
  if (!option.to || option.blocked) return "blocked";
  if (reaches(journey, option.to, mission.checkpoints[checkpoint])) return "right";
  // 違う所: 行き先（dest）なら着いてから戻る。そうでない所（ほかの目当てでは正しい道）は、動かずに理由を出す
  return stopOf(journey, option.to).dest ? "dest" : "blocked";
}

/** 違う所へ行く選択肢で、動かないときの理由 */
export function blockedReason(journey: Journey, mission: JourneyMission, option: JourneyOption): string {
  if (option.blocked) return option.blocked;
  return [option.why, forkPrompt(journey.offRoute, mission)].filter(Boolean).join(" ");
}

/** 分かれ道の問い（{goal} に目当ての名前） */
export function forkPrompt(prompt: string, mission: JourneyMission): string {
  return prompt.replaceAll("{goal}", mission.label);
}

/** 正しい道を選び続けたときの所の並び（確かめ用・道順の見本） */
export function rightPath(journey: Journey, mission: JourneyMission): string[] {
  const path = [journey.start];
  let checkpoint = 0;
  for (let guard = 0; guard < 60; guard++) {
    const stop = stopOf(journey, path[path.length - 1]);
    if (stop.id === mission.checkpoints[checkpoint]) {
      checkpoint++;
      if (checkpoint >= mission.checkpoints.length) return path;
    }
    const option = stop.fork?.options.find((o) => optionResult(journey, mission, checkpoint, o) === "right");
    if (!option?.to) throw new Error(`正しい道が無い: ${journey.id}/${mission.id}/${stop.id}`);
    path.push(option.to);
  }
  throw new Error(`終わらない: ${journey.id}/${mission.id}`);
}

/** 結果（db.settings の journey.<旅ID>。目当てごと） */
export interface JourneyRecord {
  /** いちばん少なかったまちがいの数 */
  best: number;
  /** 前回のまちがいの数 */
  last: number;
  at: string;
}
export const journeyKey = (id: JourneyId) => `journey.${id}`;
