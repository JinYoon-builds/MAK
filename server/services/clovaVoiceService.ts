import { config } from '../config.js';

function requireClovaVoiceEnv() {
  if (!config.clovaVoiceClientId || !config.clovaVoiceClientSecret) {
    const err = new Error('CLOVA Voice credentials are not configured');
    (err as Error & { status?: number }).status = 500;
    throw err;
  }
}

export async function clovaSynthesizeSpeech(text: string) {
  requireClovaVoiceEnv();
  const body = new URLSearchParams();
  body.set('speaker', config.clovaVoiceId);
  body.set('volume', config.clovaVoiceVolume);
  body.set('speed', config.clovaVoiceSpeed);
  body.set('pitch', config.clovaVoicePitch);
  body.set('format', config.clovaVoiceFormat);
  body.set('text', text.slice(0, 2000));

  const response = await fetch(config.clovaVoiceUrl, {
    method: 'POST',
    headers: {
      'X-NCP-APIGW-API-KEY-ID': config.clovaVoiceClientId,
      'X-NCP-APIGW-API-KEY': config.clovaVoiceClientSecret,
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8'
    },
    body
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('[clova-tts-error]', { status: response.status, body: errorText.slice(0, 500) });
    const err = new Error(`CLOVA Voice failed: ${response.status}`);
    (err as Error & { status?: number }).status = response.status;
    throw err;
  }

  return Buffer.from(await response.arrayBuffer());
}
