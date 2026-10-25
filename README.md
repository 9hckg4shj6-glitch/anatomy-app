# 解剖学 3D単語帳

解剖学の「用語」「体のどこにあるか」「英語名」を、3Dモデルとフラッシュカード（FSRS）で一緒に覚えるアプリ。医療系の1年生向け。設計は [docs/設計.md](docs/設計.md)。

## 使う

https://9hckg4shj6-glitch.github.io/anatomy-app/

スマホでは開いてから「ホーム画面に追加」（iPhone は Safari の共有ボタンから）すると、アプリとして全画面で開ける。2回目からは通信が無くても動く（3Dモデルと音声は一度開いた分を端末に保存）。学習の記録は端末ごと。

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
2. 3Dモデルと音声を作り直す（初回だけ `npm run fetch:sources` で BodyParts3D を取得。約600MB）

```sh
npm run build:models
npm run build:audio      # macOS の afconvert を使う
npm run build:wikidata   # 任意。Wikidata の日本語名との照合用
npm run validate:content # docs/要確認用語.md も作り直す
```

アイコンを変えたら `public/icons/icon.svg` を直して `npm run build:icons`（ホーム画面用の PNG を作り直す）。

## 骨の部位のピンを直す

`npm run dev` のあと `http://localhost:5173/?admin=1#/admin` を開く（「ピン」タブが出る）。部位を選んで骨をクリックし、「保存」で `content/pins.json` が書きかわる。くわしくは docs/設計.md の「骨の部位（ピン）」。

## 出典

3Dモデル: BodyParts3D, © The Database Center for Life Science licensed under CC Attribution 4.0 International。ほかはアプリの「出典・クレジット」画面を参照。
