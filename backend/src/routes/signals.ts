import { Router, Request, Response } from 'express';
import axios from 'axios';
import NodeCache from 'node-cache';
import { calculateSignalScore } from '../services/signalScore';
import { getRankChange7d } from './rankings';
import { volumeAggregator } from '../exchanges/aggregator';

const router = Router();
const cache = new NodeCache({ stdTTL: 60 }); // 1분 캐싱

const BINANCE_BASE = 'https://api.binance.com/api/v3';

async function fetchBinanceKlines(symbol: string, interval: string, limit = 100) {
  const response = await axios.get(`${BINANCE_BASE}/klines`, {
    params: { symbol: symbol.toUpperCase(), interval, limit },
    timeout: 10000,
  });
  return response.data.map((k: any) => ({
    time: Math.floor(k[0] / 1000),
    open: parseFloat(k[1]),
    high: parseFloat(k[2]),
    low: parseFloat(k[3]),
    close: parseFloat(k[4]),
    volume: parseFloat(k[5]),
  }));
}

// GET /api/signals/:symbol
// 예: /api/signals/BTCUSDT
router.get('/:symbol', async (req: Request, res: Response) => {
  const symbol = (req.params.symbol as string).toUpperCase();
  const cacheKey = `signals:${symbol}`;
  const cached = cache.get(cacheKey);
  if (cached) {
    res.json(cached);
    return;
  }

  try {
    // BTC/USDT 형식으로 변환 (aggregator 표준 심볼)
    const stdSymbol = symbol.endsWith('USDT')
      ? `${symbol.slice(0, -4)}/USDT`
      : symbol as string;

    const [candles1h, candles4h, candles1d, aggKlines] = await Promise.all([
      fetchBinanceKlines(symbol as string, '1h', 100),
      fetchBinanceKlines(symbol as string, '4h', 100),
      fetchBinanceKlines(symbol as string, '1d', 60),
      // 집계 거래량 (CEX 전용 — 속도 우선, 실패해도 무시)
      volumeAggregator.getAggregatedKlines(stdSymbol, '4h', 30).catch(() => []),
    ]);

    const rankChange = getRankChange7d(symbol as string);
    const aggVol = aggKlines.length > 0
      ? aggKlines.map((k) => ({
          timestamp: k.timestamp,
          totalQuoteVolume: k.totalQuoteVolume,
          dexRatio: k.dexRatio,
          breakdown: k.breakdown,
        }))
      : undefined;

    const result = calculateSignalScore(candles1h, candles4h, candles1d, rankChange, aggVol);

    cache.set(cacheKey, result);
    res.json(result);
  } catch (err: any) {
    console.error(`Signal score error for ${symbol}:`, err.message);
    res.status(502).json({ error: 'Failed to calculate signal score' });
  }
});

// GET /api/signals — 시총 Top 50 전체 스코어 (배치)
router.get('/', async (req: Request, res: Response) => {
  const { symbols } = req.query as { symbols?: string };
  if (!symbols) {
    res.status(400).json({ error: 'symbols query param required (comma-separated)' });
    return;
  }

  const symList = symbols.split(',').slice(0, 200);
  const cacheKey = `signals:batch:${symList.sort().join(',')}`;
  const cached = cache.get(cacheKey);
  if (cached) {
    res.json(cached);
    return;
  }

  const results: Record<string, any> = {};

  // 병렬로 가져오되 에러 무시
  await Promise.allSettled(
    symList.map(async (sym) => {
      const single = cache.get(`signals:${sym}`);
      if (single) {
        results[sym] = single;
        return;
      }
      try {
        const [candles1h, candles4h, candles1d] = await Promise.all([
          fetchBinanceKlines(sym.trim(), '1h', 100),
          fetchBinanceKlines(sym.trim(), '4h', 100),
          fetchBinanceKlines(sym.trim(), '1d', 60),
        ]);
        const rankChange = getRankChange7d(sym);
        results[sym] = calculateSignalScore(candles1h, candles4h, candles1d, rankChange);
      } catch {
        results[sym] = { score: 0, level: 'none', signals: [], direction: 'neutral' };
      }
    })
  );

  cache.set(cacheKey, results, 180); // 배치는 3분 캐싱
  res.json(results);
});

export default router;
