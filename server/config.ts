import 'dotenv/config';

export const config = {
  port: Number(process.env.PORT ?? 8787),
  openaiApiKey: process.env.OPENAI_API_KEY ?? '',
  openaiLlmModel: process.env.OPENAI_LLM_MODEL ?? 'gpt-5.4-mini',
  openaiSttModel: process.env.OPENAI_STT_MODEL ?? 'gpt-4o-transcribe',
  openaiSttPrompt:
    process.env.OPENAI_STT_PROMPT ??
    [
      '한국어 기차표 예매 키오스크 음성입니다.',
      '사용자는 목적지 역명, 날짜, 시간, 인원수, 예/아니오를 짧게 말합니다.',
      '역명과 발권 표현을 우선 고려하세요.',
      '자주 나오는 표현: 부산, 부산역, 대구, 동대구, 대전, 광주, 광주송정, 목포, 여수, 여수엑스포, 강릉, 포항, 울산, 마산, 창원, 진주, 수원, 천안아산, KTX, ITX, 새마을, 무궁화, 오늘, 내일, 오전, 오후, 네, 아니요.',
      '예: "부산 가고 싶어"를 "그만하고 싶어"처럼 종료 의도로 바꾸지 말고, 기차 목적지 발화로 전사하세요.'
    ].join(' '),
  sttProvider: process.env.STT_PROVIDER ?? 'openai',
  sttFinalProvider: process.env.STT_FINAL_PROVIDER ?? 'openai',
  openaiTtsModel: process.env.OPENAI_TTS_MODEL ?? 'gpt-4o-mini-tts',
  openaiTtsVoice: process.env.OPENAI_TTS_VOICE ?? 'coral',
  ttsProvider: process.env.TTS_PROVIDER ?? 'openai',
  clovaVoiceClientId: process.env.NCP_CLOVA_VOICE_CLIENT_ID ?? '',
  clovaVoiceClientSecret: process.env.NCP_CLOVA_VOICE_CLIENT_SECRET ?? '',
  clovaVoiceId: process.env.CLOVA_VOICE_ID ?? 'nara',
  clovaVoiceSpeed: process.env.CLOVA_VOICE_SPEED ?? '-1',
  clovaVoicePitch: process.env.CLOVA_VOICE_PITCH ?? '0',
  clovaVoiceVolume: process.env.CLOVA_VOICE_VOLUME ?? '0',
  clovaVoiceFormat: process.env.CLOVA_VOICE_FORMAT ?? 'mp3',
  clovaVoiceUrl: process.env.CLOVA_VOICE_URL ?? 'https://naveropenapi.apigw.ntruss.com/tts-premium/v1/tts',
  clovaSpeechClientId: process.env.NCP_CLOVA_SPEECH_CLIENT_ID ?? process.env.NCP_CLOVA_VOICE_CLIENT_ID ?? '',
  clovaSpeechClientSecret: process.env.NCP_CLOVA_SPEECH_CLIENT_SECRET ?? process.env.NCP_CLOVA_VOICE_CLIENT_SECRET ?? '',
  clovaSpeechLang: process.env.CLOVA_SPEECH_LANG ?? 'Kor',
  clovaSpeechUrl: process.env.CLOVA_SPEECH_URL ?? 'https://naveropenapi.apigw.ntruss.com/recog/v1/stt',
  openaiRealtimeTranscriptionModel: process.env.OPENAI_REALTIME_TRANSCRIPTION_MODEL ?? 'gpt-4o-mini-transcribe',
  dataGoKrServiceKey: process.env.DATA_GO_KR_SERVICE_KEY ?? '',
  dataGoKrServiceKeyType: process.env.DATA_GO_KR_SERVICE_KEY_TYPE ?? 'encoding',
  tagoBaseUrl: process.env.TAGO_BASE_URL ?? 'https://apis.data.go.kr/1613000/TrainInfo',
  defaultDepartureStation: process.env.KIOSK_DEFAULT_DEPARTURE_STATION ?? '서울',
  timezone: process.env.KIOSK_TIMEZONE ?? 'Asia/Seoul'
};

export function requireEnv(name: 'OPENAI_API_KEY' | 'DATA_GO_KR_SERVICE_KEY') {
  const value = name === 'OPENAI_API_KEY' ? config.openaiApiKey : config.dataGoKrServiceKey;
  if (!value) {
    const err = new Error(`${name} is not configured`);
    (err as Error & { status?: number }).status = 500;
    throw err;
  }
}
