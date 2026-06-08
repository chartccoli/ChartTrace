import { Router, Request, Response } from 'express';
import { getAggregatedFutures } from '../exchanges/futuresAggregator';

const router = Router();

/**
 * GET /api/futures?symbol=BTC/USDT&interval=4h&limit=200
 *
 * 펀딩비(OI 가중 일일 %) + 미결제약정(USD) 집계
 * 거래소: Binance, Bybit, OKX, Bitget, Hyperliquid
 */
router.get('/', async (req: Request, res: Response) => {
  const {
    symbol   = 'BTC/USDT',
    interval = '4h',
    limit    = '200',
  } = req.query as Record<string, string>;

  try {
    const data = await getAggregatedFutures(symbol, interval, parseInt(limit));
    res.json(data);
  } catch (err: any) {
    console.error('Futures aggregation error:', err.message);
    res.status(502).json({ error: 'Failed to aggregate futures data' });
  }
});

export default router;
