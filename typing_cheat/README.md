# typing_cheat — myTyping Auto Typer (学習用)

myTyping (https://typing.twi1.me) を自動タイピングで突破するユーザースクリプト。
プログラミング学習用に「ブラウザに深く干渉するツールをどう作るか」を実践するためのリポジトリで、実際に他人のスコアと競うために使うものではありません。

## 動作原理

1. `typing.min.js` はゲーム画面で `document.addEventListener("keydown", W)` を登録し、`e.keyCode` を見ている。`isTrusted` チェックは無い。
2. よって `document.dispatchEvent(new KeyboardEvent("keydown", {...}))` で人間のキー押下と同じ処理経路に入る。
3. 次に打つべき1文字は DOM の `.mtjGmSc-roma > .mtjNowInput` にそのまま出ている（例: `K`）。
4. 一定間隔で「今の1文字を読む → dispatch する」を繰り返す。

## インストール

1. Chrome / Firefox / Edge に [Tampermonkey](https://www.tampermonkey.net/) を入れる
2. Tampermonkeyダッシュボードで「新規スクリプトを作成」→ このリポジトリの `mytyping_auto.user.js` の中身を貼り付け、保存
3. https://typing.twi1.me/game/XXXXX を開くと画面右下に操作パネルが出る

## 使い方

1. 設定モーダル（効果音・キーボード等）が出た状態でパネルの **START** を押すだけ
2. スクリプトが Enter → 設定確定 → Space → タイピング開始 → 20問完走 → 結果画面到達 まで自動で進める
3. **STOP** で即停止
4. 「間隔」は 1キーあたりの遅延（ms）。`0` にすると理論最速だが描画がスキップされることがある。既定は `8ms`。

## 実測

- 打鍵/秒: **100.0** (人間の全国1位: 44.7)
- 正誤率: 100%
- 20問560打鍵を **5.6秒** で完走 → スコア 100000 (称号「神」)

## ファイル

- `mytyping_auto.user.js` — 本体（Tampermonkey対応。約270行）
