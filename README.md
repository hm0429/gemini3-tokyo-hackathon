# The World Quest

This game gives real-world challenges through AI. Players perform the challenge in the real world, and score increases when they succeed.

This MVP includes:

- Random challenge selection from a fixed list
- Video + audio challenge judgement with Gemini API
- Score gain on success and streak tracking
- Play history
- Optional GPS-assisted checks for location-based challenges (skipped if unavailable)

## Tech Stack

- Web: Vite + TypeScript
- AI Judgement: `models.generateContent` via [@google/genai](https://www.npmjs.com/package/@google/genai) (multimodal)

## Setup

1. Install dependencies

```bash
npm install
```

2. Configure `.env`

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
# VITE_GEMINI_CHALLENGE_MODEL=gemini-2.5-flash
# Optional
# VITE_GEMINI_JUDGE_FALLBACK_MODEL=gemini-2.5-flash
```

If you previously used `GEMINI_API_KEY`, rename it to `VITE_GEMINI_API_KEY`.

- `VITE_CAPTURE_SECONDS` controls capture duration (1-60, default 10).
- Finger-circle gesture can trigger `Share Reality`; disable with `VITE_GESTURE_TRIGGER_ENABLED=false`.
- Fix gesture model sources with `VITE_GESTURE_WASM_ROOT` and `VITE_GESTURE_MODEL_ASSET_PATH` if needed.
- You can pin the normalizer model with `VITE_GEMINI_JUDGE_NORMALIZER_MODEL` (default tries `gemini-2.5-flash` then `gemini-2.0-flash`).
- You can pin the AI challenge generator model with `VITE_GEMINI_CHALLENGE_MODEL` (default tries `gemini-2.5-flash` then `gemini-2.0-flash`).
- You can pin the judge model with `VITE_GEMINI_JUDGE_FALLBACK_MODEL` (default tries `gemini-2.5-flash` then `gemini-2.0-flash`).

3. Start dev server

```bash
npm run dev
```

4. Open `http://localhost:5173`

## How to Play

1. In Debug Screen, choose `Challenge Source`: `Fixed Challenges` or `AI Generated (Realtime)` (default is fixed)
2. Pick a mission with `Maybe Later...`
3. Perform the mission in the real world
4. Start verification with `Share Reality` or a finger-circle gesture in front of your face
5. The app captures camera + microphone data for the configured duration and judges via `models.generateContent`
6. Points are added on success
7. For debug mode, enter a custom challenge and click `Set Custom Challenge`

## Judgement Logic

- The app asks the model for strict one-line key-value output:

```txt
success=true;confidence=0.92;reason=...;detected_actions=action1|action2;safety_notes=...
```

- JSON responses are also parsed as fallback.
- Judgement runs directly with `models.generateContent` (Live API judgement is not used).
- Audio is attached as an `audio/wav` clip.
- If output format is unstable, a second model normalizes it using `application/json + responseSchema`.
- If normalization still fails, a narrative fallback parser is used.

For `locationCheck` missions:

- GPS distance is evaluated against the radius.
- Outside the radius => failure.
- If location cannot be obtained, location check is skipped.

## Known Limits (MVP)

- Noisy environments can reduce audio judgement quality.
- Lighting and camera angle can affect visual judgement.
- AI-generated missions can occasionally be repetitive or low quality.

## Next Extensions

1. Dynamic challenge generation with Gemini (difficulty, place, and time personalization)
2. Anti-cheat measures (replay detection, duplicate identity checks)
3. Team battle, rankings, and timed events
