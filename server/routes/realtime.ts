import { Router, text } from 'express';
import { config, requireEnv } from '../config.js';

export const realtimeRouter = Router();

function clampSilenceDurationMs(value: unknown) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 700;
  return Math.min(3500, Math.max(700, Math.round(n)));
}

realtimeRouter.post('/call', text({ type: ['application/sdp', 'text/plain'], limit: '1mb' }), async (req, res, next) => {
  try {
    requireEnv('OPENAI_API_KEY');
    const sdp = typeof req.body === 'string' ? req.body : '';
    const silenceDurationMs = clampSilenceDurationMs(req.query.silenceDurationMs);
    if (!sdp.trim()) {
      res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'SDP body is required' } });
      return;
    }

    const fd = new FormData();
    fd.set('sdp', sdp);
    fd.set(
      'session',
      JSON.stringify({
        type: 'transcription',
        audio: {
          input: {
            transcription: {
              model: config.openaiRealtimeTranscriptionModel,
              language: 'ko'
            },
	            turn_detection: {
	              type: 'server_vad',
	              threshold: 0.5,
	              prefix_padding_ms: 300,
	              silence_duration_ms: silenceDurationMs
	            }
          }
        }
      })
    );

    const response = await fetch('https://api.openai.com/v1/realtime/calls', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.openaiApiKey}`
      },
      body: fd
    });

    const answer = await response.text();
    if (!response.ok) {
      console.error('[realtime-call-error]', { status: response.status, body: answer.slice(0, 500) });
      res.status(response.status).json({ error: { code: 'REALTIME_SESSION_ERROR', userMessage: '실시간 음성 연결에 실패했어요.' } });
      return;
    }

    res.type('application/sdp').send(answer);
  } catch (error) {
    next(error);
  }
});
