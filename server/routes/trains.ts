import { Router } from 'express';
import { listStations, listVehicleKinds, searchTrains } from '../services/trainSearchService.js';

export const trainsRouter = Router();

trainsRouter.get('/stations', async (_req, res, next) => {
  try {
    const stations = await listStations();
    res.json({ stations });
  } catch (error) {
    next(error);
  }
});

trainsRouter.get('/vehicles', async (_req, res, next) => {
  try {
    const vehicles = await listVehicleKinds();
    res.json({ vehicles });
  } catch (error) {
    next(error);
  }
});

trainsRouter.post('/search', async (req, res, next) => {
  try {
    const candidates = await searchTrains(req.body?.intent ?? req.body ?? {});
    if (candidates.length === 0) {
      res.status(404).json({ error: { code: 'NO_TRAINS', userMessage: '조건에 맞는 기차를 찾지 못했어요.' } });
      return;
    }
    res.json({ candidates });
  } catch (error) {
    next(error);
  }
});
