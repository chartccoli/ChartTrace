import axios from 'axios';
import { ExchangeAdapter, Kline } from '../adapter.interface';

const BASE = 'https://api.hyperliquid.xyz/info';

const INTERVAL_MAP: Record<string, string> = {
  '15m': '15m',
  '1h':  '1h',
  '4h':  '4h',
  '1d':  '1d',
  '1w':  '1w',
};

const INTERVAL_MS: Record<string, number> = {
  '15m': 900_000,
  '1h':  3_600_000,
  '4h':  14_400_000,
  '1d':  86_400_000,
  '1w':  604_800_000,
};

export class HyperliquidAdapter implements ExchangeAdapter {
  name = 'hyperliquid';
  type = 'DEX' as const;

  normalizeSymbol(s: string): string {
    return `${s}/USDT`;
  }

  toExchangeSymbol(s: string): string {
    // BTC/USDT → BTC (coin only)
    return s.split('/')[0];
  }

  async getKlines(symbol: string, interval: string, limit: number): Promise<Kline[]> {
    const coin = this.toExchangeSymbol(symbol);
    const hl_interval = INTERVAL_MAP[interval] ?? '1h';
    const intervalMs = INTERVAL_MS[interval] ?? 3_600_000;

    const endTime = Date.now();
    const startTime = endTime - intervalMs * Math.min(limit, 5000);

    const { data } = await axios.post(
      BASE,
      { type: 'candleSnapshot', req: { coin, interval: hl_interval, startTime, endTime } },
      { timeout: 10000 }
    );

    if (!Array.isArray(data)) return [];

    return data.slice(-limit).map((k: any) => {
      const closePrice = parseFloat(k.c);
      const vol = parseFloat(k.v);
      return {
        openTime: Math.floor(k.t / 1000),
        open: parseFloat(k.o),
        high: parseFloat(k.h),
        low: parseFloat(k.l),
        close: closePrice,
        volume: vol,
        quoteVolume: vol * closePrice,
        takerBuyVolume: 0,
        source: 'hyperliquid',
      };
    });
  }
}
