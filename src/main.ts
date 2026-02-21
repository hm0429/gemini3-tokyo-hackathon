import { GoogleGenAI, Modality, type Session } from '@google/genai';
import './style.css';

type Challenge = {
  id: string;
  title: string;
  description: string;
  points: number;
  locationCheck?: {
    label: string;
    lat: number;
    lng: number;
    radiusMeters: number;
  };
};

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

const STORAGE_KEY = 'reality-quest-state-v1';
const HISTORY_STORAGE_KEY = 'reality-quest-history-v1';
const CUSTOM_CHALLENGE_STORAGE_KEY = 'reality-quest-custom-challenge-v1';
const CAPTURE_SECONDS = resolveCaptureSeconds();
const CUSTOM_CHALLENGE_POINTS = 150;
const MAX_EVALUATION_FRAMES = 12;

const FIXED_CHALLENGES: Challenge[] = [
  {
    id: 'white-glasses-person',
    title: '街角スカウト',
    description: 'メガネをかけて白い服を着ている人を探して、同じフレームに入ってください。',
    points: 120,
  },
  {
    id: 'hachiko-squats',
    title: 'ハチ公チャレンジ',
    description: 'ハチ公前のエリアでスクワットを 5 回行ってください。',
    points: 220,
    locationCheck: {
      label: '渋谷・ハチ公像周辺',
      lat: 35.659482,
      lng: 139.70056,
      radiusMeters: 180,
    },
  },
  {
    id: 'red-sign-pose',
    title: '赤看板ポーズ',
    description: '赤い看板が見える場所で、3 秒間両手を上げてポーズしてください。',
    points: 140,
  },
  {
    id: 'convenience-peace',
    title: 'コンビニピース',
    description: 'コンビニの袋を持って、カメラに向かってピースしてください。',
    points: 150,
  },
  {
    id: 'vending-jump',
    title: '自販機ジャンプ',
    description: '自動販売機が映る位置で、その場ジャンプを 2 回してください。',
    points: 170,
  },
  {
    id: 'bench-sit',
    title: 'ベンチ休憩',
    description: '公園か屋外ベンチに座って、手を振ってください。',
    points: 130,
  },
  {
    id: '',
    title: 'バンザイ',
    description: '両手を上げてください。バンザイの姿勢をとってください。',
    points: 130,
  },
];

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) {
  throw new Error('app root not found');
}

app.innerHTML = `
  <div class="shell">
    <header class="hero">
      <p class="eyebrow">REAL WORLD QUEST</p>
      <h1>AI お題ミッション</h1>
      <p class="lead">AI がランダムなお題を出題し、Gemini Live API が実行可否を判定します。</p>
    </header>

    <main class="layout">
      <section class="panel mission">
        <div class="panel-head">
          <h2>現在のお題</h2>
          <span id="challengePoints" class="points-pill">+0 pt</span>
        </div>
        <h3 id="challengeTitle" class="challenge-title">読み込み中...</h3>
        <p id="challengeDescription" class="challenge-description"></p>
        <p id="locationHint" class="location-hint"></p>

        <div class="actions">
          <button id="newChallengeButton" class="btn ghost">次のお題</button>
          <button id="verifyButton" class="btn primary">実行を判定する</button>
          <button id="resetScoreButton" class="btn danger">スコアをリセット</button>
        </div>
        <div class="custom-challenge-panel">
          <p class="custom-challenge-label">Debug カスタムお題</p>
          <textarea id="customChallengeInput" class="custom-challenge-input" placeholder="例: ハチ公前でスクワットを 5 回してください"></textarea>
          <div class="custom-challenge-actions">
            <button id="applyCustomChallengeButton" class="btn ghost" type="button">カスタムお題をセット</button>
            <button id="clearCustomChallengeButton" class="btn ghost" type="button">カスタム解除</button>
          </div>
          <p id="customChallengeMeta" class="custom-challenge-meta"></p>
        </div>

        <p id="statusText" class="status info">準備完了。カメラ許可後に判定できます。</p>
      </section>

      <section class="panel evidence">
        <h2>判定ストリーム</h2>
        <video id="cameraPreview" class="preview" playsinline muted></video>
        <p class="preview-note">判定中に ${CAPTURE_SECONDS} 秒間の映像を撮影し、代表フレームを Gemini Live API に送信します。</p>

        <div class="result-card">
          <h3>直近の判定結果</h3>
          <p id="resultSummary">未実行</p>
          <p id="resultReason">理由: -</p>
          <p id="resultConfidence">信頼度: -</p>
          <p id="resultLocation">位置判定: -</p>
          <p id="resultActions">検出アクション: -</p>
          <p class="judge-debug-label">judge result (debug)</p>
          <pre id="judgeJson" class="judge-json">-</pre>
        </div>
      </section>
    </main>

    <section class="panel scoreboard">
      <div class="metrics">
        <div class="metric">
          <p class="metric-label">TOTAL SCORE</p>
          <p id="scoreValue" class="metric-value">0</p>
        </div>
        <div class="metric">
          <p class="metric-label">STREAK</p>
          <p id="streakValue" class="metric-value">0</p>
        </div>
      </div>

      <div class="history-wrap">
        <h3>プレイ履歴</h3>
        <ul id="historyList" class="history-list"></ul>
      </div>
    </section>
  </div>
`;

const scoreValue = queryEl<HTMLParagraphElement>('#scoreValue');
const streakValue = queryEl<HTMLParagraphElement>('#streakValue');
const challengeTitle = queryEl<HTMLHeadingElement>('#challengeTitle');
const challengeDescription = queryEl<HTMLParagraphElement>('#challengeDescription');
const challengePoints = queryEl<HTMLSpanElement>('#challengePoints');
const locationHint = queryEl<HTMLParagraphElement>('#locationHint');
const statusText = queryEl<HTMLParagraphElement>('#statusText');
const preview = queryEl<HTMLVideoElement>('#cameraPreview');
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

let appState = loadState();
let history = loadHistory();
let customChallengeText = loadCustomChallengeText();
let currentChallenge = customChallengeText ? buildCustomChallenge(customChallengeText) : pickRandomChallenge();
let isVerifying = false;
let activeStream: MediaStream | null = null;
let activeSession: Session | null = null;

newChallengeButton.addEventListener('click', () => {
  if (isVerifying) {
    return;
  }
  if (customChallengeText) {
    currentChallenge = buildCustomChallenge(customChallengeText);
    renderChallenge(currentChallenge);
    setStatus('カスタムお題モード中です。解除するとランダム出題に戻ります。', 'info');
    return;
  }
  currentChallenge = pickRandomChallenge(currentChallenge.id);
  renderChallenge(currentChallenge);
  setStatus('新しいお題をセットしました。', 'info');
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
  setStatus('スコアと履歴をリセットしました。', 'info');
});

applyCustomChallengeButton.addEventListener('click', () => {
  if (isVerifying) {
    return;
  }

  const normalized = normalizeCustomChallengeText(customChallengeInput.value);
  if (!normalized) {
    setStatus('カスタムお題を 1〜220 文字で入力してください。', 'error');
    return;
  }

  customChallengeText = normalized;
  persistCustomChallengeText(customChallengeText);
  currentChallenge = buildCustomChallenge(customChallengeText);
  renderChallenge(currentChallenge);
  renderCustomChallengeState();
  setStatus('デバッグ用カスタムお題をセットしました。', 'info');
});

clearCustomChallengeButton.addEventListener('click', () => {
  if (isVerifying) {
    return;
  }
  if (!customChallengeText) {
    setStatus('カスタムお題は未設定です。', 'info');
    return;
  }

  customChallengeText = null;
  persistCustomChallengeText(customChallengeText);
  currentChallenge = pickRandomChallenge();
  renderChallenge(currentChallenge);
  renderCustomChallengeState();
  setStatus('カスタムお題を解除してランダム出題へ戻しました。', 'info');
});

window.addEventListener('beforeunload', () => {
  stopMedia();
  closeSession();
});

renderChallenge(currentChallenge);
renderScore();
renderHistory();
renderCustomChallengeState();

async function verifyCurrentChallenge() {
  if (isVerifying) {
    return;
  }

  const apiKey = (import.meta.env.VITE_GEMINI_API_KEY ?? '').trim();
  if (!apiKey) {
    setStatus('`VITE_GEMINI_API_KEY` が未設定です。README の手順で .env を設定してください。', 'error');
    return;
  }

  isVerifying = true;
  syncButtonState();
  resultSummary.textContent = '判定中...';
  resultReason.textContent = '理由: 判定を準備しています';
  resultConfidence.textContent = '信頼度: -';
  resultLocation.textContent = '位置判定: -';
  resultActions.textContent = '検出アクション: -';
  setJudgeDebug({ status: 'running', message: '判定中...' });

  try {
    setStatus('カメラを起動しています...', 'info');
    await startCamera();

    const locationSnapshot = await getLocationSnapshot(currentChallenge);
    const { session, responsePromise, modelName } = await createLiveSession(apiKey);
    activeSession = session;

    setStatus(`${modelName} へ接続完了。${CAPTURE_SECONDS} 秒間、動作を撮影します。`, 'info');
    const frameSamples = await captureFrameSamples(preview, CAPTURE_SECONDS, (remainingSeconds) => {
      setStatus(`撮影中... 残り ${remainingSeconds} 秒`, 'info');
    });
    setStatus(`撮影完了。${frameSamples.length} フレームで判定します。`, 'info');

    const evaluationPrompt = buildEvaluationPrompt(currentChallenge, locationSnapshot);
    const evaluationParts: Array<{ inlineData: { mimeType: string; data: string } } | { text: string }> = [
      ...frameSamples.map((data) => ({
        inlineData: {
          mimeType: 'image/jpeg',
          data,
        },
      })),
      { text: evaluationPrompt },
    ];

    session.sendClientContent({
      turns: [{ role: 'user', parts: evaluationParts }],
      turnComplete: true,
    });

    const rawText = await withTimeout(responsePromise, 20000, 'モデルの応答がタイムアウトしました');
    const judgeResult = parseJudgeResult(rawText);
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
      sampledFrames: frameSamples.length,
      rawModelText: rawText,
      parsedJudgeResult: judgeResult,
      finalJudgement,
      locationSnapshot,
    });

    applyScore(finalJudgement);
    renderResult(finalJudgement);
    appendHistory(finalJudgement, currentChallenge);
    currentChallenge = nextChallengeAfterJudge(currentChallenge.id);
    renderChallenge(currentChallenge);

    setStatus(finalJudgement.success ? `成功! +${finalJudgement.scoreAdded} pt` : '今回は失敗。次のお題へ進めます。', finalJudgement.success ? 'ok' : 'error');
  } catch (error) {
    const message = error instanceof Error ? error.message : '不明なエラーが発生しました';
    setStatus(`判定失敗: ${message}`, 'error');
    setJudgeDebug({
      timestamp: new Date().toISOString(),
      status: 'error',
      error: message,
    });
  } finally {
    isVerifying = false;
    syncButtonState();
    stopMedia();
    closeSession();
  }
}

function combineJudgement(result: JudgeResult, points: number, locationMessage: string): FinalJudgement {
  const locationFailed = locationMessage.startsWith('失敗');
  const success = result.success && !locationFailed;
  const scoreAdded = success ? points : 0;

  return {
    ...result,
    success,
    scoreAdded,
    reason: locationFailed ? `${result.reason} / 位置条件を満たしていません` : result.reason,
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
    timestamp: new Date().toLocaleString('ja-JP'),
  };

  history.unshift(record);
  history = history.slice(0, 8);
  persistHistory(history);
  renderHistory();
}

function renderResult(finalJudgement: FinalJudgement) {
  const scoreText = finalJudgement.success ? `成功 (+${finalJudgement.scoreAdded}pt)` : '失敗 (+0pt)';
  resultSummary.textContent = scoreText;
  resultReason.textContent = `理由: ${finalJudgement.reason}`;
  resultConfidence.textContent = `信頼度: ${(finalJudgement.confidence * 100).toFixed(0)}%`;
  resultLocation.textContent = `位置判定: ${finalJudgement.locationMessage}`;
  const actionsText = finalJudgement.detectedActions.length > 0 ? finalJudgement.detectedActions.join(' / ') : '-';
  resultActions.textContent = `検出アクション: ${actionsText}`;
}

function renderChallenge(challenge: Challenge) {
  challengeTitle.textContent = challenge.title;
  challengeDescription.textContent = challenge.description;
  challengePoints.textContent = `+${challenge.points} pt`;
  locationHint.textContent = challenge.locationCheck
    ? `位置情報オプション: ${challenge.locationCheck.label} (${challenge.locationCheck.radiusMeters}m 以内)`
    : '位置情報オプション: なし';
}

function renderScore() {
  scoreValue.textContent = String(appState.score);
  streakValue.textContent = String(appState.streak);
}

function renderHistory() {
  historyList.innerHTML = '';
  if (history.length === 0) {
    const li = document.createElement('li');
    li.className = 'history-empty';
    li.textContent = 'まだプレイ履歴がありません。';
    historyList.appendChild(li);
    return;
  }

  history.forEach((item) => {
    const li = document.createElement('li');
    li.className = item.success ? 'history-item success' : 'history-item fail';
    li.innerHTML = `
      <p class="history-title">${escapeHtml(item.challengeTitle)} <span>${item.success ? '成功' : '失敗'}</span></p>
      <p class="history-meta">${item.timestamp} / ${item.scoreAdded} pt</p>
      <p class="history-reason">${escapeHtml(item.reason)}</p>
    `;
    historyList.appendChild(li);
  });
}

function renderCustomChallengeState() {
  if (!customChallengeText) {
    customChallengeInput.value = '';
    customChallengeMeta.textContent = '現在: ランダムお題モード';
    return;
  }

  customChallengeInput.value = customChallengeText;
  customChallengeMeta.textContent = `現在: カスタムお題モード (+${CUSTOM_CHALLENGE_POINTS} pt)`;
}

function syncButtonState() {
  verifyButton.disabled = isVerifying;
  newChallengeButton.disabled = isVerifying;
  resetScoreButton.disabled = isVerifying;
  customChallengeInput.disabled = isVerifying;
  applyCustomChallengeButton.disabled = isVerifying;
  clearCustomChallengeButton.disabled = isVerifying;
}

function setStatus(message: string, kind: 'info' | 'ok' | 'error') {
  statusText.textContent = message;
  statusText.classList.remove('info', 'ok', 'error');
  statusText.classList.add(kind);
}

function setJudgeDebug(payload: unknown) {
  judgeJson.textContent = JSON.stringify(payload, null, 2);
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

    let resolveResponse!: (value: string) => void;
    let rejectResponse!: (reason?: unknown) => void;

    const responsePromise = new Promise<string>((resolve, reject) => {
      resolveResponse = resolve;
      rejectResponse = reject;
    });

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
            if (!resolved) {
              resolved = true;
              rejectResponse(new Error(event.message || 'Live API error'));
            }
          },
          onclose: (event: CloseEvent) => {
            if (!resolved && textParts.length === 0) {
              resolved = true;
              rejectResponse(new Error(event.reason || 'Live API session closed'));
            }
          },
        },
      });

      return { session, responsePromise, modelName };
    } catch (error) {
      errors.push(`${modelName}: ${stringifyError(error)}`);
    }
  }

  throw new Error(`Live API 接続に失敗しました。${errors.join(' | ')}`);
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

async function captureFrameSamples(
  video: HTMLVideoElement,
  seconds: number,
  onTick?: (remainingSeconds: number) => void,
): Promise<string[]> {
  await waitForVideoReady(video);

  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Canvas context を取得できませんでした');
  }

  const sampleInterval = Math.max(1, Math.floor(seconds / MAX_EVALUATION_FRAMES));
  const frames: string[] = [];

  for (let elapsed = 0; elapsed < seconds; elapsed += 1) {
    const remaining = seconds - elapsed;
    onTick?.(remaining);
    canvas.width = Math.max(Math.round(video.videoWidth * 0.4), 320);
    canvas.height = Math.max(Math.round(video.videoHeight * 0.4), 240);
    context.drawImage(video, 0, 0, canvas.width, canvas.height);

    const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
    const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
    const shouldSample = elapsed % sampleInterval === 0 || elapsed === seconds - 1;
    if (shouldSample) {
      frames.push(base64);
    }

    await sleep(1000);
  }

  if (frames.length === 0) {
    throw new Error('判定用フレームを取得できませんでした');
  }

  return frames;
}

async function getLocationSnapshot(challenge: Challenge): Promise<LocationSnapshot> {
  if (!challenge.locationCheck) {
    return { status: 'skipped' };
  }

  if (!('geolocation' in navigator)) {
    return {
      status: 'unsupported',
      message: 'このブラウザは位置情報取得に対応していません。',
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
        message: '位置情報の取得が許可されませんでした。',
      };
    }

    return {
      status: 'error',
      message: '位置情報を取得できませんでした。',
    };
  }
}

function evaluateLocation(challenge: Challenge, snapshot: LocationSnapshot): string {
  if (!challenge.locationCheck) {
    return 'スキップ (位置条件なし)';
  }

  if (snapshot.status !== 'available') {
    return `スキップ (${snapshot.message ?? snapshot.status})`;
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
    return `成功 (${roundedDistance}m / 許容 ${challenge.locationCheck.radiusMeters}m, 精度 ±${roundedAccuracy}m)`;
  }

  return `失敗 (${roundedDistance}m / 許容 ${challenge.locationCheck.radiusMeters}m, 精度 ±${roundedAccuracy}m)`;
}

function buildSystemInstruction() {
  return [
    'あなたは実世界ミッションの厳密な審査員です。',
    '送信された映像情報だけを根拠にし、未確認なら必ず失敗判定にしてください。',
    '応答は必ず1行のみ。説明文は禁止。',
    '形式は次だけを使用: success=<true|false>;confidence=<0-1>;reason=<短文>;detected_actions=<a|b|c>;safety_notes=<短文>',
    'confidence は 0 から 1 の実数。',
  ].join(' ');
}

function buildEvaluationPrompt(challenge: Challenge, location: LocationSnapshot) {
  const locationDetails = challenge.locationCheck
    ? `\n位置条件: ${challenge.locationCheck.label} から半径 ${challenge.locationCheck.radiusMeters}m 以内。`
    : '\n位置条件: なし。';

  const locationMeasurement =
    location.status === 'available'
      ? `\n取得したGPS: lat=${location.latitude}, lng=${location.longitude}, accuracy=${location.accuracy}m`
      : `\nGPS情報: ${location.message ?? location.status}`;

  return [
    '以下のチャレンジが達成されたか判定してください。',
    `チャレンジ: ${challenge.description}`,
    locationDetails,
    locationMeasurement,
    '画面内で確認できた具体的な行動を detected_actions に 1〜4 件記載してください。',
    '最終回答は次の1行形式だけで返してください。',
    'success=<true|false>;confidence=<0-1>;reason=<短文>;detected_actions=<a|b|c>;safety_notes=<短文>',
  ].join('\n');
}

function parseJudgeResult(rawText: string): JudgeResult {
  const keyValueParsed = parseKeyValueJudgeResult(rawText);
  if (keyValueParsed) {
    return keyValueParsed;
  }

  const narrativeParsed = parseNarrativeJudgeResult(rawText);
  if (narrativeParsed) {
    return narrativeParsed;
  }

  const fallback: JudgeResult = {
    success: false,
    confidence: 0,
    reason: `JSON 解析失敗: ${rawText.slice(0, 240)}`,
    detectedActions: [],
    safetyNotes: '',
  };

  const jsonCandidate = extractJson(rawText);
  if (!jsonCandidate) {
    return fallback;
  }

  try {
    const parsed = JSON.parse(jsonCandidate) as {
      success?: unknown;
      confidence?: unknown;
      reason?: unknown;
      detected_actions?: unknown;
      safety_notes?: unknown;
    };

    const confidence = normalizeConfidence(parsed.confidence);
    const detectedActions = Array.isArray(parsed.detected_actions)
      ? parsed.detected_actions.filter((v): v is string => typeof v === 'string').slice(0, 8)
      : [];

    return {
      success: parsed.success === true,
      confidence,
      reason: typeof parsed.reason === 'string' ? parsed.reason : '理由が返されませんでした。',
      detectedActions,
      safetyNotes: typeof parsed.safety_notes === 'string' ? parsed.safety_notes : '',
    };
  } catch {
    return fallback;
  }
}

function parseNarrativeJudgeResult(rawText: string): JudgeResult | null {
  const normalized = rawText.replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return null;
  }

  const lower = normalized.toLowerCase();
  const positivePatterns = [
    /successful completion/g,
    /\bsuccess(?:ful|fully)?\b/g,
    /\bcompleted?\b/g,
    /\bmeets? (the )?criteria\b/g,
    /\bpositive validation(s)?\b/g,
    /\bdefinitively demonstrate\b/g,
    /達成/g,
    /成功/g,
    /条件を満た/g,
  ];
  const negativePatterns = [
    /\bfail(?:ed|ure)?\b/g,
    /does not meet/g,
    /did not/g,
    /not completed/g,
    /cannot confirm/g,
    /insufficient/g,
    /no (visual )?evidence/g,
    /does not align/g,
    /失敗/g,
    /確認できない/g,
    /未達成/g,
  ];

  const positiveHits = countMatches(lower, positivePatterns);
  const negativeHits = countMatches(lower, negativePatterns);

  if (positiveHits === 0 && negativeHits === 0) {
    return null;
  }

  const success = positiveHits >= negativeHits;
  const confidenceBase = 0.55 + Math.min(0.3, Math.abs(positiveHits - negativeHits) * 0.08);
  const confidence = clamp(confidenceBase, 0.5, 0.85);
  const firstSentence = normalized.split(/(?<=[.!?。！？])\s+/)[0] ?? normalized;

  return {
    success,
    confidence,
    reason: firstSentence.slice(0, 220),
    detectedActions: [],
    safetyNotes: 'fallback:narrative-parse',
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
  const reason = map.get('reason') ?? '理由が返されませんでした。';
  const safetyNotes = map.get('safety_notes') ?? '';
  const actionsRaw = map.get('detected_actions') ?? '';

  const detectedActions = actionsRaw
    .split('|')
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

function countMatches(text: string, patterns: RegExp[]): number {
  return patterns.reduce((count, pattern) => {
    const matches = text.match(pattern);
    return count + (matches ? matches.length : 0);
  }, 0);
}

function extractJson(text: string): string | null {
  const match = text.match(/\{[\s\S]*\}/);
  return match ? match[0] : null;
}

function nextChallengeAfterJudge(excludedId?: string): Challenge {
  if (customChallengeText) {
    return buildCustomChallenge(customChallengeText);
  }
  return pickRandomChallenge(excludedId);
}

function pickRandomChallenge(excludedId?: string) {
  const candidates = FIXED_CHALLENGES.filter((challenge) => challenge.id !== excludedId);
  return candidates[Math.floor(Math.random() * candidates.length)];
}

function buildCustomChallenge(text: string): Challenge {
  return {
    id: 'custom-debug-challenge',
    title: 'DEBUG カスタムお題',
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

async function startCamera() {
  stopMedia();
  const stream = await navigator.mediaDevices.getUserMedia({
    video: {
      width: { ideal: 1280 },
      height: { ideal: 720 },
      facingMode: 'environment',
    },
    audio: false,
  });

  activeStream = stream;
  preview.srcObject = stream;
  await preview.play();
}

function stopMedia() {
  if (activeStream) {
    activeStream.getTracks().forEach((track) => track.stop());
    activeStream = null;
  }
  preview.srcObject = null;
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
      reject(new Error('カメラ映像の初期化がタイムアウトしました'));
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
