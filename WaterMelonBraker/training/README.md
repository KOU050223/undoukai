# WaterMelonBraker: スイカ検出モデルの学習手順

Roboflow の `fruits-and-veg-2` データセット (32クラス、mAP@50 92.7%) を用いて YOLOv8n を fine-tune し、Meta Quest 3 の Unity Sentis で動作する ONNX モデルを生成する手順。

## 概要

- **ベースモデル**: YOLOv8n (nano, 3.2M params)
- **データセット**: [fruits-and-veg-2-x027v](https://universe.roboflow.com/calories/fruits-and-veg-2-x027v) (7,044枚 / 32クラス / watermelon含む)
- **学習環境**: Google Colab 無料枠 (T4 GPU)
- **想定所要時間**: 約 40〜55 分
- **出力**: Unity Sentis 用の `.onnx` モデルとクラス名リスト

## 成果物

学習完了後、以下のファイルがローカルに自動ダウンロードされる。

| ファイル | 用途 |
|---|---|
| `watermelon.onnx` | Unity Sentis に投入する ONNX モデル |
| `SentisYoloClasses.txt` | 32クラスのラベルファイル |
| `watermelon_best.pt` | 元の PyTorch weight (保険) |

## 手順

### 1. Roboflow API Key を取得

1. https://roboflow.com にログイン (Google アカウントで可)
2. 対象データセットのページ (https://universe.roboflow.com/calories/fruits-and-veg-2-x027v/dataset/2) を開く
3. `Download Dataset` → `YOLOv8` → `Download dataset` → `Continue` → `Show download code` を選ぶ
4. 表示されたコード内の `api_key="..."` の値をコピーしておく (次で使う)

⚠️ API Key は公開リポジトリに commit しないこと。以降の手順でも Colab のシークレット機能に登録して使う。

### 2. Google Colab で Notebook を開く

1. https://colab.research.google.com/ にアクセス
2. `ファイル` → `ノートブックをアップロード`
3. 本ディレクトリの `train_watermelon_yolov8.ipynb` を選択

### 3. T4 GPU を有効化

Colab 上部メニュー:

- `ランタイム` → `ランタイムのタイプを変更` → `T4 GPU` を選択 → 保存

⚠️ GPU を有効化しないと CPU で学習が始まり、数時間〜半日かかる。

### 4. Roboflow API Key をシークレット登録

Colab 左サイドバーの 🔑 アイコン (シークレット) をクリック:

- `+ 新しいシークレットを追加`
- 名前: `ROBOFLOW_API_KEY`
- 値: 手順1でコピーした API Key を貼り付け
- `ノートブックからのアクセス` のトグルを ON

これで Notebook から `userdata.get('ROBOFLOW_API_KEY')` で安全に参照できる。

### 5. Notebook を上から順に実行

- `Ctrl+Enter` (Windows) / `Cmd+Enter` (Mac) で1セルずつ実行
- または `ランタイム` → `すべてのセルを実行` で一括実行

セル構成:

| ステップ | 内容 | 所要時間 |
|---|---|---|
| 1 | GPU確認 (`nvidia-smi`) | 数秒 |
| 2 | パッケージインストール | 1〜2分 |
| 3 | データセットダウンロード | 3〜5分 |
| 4 | `data.yaml` 確認 | 数秒 |
| 5 | **fine-tune (50 epochs)** | **30〜45分** |
| 6 | 学習結果の可視化 | 数秒 |
| 7 | 検証セットで mAP 確認 | 1〜2分 |
| 8 | ONNX エクスポート | 1分 |
| 9 | クラス名リスト生成 | 数秒 |
| 10 | ローカルダウンロード | 数秒 |

### 6. 待機中の注意

- Colab 無料枠は **アイドル状態が続くと切断される** (目安: 90分)
- 学習中はたまにタブに戻るか、他タブで YouTube などを再生してアクティブ扱いにする
- 切断されると学習がやり直しになるので注意

## 学習パラメータ

Notebook 内の Step 5 で以下を指定している。変更したい場合はここを編集。

```python
model.train(
    data=f'{dataset.location}/data.yaml',
    epochs=50,       # 学習エポック数
    imgsz=640,       # 入力画像サイズ (Sentis 側と合わせる)
    batch=16,        # T4 GPU (16GB) で余裕あるサイズ
    patience=15,     # 15エポック改善なければ早期終了
    project='runs/train',
    name='watermelon',
    exist_ok=True,
)
```

### 精度が足りない場合

- `epochs=100` に増やす (時間は倍)
- `model = YOLO('yolov8s.pt')` に変える (nano→small、精度向上、Quest 3 でもまだ動く)
- Roboflow 側でデータ拡張 (augmentation) を強化してから再ダウンロード

### 学習が遅い場合

- `imgsz=480` に下げる (精度は微減、速度向上)
- `batch=32` に上げる (T4 GPU で可能)

## ONNX エクスポートの設定

Meta 公式サンプル (`SentisModelEditorConverter.cs`) は 出力形状 `(1, 84, N)` の標準 YOLOv8 ONNX を期待する。そのため以下の設定でエクスポートしている。

```python
best_model.export(
    format='onnx',
    imgsz=640,      # Sentis 入力サイズ
    opset=15,       # Sentis / Unity Inference Engine の安定サポート範囲
    simplify=True,  # グラフ最適化
    dynamic=False,  # 静的shape
    nms=False,      # NMS は Sentis 側で組み込む
)
```

`nms=False` にすることが重要。Sentis 側の `SentisModelEditorConverter.cs` が Non-Max-Suppression レイヤーを graph に追加するため、ONNX 側で NMS を組み込むと二重処理になる。

## 次のステップ (Unity 側)

ダウンロードした3ファイルを Unity プロジェクトに配置:

1. `watermelon.onnx` を `Assets/PassthroughCameraApiSamples/MultiObjectDetection/SentisInference/Model/` に配置
2. `SentisYoloClasses.txt` で既存の同名ファイルを上書き (バックアップ推奨)
3. Unity Editor で `MultiObjectDetection` シーンを開く
4. `SentisInferenceManagerPrefab` を選び、Inspector の `SentisInferenceRunManager` コンポーネントを確認
5. `OnnxModel` スロットに `watermelon.onnx` をドラッグ
6. Inspector 下部の `Generate Yolov9 Sentis model with Non-Max-Supression layer` ボタンを押す
7. 生成された `.sentis` を `m_sentisModel` スロットに設定
8. `m_labelsAsset` スロットに新しい `SentisYoloClasses.txt` を設定
9. Quest 3 にビルドして動作確認

## トラブルシューティング

### Colab で GPU が使えない

- `nvidia-smi` が失敗する → ランタイムタイプを T4 に設定し直して、`ランタイム` → `ランタイムを再起動`

### `userdata.get('ROBOFLOW_API_KEY')` が None を返す

- シークレット登録後に「ノートブックからのアクセス」トグルを ON にし忘れている
- シークレット名のスペルを確認 (`ROBOFLOW_API_KEY` 完全一致)

### 学習が途中で止まる

- Colab 無料枠のセッション切断が原因の可能性大
- 有料の Colab Pro (月$10) にすると切断されにくい
- または `epochs=30` に下げて短時間で完了させる

### ONNX 変換で Unity 側がエラー

- opset バージョン不整合の可能性 → `opset=13` や `opset=17` を試す
- Sentis のバージョンと合っていない可能性 → Unity 側の Sentis バージョンを確認

## 参考

- [Ultralytics YOLOv8 Docs](https://docs.ultralytics.com/)
- [Unity Sentis Docs](https://docs.unity3d.com/Packages/com.unity.sentis@latest/)
- [Meta Passthrough Camera API Samples](https://github.com/oculus-samples/Unity-PassthroughCameraApiSamples)
- [Roboflow Universe](https://universe.roboflow.com/)
