import { FaceDetector, FaceLandmarker, FilesetResolver, type BoundingBox } from '@mediapipe/tasks-vision';
import { LipMotionTracker } from './lipMotion';
import { fixedPromptAudio, fixedScreenPrompts } from './prompts';
import type { DialogTurnResult, KioskSession, ScreenId, TicketIntent, TrainCandidate } from './types';
import { loadVadCalibrationSettings, saveVadCalibrationSettings, type VadCalibrationSettings } from './vadSettings';

const HAPPY: ScreenId[] = ['start', 'dest', 'confirm', 'time', 'summary', 'searching', 'results', 'done'];
const LABEL: Record<string, string> = {
  start: '시작하기',
  dest: '목적지 듣기',
  confirm: '목적지 확인',
  time: '시간 듣기',
  summary: '요약 확인',
  searching: '표 찾는 중',
  results: '결과',
  done: '선택 완료',
  nudge: '먼저 말 걸기',
  idle: '자리 비움 확인',
  retry: '되묻기',
  staff: '직원 연결 제안'
};

const KW = 810;
const KH = 1440;
const DETECTION_INTERVAL_MS = 150;
const MEDIA_PIPE_WASM_PATH = '/vendor/mediapipe';
const MEDIA_PIPE_FACE_MODEL =
  'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite';
const MEDIA_PIPE_FACE_LANDMARKER_MODEL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';
// 발화 구간 동안 얼굴이 실제로 프레임 안에 있었는지(입을 관찰할 기회가 있었는지) 기준.
const LIP_TRACK_MIN_FRAMES = 4;
const LIP_TRACK_MIN_RATIO = 0.6;
// 폐기는 "입이 완전히 정지"였을 때만 한다. 발화 임계값(lipMotionThreshold)에는 못 미쳐도
// 이 정도의 약한 출렁임이라도 있었다면 = 마스크·역광으로 억눌린 실제 발화일 수 있으므로
// 폐기하지 않고 통과시켜 확인 단계에서 정정하게 한다. (거짓 무시가 거짓 통과보다 비싸다.)
const LIP_STILL_FLOOR = 0.15;

const screens: Partial<Record<ScreenId, HTMLElement>> = {};
document.querySelectorAll<HTMLElement>('.screen').forEach((el) => {
  screens[el.dataset.screen as ScreenId] = el;
});

const state: KioskSession = {
  currentScreen: 'start',
  intent: {
    departureStation: '서울',
    passengerCount: 1,
    missingFields: ['arrivalStation', 'date', 'timePreference'],
    confidence: 0
  },
  transcriptHistory: [],
  assistantMessages: [],
  trainCandidates: [],
  retryCount: 0
};

let idleTimer: number | undefined;
let isBusy = false;
let autoListenTimer: number | undefined;
let currentAssistantAudio: HTMLAudioElement | undefined;
let speakGeneration = 0;
const assistantPlaybackRate = 1.15;
const audioOutputEnabled = false;
const spokenScreenPrompts = new Set<string>();
const autoListenedScreens = new Set<string>();
let displayedTranscript = '';
let isAnnouncing = false;
let personPresent = false;
let presenceGateStarted = false;
let presenceGateStarting = false;
let presenceCameraStream: MediaStream | undefined;
let presenceVideo: HTMLVideoElement | undefined;
let presenceDetector: FaceDetector | undefined;
let presenceLandmarker: FaceLandmarker | undefined;
let presenceDetectionTimer: number | undefined;
let presenceSeenSince = 0;
let presenceMissingSince = 0;
let presenceFaceRatioPercent = 0;
let lipMotionScore = 0;
const lipMotionTracker = new LipMotionTracker();
let lastLipMotionAt = 0;
let voiceTurnLipMotionSeen = false;
let voiceTurnFrames = 0;
let voiceTurnTrackedFrames = 0;
let voiceTurnPeakLipScore = 0;
let activeVoiceAbortController: AbortController | undefined;
type MainSettingsRange = {
  input: HTMLInputElement;
  value: () => number;
};

function vadCalibrationSettings() {
  return loadVadCalibrationSettings();
}

function initSettingsPanel() {
  const entry = document.getElementById('settingsEntry') as HTMLButtonElement | null;
  const panel = document.getElementById('settingsPanel') as HTMLElement | null;
  const close = document.getElementById('settingsClose') as HTMLButtonElement | null;
  const pinPanel = document.getElementById('settingsPinPanel') as HTMLElement | null;
  const pinForm = document.getElementById('settingsPinForm') as HTMLFormElement | null;
  const pinInput = document.getElementById('settingsPinInput') as HTMLInputElement | null;
  const pinClose = document.getElementById('settingsPinClose') as HTMLButtonElement | null;
  const pinMessage = document.getElementById('settingsPinMessage');
  const saved = document.getElementById('settingsSaved');
  if (!entry || !panel || !close || !pinPanel || !pinForm || !pinInput || !pinClose) return;

  const settings = loadVadCalibrationSettings();
  const closeRatio = bindSettingsRange('mainCloseRatio', 'mainCloseValue', settings.closeRatioPercent, (value) => `${value}%`);
  const enterDebounce = bindSettingsRange('mainEnterDebounce', 'mainEnterValue', settings.enterDebounceMs, formatSeconds);
  const exitDebounce = bindSettingsRange('mainExitDebounce', 'mainExitValue', settings.exitDebounceMs, formatSeconds);
  const silenceMs = bindSettingsRange('mainSilenceMs', 'mainSilenceValue', settings.silenceMs, formatSeconds);
  const minSpeechMs = bindSettingsRange('mainMinSpeechMs', 'mainMinSpeechValue', settings.minSpeechMs, (value) => `${(value / 1000).toFixed(2)}초`);
  const lipMotionThreshold = bindSettingsRange('mainLipMotionThreshold', 'mainLipMotionThresholdValue', settings.lipMotionThreshold, (value) => value.toFixed(1));
  const lipMotionHold = bindSettingsRange('mainLipMotionHold', 'mainLipMotionHoldValue', settings.lipMotionHoldMs, formatSeconds);
  const lipMotionEnabled = document.getElementById('mainLipMotionEnabled') as HTMLInputElement | null;
  if (lipMotionEnabled) lipMotionEnabled.checked = settings.lipMotionEnabled;
  const ranges = [closeRatio, enterDebounce, exitDebounce, silenceMs, minSpeechMs, lipMotionThreshold, lipMotionHold].filter(Boolean) as MainSettingsRange[];

  const persist = () => {
    saveVadCalibrationSettings({
      closeRatioPercent: closeRatio?.value() ?? settings.closeRatioPercent,
      enterDebounceMs: enterDebounce?.value() ?? settings.enterDebounceMs,
      exitDebounceMs: exitDebounce?.value() ?? settings.exitDebounceMs,
      silenceMs: silenceMs?.value() ?? settings.silenceMs,
      minSpeechMs: minSpeechMs?.value() ?? settings.minSpeechMs,
      lipMotionEnabled: lipMotionEnabled?.checked ?? settings.lipMotionEnabled,
      lipMotionThreshold: lipMotionThreshold?.value() ?? settings.lipMotionThreshold,
      lipMotionHoldMs: lipMotionHold?.value() ?? settings.lipMotionHoldMs
    });
    if (saved) saved.textContent = '저장됨. 테스트 화면과 실제 화면에 함께 적용됩니다.';
  };

  ranges.forEach((range) => range.input.addEventListener('input', persist));
  lipMotionEnabled?.addEventListener('change', persist);
  const closeAll = () => {
    panel.hidden = true;
    pinPanel.hidden = true;
    pinInput.value = '';
    if (pinMessage) pinMessage.textContent = '관리자 비밀번호를 입력하세요.';
  };
  entry.addEventListener('click', () => {
    pinPanel.hidden = false;
    window.setTimeout(() => pinInput.focus(), 0);
  });
  pinForm.addEventListener('submit', (event) => {
    event.preventDefault();
    if (pinInput.value === '0418') {
      pinPanel.hidden = true;
      pinInput.value = '';
      panel.hidden = false;
      if (pinMessage) pinMessage.textContent = '관리자 비밀번호를 입력하세요.';
      return;
    }
    pinInput.value = '';
    if (pinMessage) pinMessage.textContent = '비밀번호가 맞지 않습니다.';
  });
  pinClose.addEventListener('click', closeAll);
  close.addEventListener('click', () => {
    panel.hidden = true;
  });
  panel.addEventListener('click', (event) => {
    if (event.target === panel) panel.hidden = true;
  });
  pinPanel.addEventListener('click', (event) => {
    if (event.target === pinPanel) closeAll();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeAll();
  });
}

function bindSettingsRange(id: string, labelId: string, initialValue: number, format: (value: number) => string): MainSettingsRange | undefined {
  const input = document.getElementById(id) as HTMLInputElement | null;
  const label = document.getElementById(labelId);
  if (!input || !label) return undefined;
  input.value = String(initialValue);
  const read = () => Number(input.value);
  const sync = () => {
    label.textContent = format(read());
  };
  input.addEventListener('input', sync);
  sync();
  return { input, value: read };
}

function formatSeconds(value: number) {
  return `${(value / 1000).toFixed(1)}초`;
}

function todayLabel(date?: string) {
  if (!date) return '오늘';
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
  return date === today ? '오늘' : date;
}

function timeLabel(intent: TicketIntent) {
  const pref = intent.timePreference;
  if (!pref) return '';
  if (pref.time) {
    const [h, m] = pref.time.split(':').map(Number);
    const ampm = h >= 12 ? '오후' : '오전';
    const hour = h > 12 ? h - 12 : h;
    return `${ampm} ${hour}시${m ? ` ${m}분` : ''}쯤`;
  }
  const label: Record<string, string> = {
    morning: '오전',
    afternoon: '오후',
    evening: '저녁',
    any: '아무 때나',
    around: '근처 시간',
    after: '이후',
    before: '이전'
  };
  return label[pref.kind] ?? '';
}

function stationLabel(value: string) {
  return value.endsWith('역') ? value : `${value}역`;
}

function routeLabel() {
  const departure = state.intent.departureStation || '서울';
  const arrival = state.intent.arrivalStation;
  const when = [todayLabel(state.intent.date), timeLabel(state.intent)].filter(Boolean).join(' ');
  if (!arrival) return `${departure}역에서 출발`;
  return `${departure}역 → ${arrival}${when ? ` · ${when}` : ''}`;
}

function setText(selector: string, text: string) {
  const el = document.querySelector<HTMLElement>(selector);
  if (el) el.textContent = text;
}

function updateControls() {
  setText('#navLabel', LABEL[state.currentScreen] || state.currentScreen);
  const i = HAPPY.indexOf(state.currentScreen);
  setText('#navIndex', i >= 0 ? `정상 흐름 ${i + 1} / ${HAPPY.length}` : '안전망 화면');
}

function clearTimers() {
  if (idleTimer) window.clearInterval(idleTimer);
  if (autoListenTimer) window.clearTimeout(autoListenTimer);
  idleTimer = undefined;
  autoListenTimer = undefined;
}

function show(id: ScreenId) {
  if (!screens[id]) return;
  clearTimers();
  Object.entries(screens).forEach(([key, el]) => el?.classList.toggle('is-active', key === id));
  state.currentScreen = id;
  updateControls();
  renderState();
  if (id === 'idle') runIdleCountdown();
  void announceScreenThenListen(id);
}

function screenPrompt(id: ScreenId) {
  if (fixedScreenPrompts[id]) return fixedScreenPrompts[id] || '';
  if (id === 'confirm') {
    const arrival = stationLabel(state.intent.arrivalStation || '목적지');
    return `${arrival} 맞으세요?`;
  }
  if (id === 'time') return `${state.intent.arrivalStation || '목적지'}으로 볼게요. 몇 시쯤 떠나실까요?`;
  if (id === 'summary') return `${state.intent.arrivalStation || '목적지'}으로 ${todayLabel(state.intent.date)} ${timeLabel(state.intent)} 기차를 찾아드릴게요. 맞으세요?`;
  if (id === 'searching') return '좋아요. 실제 기차를 찾아볼게요. 잠깐만 기다려 주세요.';
  if (id === 'results') return '제일 빠른 기차와 제일 저렴한 기차를 찾았어요. 어느 걸로 해드릴까요?';
  if (id === 'done') return '표를 선택했어요. 이제 결제 단계로 안내해드릴게요.';
  if (id === 'retry') return '제가 잘 못 들었어요. 천천히 한 번만 더 말씀해 주세요.';
  if (id === 'nudge') return '천천히 말씀하셔도 괜찮아요. 어디로 가세요?';
  if (id === 'idle') return '아직 계신가요? 계속하시려면 화면을 눌러 주세요.';
  if (id === 'staff') return '직원이 바로 도와드릴게요.';
  return '';
}

function promptKey(id: ScreenId) {
  return `${id}:${state.intent.arrivalStation || ''}:${state.intent.date || ''}:${timeLabel(state.intent)}:${state.trainCandidates.map((item) => item.id).join('|')}:${state.selectedCandidate?.id || ''}`;
}

async function announceScreenThenListen(id: ScreenId) {
  void ensurePresenceGateStarted();
  if (id === 'start') return;
  const prompt = screenPrompt(id);
  const key = promptKey(id);
  if (prompt && !spokenScreenPrompts.has(key)) {
    spokenScreenPrompts.add(key);
    setVoiceStatus('먼저 안내해드릴게요');
    isAnnouncing = true;
    try {
      await speakScreenPrompt(id, prompt);
    } finally {
      isAnnouncing = false;
    }
  }
  if (state.currentScreen === id && !isBusy) scheduleAutoListen(id);
}

function shouldAutoListen(id: ScreenId) {
  return ['dest', 'confirm', 'time', 'summary', 'retry', 'results', 'nudge'].includes(id);
}

function scheduleAutoListen(id: ScreenId) {
  if (!shouldAutoListen(id)) return;
  if (!personPresent) {
    setVoiceStatus('앞에 서시면 자동으로 듣기 시작할게요');
    return;
  }
  if (isAnnouncing) return;
  const key = `${id}:${state.transcriptHistory.length}:${state.intent.arrivalStation || ''}:${state.intent.timePreference?.time || state.intent.timePreference?.kind || ''}`;
  if (autoListenedScreens.has(key)) return;
  autoListenedScreens.add(key);
  autoListenTimer = window.setTimeout(() => {
    if (state.currentScreen !== id || isBusy) return;
    void handleVoiceTurn({ auto: true });
  }, 0);
}

function showManualStartHint() {
  const message = '마이크를 한 번 눌러 시작해 주세요';
  setVoiceStatus(message);
}

async function ensurePresenceGateStarted() {
  if (presenceGateStarted || presenceGateStarting) return;
  presenceGateStarting = true;
  try {
    presenceVideo = document.getElementById('presenceDebugVideo') as HTMLVideoElement | null || document.createElement('video');
    presenceVideo.muted = true;
    presenceVideo.playsInline = true;
    presenceVideo.setAttribute('aria-hidden', 'true');
    if (!presenceVideo.isConnected) document.body.appendChild(presenceVideo);

    presenceCameraStream = await navigator.mediaDevices.getUserMedia({
      video: {
        width: { ideal: 640 },
        height: { ideal: 360 },
        facingMode: 'user'
      },
      audio: false
    });
    presenceVideo.srcObject = presenceCameraStream;
    await presenceVideo.play();
    updatePresenceDebug();

    const vision = await FilesetResolver.forVisionTasks(MEDIA_PIPE_WASM_PATH);
    presenceDetector = await FaceDetector.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: MEDIA_PIPE_FACE_MODEL,
        delegate: 'CPU'
      },
      runningMode: 'VIDEO',
      minDetectionConfidence: 0.5
    });
    presenceLandmarker = await FaceLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: MEDIA_PIPE_FACE_LANDMARKER_MODEL,
        delegate: 'CPU'
      },
      runningMode: 'VIDEO',
      numFaces: 1,
      outputFaceBlendshapes: true,
      minFaceDetectionConfidence: 0.5,
      minFacePresenceConfidence: 0.5,
      minTrackingConfidence: 0.5
    });

    presenceGateStarted = true;
    presenceDetectionTimer = window.setInterval(() => {
      void detectPresenceTick();
    }, DETECTION_INTERVAL_MS);
  } catch (error) {
    console.warn('Presence gate failed. Falling back to manual mic controls.', error);
    setVoiceStatus('카메라 감지가 어려워요. 마이크를 눌러 말씀해 주세요');
    stopPresenceGate();
  } finally {
    presenceGateStarting = false;
  }
}

function stopPresenceGate() {
  if (presenceDetectionTimer) window.clearInterval(presenceDetectionTimer);
  presenceDetectionTimer = undefined;
  presenceDetector?.close();
  presenceDetector = undefined;
  presenceLandmarker?.close();
  presenceLandmarker = undefined;
  presenceCameraStream?.getTracks().forEach((track) => track.stop());
  presenceCameraStream = undefined;
  if (presenceVideo && presenceVideo.id !== 'presenceDebugVideo') presenceVideo.remove();
  presenceVideo = undefined;
  presenceFaceRatioPercent = 0;
  lipMotionScore = 0;
  lipMotionTracker.reset();
  lastLipMotionAt = 0;
  presenceGateStarted = false;
  presenceSeenSince = 0;
  presenceMissingSince = 0;
  void setPersonPresent(false);
}

async function detectPresenceTick() {
  const video = presenceVideo;
  const detector = presenceDetector;
  if (!video || !detector || !video.videoWidth || !video.videoHeight) return;

  const detected = detectCloseFace(video, detector);
  updateLipMotion(video);
  updatePresenceDebug();
  const now = performance.now();
  const settings = vadCalibrationSettings();
  if (detected) {
    if (!presenceSeenSince) presenceSeenSince = now;
    presenceMissingSince = 0;
    if (!personPresent && now - presenceSeenSince >= settings.enterDebounceMs) {
      await setPersonPresent(true);
    }
  } else {
    if (!presenceMissingSince) presenceMissingSince = now;
    presenceSeenSince = 0;
    if (personPresent && now - presenceMissingSince >= settings.exitDebounceMs) {
      await setPersonPresent(false);
    }
  }
}

function detectCloseFace(video: HTMLVideoElement, detector: FaceDetector) {
  try {
    const result = detector.detectForVideo(video, performance.now());
    const best = result.detections
      .map((item) => item.boundingBox)
      .filter((box): box is BoundingBox => Boolean(box))
      .sort((a, b) => b.width * b.height - a.width * a.height)[0];
    if (!best) {
      presenceFaceRatioPercent = 0;
      return false;
    }
    const frameArea = Math.max(1, video.videoWidth * video.videoHeight);
    presenceFaceRatioPercent = ((best.width * best.height) / frameArea) * 100;
    return presenceFaceRatioPercent >= vadCalibrationSettings().closeRatioPercent;
  } catch (error) {
    console.warn('Presence detection tick failed.', error);
    presenceFaceRatioPercent = 0;
    return false;
  }
}

function updatePresenceDebug() {
  const stateEl = document.getElementById('presenceDebugState');
  const ratioEl = document.getElementById('presenceDebugRatio');
  const lipEl = document.getElementById('presenceDebugLip');
  if (stateEl) stateEl.textContent = personPresent ? 'PRESENT' : presenceGateStarted ? 'SCANNING' : 'IDLE';
  if (ratioEl) ratioEl.textContent = `${presenceFaceRatioPercent.toFixed(1)}%`;
  if (lipEl) lipEl.textContent = `입 ${lipMotionScore.toFixed(1)}`;
}

function updateLipMotion(video: HTMLVideoElement) {
  const landmarker = presenceLandmarker;
  if (!landmarker) {
    lipMotionScore = 0;
    lipMotionTracker.reset();
    return;
  }
  try {
    const result = landmarker.detectForVideo(video, performance.now());
    const blendshapes = result.faceBlendshapes[0]?.categories;
    const now = performance.now();
    lipMotionScore = lipMotionTracker.update(blendshapes, now);
    if (isBusy) {
      voiceTurnFrames += 1;
      if (blendshapes?.length) voiceTurnTrackedFrames += 1;
      // 발화 구간 중 가장 큰 입 움직임. 마스크로 억눌린 약한 출렁임까지 여기 반영된다.
      voiceTurnPeakLipScore = Math.max(voiceTurnPeakLipScore, lipMotionScore);
    }
    const settings = vadCalibrationSettings();
    if (lipMotionScore >= settings.lipMotionThreshold) {
      lastLipMotionAt = now;
      if (isBusy) voiceTurnLipMotionSeen = true;
    }
  } catch (error) {
    console.warn('Lip motion detection tick failed.', error);
    lipMotionScore = 0;
  }
}

function hasRecentLipMotion(settings = vadCalibrationSettings()) {
  if (!settings.lipMotionEnabled) return true;
  if (!presenceLandmarker) return true;
  return performance.now() - lastLipMotionAt <= settings.lipMotionHoldMs;
}

async function setPersonPresent(next: boolean) {
  if (personPresent === next) return;
  personPresent = next;
  console.log(`[presence-main] personPresent=${next}`);
  updatePresenceDebug();

  if (next) {
    if (state.currentScreen === 'start') {
      show('dest');
      return;
    }
    if (shouldAutoListen(state.currentScreen) && !isBusy && !isAnnouncing) scheduleAutoListen(state.currentScreen);
    return;
  }

  if (isBusy) activeVoiceAbortController?.abort();
  if (shouldAutoListen(state.currentScreen)) setVoiceStatus('앞에 서시면 자동으로 듣기 시작할게요');
}

function runIdleCountdown() {
  const el = document.getElementById('idleCount');
  let n = 10;
  if (el) el.textContent = String(n);
  idleTimer = window.setInterval(() => {
    n -= 1;
    if (el) el.textContent = String(n);
    if (n <= 0) show('dest');
  }, 1000);
}

function renderState() {
  if (state.currentScreen === 'start') return;
  document.querySelectorAll<HTMLElement>('.topbar .path').forEach((el) => {
    if (state.currentScreen === 'staff') return;
    el.textContent = routeLabel();
  });

  const arrival = state.intent.arrivalStation || '목적지';
  const station = stationLabel(arrival);
  const when = timeLabel(state.intent) || '시간';
  const date = todayLabel(state.intent.date);

  const confirmDisplay = screens.confirm?.querySelector<HTMLElement>('.display');
  if (confirmDisplay) confirmDisplay.innerHTML = `<span class="g">${escapeHtml(station)}</span> 맞으세요?`;

  const timeLead = screens.time?.querySelector<HTMLElement>('.lead');
  if (timeLead) timeLead.textContent = `${date} 출발 기준이에요`;

  const summary = screens.summary?.querySelector<HTMLElement>('.summary-card .big');
  if (summary) {
    summary.innerHTML = `<span class="g" style="color:var(--green-deep)">${escapeHtml(arrival)}</span>으로 ${escapeHtml(date)}<br /><span class="g" style="color:var(--green-deep)">${escapeHtml(when)}</span> 기차,<br />맞으세요?`;
  }

  renderResults();
  renderSelectedTicket();
}

function renderResults() {
  const options = screens.results?.querySelector<HTMLElement>('.options');
  if (!options || state.trainCandidates.length === 0) return;
  options.innerHTML = state.trainCandidates.map((candidate) => renderCandidate(candidate)).join('');
}

function tagText(candidate: TrainCandidate) {
  if (candidate.tags.includes('fastest')) return '제일 빨라요';
  if (candidate.tags.includes('cheapest')) return '제일 싸요';
  if (candidate.tags.includes('soonest')) return '곧 출발해요';
  return '추천해요';
}

function renderCandidate(candidate: TrainCandidate) {
  const dep = new Date(candidate.departureAt);
  const depText = dep.toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit', hour12: true });
  const fare = candidate.adultFareKrw ? `${candidate.adultFareKrw.toLocaleString('ko-KR')}<small>원</small>` : '운임 확인 필요';
  return `
    <div class="opt ${candidate.tags.includes('fastest') ? 'accent' : ''}" data-train-id="${escapeHtml(candidate.id)}">
      <span class="tag">${tagText(candidate)}</span>
      <div class="dep">${escapeHtml(depText)}</div>
      <div class="meta">${escapeHtml(candidate.trainName)} · ${Math.floor(candidate.durationMinutes / 60)}시간 ${candidate.durationMinutes % 60}분</div>
      <div class="price">${fare}</div>
    </div>`;
}

function renderSelectedTicket() {
  const ticket = screens.done?.querySelector<HTMLElement>('.ticket');
  const selected = state.selectedCandidate;
  if (!ticket || !selected) return;
  const dep = new Date(selected.departureAt).toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit', hour12: true });
  ticket.innerHTML = `
    <div class="head"><span class="route">${escapeHtml(selected.departureStation)} → ${escapeHtml(selected.arrivalStation)}</span><span class="kind">${escapeHtml(selected.trainName)}</span></div>
    <div class="row2">
      <span class="t">${todayLabel(selected.departureAt.slice(0, 10))} <b>${escapeHtml(dep)}</b></span>
      <span class="seat">좌석/결제는 다음 단계</span>
      <span class="won">${selected.adultFareKrw ? `${selected.adultFareKrw.toLocaleString('ko-KR')}원` : '운임 확인'}</span>
    </div>`;
  const title = screens.done?.querySelector<HTMLElement>('.display');
  if (title) title.textContent = '표를 선택했어요';
  const lead = screens.done?.querySelector<HTMLElement>('.lead');
  if (lead) lead.textContent = '이제 결제 단계로 안내해드릴게요';
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char] || char);
}

async function apiJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {})
    }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw data;
  return data as T;
}

async function callDialog(transcript: string) {
  const result = await apiJson<DialogTurnResult>('/api/dialog/turn', {
    method: 'POST',
    body: JSON.stringify({
      currentScreen: state.currentScreen,
      transcript,
      currentIntent: state.intent,
      lastCandidates: state.trainCandidates
    })
  });
  applyDialogResult(result);
}

async function applyDialogResult(result: DialogTurnResult) {
  state.intent = result.intent;
  state.assistantMessages.push(result.say);
  renderState();

  if (result.action === 'select_train') {
    selectByVoice(result.selection ?? 'unknown');
    return;
  }

  if (result.requiresTrainSearch) {
    await searchTrains();
    return;
  }

  show(result.nextScreen);
}

async function searchTrains() {
  show('searching');
  try {
    const data = await apiJson<{ candidates: TrainCandidate[] }>('/api/trains/search', {
      method: 'POST',
      body: JSON.stringify({ intent: state.intent })
    });
    state.trainCandidates = data.candidates;
    state.assistantMessages.push('두 가지로 추렸어요. 어느 게 좋으세요?');
    renderState();
    show('results');
  } catch (error) {
    console.error(error);
    show('staff');
  }
}

function selectByVoice(selection: string) {
  if (state.trainCandidates.length === 0) {
    show('results');
    return;
  }
  const candidate =
    state.trainCandidates.find((item) => selection === 'fastest' && item.tags.includes('fastest')) ||
    state.trainCandidates.find((item) => selection === 'cheapest' && item.tags.includes('cheapest')) ||
    state.trainCandidates[0];
  selectCandidate(candidate.id);
}

function selectCandidate(id: string) {
  const candidate = state.trainCandidates.find((item) => item.id === id);
  if (!candidate) return;
  state.selectedCandidate = candidate;
  renderState();
  show('done');
}

async function handleVoiceTurn(options: { auto?: boolean } = {}) {
  if (isBusy) return;
  isBusy = true;
  voiceTurnLipMotionSeen = hasRecentLipMotion();
  voiceTurnFrames = 0;
  voiceTurnTrackedFrames = 0;
  voiceTurnPeakLipScore = 0;
  const abortController = new AbortController();
  activeVoiceAbortController = abortController;
  displayedTranscript = '';
  stopAssistantVoice();
  await sleep(120);
  setVoiceStatus(options.auto ? '자동으로 듣기 시작할게요' : '듣고 있어요. 말씀해 주세요');
  try {
    const transcript = await captureTranscriptRealtimeFirst(abortController.signal);
    const settings = vadCalibrationSettings();
    const lipMoved = voiceTurnLipMotionSeen || hasRecentLipMotion();
    const trackedRatio = voiceTurnFrames > 0 ? voiceTurnTrackedFrames / voiceTurnFrames : 0;
    const faceObserved = voiceTurnFrames >= LIP_TRACK_MIN_FRAMES && trackedRatio >= LIP_TRACK_MIN_RATIO;
    // 발화 구간 내내 입이 "완전히" 정지였는가. 발화 임계값엔 못 미쳐도 약한 출렁임(마스크·역광으로
    // 억눌린 실제 발화의 흔적)이 있었으면 정지로 보지 않는다.
    const mouthFullyStill = voiceTurnPeakLipScore < LIP_STILL_FLOOR;
    // 얼굴이 관찰됐는데 입이 완전히 정지였을 때만 = 앞사람은 가만히 있고 주변 소리가 들어온 것으로
    // 보고 조용히 흘려보낸다. 약한 움직임이라도 있었거나(마스크 가능성) 얼굴 관찰이 부실했으면
    // 묵살하지 않고 그대로 진행해, 뒤따르는 확인 단계에서 사용자가 직접 바로잡게 한다.
    if (settings.lipMotionEnabled && presenceLandmarker && !lipMoved && faceObserved && mouthFullyStill) {
      setVoiceStatus('입 움직임이 없어 주변 소리로 보고 넘어갔어요');
      if (personPresent) {
        isBusy = false;
        autoListenedScreens.clear();
        scheduleAutoListen(state.currentScreen);
      }
      return;
    }
    state.transcriptHistory.push(transcript);
    setVoiceStatus(`이렇게 들었어요: ${transcript}`);
    await sleep(350);
    setVoiceStatus('말씀을 이해하는 중이에요');
    await callDialog(transcript);
  } catch (error) {
    console.error(error);
    const name = error instanceof DOMException ? error.name : '';
    if (name === 'AbortError') {
      setVoiceStatus('앞에 서시면 자동으로 듣기 시작할게요');
      return;
    }
    if (options.auto && (name === 'NotAllowedError' || name === 'SecurityError')) {
      showManualStartHint();
      return;
    }
    state.retryCount += 1;
    setVoiceStatus(options.auto ? '다시 말씀해 주세요' : '제가 잘 못 들었어요');
    show(state.retryCount >= 2 ? 'staff' : 'retry');
  } finally {
    if (activeVoiceAbortController === abortController) activeVoiceAbortController = undefined;
    isBusy = false;
  }
}

async function captureTranscriptRealtimeFirst(signal?: AbortSignal) {
  throwIfAborted(signal);
  if ('RTCPeerConnection' in window && Boolean(navigator.mediaDevices?.getUserMedia)) {
    try {
      return await captureRealtimeTranscript(signal);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw error;
      console.warn('Realtime transcription failed, falling back to file STT.', error);
      setVoiceStatus('실시간 연결이 어려워요. 짧게 녹음해서 다시 들을게요');
      await sleep(900);
    }
  }
  return captureTranscript(signal);
}

async function transcribeBlobWithFinalProvider(blob: Blob, realtimeTranscript: string) {
  const realtimeText = realtimeTranscript.trim();

  try {
    setVoiceStatus(realtimeText ? '녹음본으로 한 번 더 정확히 확인 중이에요' : '실시간 자막이 비어 있어 녹음본으로 다시 확인 중이에요');
    const audioBase64 = await blobToBase64(blob);
    const result = await apiJson<{ text: string }>('/api/stt/transcribe', {
      method: 'POST',
      body: JSON.stringify({ audioBase64, mimeType: blob.type, filename: 'speech.webm' })
    });
    const finalText = result.text.trim();
    if (finalText) return finalText;
  } catch (error) {
    console.warn('Final STT pass failed.', error);
  }

  return realtimeText;
}

function preferredRecordingMimeType() {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
  return candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate)) || '';
}

async function captureRealtimeTranscript(signal?: AbortSignal) {
  throwIfAborted(signal);
  setVoiceStatus('실시간 음성 연결 중이에요');
  const vadSettings = vadCalibrationSettings();
  const pc = new RTCPeerConnection();
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true
    }
  });
  const [track] = stream.getAudioTracks();
  pc.addTrack(track, stream);

  const recordedChunks: BlobPart[] = [];
  const recorderMimeType = preferredRecordingMimeType();
  const recorder = new MediaRecorder(stream, recorderMimeType ? { mimeType: recorderMimeType } : undefined);
  const recordedBlob = new Promise<Blob>((resolve) => {
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) recordedChunks.push(event.data);
    };
    recorder.onstop = () => resolve(new Blob(recordedChunks, { type: recorder.mimeType || 'audio/webm' }));
  });
  recorder.start();

  const dc = pc.createDataChannel('oai-events');
  let partial = '';
  let realtimeCompletedTranscript = '';
  let committed = false;
  let completed = false;
  let serverDetectedSpeech = false;
  let commitTimer: number | undefined;
  let hardStopTimer: number | undefined;

  const cleanup = () => {
    if (commitTimer) window.clearTimeout(commitTimer);
    if (hardStopTimer) window.clearTimeout(hardStopTimer);
    signal?.removeEventListener('abort', abortListener);
    stream.getTracks().forEach((item) => item.stop());
    dc.close();
    pc.close();
  };
  const abortListener = () => {
    if (recorder.state !== 'inactive') recorder.stop();
  };
  signal?.addEventListener('abort', abortListener, { once: true });

  try {
    const realtimeTranscript = await new Promise<string>((resolve, reject) => {
      const finish = (value: string) => {
        if (completed) return;
        completed = true;
        if (recorder.state !== 'inactive') recorder.stop();
        resolve(value.trim());
      };
      const abort = () => {
        if (completed) return;
        completed = true;
        if (recorder.state !== 'inactive') recorder.stop();
        reject(new DOMException('Presence left while listening', 'AbortError'));
      };
      signal?.addEventListener('abort', abort, { once: true });

      dc.addEventListener('open', () => {
        setVoiceStatus('듣고 있어요. 말씀이 끝나면 바로 글자가 보여요');
        commitTimer = window.setTimeout(() => {
          if (committed || dc.readyState !== 'open') return;
          committed = true;
          setVoiceStatus(partial ? `확인 중: ${partial}` : serverDetectedSpeech ? '말씀을 확인하는 중이에요' : '아직 음성이 잘 안 들려요');
          if (serverDetectedSpeech) dc.send(JSON.stringify({ type: 'input_audio_buffer.commit' }));
	        }, Math.max(4500, vadSettings.silenceMs + 4300));
	        hardStopTimer = window.setTimeout(() => {
	          finish(realtimeCompletedTranscript || partial);
	        }, Math.max(8000, vadSettings.silenceMs + 8300));
      });

      dc.addEventListener('message', (event) => {
        let data: { type?: string; delta?: string; transcript?: string; text?: string; error?: unknown };
        try {
          data = JSON.parse(event.data);
        } catch {
          return;
        }

        if (data.type === 'input_audio_buffer.speech_started') {
          serverDetectedSpeech = true;
          setVoiceStatus('음성이 들려요. 계속 말씀해 주세요');
        }

        if (data.type === 'input_audio_buffer.committed') {
          committed = true;
          setVoiceStatus(partial.trim() ? `확인 중: ${partial.trim()}` : '말씀을 글자로 바꾸는 중이에요');
        }

        if (data.type === 'input_audio_buffer.speech_stopped') {
          setVoiceStatus(partial.trim() ? `확인 중: ${partial.trim()}` : '말씀을 글자로 바꾸는 중이에요');
        }

        if (data.type === 'conversation.item.input_audio_transcription.delta' && data.delta) {
          partial += data.delta;
          setVoiceStatus(partial.trim() ? `듣는 중: ${partial.trim()}` : '듣고 있어요');
        }

        if (data.type === 'conversation.item.input_audio_transcription.segment' && data.text) {
          partial = data.text;
          setVoiceStatus(partial.trim() ? `듣는 중: ${partial.trim()}` : '듣고 있어요');
        }

        if (data.type === 'conversation.item.input_audio_transcription.completed') {
          realtimeCompletedTranscript = data.transcript || partial;
          setVoiceStatus(`이렇게 들었어요: ${realtimeCompletedTranscript}`);
          finish(realtimeCompletedTranscript);
        }

        if (data.type === 'error') {
          reject(new Error(JSON.stringify(data.error || data)));
        }
      });

      pc.addEventListener('connectionstatechange', () => {
        if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
          if (!completed) reject(new Error(`Realtime connection ${pc.connectionState}`));
        }
      });

      pc.createOffer()
        .then((offer) => pc.setLocalDescription(offer))
        .then(async () => {
          const offerSdp = pc.localDescription?.sdp;
          if (!offerSdp) throw new Error('Missing local SDP');
	          const response = await fetch(`/api/realtime/call?silenceDurationMs=${encodeURIComponent(String(vadSettings.silenceMs))}`, {
	            method: 'POST',
	            headers: { 'Content-Type': 'application/sdp' },
	            body: offerSdp,
	            signal
	          });
          if (!response.ok) throw new Error(`Realtime session failed: ${response.status}`);
          const answerSdp = await response.text();
          await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp });
        })
        .catch(reject);
    });
    const blob = await recordedBlob;
    const finalTranscript = await transcribeBlobWithFinalProvider(blob, realtimeTranscript);
    if (!finalTranscript.trim()) throw new Error('Empty transcript');
    setVoiceStatus(`이렇게 들었어요: ${finalTranscript}`);
    return finalTranscript;
  } finally {
    cleanup();
  }
}

async function captureTranscript(signal?: AbortSignal) {
  throwIfAborted(signal);
  if (!navigator.mediaDevices || typeof MediaRecorder === 'undefined') {
    const text = window.prompt('마이크를 사용할 수 없어 텍스트로 입력해 주세요.')?.trim();
    if (!text) throw new Error('No transcript');
    return text;
  }
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const chunks: BlobPart[] = [];
  const recorder = new MediaRecorder(stream, { mimeType: MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : undefined });
  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) chunks.push(event.data);
  };
  const stopped = new Promise<Blob>((resolve) => {
    recorder.onstop = () => {
      stream.getTracks().forEach((track) => track.stop());
      resolve(new Blob(chunks, { type: recorder.mimeType || 'audio/webm' }));
    };
  });
  recorder.start();
  for (let remaining = 5; remaining > 0; remaining -= 1) {
    throwIfAborted(signal);
    setVoiceStatus(`${remaining}초 동안 듣고 있어요`);
    await sleep(1000);
  }
  setVoiceStatus('음성을 글자로 바꾸는 중이에요');
  recorder.stop();
  const blob = await stopped;
  const audioBase64 = await blobToBase64(blob);
  const result = await apiJson<{ text: string }>('/api/stt/transcribe', {
    method: 'POST',
    body: JSON.stringify({ audioBase64, mimeType: blob.type, filename: 'speech.webm' })
  });
  if (!result.text.trim()) throw new Error('Empty transcript');
  return result.text.trim();
}

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException('Presence left while listening', 'AbortError');
}

function blobToBase64(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.readAsDataURL(blob);
  });
}

function setVoiceStatus(text: string) {
  const activeScreen = screens[state.currentScreen];
  if (state.currentScreen === 'start') {
    const lead = activeScreen?.querySelector<HTMLElement>('.lead');
    if (lead) lead.textContent = text;
  }
  const active = activeScreen?.querySelector<HTMLElement>('.voice-text .state');
  if (!active) return;

  const display = normalizeVoiceDisplay(text);
  if (display.transcript !== undefined) displayedTranscript = display.transcript;

  const mainText = displayedTranscript || display.placeholder;
  active.textContent = mainText;

  const caption = activeScreen?.querySelector<HTMLElement>('.voice-text .ex');
  if (caption) {
    const dot = document.createElement('span');
    dot.className = 'live-dot';
    caption.replaceChildren(dot, document.createTextNode(display.status));
  }
}

function normalizeVoiceDisplay(text: string) {
  const heard = text.match(/^이렇게 들었어요:\s*(.+)$/);
  if (heard) return { status: '이렇게 들었어요', transcript: `“${heard[1].trim()}”`, placeholder: '말씀을 들었어요' };

  const listening = text.match(/^듣는 중:\s*(.+)$/);
  if (listening) return { status: '듣고 있어요', transcript: `“${listening[1].trim()}”`, placeholder: '말씀해 주세요' };

  const checking = text.match(/^(?:확인 중|정확히 확인 중):\s*(.+)$/);
  if (checking) return { status: '확인 중이에요', transcript: `“${checking[1].trim()}”`, placeholder: '확인 중이에요' };

  if (/먼저 안내/.test(text)) return { status: '안내 중이에요', placeholder: '잠시만요' };
  if (/자동으로 듣기|듣고 있어요|음성이 들려요/.test(text)) return { status: '듣고 있어요', placeholder: '말씀해 주세요' };
  if (/글자로 바꾸|확인하는 중|확인 중|이해하는 중/.test(text)) return { status: '확인 중이에요', placeholder: displayedTranscript || '확인 중이에요' };
  if (/다시 말씀|잘 못 들|비어|안 들려/.test(text)) return { status: '다시 말씀해 주세요', transcript: '', placeholder: '다시 말씀해 주세요' };
  if (/마이크를 한 번/.test(text)) return { status: '권한 확인 중이에요', transcript: '', placeholder: '마이크를 눌러 주세요' };
  if (/실시간 연결/.test(text)) return { status: '다시 듣는 중이에요', placeholder: '잠시만요' };

  return { status: text, placeholder: displayedTranscript || '말씀해 주세요' };
}

async function speakScreenPrompt(id: ScreenId, text: string) {
  if (!audioOutputEnabled) return;
  const audioUrl = fixedPromptAudio[id];
  if (audioUrl) {
    await playAudioUrl(audioUrl);
    return;
  }
  await speak(text);
}

async function playAudioUrl(url: string) {
  const generation = speakGeneration + 1;
  stopAssistantVoice();
  speakGeneration = generation;
  const audio = new Audio(url);
  audio.playbackRate = assistantPlaybackRate;
  currentAssistantAudio = audio;
  try {
    await playAudioUntilFinished(audio, generation);
  } catch (error) {
    if (generation === speakGeneration) console.warn('Local audio playback failed', error);
  }
}

async function playAudioUntilFinished(audio: HTMLAudioElement, generation: number, cleanup?: () => void) {
  const clearCurrent = () => {
    cleanup?.();
    if (currentAssistantAudio === audio) currentAssistantAudio = undefined;
  };

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    let fallbackTimer: number | undefined;

    const done = () => {
      if (settled) return;
      settled = true;
      if (fallbackTimer) window.clearTimeout(fallbackTimer);
      clearCurrent();
      resolve();
    };

    const fail = () => {
      if (settled) return;
      settled = true;
      if (fallbackTimer) window.clearTimeout(fallbackTimer);
      clearCurrent();
      reject(audio.error || new Error('Audio playback failed'));
    };

    audio.addEventListener('ended', done, { once: true });
    audio.addEventListener('pause', () => {
      if (generation !== speakGeneration) done();
    });
    audio.addEventListener('error', fail, { once: true });
    audio.addEventListener('abort', done, { once: true });
    audio.addEventListener('loadedmetadata', () => {
      const durationMs = Number.isFinite(audio.duration) ? audio.duration * 1000 : 15000;
      fallbackTimer = window.setTimeout(done, Math.min(Math.max(durationMs + 1000, 4000), 30000));
    }, { once: true });

    void audio.play().catch(fail);
  });
}

function stopAssistantVoice() {
  speakGeneration += 1;
  if (currentAssistantAudio) {
    currentAssistantAudio.pause();
    currentAssistantAudio.src = '';
    currentAssistantAudio = undefined;
  }
  if ('speechSynthesis' in window) {
    window.speechSynthesis.cancel();
  }
}

async function speak(text: string) {
  const generation = speakGeneration + 1;
  stopAssistantVoice();
  speakGeneration = generation;

  try {
    const response = await fetch('/api/tts/speak', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text })
    });
    if (!response.ok) throw new Error('TTS failed');
    const blob = await response.blob();
    if (generation !== speakGeneration) return;
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audio.playbackRate = assistantPlaybackRate;
    currentAssistantAudio = audio;
    await playAudioUntilFinished(audio, generation, () => URL.revokeObjectURL(url));
  } catch (error) {
    if (generation !== speakGeneration) return;
    if (error instanceof DOMException && error.name === 'AbortError') return;
    // Do not fall back to browser speech by default: mixed system voices feel confusing in kiosk mode.
    console.warn('TTS playback skipped after API failure', error);
  }
}

function fit() {
  const scaler = document.getElementById('scaler');
  const fitbox = document.getElementById('fitbox');
  const wrap = document.querySelector<HTMLElement>('.stage-scroll');
  if (!scaler || !fitbox || !wrap) return;
  const totalW = KW + 44;
  const totalH = KH + 44;
  const availW = wrap.clientWidth - 52;
  const availH = wrap.clientHeight - 52;
  const s = Math.min(availW / totalW, availH / totalH);
  scaler.style.transform = `scale(${s})`;
  fitbox.style.width = `${totalW * s}px`;
  fitbox.style.height = `${totalH * s}px`;
}

function initDemoMode() {
  if (new URLSearchParams(window.location.search).get('demo') === '1') {
    document.body.classList.add('demo-mode');
  }
}

function restartSearch() {
  stopAssistantVoice();
  state.intent = {
    departureStation: state.intent.departureStation || '서울',
    passengerCount: 1,
    missingFields: ['arrivalStation', 'timePreference'],
    confidence: 0
  };
  state.trainCandidates = [];
  state.selectedCandidate = undefined;
  state.retryCount = 0;
  show('dest');
}

function clearDestinationForRetry() {
  state.intent = {
    ...state.intent,
    arrivalStation: undefined,
    confirmation: 'no',
    missingFields: ['arrivalStation']
  };
  state.trainCandidates = [];
  state.selectedCandidate = undefined;
}

document.addEventListener('click', async (event) => {
  const target = event.target as Element;
  const action = target.closest<HTMLElement>('[data-action]');
  if (action?.dataset.action === 'restart-search') {
    event.preventDefault();
    restartSearch();
    return;
  }

  const trainCard = target.closest<HTMLElement>('[data-train-id]');
  if (trainCard) {
    event.preventDefault();
    selectCandidate(trainCard.dataset.trainId || '');
    return;
  }

  const voice = target.closest<HTMLElement>('.voice');
  if (voice && ['dest', 'confirm', 'time', 'summary', 'retry', 'results', 'nudge'].includes(state.currentScreen)) {
    event.preventDefault();
    await handleVoiceTurn({ auto: false });
    return;
  }

  const go = target.closest<HTMLElement>('[data-go]');
  if (!go) return;
  event.preventDefault();
  const next = go.dataset.go as ScreenId;
  if (state.currentScreen === 'confirm' && next === 'time') {
    await callDialog('네');
    return;
  }
  if (state.currentScreen === 'confirm' && next === 'dest') {
    clearDestinationForRetry();
    show('dest');
    return;
  }
  if (state.currentScreen === 'summary' && next === 'searching') {
    await callDialog('네');
    return;
  }
  show(next);
});

document.getElementById('prev')?.addEventListener('click', () => {
  const i = HAPPY.indexOf(state.currentScreen);
  show(i === -1 ? 'dest' : HAPPY[Math.max(0, i - 1)]);
});

document.getElementById('next')?.addEventListener('click', () => {
  const i = HAPPY.indexOf(state.currentScreen);
  show(i === -1 ? 'dest' : HAPPY[Math.min(HAPPY.length - 1, i + 1)]);
});

document.addEventListener('keydown', (event) => {
  if (!document.body.classList.contains('demo-mode')) return;
  if (event.key === 'ArrowRight') document.getElementById('next')?.click();
  if (event.key === 'ArrowLeft') document.getElementById('prev')?.click();
});

window.addEventListener('resize', fit);
initDemoMode();
initSettingsPanel();
fit();
renderState();
updateControls();
void announceScreenThenListen(state.currentScreen);
