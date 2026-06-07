import 'dotenv/config';

export const config = {
  port: Number(process.env.PORT ?? 8787),
  openaiApiKey: process.env.OPENAI_API_KEY ?? '',
  openaiLlmModel: process.env.OPENAI_LLM_MODEL ?? 'gpt-5.4-mini',
  openaiSttModel: process.env.OPENAI_STT_MODEL ?? 'gpt-4o-mini-transcribe',
  sttProvider: process.env.STT_PROVIDER ?? 'openai',
  sttFinalProvider: process.env.STT_FINAL_PROVIDER ?? 'none',
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
