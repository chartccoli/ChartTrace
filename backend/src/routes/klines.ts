import { Router, Request, Response } from 'express';
import axios from 'axios';
import NodeCache from 'node-cache';
import { calculateHeikinAshi } from '../services/heikinashi';
import { detectPatterns } from '../services/patterns';

const router = Router();
const cache = new NodeCache({ stdTTL: 30 }); // 30초 캐싱

const BINANCE_BASE = 'https://api.binance.com/api/v3';

interface BinanceKline {
  0: number;  // Open time
  1: string;  // Open
  2: string;  // High
  3: string;  // Low
  4: string;  // Close
  5: string;  // Volume
  6: number;  // Close time
  7: string;  // Quote asset volume
  8: number;  // Number of trades
  9: string;  // Taker buy base asset volume
  10: string; // Taker buy quote asset volume
}

// GET /api/klines?symbol=BTCUSDT&interval=4h&limit=500
router.get('/', async (req: Request, res: Response) => {
  const { symbol, interval, limit = '500' } = req.query as Record<string, string>;

  if (!symbol || !interval) {
    res.status(400).json({ error: 'symbol and interval are required' });
    return;
  }

  const cacheKey = `klines:${symbol}:${interval}:${limit}`;
  const cached = cache.get(cacheKey);
  if (cached) {
    res.json(cached);
    return;
  }

  try {
    const response = await axios.get<BinanceKline[]>(`${BINANCE_BASE}/klines`, {
      params: { symbol: symbol.toUpperCase(), interval, limit: parseInt(limit) },
      timeout: 10000,
    });

    const candles = response.data.map((k) => ({
      time: Math.floor(k[0] / 1000),
      open: parseFloat(k[1]),
      high: parseFloat(k[2]),
      low: parseFloat(k[3]),
      close: parseFloat(k[4]),
      volume: parseFloat(k[5]),
      takerBuyVolume: parseFloat(k[9]),
      takerBuyQuoteVolume: parseFloat(k[10]),
    }));

    // 하이킨아시 계산
    const heikinAshi = calculateHeikinAshi(candles);

    // 캔들패턴 감지
    const patterns = detectPatterns(candles);

    const payload = { candles, heikinAshi, patterns };
    cache.set(cacheKey, payload);
    res.json(payload);
  } catch (err: any) {
    console.error('Binance klines error:', err.message);
    res.status(502).json({ error: 'Failed to fetch klines from Binance' });
  }
});

export default router;
