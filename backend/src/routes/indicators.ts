import { Router, Request, Response } from 'express';
import axios from 'axios';
import NodeCache from 'node-cache';
import { calculateIndicators } from '../services/indicators';

const router = Router();
const cache = new NodeCache({ stdTTL: 30 });

const BINANCE_BASE = 'https://api.binance.com/api/v3';

// POST /api/indicators
// Body: { symbol, interval, limit, indicators: ['bb', 'ema20', 'rsi', ...] }
router.post('/', async (req: Request, res: Response) => {
  const { symbol, interval, limit = 500, indicators } = req.body;

  if (!symbol || !interval || !Array.isArray(indicators)) {
    res.status(400).json({ error: 'symbol, interval, and indicators array are required' });
    return;
  }

  const cacheKey = `indicators:${symbol}:${interval}:${limit}:${indicators.sort().join(',')}`;
  const cached = cache.get(cacheKey);
  if (cached) {
    res.json(cached);
    return;
  }

  try {
    const response = await axios.get(`${BINANCE_BASE}/klines`, {
      params: { symbol: symbol.toUpperCase(), interval, limit },
      timeout: 10000,
    });

    const candles = response.data.map((k: any) => ({
      time: Math.floor(k[0] / 1000),
      open: parseFloat(k[1]),
      high: parseFloat(k[2]),
      low: parseFloat(k[3]),
      close: parseFloat(k[4]),
      volume: parseFloat(k[5]),
    }));

    const result = calculateIndicators(candles, indicators);
    const payload = { times: candles.map((c: any) => c.time), ...result };

    cache.set(cacheKey, payload);
    res.json(payload);
  } catch (err: any) {
    console.error('Indicators error:', err.message);
    res.status(502).json({ error: 'Failed to calculate indicators' });
  }
});

export default router;
