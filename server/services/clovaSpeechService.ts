import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { config } from '../config.js';

const execFileAsync = promisify(execFile);

function requireClovaSpeechEnv() {
  if (!config.clovaSpeechClientId || !config.clovaSpeechClientSecret) {
    const err = new Error('CLOVA Speech credentials are not configured');
    (err as Error & { status?: number }).status = 500;
    throw err;
  }
}

async function convertToWavIfNeeded(buffer: Buffer, mimeType?: string) {
  const mime = mimeType || '';
  const needsConversion = /webm|mp4|mpeg|mp3|ogg|opus/i.test(mime);
  if (!needsConversion) return { buffer, contentType: mimeType || 'application/octet-stream' };

  const dir = await mkdtemp(path.join(tmpdir(), 'mak-clova-stt-'));
  const input = path.join(dir, 'input.audio');
  const output = path.join(dir, 'output.wav');
  try {
    await writeFile(input, buffer);
    await execFileAsync('ffmpeg', ['-y', '-i', input, '-ac', '1', '-ar', '16000', '-f', 'wav', output], { timeout: 10000 });
    return { buffer: await readFile(output), contentType: 'application/octet-stream' };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export async function clovaTranscribeBase64Audio(input: { audioBase64: string; mimeType?: string }) {
  requireClovaSpeechEnv();
  const raw = Buffer.from(input.audioBase64, 'base64');
  if (raw.byteLength === 0) {
    const err = new Error('Empty audio');
    (err as Error & { status?: number }).status = 400;
    throw err;
  }

  const { buffer, contentType } = await convertToWavIfNeeded(raw, input.mimeType);
  const url = new URL(config.clovaSpeechUrl);
  url.searchParams.set('lang', config.clovaSpeechLang);

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'X-NCP-APIGW-API-KEY-ID': config.clovaSpeechClientId,
      'X-NCP-APIGW-API-KEY': config.clovaSpeechClientSecret,
      'Content-Type': contentType
    },
    body: buffer as unknown as BodyInit
  });

  const text = await response.text();
  if (!response.ok) {
    console.error('[clova-stt-error]', { status: response.status, body: text.slice(0, 500) });
    const err = new Error(`CLOVA Speech failed: ${response.status}`);
    (err as Error & { status?: number }).status = response.status;
    throw err;
  }

  const json = JSON.parse(text) as { text?: string };
  console.log('[clova-stt-ok]', { textLength: (json.text ?? '').length });
  return { text: json.text ?? '' };
}
