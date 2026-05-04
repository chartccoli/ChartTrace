import axios from 'axios';
import { ExchangeAdapter, Kline } from '../adapter.interface';

const BASE = 'https://api.bitget.com/api/v2/spot/market';

const INTERVAL_MAP: Record<string, string> = {
  '15m': '15min',
  '1h':  '1h',
  '4h':  '4h',
  '1d':  '1day',
  '1w':  '1week',
};

export class BitgetAdapter implements ExchangeAdapter {
  name = 'bitget';
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
    const granularity = INTERVAL_MAP[interval] ?? '1h';

    const { data } = await axios.get(`${BASE}/candles`, {
      params: { symbol: exSym, granularity, limit: Math.min(limit, 1000) },
      timeout: 8000,
    });

    if (!data?.data) return [];

    // Bitget: [[ts_ms, open, high, low, close, baseVol, quoteVol], ...] — 최신이 먼저
    return (data.data as string[][]).reverse().map((k) => ({
      openTime: Math.floor(parseInt(k[0]) / 1000),
      open: parseFloat(k[1]),
      high: parseFloat(k[2]),
      low: parseFloat(k[3]),
      close: parseFloat(k[4]),
      volume: parseFloat(k[5]),
      quoteVolume: parseFloat(k[6]),
      takerBuyVolume: 0,
      source: 'bitget',
    }));
  }
}
