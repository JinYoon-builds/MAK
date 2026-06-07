import { Router } from 'express';
import { runDialogTurn } from '../services/llmIntentService.js';

export const dialogRouter = Router();

dialogRouter.post('/turn', async (req, res, next) => {
  try {
    const result = await runDialogTurn(req.body ?? {});
    res.json(result);
  } catch (error) {
    next(error);
  }
});
