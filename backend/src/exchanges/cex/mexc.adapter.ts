import axios from 'axios';
import { ExchangeAdapter, Kline } from '../adapter.interface';

const BASE = 'https://api.mexc.com/api/v3';

export class MexcAdapter implements ExchangeAdapter {
  name = 'mexc';
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
    const { data } = await axios.get(`${BASE}/klines`, {
      params: { symbol: exSym, interval, limit: Math.min(limit, 500) },
      timeout: 8000,
    });

    if (!Array.isArray(data)) return [];

    return data.map((k: any) => ({
      openTime: Math.floor(k[0] / 1000),
      open: parseFloat(k[1]),
      high: parseFloat(k[2]),
      low: parseFloat(k[3]),
      close: parseFloat(k[4]),
      volume: parseFloat(k[5]),
      quoteVolume: parseFloat(k[7]),
      takerBuyVolume: parseFloat(k[9]) || 0,
      source: 'mexc',
    }));
  }
}
