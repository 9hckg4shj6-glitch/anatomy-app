# 解剖学 3D単語帳

解剖学の「用語」「体のどこにあるか」「英語名」を、3Dモデルとフラッシュカード（FSRS）で一緒に覚えるアプリ。医療系の1年生向け。設計は [docs/設計.md](docs/設計.md)。

## 使う

https://9hckg4shj6-glitch.github.io/anatomy-app/

スマホでは開いてから「ホーム画面に追加」（iPhone は Safari の共有ボタンから）すると、アプリとして全画面で開ける。2回目からは通信が無くても動く（3Dモデルと音声は一度開いた分を端末に保存）。学習の記録は端末ごと（進捗の画面でファイルに書き出して、別の端末で読み込める）。

13系統・1,757語（183レッスン）と語根カード138個。レッスン → 復習（FSRS）のほか、範囲を選んだ演習・苦手を解く演習、図鑑（関係する語・断面）、局所解剖（大腿三角・膝窩・腋窩・手根管・区画・頚部の三角・鼡径管・縦隔・頭蓋窩など）、筋の作用を骨の動きで見る機能（下肢と上肢・肩甲骨の筋）がある。

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
npm run build:wikidata   # 任意。Wikidata の日本語名との照合用
npm run validate:content # docs/要確認用語.md も作り直す
node scripts/visibility.mjs <系統> # 隠れて見えない語（xray を付けるか）の目安
```

語根カードは `content/roots.json`（例の語は英語名から自動で拾う）。

アイコンを変えたら `public/icons/icon.svg` を直して `npm run build:icons`（ホーム画面用の PNG を作り直す）。

## 骨の部位のピンを直す

`npm run dev` のあと `http://localhost:5173/?admin=1#/admin` を開く（「ピン」タブが出る）。部位を選んで骨をクリックし、「保存」で `content/pins.json` が書きかわる。くわしくは docs/設計.md の「骨の部位（ピン）」。

## 出典

3Dモデル: BodyParts3D, © The Database Center for Life Science licensed under CC Attribution 4.0 International（骨・脳などは、4.0 より細かい 3.0 の形を 4.0 の形に重ねて表示に使う）。BodyParts3D に無い構造と筋の付着面は Z-Anatomy（CC BY-SA 4.0）を骨に合わせて変形したもの（`public/models/` の名前に `-za` が付くファイル）。ほかはアプリの「出典・クレジット」画面を参照。
