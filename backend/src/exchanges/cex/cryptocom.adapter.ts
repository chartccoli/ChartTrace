import axios from 'axios';
import { ExchangeAdapter, Kline } from '../adapter.interface';

const BASE = 'https://api.crypto.com/exchange/v1/public';

const INTERVAL_MAP: Record<string, string> = {
  '15m': 'M15',
  '1h':  'H1',
  '4h':  'H4',
  '1d':  'D1',
  '1w':  '1W',
};

export class CryptocomAdapter implements ExchangeAdapter {
  name = 'cryptocom';
  type = 'CEX' as const;

  normalizeSymbol(s: string): string {
    return s.replace('_', '/');
  }

  toExchangeSymbol(s: string): string {
    // BTC/USDT → BTC_USDT
    return s.replace('/', '_');
  }

  async getKlines(symbol: string, interval: string, limit: number): Promise<Kline[]> {
    const instrumentName = this.toExchangeSymbol(symbol);
    const timeframe = INTERVAL_MAP[interval] ?? 'H1';

    const { data } = await axios.get(`${BASE}/get-candlestick`, {
      params: { instrument_name: instrumentName, timeframe, count: Math.min(limit, 300) },
      timeout: 8000,
    });

    const candles: any[] = data?.result?.data ?? [];
    if (!candles.length) return [];

    // Crypto.com: { t: ts_ms, o, h, l, c, v } — 오래된 순 정렬됨
    return candles.map((k) => ({
      openTime: Math.floor(k.t / 1000),
      open: parseFloat(k.o),
      high: parseFloat(k.h),
      low: parseFloat(k.l),
      close: parseFloat(k.c),
      volume: parseFloat(k.v),
      quoteVolume: parseFloat(k.v) * parseFloat(k.c),
      takerBuyVolume: 0,
      source: 'cryptocom',
    }));
  }
}
