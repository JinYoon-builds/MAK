import { FaceDetector, FilesetResolver, type BoundingBox } from '@mediapipe/tasks-vision';
import { MicVAD, utils } from '@ricky0123/vad-web';
import type { RealTimeVADOptions } from '@ricky0123/vad-web';
import {
  loadVadCalibrationSettings,
  saveVadCalibrationSettings,
  type VadCalibrationSettings
} from './vadSettings';

type GateState = 'IDLE' | 'LISTENING' | 'CAPTURING';
type DetectorMode = 'MediaPipe Face Detector' | 'Native FaceDetector' | 'unavailable';

type NativeFaceDetector = {
  detect: (source: HTMLVideoElement) => Promise<Array<{ boundingBox?: DOMRectReadOnly }>>;
};

declare global {
  interface Window {
    FaceDetector?: new (options?: { fastMode?: boolean; maxDetectedFaces?: number }) => NativeFaceDetector;
  }
}

const DETECTION_INTERVAL_MS = 150;
const MEDIA_PIPE_WASM_PATH = '/vendor/mediapipe';
const MEDIA_PIPE_FACE_MODEL =
  'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite';
const VAD_ASSET_PATH = '/vendor/vad/';
const ONNX_WASM_PATH = import.meta.env.DEV ? '/src/vendor/onnxruntime/' : '/vendor/onnxruntime/';
const AUDIO_SAMPLE_RATE = 16000;

const vadDefaults = {
  positiveSpeechThreshold: 0.46,
  negativeSpeechThreshold: 0.32,
  preSpeechPadMs: 450,
  redemptionMs: 2200,
  minSpeechMs: 450
};

const video = getEl<HTMLVideoElement>('camera');
const overlay = getEl<HTMLCanvasElement>('overlay');
const ctx = overlay.getContext('2d');
const headline = getEl('headline');
const sub = getEl('sub');
const statePill = getEl('statePill');
const presenceDot = getEl('presenceDot');
const detectorName = getEl('detectorName');
const speechCountEl = getEl('speechCount');
const lastDurationEl = getEl('lastDuration');
const statusEl = getEl('status');
const speechLog = getEl<HTMLUListElement>('speechLog');
const startButton = getEl<HTMLButtonElement>('startButton');
const stopButton = getEl<HTMLButtonElement>('stopButton');
const calibrationSettings = loadVadCalibrationSettings();

const enterDebounce = getRange('enterDebounce', 'enterValue', calibrationSettings.enterDebounceMs, formatSeconds);
const exitDebounce = getRange('exitDebounce', 'exitValue', calibrationSettings.exitDebounceMs, formatSeconds);
const silenceMs = getRange('silenceMs', 'silenceValue', calibrationSettings.silenceMs, formatSeconds);
const minSpeechMs = getRange('minSpeechMs', 'minSpeechValue', calibrationSettings.minSpeechMs, (value) => `${(value / 1000).toFixed(2)}초`);
const closeRatio = getRange('closeRatio', 'closeValue', calibrationSettings.closeRatioPercent, (value) => `${value}%`);

let state: GateState = 'IDLE';
let personPresent = false;
let cameraStream: MediaStream | undefined;
let detectionTimer: number | undefined;
let seenSince = 0;
let missingSince = 0;
let speechCount = 0;
let vad: MicVAD | undefined;
let faceDetector: FaceDetector | undefined;
let nativeFaceDetector: NativeFaceDetector | undefined;
let detectorMode: DetectorMode = 'unavailable';
let lastBox: BoundingBox | DOMRectReadOnly | undefined;
let vadStarting = false;

startButton.addEventListener('click', () => {
  void startDemo();
});

stopButton.addEventListener('click', () => {
  void stopDemo();
});

silenceMs.input.addEventListener('input', updateVadOptions);
minSpeechMs.input.addEventListener('input', updateVadOptions);
[enterDebounce, exitDebounce, silenceMs, minSpeechMs, closeRatio].forEach((range) => {
  range.input.addEventListener('input', persistCalibrationSettings);
});

setStatus('카메라 시작을 누르면 로컬 감지를 시작합니다. 영상은 저장하거나 전송하지 않습니다.');
render();

async function startDemo() {
  startButton.disabled = true;
  try {
    setStatus('카메라 권한을 요청하고 있어요.');
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: {
        width: { ideal: 960 },
        height: { ideal: 540 },
        facingMode: 'user'
      },
      audio: false
    });
    video.srcObject = cameraStream;
    await video.play();
    resizeOverlay();
    await initDetector();
    startDetectionLoop();
    setStatus('사람 감지 중입니다. 사람이 감지되기 전까지 마이크/VAD는 꺼져 있습니다.');
  } catch (error) {
    startButton.disabled = false;
    setStatus(`시작 실패: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function stopDemo() {
  if (detectionTimer) window.clearInterval(detectionTimer);
  detectionTimer = undefined;
  await setPersonPresent(false);
  await vad?.destroy();
  vad = undefined;
  faceDetector?.close();
  faceDetector = undefined;
  cameraStream?.getTracks().forEach((track) => track.stop());
  cameraStream = undefined;
  video.srcObject = null;
  personPresent = false;
  seenSince = 0;
  missingSince = 0;
  lastBox = undefined;
  setState('IDLE');
  setStatus('정지했습니다.');
  startButton.disabled = false;
  render();
}

async function initDetector() {
  detectorMode = 'unavailable';
  try {
    const vision = await FilesetResolver.forVisionTasks(MEDIA_PIPE_WASM_PATH);
    faceDetector = await FaceDetector.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: MEDIA_PIPE_FACE_MODEL,
        delegate: 'CPU'
      },
      runningMode: 'VIDEO',
      minDetectionConfidence: 0.5
    });
    detectorMode = 'MediaPipe Face Detector';
    detectorName.textContent = detectorMode;
    return;
  } catch (error) {
    console.warn('[presence] MediaPipe face detector unavailable.', error);
  }

  if (window.FaceDetector) {
    nativeFaceDetector = new window.FaceDetector({ fastMode: true, maxDetectedFaces: 1 });
    detectorMode = 'Native FaceDetector';
  }
  detectorName.textContent = detectorMode === 'unavailable' ? '감지 불가' : detectorMode;
}

function startDetectionLoop() {
  if (detectionTimer) window.clearInterval(detectionTimer);
  detectionTimer = window.setInterval(() => {
    void detectPresenceTick();
  }, DETECTION_INTERVAL_MS);
}

async function detectPresenceTick() {
  if (!video.videoWidth || !video.videoHeight) return;
  resizeOverlay();

  const detected = await detectCloseFace();
  const now = performance.now();
  if (detected) {
    if (!seenSince) seenSince = now;
    missingSince = 0;
    if (!personPresent && now - seenSince >= enterDebounce.value()) {
      await setPersonPresent(true);
    }
  } else {
    if (!missingSince) missingSince = now;
    seenSince = 0;
    if (personPresent && now - missingSince >= exitDebounce.value()) {
      await setPersonPresent(false);
    }
  }

  drawOverlay(detected);
  render();
}

async function detectCloseFace() {
  if (detectorMode === 'unavailable') {
    lastBox = undefined;
    return false;
  }

  try {
    if (faceDetector) {
      const result = faceDetector.detectForVideo(video, performance.now());
      const best = result.detections
        .map((item) => item.boundingBox)
        .filter((box): box is BoundingBox => Boolean(box))
        .sort((a, b) => b.width * b.height - a.width * a.height)[0];
      lastBox = best;
      return Boolean(best && boxAreaRatio(best) >= closeRatio.value() / 100);
    }

    if (nativeFaceDetector) {
      const result = await nativeFaceDetector.detect(video);
      const best = result
        .map((item) => item.boundingBox)
        .filter((box): box is DOMRectReadOnly => Boolean(box))
        .sort((a, b) => b.width * b.height - a.width * a.height)[0];
      lastBox = best;
      return Boolean(best && boxAreaRatio(best) >= closeRatio.value() / 100);
    }
  } catch (error) {
    console.warn('[presence] detection tick failed.', error);
  }

  lastBox = undefined;
  return false;
}

async function setPersonPresent(next: boolean) {
  if (personPresent === next) return;

  if (next) {
    personPresent = true;
    console.log('[presence] personPresent=true');
    setStatus('사람이 감지되었습니다. 마이크/VAD를 켜는 중입니다.');
    try {
      await ensureVadStarted();
      setState('LISTENING');
      setStatus('사람이 감지되어 VAD를 켰습니다. 말씀하세요.');
    } catch (error) {
      personPresent = false;
      seenSince = 0;
      missingSince = performance.now();
      setState('IDLE');
      const message = error instanceof Error ? error.message : String(error);
      console.error('[vad] failed to start', error);
      setStatus(`VAD 시작 실패: ${message}. 마이크 권한과 VAD asset 경로를 확인하세요.`);
    }
    return;
  }

  personPresent = false;
  console.log('[presence] personPresent=false');
  setStatus('사람이 떠나 VAD를 끕니다.');
  await vad?.pause();
  setState('IDLE');
}

async function ensureVadStarted() {
  if (vadStarting) return;
  vadStarting = true;
  try {
    if (!vad) {
      vad = await MicVAD.new({
        startOnLoad: false,
        model: 'v5',
        baseAssetPath: VAD_ASSET_PATH,
        onnxWASMBasePath: ONNX_WASM_PATH,
        positiveSpeechThreshold: vadDefaults.positiveSpeechThreshold,
        negativeSpeechThreshold: vadDefaults.negativeSpeechThreshold,
        redemptionMs: silenceMs.value(),
        preSpeechPadMs: vadDefaults.preSpeechPadMs,
        minSpeechMs: minSpeechMs.value(),
        submitUserSpeechOnPause: false,
        onSpeechStart: () => {
          console.log('[vad] speech start');
          setState('CAPTURING');
          setStatus('발화 시작을 감지했습니다. 말씀이 끝날 때까지 녹음합니다.');
        },
        onSpeechRealStart: () => {
          setState('CAPTURING');
        },
        onSpeechEnd: (audio) => {
          handleSpeechEnd(audio);
        },
        onVADMisfire: () => {
          console.log('[vad] misfire ignored');
          if (personPresent) setState('LISTENING');
          setStatus('너무 짧은 소리는 무시했습니다.');
        },
        onFrameProcessed: () => undefined
      } satisfies Partial<RealTimeVADOptions>);
    }

    updateVadOptions();
    await vad.start();
  } finally {
    vadStarting = false;
  }
}

function updateVadOptions() {
  vad?.setOptions({
    redemptionMs: silenceMs.value(),
    minSpeechMs: minSpeechMs.value(),
    positiveSpeechThreshold: vadDefaults.positiveSpeechThreshold,
    negativeSpeechThreshold: vadDefaults.negativeSpeechThreshold,
    preSpeechPadMs: vadDefaults.preSpeechPadMs
  });
}

function currentCalibrationSettings(): VadCalibrationSettings {
  return {
    enterDebounceMs: enterDebounce.value(),
    exitDebounceMs: exitDebounce.value(),
    silenceMs: silenceMs.value(),
    minSpeechMs: minSpeechMs.value(),
    closeRatioPercent: closeRatio.value()
  };
}

function persistCalibrationSettings() {
  saveVadCalibrationSettings(currentCalibrationSettings());
  setStatus('설정값을 저장했습니다. 실제 키오스크 화면에서도 같은 값을 읽습니다.');
}

function handleSpeechEnd(audio: Float32Array) {
  const durationSec = audio.length / AUDIO_SAMPLE_RATE;
  const wav = utils.encodeWAV(audio, 3, AUDIO_SAMPLE_RATE, 1, 32);
  const blob = new Blob([wav], { type: 'audio/wav' });
  const url = URL.createObjectURL(blob);
  speechCount += 1;
  speechCountEl.textContent = String(speechCount);
  lastDurationEl.textContent = `${durationSec.toFixed(2)}초`;
  console.log(`[발화 감지] 길이: ${durationSec.toFixed(2)}초, 시각: ${new Date().toLocaleTimeString('ko-KR')}`, blob);

  const item = document.createElement('li');
  const title = document.createElement('div');
  title.textContent = `${new Date().toLocaleTimeString('ko-KR')} · ${durationSec.toFixed(2)}초`;
  const audioEl = document.createElement('audio');
  audioEl.controls = true;
  audioEl.src = url;
  item.append(title, audioEl);
  speechLog.prepend(item);

  setStatus(`발화 감지됨, 길이 ${durationSec.toFixed(2)}초. 다음 발화를 기다립니다.`);
  if (personPresent) setState('LISTENING');
}

function setState(next: GateState) {
  if (state === next) return;
  console.log(`[state] ${state}→${next}`);
  state = next;
  render();
}

function render() {
  presenceDot.classList.toggle('on', personPresent);
  statePill.textContent = state;
  statePill.className = `state-pill ${state.toLowerCase()}`;

  if (state === 'IDLE') {
    headline.textContent = '어서 오세요';
    sub.textContent = detectorMode === 'unavailable' ? '사람 감지 모델을 사용할 수 없습니다.' : '카메라로 앞에 사람이 있는지 확인하고 있어요.';
  } else if (state === 'LISTENING') {
    headline.textContent = '말씀하세요';
    sub.textContent = '듣고 있어요. 말이 시작되면 자동으로 발화 구간을 자릅니다.';
  } else {
    headline.textContent = '듣고 있어요';
    sub.textContent = '중간에 잠깐 쉬어도 침묵 timeout 동안 기다립니다.';
  }
}

function drawOverlay(rawDetected: boolean) {
  if (!ctx) return;
  ctx.clearRect(0, 0, overlay.width, overlay.height);
  if (!lastBox) return;

  const scaleX = overlay.width / video.videoWidth;
  const scaleY = overlay.height / video.videoHeight;
  ctx.lineWidth = 4;
  ctx.strokeStyle = rawDetected ? '#70d34b' : '#f6bd38';
  const x = boxX(lastBox);
  const y = boxY(lastBox);
  ctx.strokeRect(x * scaleX, y * scaleY, lastBox.width * scaleX, lastBox.height * scaleY);
  ctx.fillStyle = rawDetected ? '#70d34b' : '#f6bd38';
  ctx.font = '18px sans-serif';
  ctx.fillText(`${Math.round(boxAreaRatio(lastBox) * 100)}%`, x * scaleX, Math.max(24, y * scaleY - 8));
}

function resizeOverlay() {
  const width = video.videoWidth || video.clientWidth;
  const height = video.videoHeight || video.clientHeight;
  if (overlay.width !== width) overlay.width = width;
  if (overlay.height !== height) overlay.height = height;
}

function boxAreaRatio(box: BoundingBox | DOMRectReadOnly) {
  const frameArea = Math.max(1, video.videoWidth * video.videoHeight);
  return (box.width * box.height) / frameArea;
}

function boxX(box: BoundingBox | DOMRectReadOnly) {
  return 'originX' in box ? box.originX : box.x;
}

function boxY(box: BoundingBox | DOMRectReadOnly) {
  return 'originY' in box ? box.originY : box.y;
}

function setStatus(message: string) {
  statusEl.textContent = message;
}

function getEl<T extends HTMLElement = HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id}`);
  return el as T;
}

function getRange(id: string, labelId: string, initialValue: number, format: (value: number) => string) {
  const input = getEl<HTMLInputElement>(id);
  const label = getEl(labelId);
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
