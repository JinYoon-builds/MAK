import { Router } from 'express';
import { synthesizeSpeech } from '../services/audioService.js';

export const ttsRouter = Router();

ttsRouter.post('/speak', async (req, res, next) => {
  try {
    const text = String(req.body?.text ?? '').trim();
    if (!text) {
      res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'text is required' } });
      return;
    }
    const audio = await synthesizeSpeech(text.slice(0, 2000));
    res.setHeader('Content-Type', 'audio/mpeg');
    res.send(audio);
  } catch (error) {
    next(error);
  }
});
