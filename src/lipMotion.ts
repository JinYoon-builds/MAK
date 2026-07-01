import type { Category } from '@mediapipe/tasks-vision';

// 2D 랜드마크 거리 비율은 고개가 돌아가면(yaw/pitch) 투영이 바뀌어 입을 안 움직여도 값이 변한다.
// 대신 MediaPipe 블렌드셰이프(표정 계수, 0~1)를 쓴다. 머리 자세와 무관하게 정규화돼 있다.
// jawOpen(입 벌어짐)을 주 신호로 두고, 입을 거의 안 벌리는 음의 보조 셰이프는 아주 작게만 더한다.
const LIP_BLENDSHAPES: Record<string, number> = {
  jawOpen: 1, // 입 벌어짐(대부분의 모음) — 주 신호
  mouthClose: 0.4, // 입 다물기(ㅁ·ㅂ·ㅍ)
  mouthPucker: 0.2, // 오므림(ㅗ·ㅜ)
  mouthFunnel: 0.2, // 둥글게(ㅗ·ㅜ)
  mouthStretchLeft: 0.2, // 옆으로 퍼짐(ㅣ·ㅡ)
  mouthStretchRight: 0.2
};

// 말의 본질은 음절마다 입이 "벌어졌다 닫혔다" 하는 진동이다.
// 그래서 누적 변화량이 아니라 짧은 윈도 안에서 벌어짐의 "진폭(max−min)"을 본다.
// 정지한 입은(열렸든 닫혔든, 미소든) 진폭이 0이라 걸러지고, 말할 때만 출렁여서 잡힌다.
// 진폭은 누적이 아니라 유계(bounded)라 지터가 쌓여 과민해지지 않는다.
const LIP_MOTION_WINDOW_MS = 500;
// 이만큼(계수 단위)의 진폭은 모델 지터로 보고 깎아낸다.
const LIP_AMPLITUDE_DEADBAND = 0.03;
// 진폭을 기존 임계값 슬라이더(기본 0.7, 0.1~5) 범위로 끌어올리는 스케일.
const LIP_MOTION_SCALE = 8;

function aperture(categories: Category[]): number {
  let value = 0;
  for (const category of categories) {
    const weight = LIP_BLENDSHAPES[category.categoryName];
    if (weight) value += weight * category.score;
  }
  return value;
}

export class LipMotionTracker {
  private samples: Array<{ at: number; value: number }> = [];

  reset() {
    this.samples = [];
  }

  // 최근 윈도 안의 벌어짐 진폭(max−min)을 반환한다.
  // 블렌드셰이프가 없으면(얼굴 추적 끊김) 0을 돌려주고 상태를 초기화한다.
  update(categories: Category[] | undefined, now: number): number {
    if (!categories || categories.length === 0) {
      this.reset();
      return 0;
    }
    this.samples.push({ at: now, value: aperture(categories) });
    const cutoff = now - LIP_MOTION_WINDOW_MS;
    while (this.samples.length && this.samples[0].at < cutoff) this.samples.shift();
    if (this.samples.length < 2) return 0;

    let min = Infinity;
    let max = -Infinity;
    for (const sample of this.samples) {
      if (sample.value < min) min = sample.value;
      if (sample.value > max) max = sample.value;
    }
    return Math.max(0, max - min - LIP_AMPLITUDE_DEADBAND) * LIP_MOTION_SCALE;
  }
}
