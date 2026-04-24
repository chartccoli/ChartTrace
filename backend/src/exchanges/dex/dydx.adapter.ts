import axios from 'axios';
import { ExchangeAdapter, Kline } from '../adapter.interface';

// dYdX v4 (Cosmos chain) — Public indexer REST API
const BASE = 'https://indexer.dydx.trade/v4';

// dYdX perpetuals 심볼 형식: BTC-USD
const RESOLUTION_MAP: Record<string, string> = {
  '15m': '15MINS',
  '1h':  '1HOUR',
  '4h':  '4HOURS',
  '1d':  '1DAY',
  '1w':  '1WEEK',
};

// dYdX에서 지원하는 심볼 목록 (주요 페어만)
const SUPPORTED: Set<string> = new Set([
  'BTC/USDT', 'ETH/USDT', 'SOL/USDT', 'AVAX/USDT', 'DOGE/USDT',
  'LINK/USDT', 'MATIC/USDT', 'UNI/USDT', 'AAVE/USDT',
]);

export class DydxAdapter implements ExchangeAdapter {
  name = 'dydx';
  type = 'DEX' as const;

  normalizeSymbol(s: string): string {
    // BTC-USD → BTC/USDT
    return s.replace('-USD', '/USDT');
  }

  toExchangeSymbol(s: string): string {
    // BTC/USDT → BTC-USD
    const [base] = s.split('/');
    return `${base}-USD`;
  }

  async getKlines(symbol: string, interval: string, limit: number): Promise<Kline[]> {
    if (!SUPPORTED.has(symbol)) return [];

    const market = this.toExchangeSymbol(symbol);
    const resolution = RESOLUTION_MAP[interval] ?? '1HOUR';

    const { data } = await axios.get(`${BASE}/candles/perpetualMarkets/${market}`, {
      params: { resolution, limit: Math.min(limit, 100) },
      timeout: 8000,
    });

    const candles: any[] = data?.candles ?? [];
    if (!candles.length) return [];

    // dYdX: { startedAt, open, high, low, close, baseTokenVolume, usdVolume }
    // 최신이 먼저 → reverse
    return candles.reverse().map((k: any) => ({
      openTime: Math.floor(new Date(k.startedAt).getTime() / 1000),
      open: parseFloat(k.open),
      high: parseFloat(k.high),
      low: parseFloat(k.low),
      close: parseFloat(k.close),
      volume: parseFloat(k.baseTokenVolume ?? 0),
      quoteVolume: parseFloat(k.usdVolume ?? 0),
      takerBuyVolume: 0,
      source: 'dydx',
    }));
  }
}
