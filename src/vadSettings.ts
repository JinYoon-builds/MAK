export type VadCalibrationSettings = {
  enterDebounceMs: number;
  exitDebounceMs: number;
  silenceMs: number;
  minSpeechMs: number;
  closeRatioPercent: number;
  lipMotionEnabled: boolean;
  lipMotionThreshold: number;
  lipMotionHoldMs: number;
};

export const VAD_SETTINGS_STORAGE_KEY = 'mak.vadCalibration.v1';

export const defaultVadCalibrationSettings: VadCalibrationSettings = {
  enterDebounceMs: 700,
  exitDebounceMs: 2000,
  silenceMs: 2200,
  minSpeechMs: 450,
  closeRatioPercent: 8,
  lipMotionEnabled: true,
  lipMotionThreshold: 0.7,
  lipMotionHoldMs: 900
};

export function loadVadCalibrationSettings(): VadCalibrationSettings {
  try {
    const raw = window.localStorage.getItem(VAD_SETTINGS_STORAGE_KEY);
    if (!raw) return defaultVadCalibrationSettings;
    const parsed = JSON.parse(raw) as Partial<VadCalibrationSettings>;
    return normalizeVadCalibrationSettings(parsed);
  } catch {
    return defaultVadCalibrationSettings;
  }
}

export function saveVadCalibrationSettings(settings: VadCalibrationSettings) {
  window.localStorage.setItem(VAD_SETTINGS_STORAGE_KEY, JSON.stringify(normalizeVadCalibrationSettings(settings)));
}

export function normalizeVadCalibrationSettings(settings: Partial<VadCalibrationSettings>): VadCalibrationSettings {
  return {
    enterDebounceMs: clampNumber(settings.enterDebounceMs, 200, 2000, defaultVadCalibrationSettings.enterDebounceMs),
    exitDebounceMs: clampNumber(settings.exitDebounceMs, 500, 5000, defaultVadCalibrationSettings.exitDebounceMs),
    silenceMs: clampNumber(settings.silenceMs, 700, 3500, defaultVadCalibrationSettings.silenceMs),
    minSpeechMs: clampNumber(settings.minSpeechMs, 100, 1200, defaultVadCalibrationSettings.minSpeechMs),
    closeRatioPercent: clampNumber(settings.closeRatioPercent, 2, 25, defaultVadCalibrationSettings.closeRatioPercent),
    lipMotionEnabled: typeof settings.lipMotionEnabled === 'boolean' ? settings.lipMotionEnabled : defaultVadCalibrationSettings.lipMotionEnabled,
    lipMotionThreshold: clampNumber(settings.lipMotionThreshold, 0.1, 5, defaultVadCalibrationSettings.lipMotionThreshold),
    lipMotionHoldMs: clampNumber(settings.lipMotionHoldMs, 300, 2000, defaultVadCalibrationSettings.lipMotionHoldMs)
  };
}

function clampNumber(value: unknown, min: number, max: number, fallback: number) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}
