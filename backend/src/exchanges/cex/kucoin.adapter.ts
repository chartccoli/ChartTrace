import axios from 'axios';
import { ExchangeAdapter, Kline } from '../adapter.interface';

const BASE = 'https://api.kucoin.com/api/v1/market';

const INTERVAL_MAP: Record<string, string> = {
  '15m': '15min',
  '1h':  '1hour',
  '4h':  '4hour',
  '1d':  '1day',
  '1w':  '1week',
};

// KuCoin max 1500 candles per request, needs startAt/endAt
const INTERVAL_SECONDS: Record<string, number> = {
  '15m': 900,
  '1h':  3600,
  '4h':  14400,
  '1d':  86400,
  '1w':  604800,
};

export class KucoinAdapter implements ExchangeAdapter {
  name = 'kucoin';
  type = 'CEX' as const;

  normalizeSymbol(s: string): string {
    // BTC-USDT → BTC/USDT
    return s.replace('-', '/');
  }

  toExchangeSymbol(s: string): string {
    // BTC/USDT → BTC-USDT
    return s.replace('/', '-');
  }

  async getKlines(symbol: string, interval: string, limit: number): Promise<Kline[]> {
    const exSym = this.toExchangeSymbol(symbol);
    const type = INTERVAL_MAP[interval] ?? '1hour';
    const intervalSec = INTERVAL_SECONDS[interval] ?? 3600;

    const endAt = Math.floor(Date.now() / 1000);
    const startAt = endAt - intervalSec * Math.min(limit, 1500);

    const { data } = await axios.get(`${BASE}/candles`, {
      params: { symbol: exSym, type, startAt, endAt },
      timeout: 8000,
    });

    if (!data?.data) return [];

    // KuCoin: [openTime, open, close, high, low, volume, turnover] — 최신이 먼저
    return (data.data as string[][]).reverse().map((k) => ({
      openTime: parseInt(k[0]),
      open: parseFloat(k[1]),
      high: parseFloat(k[3]),
      low: parseFloat(k[4]),
      close: parseFloat(k[2]),
      volume: parseFloat(k[5]),
      quoteVolume: parseFloat(k[6]),
      takerBuyVolume: 0,
      source: 'kucoin',
    }));
  }
}
