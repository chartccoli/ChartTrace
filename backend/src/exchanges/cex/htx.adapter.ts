import axios from 'axios';
import { ExchangeAdapter, Kline } from '../adapter.interface';

const BASE = 'https://api.htx.com';

const INTERVAL_MAP: Record<string, string> = {
  '15m': '15min',
  '1h':  '60min',
  '4h':  '4hour',
  '1d':  '1day',
  '1w':  '1week',
};

export class HtxAdapter implements ExchangeAdapter {
  name = 'htx';
  type = 'CEX' as const;

  normalizeSymbol(s: string): string {
    if (s.endsWith('usdt')) return `${s.slice(0, -4).toUpperCase()}/USDT`;
    return s;
  }

  toExchangeSymbol(s: string): string {
    // BTC/USDT → btcusdt
    return s.replace('/', '').toLowerCase();
  }

  async getKlines(symbol: string, interval: string, limit: number): Promise<Kline[]> {
    const exSym = this.toExchangeSymbol(symbol);
    const period = INTERVAL_MAP[interval] ?? '60min';

    const { data } = await axios.get(`${BASE}/market/history/kline`, {
      params: { symbol: exSym, period, size: Math.min(limit, 500) },
      timeout: 8000,
    });

    if (data?.status !== 'ok' || !data?.data) return [];

    // HTX: [{ id, open, close, low, high, amount, vol, count }]  — 최신이 먼저
    return data.data.reverse().map((k: any) => ({
      openTime: k.id,
      open: k.open,
      high: k.high,
      low: k.low,
      close: k.close,
      volume: k.amount,
      quoteVolume: k.vol,
      takerBuyVolume: 0,
      source: 'htx',
    }));
  }
}
