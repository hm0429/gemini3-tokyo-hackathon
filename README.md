# Real World Quest (Web MVP)

AI が実世界のお題を出し、人間が行動して達成するとスコアが貯まるゲームです。

この MVP では以下を実装しています。

- 固定お題からランダム出題
- Gemini API で映像+音声を解析して達成判定
- 成功時のスコア加算と連続成功ストリーク
- 履歴表示
- 位置が重要なお題のみ GPS 取得して補助判定（取得できない場合はスキップ）

## 技術スタック

- Web: Vite + TypeScript
- AI 判定: [@google/genai](https://www.npmjs.com/package/@google/genai) の `models.generateContent`（マルチモーダル）

## セットアップ

1. 依存関係をインストール

```bash
npm install
```

2. `.env` を設定

```bash
VITE_GEMINI_API_KEY=YOUR_API_KEY
# Optional
# VITE_CAPTURE_SECONDS=10
# Optional
# VITE_GESTURE_TRIGGER_ENABLED=true
# Optional
# VITE_GESTURE_WASM_ROOT=https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm
# Optional
# VITE_GESTURE_MODEL_ASSET_PATH=https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task
# Optional
# VITE_GEMINI_JUDGE_NORMALIZER_MODEL=gemini-2.5-flash
# Optional
# VITE_GEMINI_JUDGE_FALLBACK_MODEL=gemini-2.5-flash
```

既存の `.env` が `GEMINI_API_KEY` になっている場合は、`VITE_` プレフィックス付きの `VITE_GEMINI_API_KEY` に変更してください。
判定フレーム秒数は `.env` の `VITE_CAPTURE_SECONDS`（1〜60）で変更できます。未指定時は 10 秒です。
顔の前で指で円を作るジェスチャーで `Share Reality` を開始できます。無効化する場合は `VITE_GESTURE_TRIGGER_ENABLED=false` を設定してください。
ジェスチャー検出モデルの取得先を固定したい場合は `VITE_GESTURE_WASM_ROOT` / `VITE_GESTURE_MODEL_ASSET_PATH` を設定してください。
判定正規化モデルを固定したい場合は `VITE_GEMINI_JUDGE_NORMALIZER_MODEL` を指定してください（未指定時は `gemini-2.5-flash` → `gemini-2.0-flash` の順に試行）。
判定モデルを固定したい場合は `VITE_GEMINI_JUDGE_FALLBACK_MODEL` を指定してください（未指定時は `gemini-2.5-flash` → `gemini-2.0-flash`）。

3. 開発サーバー起動

```bash
npm run dev
```

4. ブラウザで `http://localhost:5173` を開く

## 使い方

1. 「次のお題」でランダムお題を選択
2. 実世界でお題を実行
3. 「Share Reality」を押す、または顔の前で指で円を作る
4. 10 秒間のカメラ映像と音声を収集し、`models.generateContent` で判定する
5. 成功時にポイント加算
6. Debug カスタムお題を使う場合は、画面の入力欄にお題文を入れて「カスタムお題をセット」を押す

## 判定ロジック

- モデルの返答は 1 行のキー=値形式を要求（音声転写で崩れにくくするため）
- 推奨形式:

```txt
success=true;confidence=0.92;reason=...;detected_actions=action1|action2;safety_notes=...
```

- 互換性のため JSON 応答もフォールバックで解析
- 最初から `models.generateContent` で判定（Live 判定は使用しない）
- 音声は `audio/wav` クリップを添付して判定
- Live 応答が自由文で崩れた場合は、別モデルへ再入力して `application/json + responseSchema` で正規化してから採点
- それでも失敗した場合のみ最終フォールバックとして narrative 解析を実施

- `locationCheck` があるお題は GPS の距離判定を追加
  - 指定半径外なら失敗
  - 位置情報が取れない場合は「位置判定スキップ」扱い

## 既知の制限（MVP）

- 音声・映像を同時送信して判定しますが、騒音環境では音声判定精度が落ちる場合があります
- 判定は環境光やカメラ角度の影響を受ける
- お題は固定データ（動的生成は未実装）

## 次の拡張候補

1. Gemini で動的お題生成（難易度、場所、時間帯でパーソナライズ）
2. 不正対策（過去動画のリプレイ検知、顔認識の重複チェック）
3. チーム対戦、ランキング、時限イベント
