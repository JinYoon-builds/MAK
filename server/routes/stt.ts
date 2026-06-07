import { Router } from 'express';
import { transcribeBase64Audio } from '../services/audioService.js';

export const sttRouter = Router();

sttRouter.post('/transcribe', async (req, res, next) => {
  try {
    const { audioBase64, mimeType, filename } = req.body ?? {};
    if (!audioBase64 || typeof audioBase64 !== 'string') {
      res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'audioBase64 is required' } });
      return;
    }
    const result = await transcribeBase64Audio({ audioBase64, mimeType, filename });
    res.json(result);
  } catch (error) {
    next(error);
  }
});
