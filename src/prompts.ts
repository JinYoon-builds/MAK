import type { ScreenId } from './types';

export const fixedScreenPrompts: Partial<Record<ScreenId, string>> = {
  dest: '어디로 가세요?',
  searching: '좋아요. 실제 기차를 찾아볼게요. 잠깐만 기다려 주세요.',
  results: '제일 빠른 기차와 제일 저렴한 기차를 찾았어요. 어느 걸로 해드릴까요?',
  done: '표를 선택했어요. 이제 결제 단계로 안내해드릴게요.',
  retry: '제가 잘 못 들었어요. 천천히 한 번만 더 말씀해 주세요.',
  nudge: '천천히 말씀하셔도 괜찮아요. 어디로 가세요?',
  idle: '아직 계신가요? 계속하시려면 화면을 눌러 주세요.',
  staff: '직원이 바로 도와드릴게요.'
};

export const fixedPromptAudio: Partial<Record<ScreenId, string>> = {
  dest: '/assets/audio/dest.mp3',
  searching: '/assets/audio/searching.mp3',
  results: '/assets/audio/results.mp3',
  done: '/assets/audio/done.mp3',
  retry: '/assets/audio/retry.mp3',
  nudge: '/assets/audio/nudge.mp3',
  idle: '/assets/audio/idle.mp3',
  staff: '/assets/audio/staff.mp3'
};
