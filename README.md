# Real World Quest (Web MVP)

AI が実世界のお題を出し、人間が行動して達成するとスコアが貯まるゲームです。

この MVP では以下を実装しています。

- 固定お題からランダム出題
- Gemini Live API でカメラフレームを解析して達成判定
- 成功時のスコア加算と連続成功ストリーク
- 履歴表示
- 位置が重要なお題のみ GPS 取得して補助判定（取得できない場合はスキップ）

## 技術スタック

- Web: Vite + TypeScript
- AI 判定: [@google/genai](https://www.npmjs.com/package/@google/genai) の Live API (`live.connect`)

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
# VITE_GEMINI_LIVE_MODEL=gemini-2.5-flash-native-audio-latest
# Optional
# VITE_GEMINI_VOICE_NAME=Kore
```

既存の `.env` が `GEMINI_API_KEY` になっている場合は、`VITE_` プレフィックス付きの `VITE_GEMINI_API_KEY` に変更してください。
デフォルトでは Live API の native-audio モデルを順番に試します。固定したい場合は `VITE_GEMINI_LIVE_MODEL` を指定してください。
native-audio モデルは `TEXT` モダリティで不安定なため、この実装では `AUDIO + outputAudioTranscription` を使って判定テキストを取得しています。
判定フレーム秒数は `.env` の `VITE_CAPTURE_SECONDS`（1〜60）で変更できます。未指定時は 10 秒です。

3. 開発サーバー起動

```bash
npm run dev
```

4. ブラウザで `http://localhost:5173` を開く

## 使い方

1. 「次のお題」でランダムお題を選択
2. 実世界でお題を実行
3. 「実行を判定する」を押す
4. 10 秒間のカメラフレームが Gemini Live API に送られ、1行フォーマットの判定結果が返る
5. 成功時にポイント加算
6. Debug カスタムお題を使う場合は、画面の入力欄にお題文を入れて「カスタムお題をセット」を押す

## 判定ロジック

- モデルの返答は 1 行のキー=値形式を要求（音声転写で崩れにくくするため）
- 推奨形式:

```txt
success=true;confidence=0.92;reason=...;detected_actions=action1|action2;safety_notes=...
```

- 互換性のため JSON 応答もフォールバックで解析

- `locationCheck` があるお題は GPS の距離判定を追加
  - 指定半径外なら失敗
  - 位置情報が取れない場合は「位置判定スキップ」扱い

## 既知の制限（MVP）

- 音声ストリーム送信は未実装（現状は動画フレーム中心の判定）
- 判定は環境光やカメラ角度の影響を受ける
- お題は固定データ（動的生成は未実装）

## 次の拡張候補

1. Gemini で動的お題生成（難易度、場所、時間帯でパーソナライズ）
2. マイク音声の PCM 送信を追加して Live API の音声判定を強化
3. 不正対策（過去動画のリプレイ検知、顔認識の重複チェック）
4. チーム対戦、ランキング、時限イベント
