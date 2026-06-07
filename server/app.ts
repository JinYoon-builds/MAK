import express from 'express';
import cors from 'cors';
import { config } from './config.js';
import { dialogRouter } from './routes/dialog.js';
import { sttRouter } from './routes/stt.js';
import { trainsRouter } from './routes/trains.js';
import { ttsRouter } from './routes/tts.js';
import { realtimeRouter } from './routes/realtime.js';

const app = express();

app.use(cors({ origin: [/^https?:\/\/localhost:\d+$/, /^https?:\/\/127\.0\.0\.1:\d+$/] }));
app.use(express.json({ limit: '12mb' }));

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    models: {
      llm: config.openaiLlmModel,
      stt: config.openaiSttModel,
      tts: config.openaiTtsModel,
      realtimeTranscription: config.openaiRealtimeTranscriptionModel,
      sttProvider: config.sttProvider,
      ttsProvider: config.ttsProvider,
      sttFinalProvider: config.sttFinalProvider
    },
    tagoConfigured: Boolean(config.dataGoKrServiceKey),
    openaiConfigured: Boolean(config.openaiApiKey)
  });
});
app.use('/api/realtime', realtimeRouter);
app.use('/api/dialog', dialogRouter);
app.use('/api/stt', sttRouter);
app.use('/api/tts', ttsRouter);
app.use('/api/trains', trainsRouter);

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const err = error as Error & { status?: number; code?: string };
  const status = err.status || (err.name === 'AbortError' ? 504 : 500);
  const code = err.name === 'AbortError' ? 'TIMEOUT' : err.code || 'PROVIDER_ERROR';
  console.error('[api-error]', { status, code, message: err.message });
  res.status(status).json({
    error: {
      code,
      userMessage: status === 504 ? '조회가 오래 걸리고 있어요. 잠시 후 다시 시도해 주세요.' : '잠시 문제가 생겼어요. 직원이 도와드릴게요.'
    }
  });
});

app.listen(config.port, () => {
  console.log(`MAK API server listening on http://localhost:${config.port}`);
});
