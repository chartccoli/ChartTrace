import axios from 'axios';
import { ExchangeAdapter, Kline, INTERVAL_MAP } from '../adapter.interface';

const BASE = 'https://api.bybit.com/v5/market';

export class BybitAdapter implements ExchangeAdapter {
  name = 'bybit';
  type = 'CEX' as const;

  normalizeSymbol(s: string): string {
    if (s.endsWith('USDT')) return `${s.slice(0, -4)}/USDT`;
    return s;
  }

  toExchangeSymbol(s: string): string {
    return s.replace('/', '');
  }

  async getKlines(symbol: string, interval: string, limit: number): Promise<Kline[]> {
    const exSym = this.toExchangeSymbol(symbol);
    const exInterval = INTERVAL_MAP.bybit[interval] ?? interval;
    const { data } = await axios.get(`${BASE}/kline`, {
      params: { category: 'spot', symbol: exSym, interval: exInterval, limit: Math.min(limit, 200) },
      timeout: 8000,
    });

    const list: any[][] = data?.result?.list ?? [];
    if (!list.length) return [];

    // Bybit: [startTime, open, high, low, close, volume, turnover] — 최신이 먼저
    return list.reverse().map((k) => ({
      openTime: Math.floor(parseInt(k[0]) / 1000),
      open: parseFloat(k[1]),
      high: parseFloat(k[2]),
      low: parseFloat(k[3]),
      close: parseFloat(k[4]),
      volume: parseFloat(k[5]),
      quoteVolume: parseFloat(k[6]),
      takerBuyVolume: 0,
      source: 'bybit',
    }));
  }
}
