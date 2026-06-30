import { toFile } from 'openai';
import { config } from '../config.js';
import { getOpenAI } from '../integrations/openaiClient.js';
import { clovaTranscribeBase64Audio } from './clovaSpeechService.js';
import { clovaSynthesizeSpeech } from './clovaVoiceService.js';

export async function transcribeBase64Audio(input: { audioBase64: string; mimeType?: string; filename?: string }) {
  if (config.sttProvider === 'clova') return clovaTranscribeBase64Audio(input);
  const openai = getOpenAI();
  const buffer = Buffer.from(input.audioBase64, 'base64');
  if (buffer.byteLength === 0) {
    const err = new Error('Empty audio');
    (err as Error & { status?: number }).status = 400;
    throw err;
  }
  const filename = input.filename || (input.mimeType?.includes('webm') ? 'speech.webm' : 'speech.wav');
  const file = await toFile(buffer, filename, { type: input.mimeType || 'audio/webm' });
  const result = await openai.audio.transcriptions.create({
    file,
    model: config.openaiSttModel,
    language: 'ko',
    prompt: config.openaiSttPrompt,
    response_format: 'json'
  } as any);
  return { text: result.text ?? '' };
}

export async function synthesizeSpeech(text: string) {
  if (config.ttsProvider === 'clova') return clovaSynthesizeSpeech(text);
  const openai = getOpenAI();
  const speech = await openai.audio.speech.create({
    model: config.openaiTtsModel,
    voice: config.openaiTtsVoice as any,
    input: text,
    instructions: '따뜻하고 친절한 여성 역무원처럼, 시니어 사용자가 이해하기 쉽게 천천히 또렷한 한국어로 말하세요.',
    response_format: 'mp3'
  } as any);
  const arrayBuffer = await speech.arrayBuffer();
  return Buffer.from(arrayBuffer);
}
