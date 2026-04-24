import { Router, Request, Response } from 'express';
import NodeCache from 'node-cache';
import { volumeAggregator } from '../exchanges/aggregator';

const router = Router();

// CEX: 1분 캐싱 / DEX 포함 시 5분 캐싱 (The Graph 제한 대응)
const cexCache = new NodeCache({ stdTTL: 60 });
const fullCache = new NodeCache({ stdTTL: 300 });

/**
 * GET /api/volume?symbol=BTC/USDT&interval=4h&limit=500&dex=true
 *
 * dex=false (기본): CEX 전용 — 빠름, 1분 캐시
 * dex=true         : CEX + DEX 통합 — 느림, 5분 캐시
 */
router.get('/', async (req: Request, res: Response) => {
  const {
    symbol = 'BTC/USDT',
    interval = '4h',
    limit = '500',
    dex = 'false',
  } = req.query as Record<string, string>;

  const includeDex = dex === 'true';
  const cacheKey = `vol:${symbol}:${interval}:${limit}:${includeDex}`;
  const cache = includeDex ? fullCache : cexCache;

  const cached = cache.get(cacheKey);
  if (cached) {
    res.json(cached);
    return;
  }

  try {
    const klines = await volumeAggregator.getAggregatedKlines(
      symbol,
      interval,
      parseInt(limit)
    );

    // dex=false 요청 시 DEX 어댑터 결과를 제거
    const filtered = includeDex
      ? klines
      : klines.map((k) => ({
          ...k,
          breakdown: k.breakdown.filter((b) => b.type === 'CEX'),
          dexVolume: 0,
          dexRatio: 0,
          totalQuoteVolume: k.breakdown
            .filter((b) => b.type === 'CEX')
            .reduce((a, b) => a + b.quoteVolume, 0),
        }));

    cache.set(cacheKey, filtered);
    res.json(filtered);
  } catch (err: any) {
    console.error('Volume aggregation error:', err.message);
    res.status(502).json({ error: 'Failed to aggregate volume' });
  }
});

/**
 * GET /api/volume/exchanges — 현재 등록된 거래소 목록
 */
router.get('/exchanges', (_req, res) => {
  res.json([
    { name: 'binance',      type: 'CEX', priority: 1 },
    { name: 'okx',          type: 'CEX', priority: 2 },
    { name: 'bybit',        type: 'CEX', priority: 3 },
    { name: 'upbit',        type: 'CEX', priority: 4 },
    { name: 'coinbase',     type: 'CEX', priority: 5 },
    { name: 'uniswap',      type: 'DEX', priority: 6 },
    { name: 'pancakeswap',  type: 'DEX', priority: 7 },
    { name: 'dydx',         type: 'DEX', priority: 8 },
  ]);
});

export default router;
