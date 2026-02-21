import { GoogleGenAI, Modality, Type, type Session } from '@google/genai';
import { FIXED_CHALLENGES, type Challenge } from './challenges';
import './style.css';

type AppState = {
  score: number;
  streak: number;
};

type JudgeResult = {
  success: boolean;
  confidence: number;
  reason: string;
  detectedActions: string[];
  safetyNotes: string;
};

type LocationSnapshot = {
  status: 'available' | 'skipped' | 'denied' | 'unsupported' | 'error';
  latitude?: number;
  longitude?: number;
  accuracy?: number;
  message?: string;
};

type FinalJudgement = JudgeResult & {
  scoreAdded: number;
  locationMessage: string;
};

type HistoryRecord = {
  challengeTitle: string;
  success: boolean;
  scoreAdded: number;
  reason: string;
  timestamp: string;
};

type JudgeParseTrace = {
  source: 'live-key-value' | 'live-json' | 'normalizer-json' | 'narrative-fallback' | 'parse-failed';
  normalizerModel?: string;
  normalizerRawText?: string;
  normalizerError?: string;
};

type JudgeParseOutput = {
  result: JudgeResult;
  trace: JudgeParseTrace;
};

type CaptureEvidence = {
  frameSamples: string[];
  videoFramesSent: number;
  audioChunksSent: number;
  audioClipBase64: string | null;
  audioClipMimeType: string | null;
  audioClipBytes: number;
};

type AudioCaptureResult = {
  sentChunks: number;
  audioClipBase64: string | null;
  audioClipMimeType: string | null;
  audioClipBytes: number;
};

type AudioRealtimeStreamer = {
  stop: () => AudioCaptureResult;
};

type LandmarkPoint = {
  x: number;
  y: number;
  z?: number;
};

type HandLandmarkerLike = {
  detectForVideo: (
    video: HTMLVideoElement,
    timestampMs: number,
  ) => {
    landmarks?: LandmarkPoint[][];
  };
  close?: () => void;
};

type VisionTasksModule = {
  FilesetResolver: {
    forVisionTasks: (wasmRoot: string) => Promise<unknown>;
  };
  HandLandmarker: {
    createFromOptions: (
      filesetResolver: unknown,
      options: Record<string, unknown>,
    ) => Promise<HandLandmarkerLike>;
  };
};

type ChallengeSourceMode = 'fixed' | 'ai';
type ChallengeRefreshContext = 'user' | 'post-judge' | 'mode-switch';

const STORAGE_KEY = 'reality-quest-state-v1';
const HISTORY_STORAGE_KEY = 'reality-quest-history-v1';
const CUSTOM_CHALLENGE_STORAGE_KEY = 'reality-quest-custom-challenge-v1';
const CHALLENGE_SOURCE_STORAGE_KEY = 'reality-quest-challenge-source-v1';
const CAPTURE_SECONDS = resolveCaptureSeconds();
const CUSTOM_CHALLENGE_POINTS = 150;
const MAX_EVALUATION_FRAMES = 12;
const CURIOSITY_LEVEL_POINTS = 1000;
const JUDGE_NORMALIZER_TIMEOUT_MS = 8000;
const CHALLENGE_GENERATOR_TIMEOUT_MS = 10000;
const GESTURE_TRIGGER_ENABLED = resolveGestureTriggerEnabled();
const GESTURE_WASM_ROOT = resolveGestureWasmRoot();
const GESTURE_MODEL_ASSET_PATH = resolveGestureModelAssetPath();
const GESTURE_HOLD_MS = 700;
const GESTURE_COOLDOWN_MS = 5000;
const GESTURE_INFERENCE_INTERVAL_MS = 140;
const GESTURE_PINCH_TO_PALM_RATIO = 0.43;
const GESTURE_CENTER_RADIUS = 0.29;
const GESTURE_EXTENSION_RATIO = 1.08;

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) {
  throw new Error('app root not found');
}

app.innerHTML = `
  <div class="shell">
    <header class="hero">
      <h1>The World Quest</h1>
      <p class="lead">Feed the AI's Curiosity</p>
    </header>

    <section class="panel quest-panel quest-top">
      <div class="panel-head quest-head">
        <h3 id="challengeTitle" class="challenge-title">Loading...</h3>
        <span id="challengePoints" class="points-pill">+0 pt</span>
      </div>
      <p id="challengeDescription" class="challenge-description"></p>
      <p id="locationHint" class="location-hint"></p>

      <div class="actions">
        <button id="newChallengeButton" class="btn ghost">Maybe Later...</button>
        <button id="verifyButton" class="btn primary">Share Reality</button>
      </div>
      <p id="statusText" class="status info">Ready. Grant camera permissions to start verification.</p>
    </section>

    <main class="play-layout">
      <section class="panel media-stage">
        <div class="stage-head">
          <h2>Mission Camera</h2>
          <p class="stage-capture">${CAPTURE_SECONDS}s capture</p>
        </div>
        <div class="preview-wrap">
          <video id="cameraPreview" class="preview" playsinline muted></video>
          <div id="sharingOverlay" class="sharing-overlay" aria-live="polite">Sharing Reality…</div>
        </div>
        <p class="preview-note">During verification, video and audio are captured and judged by the model. Make a finger circle in front of your face to start Share Reality.</p>
      </section>

      <aside class="panel side-panel">
        <div class="metrics">
          <div class="curiosity-meter">
            <p class="metric-label">AI CURIOSITY</p>
            <div class="curiosity-head">
              <p id="curiosityLevel" class="curiosity-level">LEVEL 1</p>
              <p id="curiosityPercent" class="curiosity-percent">0%</p>
            </div>
            <div class="curiosity-track" aria-hidden="true">
              <div id="curiosityFill" class="curiosity-fill"></div>
            </div>
            <p id="curiosityHint" class="curiosity-hint">1000 pt to LEVEL 2</p>
            <p class="curiosity-total">TOTAL <span id="scoreValue">0</span> pt</p>
          </div>
          <div class="metric">
            <p class="metric-label">STREAK</p>
            <p id="streakValue" class="metric-value">0</p>
          </div>
        </div>

        <div class="result-card">
          <h3>Latest Result</h3>
          <p id="resultSummary">Not executed</p>
          <p id="resultReason">Reason: -</p>
          <p id="resultConfidence">Confidence: -</p>
          <p id="resultLocation">Location Check: -</p>
          <p id="resultActions">Detected Actions: -</p>
        </div>

        <div class="history-wrap">
          <h3>Play History</h3>
          <ul id="historyList" class="history-list"></ul>
        </div>
      </aside>
    </main>

    <section class="panel debug-screen">
      <div class="debug-head">
        <h2>Debug Screen</h2>
        <p>Legacy debug features are consolidated here.</p>
      </div>

      <div class="debug-grid">
        <div class="panel-lite">
          <h3 class="debug-title">Custom Challenge</h3>
          <div class="custom-challenge-panel">
            <div class="challenge-source-panel">
              <p class="custom-challenge-label">Challenge Source</p>
              <select id="challengeModeSelect" class="challenge-mode-select">
                <option value="fixed">Fixed Challenges</option>
                <option value="ai">AI Generated (Realtime)</option>
              </select>
              <p id="challengeModeMeta" class="custom-challenge-meta"></p>
            </div>
            <p class="custom-challenge-label">Debug Custom Challenge</p>
            <textarea id="customChallengeInput" class="custom-challenge-input" placeholder="Example: Do 5 squats in front of Hachiko"></textarea>
            <div class="custom-challenge-actions">
              <button id="applyCustomChallengeButton" class="btn ghost" type="button">Set Custom Challenge</button>
              <button id="clearCustomChallengeButton" class="btn ghost" type="button">Clear Custom Challenge</button>
            </div>
            <button id="resetScoreButton" class="btn danger debug-reset" type="button">Reset Score</button>
            <p id="customChallengeMeta" class="custom-challenge-meta"></p>
          </div>
        </div>

        <div class="debug-result panel-lite">
          <h3>Judge Payload</h3>
          <p class="judge-debug-label">judge result (debug)</p>
          <pre id="judgeJson" class="judge-json">-</pre>
        </div>
      </div>
    </section>

    <div id="captureOverlay" class="capture-overlay" aria-hidden="true">
      <div class="capture-overlay-card">
        <div class="capture-preview-wrap">
          <video id="cameraPreviewOverlay" class="capture-preview" playsinline muted></video>
          <div class="capture-overlay-band" aria-live="polite">Sharing Reality…</div>
        </div>
      </div>
    </div>

    <div id="digestOverlay" class="digest-overlay" aria-hidden="true">
      <p class="digest-overlay-text">Digesting Reality…</p>
    </div>

    <div id="outcomeOverlay" class="outcome-overlay" aria-live="polite" aria-hidden="true">
      <div class="outcome-content">
        <p id="outcomeTitle" class="outcome-title">SUCCESS</p>
        <p id="outcomeScoreDelta" class="outcome-score-delta">+0 pt</p>
      </div>
    </div>
  </div>
`;

const scoreValue = queryEl<HTMLSpanElement>('#scoreValue');
const streakValue = queryEl<HTMLParagraphElement>('#streakValue');
const curiosityLevel = queryEl<HTMLParagraphElement>('#curiosityLevel');
const curiosityPercent = queryEl<HTMLParagraphElement>('#curiosityPercent');
const curiosityFill = queryEl<HTMLDivElement>('#curiosityFill');
const curiosityHint = queryEl<HTMLParagraphElement>('#curiosityHint');
const challengeTitle = queryEl<HTMLHeadingElement>('#challengeTitle');
const challengeDescription = queryEl<HTMLParagraphElement>('#challengeDescription');
const challengePoints = queryEl<HTMLSpanElement>('#challengePoints');
const locationHint = queryEl<HTMLParagraphElement>('#locationHint');
const statusText = queryEl<HTMLParagraphElement>('#statusText');
const preview = queryEl<HTMLVideoElement>('#cameraPreview');
const overlayPreview = queryEl<HTMLVideoElement>('#cameraPreviewOverlay');
const captureOverlay = queryEl<HTMLDivElement>('#captureOverlay');
const digestOverlay = queryEl<HTMLDivElement>('#digestOverlay');
const outcomeOverlay = queryEl<HTMLDivElement>('#outcomeOverlay');
const outcomeTitle = queryEl<HTMLParagraphElement>('#outcomeTitle');
const outcomeScoreDelta = queryEl<HTMLParagraphElement>('#outcomeScoreDelta');
const sharingOverlay = queryEl<HTMLDivElement>('#sharingOverlay');
const resultSummary = queryEl<HTMLParagraphElement>('#resultSummary');
const resultReason = queryEl<HTMLParagraphElement>('#resultReason');
const resultConfidence = queryEl<HTMLParagraphElement>('#resultConfidence');
const resultLocation = queryEl<HTMLParagraphElement>('#resultLocation');
const resultActions = queryEl<HTMLParagraphElement>('#resultActions');
const judgeJson = queryEl<HTMLPreElement>('#judgeJson');
const historyList = queryEl<HTMLUListElement>('#historyList');
const newChallengeButton = queryEl<HTMLButtonElement>('#newChallengeButton');
const verifyButton = queryEl<HTMLButtonElement>('#verifyButton');
const resetScoreButton = queryEl<HTMLButtonElement>('#resetScoreButton');
const customChallengeInput = queryEl<HTMLTextAreaElement>('#customChallengeInput');
const applyCustomChallengeButton = queryEl<HTMLButtonElement>('#applyCustomChallengeButton');
const clearCustomChallengeButton = queryEl<HTMLButtonElement>('#clearCustomChallengeButton');
const customChallengeMeta = queryEl<HTMLParagraphElement>('#customChallengeMeta');
const challengeModeSelect = queryEl<HTMLSelectElement>('#challengeModeSelect');
const challengeModeMeta = queryEl<HTMLParagraphElement>('#challengeModeMeta');

let appState = loadState();
let history = loadHistory();
let customChallengeText = loadCustomChallengeText();
let challengeSourceMode = loadChallengeSourceMode();
let currentChallenge = customChallengeText ? buildCustomChallenge(customChallengeText) : pickRandomChallenge();
let isVerifying = false;
let isGeneratingChallenge = false;
let isCapturing = false;
let isDigesting = false;
let activeStream: MediaStream | null = null;
let activeSession: Session | null = null;
let handLandmarker: HandLandmarkerLike | null = null;
let gestureInitPromise: Promise<void> | null = null;
let gestureLoopHandle: number | null = null;
let gestureHoldStartedAtMs: number | null = null;
let gestureLastTriggeredAtMs = 0;
let gestureLastInferenceAtMs = 0;
let gestureInitFailedMessage: string | null = null;
let gestureRetryAfterMs = 0;
let outcomeHideTimeoutId: number | null = null;

newChallengeButton.addEventListener('click', () => {
  if (isVerifying || isGeneratingChallenge) {
    return;
  }
  void refreshChallengeBySource(currentChallenge.id, 'user');
});

verifyButton.addEventListener('click', () => {
  void verifyCurrentChallenge();
});

resetScoreButton.addEventListener('click', () => {
  if (isVerifying) {
    return;
  }
  appState = { score: 0, streak: 0 };
  history = [];
  persistState(appState);
  persistHistory(history);
  renderScore();
  renderHistory();
  setStatus('Score and history have been reset.', 'info');
});

applyCustomChallengeButton.addEventListener('click', () => {
  if (isVerifying || isGeneratingChallenge) {
    return;
  }

  const normalized = normalizeCustomChallengeText(customChallengeInput.value);
  if (!normalized) {
    setStatus('Enter a custom challenge between 1 and 220 characters.', 'error');
    return;
  }

  customChallengeText = normalized;
  persistCustomChallengeText(customChallengeText);
  currentChallenge = buildCustomChallenge(customChallengeText);
  renderChallenge(currentChallenge);
  renderCustomChallengeState();
  setStatus('Debug custom challenge has been set.', 'info');
});

clearCustomChallengeButton.addEventListener('click', () => {
  if (isVerifying || isGeneratingChallenge) {
    return;
  }
  if (!customChallengeText) {
    setStatus('No custom challenge is currently set.', 'info');
    return;
  }

  customChallengeText = null;
  persistCustomChallengeText(customChallengeText);
  void refreshChallengeBySource(currentChallenge.id, 'user');
  renderCustomChallengeState();
  setStatus('Custom challenge cleared. Back to random missions.', 'info');
});

challengeModeSelect.addEventListener('change', () => {
  if (isVerifying || isGeneratingChallenge) {
    challengeModeSelect.value = challengeSourceMode;
    return;
  }

  const nextMode: ChallengeSourceMode = challengeModeSelect.value === 'ai' ? 'ai' : 'fixed';
  if (nextMode === challengeSourceMode) {
    return;
  }

  challengeSourceMode = nextMode;
  persistChallengeSourceMode(challengeSourceMode);
  renderChallengeModeState();
  void refreshChallengeBySource(currentChallenge.id, 'mode-switch');
});

window.addEventListener('keydown', (event) => {
  if (event.code !== 'Space' || event.repeat) {
    return;
  }
  if (shouldIgnoreSpaceShortcut(event.target)) {
    return;
  }

  event.preventDefault();
  void verifyCurrentChallenge();
});

window.addEventListener('beforeunload', () => {
  clearOutcomeOverlayTimer();
  stopGestureWatcher();
  stopMedia();
  closeSession();
});

renderChallenge(currentChallenge);
renderScore();
renderHistory();
renderChallengeModeState();
renderCustomChallengeState();
if (!customChallengeText && challengeSourceMode === 'ai') {
  void refreshChallengeBySource(currentChallenge.id, 'mode-switch');
}
void warmupMissionCamera();

async function verifyCurrentChallenge() {
  if (isVerifying || isGeneratingChallenge) {
    return;
  }

  const apiKey = (import.meta.env.VITE_GEMINI_API_KEY ?? '').trim();
  if (!apiKey) {
    setStatus('`VITE_GEMINI_API_KEY` is not set. Configure .env using the README steps.', 'error');
    return;
  }

  isVerifying = true;
  syncButtonState();
  resultSummary.textContent = 'Verifying...';
  resultReason.textContent = 'Reason: preparing verification';
  resultConfidence.textContent = 'Confidence: -';
  resultLocation.textContent = 'Location Check: -';
  resultActions.textContent = 'Detected Actions: -';
  setJudgeDebug({ status: 'running', message: 'Verifying...' });
  let verifyPhase = 'init';

  try {
    verifyPhase = 'start-media';
    setStatus('Preparing Mission Camera and microphone...', 'info');
    await startMediaCapture();

    const locationSnapshot = await getLocationSnapshot(currentChallenge);

    verifyPhase = 'capture-evidence';
    setStatus(`Capturing for ${CAPTURE_SECONDS} seconds.`, 'info');
    let evidence!: CaptureEvidence;
    try {
      isCapturing = true;
      syncButtonState();
      await ensureVideoPlaying(overlayPreview);
      evidence = await captureEvidence(null, preview, activeStream, CAPTURE_SECONDS, (remainingSeconds) => {
        setStatus(`Capturing... ${remainingSeconds}s remaining`, 'info');
      });
    } finally {
      isCapturing = false;
      syncButtonState();
    }
    setStatus(
      `Capture complete. Judging with ${evidence.videoFramesSent} video frames / ${evidence.audioChunksSent} audio chunks.`,
      'info',
    );

    const evaluationPrompt = buildEvaluationPrompt(currentChallenge, locationSnapshot, Boolean(evidence.audioClipBase64));
    const evaluationParts: Array<{ inlineData: { mimeType: string; data: string } } | { text: string }> = [
      { text: evaluationPrompt },
      ...evidence.frameSamples.map((data) => ({
        inlineData: {
          mimeType: 'image/jpeg',
          data,
        },
      })),
      ...(evidence.audioClipBase64 && evidence.audioClipMimeType
        ? [
            {
              inlineData: {
                mimeType: evidence.audioClipMimeType,
                data: evidence.audioClipBase64,
              },
            },
          ]
        : []),
    ];

    verifyPhase = 'judge-fallback-model';
    isDigesting = true;
    syncButtonState();
    setStatus('Running model judgement...', 'info');
    const fallback = await runFallbackJudgeWithGenerateContent(apiKey, evaluationParts);
    const rawText = fallback.rawText;
    const judgeTransport: 'generate-content-direct' = 'generate-content-direct';
    const judgeModelUsed = fallback.modelName;
    const judgeLiveError: string | null = null;

    verifyPhase = 'parse-result';
    const parsed = await parseJudgeResult(rawText, apiKey, currentChallenge);
    const judgeResult = parsed.result;
    const locationMessage = evaluateLocation(currentChallenge, locationSnapshot);
    const finalJudgement = combineJudgement(judgeResult, currentChallenge.points, locationMessage);
    setJudgeDebug({
      timestamp: new Date().toISOString(),
      challenge: {
        id: currentChallenge.id,
        title: currentChallenge.title,
        description: currentChallenge.description,
        points: currentChallenge.points,
      },
      captureSeconds: CAPTURE_SECONDS,
      sampledFrames: evidence.frameSamples.length,
      videoFramesSent: evidence.videoFramesSent,
      audioChunksSent: evidence.audioChunksSent,
      audioClipSent: Boolean(evidence.audioClipBase64),
      audioClipMimeType: evidence.audioClipMimeType,
      audioClipBytes: evidence.audioClipBytes,
      judgeTransport,
      judgeModelUsed,
      judgeLiveError,
      rawModelText: rawText,
      parsedJudgeResult: judgeResult,
      judgeParseTrace: parsed.trace,
      finalJudgement,
      locationSnapshot,
    });
    isDigesting = false;
    syncButtonState();

    applyScore(finalJudgement);
    renderResult(finalJudgement);
    showOutcomeOverlay(finalJudgement);
    appendHistory(finalJudgement, currentChallenge);
    void refreshChallengeBySource(currentChallenge.id, 'post-judge');

    setStatus(
      finalJudgement.success ? `Success! +${finalJudgement.scoreAdded} pt` : 'Failed this round. Moving to the next mission.',
      finalJudgement.success ? 'ok' : 'error',
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'An unknown error occurred';
    setStatus(`Verification failed: ${message}`, 'error');
    setJudgeDebug({
      timestamp: new Date().toISOString(),
      status: 'error',
      phase: verifyPhase,
      error: message,
    });
  } finally {
    isVerifying = false;
    isCapturing = false;
    isDigesting = false;
    syncButtonState();
    closeSession();
  }
}

function combineJudgement(result: JudgeResult, points: number, locationMessage: string): FinalJudgement {
  const locationFailed = locationMessage.startsWith('Failed');
  const success = result.success && !locationFailed;
  const scoreAdded = success ? points : 0;

  return {
    ...result,
    success,
    scoreAdded,
    reason: locationFailed ? `${result.reason} / Location requirement not satisfied` : result.reason,
    locationMessage,
  };
}

function applyScore(finalJudgement: FinalJudgement) {
  if (finalJudgement.success) {
    appState.score += finalJudgement.scoreAdded;
    appState.streak += 1;
  } else {
    appState.streak = 0;
  }

  persistState(appState);
  renderScore();
}

function appendHistory(finalJudgement: FinalJudgement, challenge: Challenge) {
  const record: HistoryRecord = {
    challengeTitle: challenge.title,
    success: finalJudgement.success,
    scoreAdded: finalJudgement.scoreAdded,
    reason: finalJudgement.reason,
    timestamp: new Date().toLocaleString('en-US'),
  };

  history.unshift(record);
  history = history.slice(0, 8);
  persistHistory(history);
  renderHistory();
}

function renderResult(finalJudgement: FinalJudgement) {
  const scoreText = finalJudgement.success ? `Success (+${finalJudgement.scoreAdded}pt)` : 'Failed (+0pt)';
  resultSummary.textContent = scoreText;
  resultReason.textContent = `Reason: ${finalJudgement.reason}`;
  resultConfidence.textContent = `Confidence: ${(finalJudgement.confidence * 100).toFixed(0)}%`;
  resultLocation.textContent = `Location Check: ${finalJudgement.locationMessage}`;
  const actionsText = finalJudgement.detectedActions.length > 0 ? finalJudgement.detectedActions.join(' / ') : '-';
  resultActions.textContent = `Detected Actions: ${actionsText}`;
}

function renderChallenge(challenge: Challenge) {
  challengeTitle.textContent = challenge.title;
  challengeDescription.textContent = challenge.description;
  challengePoints.textContent = `+${challenge.points} pt`;
  locationHint.textContent = challenge.locationCheck
    ? `Location option: ${challenge.locationCheck.label} (within ${challenge.locationCheck.radiusMeters}m)`
    : 'Location option: none';
}

function renderScore() {
  const totalScore = Math.max(0, appState.score);
  const level = Math.floor(totalScore / CURIOSITY_LEVEL_POINTS) + 1;
  const levelProgress = totalScore % CURIOSITY_LEVEL_POINTS;
  const progressRatio = levelProgress / CURIOSITY_LEVEL_POINTS;
  const progressPercent = Math.round(progressRatio * 100);
  const pointsToNext = CURIOSITY_LEVEL_POINTS - levelProgress;

  scoreValue.textContent = String(totalScore);
  curiosityLevel.textContent = `LEVEL ${level}`;
  curiosityPercent.textContent = `${progressPercent}%`;
  curiosityFill.style.width = `${progressPercent}%`;
  curiosityHint.textContent = `${pointsToNext} pt to LEVEL ${level + 1}`;
  streakValue.textContent = String(appState.streak);
}

function renderHistory() {
  historyList.innerHTML = '';
  if (history.length === 0) {
    const li = document.createElement('li');
    li.className = 'history-empty';
    li.textContent = 'No play history yet.';
    historyList.appendChild(li);
    return;
  }

  history.forEach((item) => {
    const li = document.createElement('li');
    li.className = item.success ? 'history-item success' : 'history-item fail';
    li.innerHTML = `
      <p class="history-title">${escapeHtml(item.challengeTitle)} <span>${item.success ? 'Success' : 'Failed'}</span></p>
      <p class="history-meta">${item.timestamp} / ${item.scoreAdded} pt</p>
      <p class="history-reason">${escapeHtml(item.reason)}</p>
    `;
    historyList.appendChild(li);
  });
}

function renderCustomChallengeState() {
  if (!customChallengeText) {
    customChallengeInput.value = '';
    customChallengeMeta.textContent = 'Current mode: Random mission mode';
    return;
  }

  customChallengeInput.value = customChallengeText;
  customChallengeMeta.textContent = `Current mode: Custom challenge mode (+${CUSTOM_CHALLENGE_POINTS} pt)`;
}

function renderChallengeModeState() {
  challengeModeSelect.value = challengeSourceMode;
  challengeModeMeta.textContent =
    challengeSourceMode === 'ai'
      ? 'Current source: AI-generated missions'
      : 'Current source: Fixed mission pool';
}

function syncButtonState() {
  const showCaptureOverlay = isCapturing;
  const showDigestOverlay = isDigesting && !isCapturing;
  const controlsBusy = isVerifying || isGeneratingChallenge;

  verifyButton.disabled = controlsBusy;
  newChallengeButton.disabled = controlsBusy;
  resetScoreButton.disabled = controlsBusy;
  customChallengeInput.disabled = controlsBusy;
  applyCustomChallengeButton.disabled = controlsBusy;
  clearCustomChallengeButton.disabled = controlsBusy;
  challengeModeSelect.disabled = controlsBusy;
  sharingOverlay.classList.toggle('active', showCaptureOverlay);
  captureOverlay.classList.toggle('active', showCaptureOverlay);
  captureOverlay.setAttribute('aria-hidden', String(!showCaptureOverlay));
  digestOverlay.classList.toggle('active', showDigestOverlay);
  digestOverlay.setAttribute('aria-hidden', String(!showDigestOverlay));
  document.body.classList.toggle('capture-overlay-open', showCaptureOverlay || showDigestOverlay);
}

function setStatus(message: string, kind: 'info' | 'ok' | 'error') {
  statusText.textContent = message;
  statusText.classList.remove('info', 'ok', 'error');
  statusText.classList.add(kind);
}

function setJudgeDebug(payload: unknown) {
  judgeJson.textContent = JSON.stringify(payload, null, 2);
}

function showOutcomeOverlay(finalJudgement: FinalJudgement) {
  clearOutcomeOverlayTimer();

  const success = finalJudgement.success;
  outcomeTitle.textContent = success ? 'SUCCESS' : 'FAILED';
  outcomeScoreDelta.textContent = success ? `+${finalJudgement.scoreAdded} pt` : '+0 pt';

  outcomeOverlay.classList.remove('success', 'fail', 'active');
  void outcomeOverlay.offsetWidth;
  outcomeOverlay.classList.add(success ? 'success' : 'fail', 'active');
  outcomeOverlay.setAttribute('aria-hidden', 'false');

  outcomeHideTimeoutId = window.setTimeout(() => {
    outcomeOverlay.classList.remove('active');
    outcomeOverlay.setAttribute('aria-hidden', 'true');
    outcomeHideTimeoutId = null;
  }, 1800);
}

function clearOutcomeOverlayTimer() {
  if (outcomeHideTimeoutId !== null) {
    window.clearTimeout(outcomeHideTimeoutId);
    outcomeHideTimeoutId = null;
  }
}

async function createLiveSession(apiKey: string) {
  const ai = new GoogleGenAI({ apiKey });
  const modelCandidates = resolveLiveModelCandidates();
  const errors: string[] = [];
  const voiceName = resolveVoiceName();

  for (const modelName of modelCandidates) {
    const textParts: string[] = [];
    let resolved = false;
    let hasTranscriptChunk = false;
    let lastTranscriptChunk = '';
    let judgeTurnArmed = false;

    let resolveResponse!: (value: string) => void;
    let rejectResponse!: (reason?: unknown) => void;

    const responsePromise = new Promise<string>((resolve, reject) => {
      resolveResponse = resolve;
      rejectResponse = reject;
    });

    const armJudgeTurn = () => {
      judgeTurnArmed = true;
      hasTranscriptChunk = false;
      lastTranscriptChunk = '';
      textParts.length = 0;
    };

    try {
      const session = await ai.live.connect({
        model: modelName,
        config: {
          responseModalities: [Modality.AUDIO],
          outputAudioTranscription: {},
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName,
              },
            },
          },
          systemInstruction: buildSystemInstruction(),
        },
        callbacks: {
          onmessage: (message: any) => {
            if (!judgeTurnArmed) {
              return;
            }

            const outputTranscription = message?.serverContent?.outputTranscription?.text;
            if (typeof outputTranscription === 'string' && outputTranscription.trim()) {
              const cleaned = outputTranscription.trim();
              if (!hasTranscriptChunk) {
                hasTranscriptChunk = true;
                textParts.length = 0;
              }
              if (cleaned !== lastTranscriptChunk) {
                textParts.push(cleaned);
                lastTranscriptChunk = cleaned;
              }
            }

            if (!hasTranscriptChunk) {
              const parts = message?.serverContent?.modelTurn?.parts ?? [];
              for (const part of parts) {
                if (typeof part?.text === 'string' && part.text.trim()) {
                  textParts.push(part.text.trim());
                }
              }
            }

            if (message?.serverContent?.turnComplete && !resolved) {
              resolved = true;
              const merged = textParts.join(' ').replace(/\s+/g, ' ').trim();
              resolveResponse(merged);
            }
          },
          onerror: (event: ErrorEvent) => {
            if (!judgeTurnArmed) {
              return;
            }
            if (!resolved) {
              resolved = true;
              rejectResponse(new Error(event.message || 'Live API error'));
            }
          },
          onclose: (event: CloseEvent) => {
            if (!judgeTurnArmed) {
              return;
            }
            if (!resolved && textParts.length === 0) {
              resolved = true;
              rejectResponse(new Error(event.reason || 'Live API session closed'));
            }
          },
        },
      });

      return { session, responsePromise, modelName, armJudgeTurn };
    } catch (error) {
      errors.push(`${modelName}: ${stringifyError(error)}`);
    }
  }

  throw new Error(`Failed to connect to Live API. ${errors.join(' | ')}`);
}

function resolveLiveModelCandidates(): string[] {
  const requestedModel = (import.meta.env.VITE_GEMINI_LIVE_MODEL ?? '').trim();
  if (requestedModel) {
    return [requestedModel];
  }

  return [
    'gemini-2.5-flash-native-audio-latest',
    'gemini-2.5-flash-native-audio-preview-12-2025',
    'gemini-2.5-flash-native-audio-preview-09-2025',
  ];
}

function resolveVoiceName(): string {
  const configured = (import.meta.env.VITE_GEMINI_VOICE_NAME ?? '').trim();
  return configured || 'Kore';
}

async function captureEvidence(
  session: Session | null,
  video: HTMLVideoElement,
  stream: MediaStream | null,
  seconds: number,
  onTick?: (remainingSeconds: number) => void,
): Promise<CaptureEvidence> {
  if (!stream) {
    throw new Error('Media stream is unavailable');
  }

  await waitForVideoReady(video);

  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Failed to acquire canvas context');
  }

  const sampleInterval = Math.max(1, Math.floor(seconds / MAX_EVALUATION_FRAMES));
  const frameSamples: string[] = [];
  let videoFramesSent = 0;
  let audioStreamer: AudioRealtimeStreamer = {
    stop: () => ({
      sentChunks: 0,
      audioClipBase64: null,
      audioClipMimeType: null,
      audioClipBytes: 0,
    }),
  };
  try {
    audioStreamer = await startAudioRealtimeStreamer(session, stream);
  } catch {
    // Continue with video-only if microphone processing fails.
  }

  for (let elapsed = 0; elapsed < seconds; elapsed += 1) {
    const remaining = seconds - elapsed;
    onTick?.(remaining);
    canvas.width = Math.max(Math.round(video.videoWidth * 0.4), 320);
    canvas.height = Math.max(Math.round(video.videoHeight * 0.4), 240);
    context.drawImage(video, 0, 0, canvas.width, canvas.height);

    const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
    const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
    videoFramesSent += 1;

    if (session) {
      try {
        session.sendRealtimeInput({
          media: {
            mimeType: 'image/jpeg',
            data: base64,
          },
        });
      } catch {
        // ignore realtime video send failure and continue local capture
      }
    }

    const shouldSample = elapsed % sampleInterval === 0 || elapsed === seconds - 1;
    if (shouldSample) {
      frameSamples.push(base64);
    }

    await sleep(1000);
  }

  const audioCapture = audioStreamer.stop();

  if (frameSamples.length === 0) {
    throw new Error('No frames were captured for judgement');
  }

  return {
    frameSamples,
    videoFramesSent,
    audioChunksSent: audioCapture.sentChunks,
    audioClipBase64: audioCapture.audioClipBase64,
    audioClipMimeType: audioCapture.audioClipMimeType,
    audioClipBytes: audioCapture.audioClipBytes,
  };
}

async function getLocationSnapshot(challenge: Challenge): Promise<LocationSnapshot> {
  if (!challenge.locationCheck) {
    return { status: 'skipped' };
  }

  if (!('geolocation' in navigator)) {
    return {
      status: 'unsupported',
      message: 'This browser does not support geolocation.',
    };
  }

  try {
    const position = await new Promise<GeolocationPosition>((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: true,
        timeout: 7000,
        maximumAge: 0,
      });
    });

    return {
      status: 'available',
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
      accuracy: position.coords.accuracy,
    };
  } catch (error) {
    if (error instanceof GeolocationPositionError && error.code === error.PERMISSION_DENIED) {
      return {
        status: 'denied',
        message: 'Geolocation permission was denied.',
      };
    }

    return {
      status: 'error',
      message: 'Failed to get geolocation.',
    };
  }
}

function evaluateLocation(challenge: Challenge, snapshot: LocationSnapshot): string {
  if (!challenge.locationCheck) {
    return 'Skipped (no location requirement)';
  }

  if (snapshot.status !== 'available') {
    return `Skipped (${snapshot.message ?? snapshot.status})`;
  }

  const distance = calcDistanceMeters(
    snapshot.latitude ?? 0,
    snapshot.longitude ?? 0,
    challenge.locationCheck.lat,
    challenge.locationCheck.lng,
  );

  const roundedDistance = Math.round(distance);
  const roundedAccuracy = Math.round(snapshot.accuracy ?? 0);

  if (distance <= challenge.locationCheck.radiusMeters) {
    return `Success (${roundedDistance}m / allowed ${challenge.locationCheck.radiusMeters}m, accuracy ±${roundedAccuracy}m)`;
  }

  return `Failed (${roundedDistance}m / allowed ${challenge.locationCheck.radiusMeters}m, accuracy ±${roundedAccuracy}m)`;
}

function buildSystemInstruction() {
  return [
    'You are a strict real-world mission judge.',
    'Use the provided video and audio as evidence, and mark failure when unconfirmed.',
    'Return exactly one line only. No explanations.',
    'Use only this format: success=<true|false>;confidence=<0-1>;reason=<short>;detected_actions=<a|b|c>;safety_notes=<short>',
    'confidence must be a real number between 0 and 1.',
  ].join(' ');
}

function buildEvaluationPrompt(challenge: Challenge, location: LocationSnapshot, hasAudioClip: boolean) {
  const locationDetails = challenge.locationCheck
    ? `\nLocation requirement: within ${challenge.locationCheck.radiusMeters}m of ${challenge.locationCheck.label}.`
    : '\nLocation requirement: none.';

  const locationMeasurement =
    location.status === 'available'
      ? `\nCaptured GPS: lat=${location.latitude}, lng=${location.longitude}, accuracy=${location.accuracy}m`
      : `\nGPS status: ${location.message ?? location.status}`;

  return [
    'Judge whether the following challenge was completed.',
    `Challenge: ${challenge.description}`,
    locationDetails,
    locationMeasurement,
    hasAudioClip
      ? 'Video frames and audio (realtime + audio/wav clip) are attached. For speaking/singing tasks, use audio as evidence.'
      : 'Video frames and realtime audio are attached. Audio clip is not attached. For speaking/singing tasks, use only received audio as evidence.',
    'List 1-4 concrete actions detected on screen in detected_actions.',
    'Return only one line using this format.',
    'success=<true|false>;confidence=<0-1>;reason=<short>;detected_actions=<a|b|c>;safety_notes=<short>',
  ].join('\n');
}

async function parseJudgeResult(rawText: string, apiKey: string, challenge: Challenge): Promise<JudgeParseOutput> {
  const keyValueParsed = parseKeyValueJudgeResult(rawText);
  if (keyValueParsed) {
    return {
      result: keyValueParsed,
      trace: {
        source: 'live-key-value',
      },
    };
  }

  const jsonParsed = parseJsonJudgeResult(rawText);
  if (jsonParsed) {
    return {
      result: jsonParsed,
      trace: {
        source: 'live-json',
      },
    };
  }

  let normalizerError: string | undefined;
  try {
    const normalized = await normalizeJudgeResultWithModel(apiKey, challenge, rawText);
    if (normalized) {
      return {
        result: normalized.result,
        trace: {
          source: 'normalizer-json',
          normalizerModel: normalized.modelName,
          normalizerRawText: normalized.rawText,
        },
      };
    }
  } catch (error) {
    normalizerError = stringifyError(error);
  }

  const narrativeParsed = parseNarrativeJudgeResult(rawText);
  if (narrativeParsed) {
    return {
      result: narrativeParsed,
      trace: {
        source: 'narrative-fallback',
        normalizerError,
      },
    };
  }

  return {
    result: buildParseFailureResult(rawText),
    trace: {
      source: 'parse-failed',
      normalizerError,
    },
  };
}

function parseJsonJudgeResult(rawText: string): JudgeResult | null {
  const jsonCandidate = extractJson(rawText);
  if (!jsonCandidate) {
    return null;
  }

  try {
    const parsed = JSON.parse(jsonCandidate) as {
      success?: unknown;
      confidence?: unknown;
      reason?: unknown;
      detected_actions?: unknown;
      detectedActions?: unknown;
      safety_notes?: unknown;
      safetyNotes?: unknown;
    };

    const detectedActionsRaw = parsed.detected_actions ?? parsed.detectedActions;
    const safetyNotesRaw = parsed.safety_notes ?? parsed.safetyNotes;
    const detectedActions = Array.isArray(detectedActionsRaw)
      ? detectedActionsRaw.filter((v): v is string => typeof v === 'string').slice(0, 8)
      : [];

    return {
      success: normalizeBoolean(parsed.success),
      confidence: normalizeConfidence(parsed.confidence),
      reason: typeof parsed.reason === 'string' ? parsed.reason : 'No reason was returned.',
      detectedActions,
      safetyNotes: typeof safetyNotesRaw === 'string' ? safetyNotesRaw : '',
    };
  } catch {
    return null;
  }
}

function buildParseFailureResult(rawText: string): JudgeResult {
  return {
    success: false,
    confidence: 0,
    reason: `JSON parse failed: ${rawText.slice(0, 240)}`,
    detectedActions: [],
    safetyNotes: '',
  };
}

async function normalizeJudgeResultWithModel(apiKey: string, challenge: Challenge, rawText: string) {
  const ai = new GoogleGenAI({ apiKey });
  const models = resolveJudgeNormalizerModelCandidates();
  const errors: string[] = [];

  const responseSchema = {
    type: Type.OBJECT,
    properties: {
      success: { type: Type.BOOLEAN },
      confidence: { type: Type.NUMBER },
      reason: { type: Type.STRING },
      detectedActions: {
        type: Type.ARRAY,
        items: { type: Type.STRING },
      },
      safetyNotes: { type: Type.STRING },
    },
    required: ['success', 'confidence', 'reason', 'detectedActions', 'safetyNotes'],
  };

  for (const modelName of models) {
    try {
      const response = await withTimeout(
        ai.models.generateContent({
          model: modelName,
          contents: buildJudgeNormalizerPrompt(challenge, rawText),
          config: {
            temperature: 0,
            responseMimeType: 'application/json',
            responseSchema,
          },
        }),
        JUDGE_NORMALIZER_TIMEOUT_MS,
        `Judge normalizer model (${modelName}) timed out`,
      );

      const normalizedText = (response.text ?? '').trim();
      if (!normalizedText) {
        errors.push(`${modelName}: empty response`);
        continue;
      }

      const parsed = parseJsonJudgeResult(normalizedText);
      if (!parsed) {
        errors.push(`${modelName}: invalid json payload`);
        continue;
      }

      return {
        modelName,
        rawText: normalizedText,
        result: {
          ...parsed,
          safetyNotes: mergeSafetyNotes(parsed.safetyNotes, `normalizer:${modelName}`),
        },
      };
    } catch (error) {
      errors.push(`${modelName}: ${stringifyError(error)}`);
    }
  }

  if (errors.length > 0) {
    throw new Error(errors.join(' | '));
  }

  return null;
}

function resolveJudgeNormalizerModelCandidates(): string[] {
  const configured = (import.meta.env.VITE_GEMINI_JUDGE_NORMALIZER_MODEL ?? '').trim();
  if (configured) {
    return [configured];
  }

  return ['gemini-2.5-flash', 'gemini-2.0-flash'];
}

function buildJudgeNormalizerPrompt(challenge: Challenge, rawText: string): string {
  return [
    'You are a judgement text normalizer. Return the requested JSON based only on the judgement text.',
    'Do not create a new judgement. Extract the conclusion contained in the text.',
    'If the text is contradictory or unclear, set success=false and confidence to 0.4 or below.',
    'Keep reason within 120 characters and concise.',
    'detectedActions should be an array of 0-4 short phrases.',
    `challenge: ${challenge.description}`,
    `judge_text: ${rawText}`,
  ].join('\n');
}

async function runFallbackJudgeWithGenerateContent(
  apiKey: string,
  parts: Array<{ inlineData: { mimeType: string; data: string } } | { text: string }>,
): Promise<{ rawText: string; modelName: string }> {
  const ai = new GoogleGenAI({ apiKey });
  const models = resolveJudgeFallbackModelCandidates();
  const errors: string[] = [];

  const responseSchema = {
    type: Type.OBJECT,
    properties: {
      success: { type: Type.BOOLEAN },
      confidence: { type: Type.NUMBER },
      reason: { type: Type.STRING },
      detectedActions: {
        type: Type.ARRAY,
        items: { type: Type.STRING },
      },
      safetyNotes: { type: Type.STRING },
    },
    required: ['success', 'confidence', 'reason', 'detectedActions', 'safetyNotes'],
  };

  for (const modelName of models) {
    try {
      const response = await withTimeout(
        ai.models.generateContent({
          model: modelName,
          contents: parts,
          config: {
            temperature: 0,
            responseMimeType: 'application/json',
            responseSchema,
          },
        }),
        20000,
        `Fallback judge model (${modelName}) timed out`,
      );

      const rawText = (response.text ?? '').trim();
      if (!rawText) {
        errors.push(`${modelName}: empty response`);
        continue;
      }

      const parsed = parseJsonJudgeResult(rawText) ?? parseKeyValueJudgeResult(rawText);
      if (!parsed) {
        errors.push(`${modelName}: unparseable response`);
        continue;
      }

      return { rawText, modelName };
    } catch (error) {
      errors.push(`${modelName}: ${stringifyError(error)}`);
    }
  }

  throw new Error(`Fallback judgement failed. ${errors.join(' | ')}`);
}

function resolveJudgeFallbackModelCandidates(): string[] {
  const configured = (import.meta.env.VITE_GEMINI_JUDGE_FALLBACK_MODEL ?? '').trim();
  if (configured) {
    return [configured];
  }

  return ['gemini-2.5-flash', 'gemini-2.0-flash'];
}

function parseNarrativeJudgeResult(rawText: string): JudgeResult | null {
  const normalized = rawText.replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return null;
  }

  const lower = normalized.toLowerCase();

  // 1) Explicit success flag in narrative text wins.
  const explicitFalsePatterns = [
    /success\s*(?:is|=|:|to)?\s*false/i,
    /success\s*:\s*false/i,
    /\bsuccess\s+false\b/i,
    /\bnot successful\b/i,
    /\bfailed\b/i,
  ];
  const explicitTruePatterns = [
    /success\s*(?:is|=|:|to)?\s*true/i,
    /success\s*:\s*true/i,
    /\bsuccess\s+true\b/i,
    /\bsuccessful\b/i,
  ];

  const hasExplicitFalse = explicitFalsePatterns.some((pattern) => pattern.test(normalized));
  const hasExplicitTrue = explicitTruePatterns.some((pattern) => pattern.test(normalized));

  if (hasExplicitFalse && !hasExplicitTrue) {
    return {
      success: false,
      confidence: 0.9,
      reason: summarizeNarrativeReason(normalized),
      detectedActions: [],
      safetyNotes: 'fallback:narrative-explicit-false',
    };
  }
  if (hasExplicitTrue && !hasExplicitFalse) {
    return {
      success: true,
      confidence: 0.85,
      reason: summarizeNarrativeReason(normalized),
      detectedActions: [],
      safetyNotes: 'fallback:narrative-explicit-true',
    };
  }

  // 2) Heuristic signal counting (negative-biased for safety).
  const positivePatterns = [
    /successful completion/g,
    /completed successfully/g,
    /challenge (?:was )?completed/g,
    /criteria (?:are|is|were|was) met/g,
    /requirement(?:s)? (?:are|is|were|was) met/g,
    /confirmed utterance/g,
  ];
  const negativePatterns = [
    /\bfail(?:ed|ure)?\b/g,
    /cannot confirm/g,
    /unable to confirm/g,
    /could not confirm/g,
    /unconfirmed/g,
    /insufficient/g,
    /does not meet/g,
    /not completed/g,
    /no (visual|audio)?\s*evidence/g,
    /lack of audio/g,
    /without audio/g,
    /audio (?:stream )?(?:is )?(?:unavailable|missing|not available|could not be confirmed)/g,
  ];

  const positiveHits = countMatches(lower, positivePatterns);
  const negativeHits = countMatches(lower, negativePatterns);

  if (positiveHits === 0 && negativeHits === 0) {
    return null;
  }

  // Negative wins ties to avoid false-positive scoring.
  const success = positiveHits > negativeHits;
  const delta = Math.abs(positiveHits - negativeHits);
  const confidenceBase = 0.55 + Math.min(0.3, delta * 0.08);
  const confidence = clamp(confidenceBase, 0.5, 0.85);

  return {
    success,
    confidence,
    reason: summarizeNarrativeReason(normalized),
    detectedActions: [],
    safetyNotes: success ? 'fallback:narrative-heuristic-true' : 'fallback:narrative-heuristic-false',
  };
}

function parseKeyValueJudgeResult(rawText: string): JudgeResult | null {
  const line = rawText.replaceAll('\n', ' ').trim();
  if (!line.includes('success=') || !line.includes('confidence=')) {
    return null;
  }

  const segments = line.split(';').map((segment) => segment.trim());
  const map = new Map<string, string>();

  for (const segment of segments) {
    const [key, ...rest] = segment.split('=');
    if (!key || rest.length === 0) {
      continue;
    }
    map.set(key.toLowerCase(), rest.join('=').trim());
  }

  const successRaw = (map.get('success') ?? '').toLowerCase();
  const confidenceRaw = map.get('confidence') ?? '';
  const reason = map.get('reason') ?? 'No reason was returned.';
  const safetyNotes = map.get('safety_notes') ?? '';
  const actionsRaw = map.get('detected_actions') ?? '';

  const detectedActions = actionsRaw
    .split(/[|,、]/)
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
    .slice(0, 8);

  return {
    success: successRaw === 'true' || successRaw === '1' || successRaw === 'yes',
    confidence: normalizeConfidence(Number(confidenceRaw)),
    reason,
    detectedActions,
    safetyNotes,
  };
}

function normalizeConfidence(value: unknown): number {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return 0;
  }

  if (value > 1 && value <= 100) {
    return clamp(value / 100, 0, 1);
  }

  return clamp(value, 0, 1);
}

function normalizeBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    return value > 0;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    return normalized === 'true' || normalized === '1' || normalized === 'yes';
  }
  return false;
}

function mergeSafetyNotes(base: string, extra: string): string {
  if (!base) {
    return extra;
  }
  if (base.includes(extra)) {
    return base;
  }
  return `${base}|${extra}`;
}

function countMatches(text: string, patterns: RegExp[]): number {
  return patterns.reduce((count, pattern) => {
    const matches = text.match(pattern);
    return count + (matches ? matches.length : 0);
  }, 0);
}

function summarizeNarrativeReason(text: string): string {
  const firstSentence = text.split(/(?<=[.!?])\s+/)[0] ?? text;
  return firstSentence.slice(0, 220);
}

function extractJson(text: string): string | null {
  const match = text.match(/\{[\s\S]*\}/);
  return match ? match[0] : null;
}

function pickRandomChallenge(excludedId?: string) {
  const candidates = FIXED_CHALLENGES.filter((challenge) => challenge.id !== excludedId);
  return candidates[Math.floor(Math.random() * candidates.length)];
}

async function refreshChallengeBySource(excludedId: string | undefined, context: ChallengeRefreshContext) {
  if (isGeneratingChallenge) {
    return;
  }

  if (customChallengeText) {
    currentChallenge = buildCustomChallenge(customChallengeText);
    renderChallenge(currentChallenge);
    if (context !== 'post-judge') {
      setStatus('Custom challenge mode is active. Clear it to use generated or fixed missions.', 'info');
    }
    return;
  }

  isGeneratingChallenge = true;
  syncButtonState();

  try {
    const shouldNotify = context !== 'post-judge';
    if (challengeSourceMode === 'ai') {
      const generated = await generateAiChallenge(excludedId, shouldNotify);
      currentChallenge = generated ?? pickRandomChallenge(excludedId);
      renderChallenge(currentChallenge);
      return;
    }

    currentChallenge = pickRandomChallenge(excludedId);
    renderChallenge(currentChallenge);
    if (shouldNotify) {
      setStatus('A new fixed mission has been set.', 'info');
    }
  } finally {
    isGeneratingChallenge = false;
    syncButtonState();
  }
}

function buildCustomChallenge(text: string): Challenge {
  return {
    id: 'custom-debug-challenge',
    title: 'DEBUG Custom Challenge',
    description: text,
    points: CUSTOM_CHALLENGE_POINTS,
  };
}

function normalizeCustomChallengeText(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed.length < 1 || trimmed.length > 220) {
    return null;
  }
  return trimmed;
}

function loadCustomChallengeText(): string | null {
  const raw = localStorage.getItem(CUSTOM_CHALLENGE_STORAGE_KEY);
  if (!raw) {
    return null;
  }
  return normalizeCustomChallengeText(raw);
}

function persistCustomChallengeText(text: string | null) {
  if (!text) {
    localStorage.removeItem(CUSTOM_CHALLENGE_STORAGE_KEY);
    return;
  }
  localStorage.setItem(CUSTOM_CHALLENGE_STORAGE_KEY, text);
}

async function generateAiChallenge(excludedId: string | undefined, notifyStatus: boolean): Promise<Challenge | null> {
  const apiKey = (import.meta.env.VITE_GEMINI_API_KEY ?? '').trim();
  if (!apiKey) {
    if (notifyStatus) {
      setStatus('AI challenge mode requires VITE_GEMINI_API_KEY. Falling back to fixed missions.', 'error');
    }
    return null;
  }

  if (notifyStatus) {
    setStatus('Generating mission with AI...', 'info');
  }

  const ai = new GoogleGenAI({ apiKey });
  const models = resolveChallengeGeneratorModelCandidates();
  const errors: string[] = [];

  const responseSchema = {
    type: Type.OBJECT,
    properties: {
      title: { type: Type.STRING },
      description: { type: Type.STRING },
      points: { type: Type.NUMBER },
    },
    required: ['title', 'description', 'points'],
  };

  for (const modelName of models) {
    try {
      const response = await withTimeout(
        ai.models.generateContent({
          model: modelName,
          contents: buildChallengeGenerationPrompt(currentChallenge),
          config: {
            temperature: 0.9,
            responseMimeType: 'application/json',
            responseSchema,
          },
        }),
        CHALLENGE_GENERATOR_TIMEOUT_MS,
        `Challenge generator model (${modelName}) timed out`,
      );

      const payloadText = (response.text ?? '').trim();
      if (!payloadText) {
        errors.push(`${modelName}: empty response`);
        continue;
      }

      const parsed = parseAiChallengePayload(payloadText, excludedId);
      if (!parsed) {
        errors.push(`${modelName}: invalid payload`);
        continue;
      }

      if (notifyStatus) {
        setStatus('AI generated a new mission.', 'ok');
      }
      return parsed;
    } catch (error) {
      errors.push(`${modelName}: ${stringifyError(error)}`);
    }
  }

  if (notifyStatus) {
    setStatus('AI generation failed. Falling back to fixed missions.', 'error');
  }
  if (errors.length > 0) {
    console.warn('ai-challenge-generation-failed', errors.join(' | '));
  }
  return null;
}

function resolveChallengeGeneratorModelCandidates(): string[] {
  const configured = (import.meta.env.VITE_GEMINI_CHALLENGE_MODEL ?? '').trim();
  if (configured) {
    return [configured];
  }

  return ['gemini-2.5-flash', 'gemini-2.0-flash'];
}

function buildChallengeGenerationPrompt(previousChallenge: Challenge): string {
  return [
    'Generate exactly one real-world challenge for a mobile/web camera game.',
    'Requirements:',
    '- Safe and legal in public spaces.',
    '- Family-friendly.',
    '- Can be verified through short video/audio capture.',
    '- Avoid requiring a specific city/place.',
    '- Keep it short and concrete.',
    '- Do not mention JSON, schema, or formatting instructions in the output fields.',
    `Previous challenge title (avoid repeating): ${previousChallenge.title}`,
  ].join('\n');
}

function parseAiChallengePayload(payloadText: string, excludedId?: string): Challenge | null {
  const jsonCandidate = extractJson(payloadText) ?? payloadText;

  try {
    const parsed = JSON.parse(jsonCandidate) as {
      title?: unknown;
      description?: unknown;
      points?: unknown;
    };

    const title = typeof parsed.title === 'string' ? parsed.title.trim() : '';
    const description = typeof parsed.description === 'string' ? parsed.description.trim() : '';
    const pointsRaw = typeof parsed.points === 'number' ? parsed.points : Number(parsed.points);

    if (!title || !description) {
      return null;
    }

    const points = clamp(Math.round(Number.isFinite(pointsRaw) ? pointsRaw : 150), 80, 320);
    let id = `ai-${slugify(title)}`;
    if (id === 'ai-' || id === `ai-${excludedId}`) {
      id = `ai-${Date.now()}`;
    }

    return {
      id,
      title: title.slice(0, 60),
      description: description.slice(0, 220),
      points,
    };
  } catch {
    return null;
  }
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

function loadChallengeSourceMode(): ChallengeSourceMode {
  const raw = localStorage.getItem(CHALLENGE_SOURCE_STORAGE_KEY);
  if (raw === 'ai') {
    return 'ai';
  }
  return 'fixed';
}

function persistChallengeSourceMode(mode: ChallengeSourceMode) {
  localStorage.setItem(CHALLENGE_SOURCE_STORAGE_KEY, mode);
}

function loadState(): AppState {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return { score: 0, streak: 0 };
  }

  try {
    const parsed = JSON.parse(raw) as Partial<AppState>;
    return {
      score: typeof parsed.score === 'number' ? parsed.score : 0,
      streak: typeof parsed.streak === 'number' ? parsed.streak : 0,
    };
  } catch {
    return { score: 0, streak: 0 };
  }
}

function persistState(state: AppState) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function loadHistory(): HistoryRecord[] {
  const raw = localStorage.getItem(HISTORY_STORAGE_KEY);
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as HistoryRecord[];
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.slice(0, 8);
  } catch {
    return [];
  }
}

function persistHistory(records: HistoryRecord[]) {
  localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(records));
}

async function startAudioRealtimeStreamer(session: Session | null, stream: MediaStream): Promise<AudioRealtimeStreamer> {
  const audioTracks = stream.getAudioTracks();
  if (audioTracks.length === 0) {
    return {
      stop: () => ({
        sentChunks: 0,
        audioClipBase64: null,
        audioClipMimeType: null,
        audioClipBytes: 0,
      }),
    };
  }

  const audioOnlyStream = new MediaStream([audioTracks[0]]);
  const targetSampleRate = 16000;
  const audioContext = new AudioContext({ sampleRate: targetSampleRate });
  await audioContext.resume();

  const source = audioContext.createMediaStreamSource(audioOnlyStream);
  const processor = audioContext.createScriptProcessor(4096, 1, 1);

  let sentChunks = 0;
  let stopped = false;
  let totalPcmSamples = 0;
  const pcmChunks: Int16Array[] = [];

  processor.onaudioprocess = (event) => {
    const input = event.inputBuffer.getChannelData(0);
    const pcm16 = downsampleToInt16(input, event.inputBuffer.sampleRate, targetSampleRate);
    if (pcm16.length === 0) {
      return;
    }

    pcmChunks.push(new Int16Array(pcm16));
    totalPcmSamples += pcm16.length;
    sentChunks += 1;

    if (session) {
      const base64 = int16ToBase64(pcm16);
      try {
        session.sendRealtimeInput({
          media: {
            mimeType: 'audio/pcm',
            data: base64,
          },
        });
      } catch {
        // ignore realtime audio send failure and continue local recording
      }
    }

    event.outputBuffer.getChannelData(0).fill(0);
  };

  source.connect(processor);
  processor.connect(audioContext.destination);

  return {
    stop: () => {
      if (stopped) {
        return {
          sentChunks,
          audioClipBase64: null,
          audioClipMimeType: null,
          audioClipBytes: 0,
        };
      }

      stopped = true;
      try {
        source.disconnect();
      } catch {
        // ignore disconnect error
      }
      try {
        processor.disconnect();
      } catch {
        // ignore disconnect error
      }
      processor.onaudioprocess = null;
      void audioContext.close().catch(() => {
        // ignore close error
      });

      if (session) {
        try {
          session.sendRealtimeInput({ audioStreamEnd: true });
        } catch {
          // ignore stream end error
        }
      }

      if (totalPcmSamples <= 0) {
        return {
          sentChunks,
          audioClipBase64: null,
          audioClipMimeType: null,
          audioClipBytes: 0,
        };
      }

      const mergedPcm = mergeInt16Chunks(pcmChunks, totalPcmSamples);
      const wavBuffer = encodePcm16ToWav(mergedPcm, targetSampleRate, 1);
      const audioClipBase64 = arrayBufferToBase64(wavBuffer);

      return {
        sentChunks,
        audioClipBase64,
        audioClipMimeType: 'audio/wav',
        audioClipBytes: wavBuffer.byteLength,
      };
    },
  };
}

function downsampleToInt16(
  input: Float32Array,
  inputSampleRate: number,
  targetSampleRate: number,
): Int16Array {
  if (input.length === 0) {
    return new Int16Array();
  }

  if (inputSampleRate <= targetSampleRate) {
    return float32ToInt16(input);
  }

  const ratio = inputSampleRate / targetSampleRate;
  const outputLength = Math.max(1, Math.round(input.length / ratio));
  const output = new Int16Array(outputLength);

  let outputIndex = 0;
  let inputIndex = 0;

  while (outputIndex < outputLength) {
    const nextInputIndex = Math.min(input.length, Math.round((outputIndex + 1) * ratio));
    let sum = 0;
    let count = 0;
    for (let i = inputIndex; i < nextInputIndex; i += 1) {
      sum += input[i];
      count += 1;
    }
    const sample = count > 0 ? sum / count : 0;
    const clamped = Math.max(-1, Math.min(1, sample));
    output[outputIndex] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;

    outputIndex += 1;
    inputIndex = nextInputIndex;
  }

  return output;
}

function float32ToInt16(input: Float32Array): Int16Array {
  const output = new Int16Array(input.length);
  for (let i = 0; i < input.length; i += 1) {
    const sample = Math.max(-1, Math.min(1, input[i]));
    output[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }
  return output;
}

function int16ToBase64(input: Int16Array): string {
  const bytes = new Uint8Array(input.buffer);
  const chunkSize = 0x8000;
  let binary = '';

  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  return window.btoa(binary);
}

function mergeInt16Chunks(chunks: Int16Array[], totalSamples: number): Int16Array {
  const merged = new Int16Array(totalSamples);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return merged;
}

function encodePcm16ToWav(samples: Int16Array, sampleRate: number, channels: number): ArrayBuffer {
  const bytesPerSample = 2;
  const blockAlign = channels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = samples.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(view, 8, 'WAVE');
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i += 1) {
    view.setInt16(offset, samples[i], true);
    offset += 2;
  }

  return buffer;
}

function writeAscii(view: DataView, offset: number, text: string) {
  for (let i = 0; i < text.length; i += 1) {
    view.setUint8(offset + i, text.charCodeAt(i));
  }
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = '';

  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  return window.btoa(binary);
}

async function startMediaCapture() {
  if (activeStream && hasLiveTracks(activeStream)) {
    attachStreamToPreviews(activeStream);
    await ensureVideoPlaying(preview);
    void ensureGestureTriggerWatcher();
    return;
  }

  const stream = await navigator.mediaDevices.getUserMedia({
    video: {
      width: { ideal: 1280 },
      height: { ideal: 720 },
      facingMode: 'environment',
    },
    audio: {
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  });

  activeStream = stream;
  attachStreamToPreviews(stream);
  await ensureVideoPlaying(preview);
  void ensureGestureTriggerWatcher();
}

function stopMedia() {
  if (activeStream) {
    activeStream.getTracks().forEach((track) => track.stop());
    activeStream = null;
  }
  preview.srcObject = null;
  overlayPreview.srcObject = null;
}

function closeSession() {
  if (activeSession) {
    try {
      activeSession.close();
    } catch {
      // ignore close error
    }
    activeSession = null;
  }
}

function waitForVideoReady(video: HTMLVideoElement): Promise<void> {
  if (video.videoWidth > 0 && video.videoHeight > 0) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      reject(new Error('Camera initialization timed out'));
    }, 5000);

    const onLoaded = () => {
      clearTimeout(timeout);
      resolve();
    };

    video.addEventListener('loadeddata', onLoaded, { once: true });
  });
}

function calcDistanceMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const earthRadius = 6371e3;
  const rad = (v: number) => (v * Math.PI) / 180;

  const dLat = rad(lat2 - lat1);
  const dLon = rad(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadius * c;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function queryEl<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) {
    throw new Error(`missing element: ${selector}`);
  }
  return element;
}

function stringifyError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  return 'unknown error';
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const id = window.setTimeout(() => {
      reject(new Error(message));
    }, ms);

    promise
      .then((value) => {
        clearTimeout(id);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(id);
        reject(error);
      });
  });
}

async function ensureGestureTriggerWatcher() {
  if (!GESTURE_TRIGGER_ENABLED || handLandmarker || gestureInitPromise) {
    return;
  }

  if (Date.now() < gestureRetryAfterMs) {
    return;
  }

  gestureInitPromise = (async () => {
    try {
      const vision = (await import('@mediapipe/tasks-vision')) as unknown as VisionTasksModule;
      const filesetResolver = await vision.FilesetResolver.forVisionTasks(GESTURE_WASM_ROOT);
      handLandmarker = await createHandLandmarker(vision, filesetResolver);
      startGestureLoop();
    } catch (error) {
      gestureInitFailedMessage = stringifyError(error);
      gestureRetryAfterMs = Date.now() + 30000;
      console.warn('gesture-trigger-init-failed', error);
      setStatus(
        `Failed to enable finger-gesture detection. Use the button or Space to start. (${gestureInitFailedMessage})`,
        'error',
      );
    } finally {
      gestureInitPromise = null;
    }
  })();

  await gestureInitPromise;
}

async function createHandLandmarker(vision: VisionTasksModule, filesetResolver: unknown): Promise<HandLandmarkerLike> {
  const baseOptions = {
    modelAssetPath: GESTURE_MODEL_ASSET_PATH,
  };
  const delegates: Array<'GPU' | 'CPU'> = ['GPU', 'CPU'];
  let lastError: unknown = null;

  for (const delegate of delegates) {
    try {
      return await vision.HandLandmarker.createFromOptions(filesetResolver, {
        baseOptions: {
          ...baseOptions,
          delegate,
        },
        runningMode: 'VIDEO',
        numHands: 1,
        minHandDetectionConfidence: 0.65,
        minHandPresenceConfidence: 0.6,
        minTrackingConfidence: 0.55,
      });
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError ?? new Error('hand landmarker initialization failed');
}

function startGestureLoop() {
  if (!handLandmarker || gestureLoopHandle !== null) {
    return;
  }

  const tick = (timestampMs: number) => {
    gestureLoopHandle = window.requestAnimationFrame(tick);
    runGestureFrame(timestampMs);
  };

  gestureLoopHandle = window.requestAnimationFrame(tick);
}

function stopGestureWatcher() {
  if (gestureLoopHandle !== null) {
    window.cancelAnimationFrame(gestureLoopHandle);
    gestureLoopHandle = null;
  }
  gestureHoldStartedAtMs = null;

  if (handLandmarker?.close) {
    try {
      handLandmarker.close();
    } catch {
      // ignore close error
    }
  }
  handLandmarker = null;
}

function runGestureFrame(timestampMs: number) {
  if (!handLandmarker || isVerifying || isCapturing || !activeStream || !hasLiveTracks(activeStream)) {
    gestureHoldStartedAtMs = null;
    return;
  }

  if (preview.videoWidth < 120 || preview.videoHeight < 120) {
    return;
  }

  if (timestampMs - gestureLastInferenceAtMs < GESTURE_INFERENCE_INTERVAL_MS) {
    return;
  }
  gestureLastInferenceAtMs = timestampMs;

  let landmarks: LandmarkPoint[][] = [];
  try {
    const result = handLandmarker.detectForVideo(preview, timestampMs);
    landmarks = result.landmarks ?? [];
  } catch {
    gestureHoldStartedAtMs = null;
    return;
  }

  const circleDetected = landmarks.some((hand) => isCircleGestureNearCenter(hand));
  if (!circleDetected) {
    gestureHoldStartedAtMs = null;
    return;
  }

  if (gestureHoldStartedAtMs === null) {
    gestureHoldStartedAtMs = timestampMs;
    return;
  }

  if (timestampMs - gestureHoldStartedAtMs < GESTURE_HOLD_MS) {
    return;
  }

  const nowEpoch = Date.now();
  if (nowEpoch - gestureLastTriggeredAtMs < GESTURE_COOLDOWN_MS) {
    return;
  }

  gestureLastTriggeredAtMs = nowEpoch;
  gestureHoldStartedAtMs = null;
  setStatus('Finger circle gesture detected. Starting Share Reality.', 'info');
  void verifyCurrentChallenge();
}

function isCircleGestureNearCenter(landmarks: LandmarkPoint[]): boolean {
  if (landmarks.length < 21) {
    return false;
  }

  const wrist = landmarks[0];
  const thumbTip = landmarks[4];
  const indexTip = landmarks[8];
  const indexMcp = landmarks[5];
  const middlePip = landmarks[10];
  const middleTip = landmarks[12];
  const middleMcp = landmarks[9];
  const ringPip = landmarks[14];
  const ringTip = landmarks[16];
  const ringMcp = landmarks[13];
  const pinkyPip = landmarks[18];
  const pinkyTip = landmarks[20];
  const pinkyMcp = landmarks[17];

  if (
    !wrist ||
    !thumbTip ||
    !indexTip ||
    !indexMcp ||
    !middlePip ||
    !middleTip ||
    !middleMcp ||
    !ringPip ||
    !ringTip ||
    !ringMcp ||
    !pinkyPip ||
    !pinkyTip ||
    !pinkyMcp
  ) {
    return false;
  }

  const palmSize = distance2d(wrist, middleMcp);
  if (palmSize < 0.04) {
    return false;
  }

  const pinchDistance = distance2d(thumbTip, indexTip);
  const pinchValid = pinchDistance <= palmSize * GESTURE_PINCH_TO_PALM_RATIO;
  if (!pinchValid) {
    return false;
  }

  const middleExtended = isFingerExtended(middleTip, middlePip, wrist);
  const ringExtended = isFingerExtended(ringTip, ringPip, wrist);
  const pinkyExtended = isFingerExtended(pinkyTip, pinkyPip, wrist);
  if (!middleExtended || !ringExtended || !pinkyExtended) {
    return false;
  }

  const handCenter = averagePoint([wrist, indexMcp, middleMcp, ringMcp, pinkyMcp]);
  const loopCenter = averagePoint([thumbTip, indexTip]);
  const screenCenter = { x: 0.5, y: 0.5 };

  if (distance2d(handCenter, screenCenter) > GESTURE_CENTER_RADIUS) {
    return false;
  }

  return distance2d(loopCenter, screenCenter) <= GESTURE_CENTER_RADIUS * 0.9;
}

function isFingerExtended(tip: LandmarkPoint, pip: LandmarkPoint, wrist: LandmarkPoint): boolean {
  const tipDistance = distance2d(tip, wrist);
  const pipDistance = distance2d(pip, wrist);
  return tipDistance > pipDistance * GESTURE_EXTENSION_RATIO;
}

function averagePoint(points: LandmarkPoint[]): LandmarkPoint {
  const sum = points.reduce(
    (acc, point) => {
      acc.x += point.x;
      acc.y += point.y;
      return acc;
    },
    { x: 0, y: 0 },
  );

  return {
    x: sum.x / points.length,
    y: sum.y / points.length,
  };
}

function distance2d(a: LandmarkPoint, b: LandmarkPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

async function warmupMissionCamera() {
  try {
    await startMediaCapture();
  } catch (error) {
    setStatus(
      `Failed to start Mission Camera. Grant permissions and retry. (${stringifyError(error)})`,
      'error',
    );
  }
}

function hasLiveTracks(stream: MediaStream): boolean {
  return stream.getTracks().some((track) => track.readyState === 'live');
}

function attachStreamToPreviews(stream: MediaStream) {
  if (preview.srcObject !== stream) {
    preview.srcObject = stream;
  }
  if (overlayPreview.srcObject !== stream) {
    overlayPreview.srcObject = stream;
  }
}

async function ensureVideoPlaying(video: HTMLVideoElement) {
  if (video.srcObject && !video.paused && !video.ended) {
    return;
  }
  try {
    await video.play();
  } catch {
    // ignore autoplay/play interruption; next user gesture will retry.
  }
}

function shouldIgnoreSpaceShortcut(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  if (target.isContentEditable) {
    return true;
  }

  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'BUTTON';
}

function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function resolveCaptureSeconds(): number {
  const configured = Number(import.meta.env.VITE_CAPTURE_SECONDS);
  if (!Number.isFinite(configured)) {
    return 10;
  }

  const rounded = Math.round(configured);
  if (rounded < 1 || rounded > 60) {
    return 10;
  }

  return rounded;
}

function resolveGestureTriggerEnabled(): boolean {
  const raw = String(import.meta.env.VITE_GESTURE_TRIGGER_ENABLED ?? 'true').trim().toLowerCase();
  return raw !== '0' && raw !== 'false' && raw !== 'off' && raw !== 'no';
}

function resolveGestureWasmRoot(): string {
  const configured = String(import.meta.env.VITE_GESTURE_WASM_ROOT ?? '').trim();
  if (configured) {
    return configured;
  }
  return 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm';
}

function resolveGestureModelAssetPath(): string {
  const configured = String(import.meta.env.VITE_GESTURE_MODEL_ASSET_PATH ?? '').trim();
  if (configured) {
    return configured;
  }
  return 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
}
