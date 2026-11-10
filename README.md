# 解剖学 3D単語帳

解剖学の「用語」「体のどこにあるか」「英語名」を、3Dモデルとフラッシュカード（FSRS）で一緒に覚えるアプリ。医療系の1年生向け。設計は [docs/設計.md](docs/設計.md)。

## 使う

https://9hckg4shj6-glitch.github.io/anatomy-app/

スマホでは開いてから「ホーム画面に追加」（iPhone は Safari の共有ボタンから）すると、アプリとして全画面で開ける。2回目からは通信が無くても動く（3Dモデルと音声は一度開いた分を端末に保存）。学習の記録は端末ごと（進捗の画面でファイルに書き出して、別の端末で読み込める）。

15系統・2,393語（278レッスン）と語根カード138個。初心者モード（最低限の450語・61レッスンと短い「覚えること」、content/beginner.json）と詳細モードを切りかえられる。レッスン → 復習（FSRS）のほか、範囲を選んだ演習・苦手を解く演習、図鑑（関係する語・断面）、局所解剖（大腿三角・膝窩・腋窩・手根管・区画・頚部の三角・鼡径管・会陰の三角・縦隔・頭蓋窩など）、筋の作用を骨の動きで見る機能（下肢と上肢・肩甲骨の筋）、3Dの向きの目印（上・下・前・後・右・左）と部位どうしの向きの問題（骨・臓器・血管・神経・筋）、ホルモンから器官を答える問題がある。外皮（皮膚の層・毛・腺・爪）と、3Dに形の無い構造（女性生殖器・ネフロンと腎臓の血管・内耳・眼底・脊髄の白質・肛門管・心臓の中隔など）は、3Dの代わりに臓器の図の平面図で学ぶ。腎臓の中（腎皮質・腎柱・腎錐体・腎乳頭・腎洞・腎杯）と被膜（脂肪被膜・腎筋膜）は、腎杯の形と腎臓からの距離をもとに作った模式の立体で、臓器の図「腎臓」で切って見られる。肺区域（S1〜S10）は肺葉の中を区域気管支と区域動脈で分けた模式の立体で、区域動脈・区域静脈とともに臓器の図「肺区域」で見られ、壁側胸膜（肋骨胸膜・横隔胸膜・縦隔胸膜・胸膜頂）と胸膜洞（肋骨横隔洞・肋骨縦隔洞）は臓器の図「胸膜」で切って見られる。臓器の図には、膝関節（靱帯・半月・滑液包）、脳の底面と脳神経（12対の出る位置と大脳動脈輪）、縦隔（区分と中を通るもの）、腹膜と腹膜腔（腹膜内臓器と腹膜後器官の色分け・網嚢）もある。心臓の面と縁・肝臓の圧痕は3Dのピンで、心臓の壁と心膜・刺激伝導系・動脈と静脈の壁・胎児循環・消化管の壁の層・膵島・口腔の区分は平面図で、心臓（原始心筒・心房中隔）と消化管（前腸・中腸・後腸）の発生はこのアプリで描いた模式図（content/diagrams/）で学ぶ。解剖学総論の内容として、体の部位（体幹・四肢・上腕・下腿など17語。目安の骨を3Dで示す）、運動の用語の前進・後退・対立・復位・側屈、細胞と組織（人体の階層・細胞小器官・4つの組織・上皮の種類・結合組織と血液・筋組織・神経細胞と神経膠細胞・体表からの層と注射・熱傷の深さの71語。自作の模式図10枚、臓器の図「細胞と組織」）もある。

`main` に push すると GitHub Actions（`.github/workflows/pages.yml`）がテスト → 内容の検査 → 型チェック → ビルドを通して GitHub Pages に公開する。開いている端末には、次にホームに戻ったときに新しい版が入る。

## 動かす

```sh
npm install
npm run dev        # http://localhost:5173/ 。同じ Wi-Fi のスマホからは http://<MacのIP>:5173/
npm run test
npm run build      # 内容の検査 → 型チェック → dist/ に出力
```

`public/models/` と `public/audio/` は作成済みのものを含むので、上だけで動く。

## 内容を足す・直す

1. `content/terms/<系統>.json` を書きかえる（書き方は docs/設計.md）
2. 3Dモデルと音声を作り直す（初回だけ `npm run fetch:sources` で BodyParts3D 4.0・3.0 と Z-Anatomy を取得。ダウンロード約0.9GB、展開後は約3GB）

```sh
npm run build:models     # 約20分（初回は 3.0 の細かい形の重ね合わせで、さらに約5分）
npm run build:attachments # 筋の起始・停止の面（Z-Anatomy から）
node scripts/build-models.mjs --attached-bones # 付着面が乗っている1本ずつの骨（付着面を作り直したとき。build:models の最後にも走る）
node scripts/pins/compute.mjs scripts/pins/rules/attach.mjs --write # Z-Anatomy に無い起始・停止（content/attachments.json）
npm run build:audio      # macOS の afconvert を使う
node scripts/joints.mjs  # 基本の用語（運動）で骨を動かす関節（content/joints.json）
npm run build:en-notes   # 説明の解剖の語に（英語）を添え、添えた一覧を content/en-notes.json に書く（アプリはふだん外して日本語だけを出す）
npm run build:wikidata   # 任意。Wikidata の日本語名との照合用
npm run validate:content # docs/要確認用語.md も作り直す
node scripts/visibility.mjs <系統> # 隠れて見えない語（xray を付けるか）の目安
```

語根カードは `content/roots.json`（例の語は英語名から自動で拾う）。

アイコンを変えたら `public/icons/icon.svg` を直して `npm run build:icons`（ホーム画面用の PNG を作り直す）。

## 骨の部位のピンを直す

`npm run dev` のあと `http://localhost:5173/?admin=1#/admin` を開く（ホームに「ピン」の項目が出る）。部位を選んで骨をクリックし、「保存」で `content/pins.json` が書きかわる。くわしくは docs/設計.md の「骨の部位（ピン）」。

## 出典

3Dモデル: BodyParts3D, © The Database Center for Life Science licensed under CC Attribution 4.0 International（骨・脳などは、4.0 より細かい 3.0 の形を 4.0 の形に重ねて表示に使う）。BodyParts3D に無い構造と筋の付着面は Z-Anatomy（CC BY-SA 4.0）を骨に合わせて変形したもの（`public/models/` の名前に `-za` が付くファイル）。ほかはアプリの「出典・クレジット」画面を参照。
