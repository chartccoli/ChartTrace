import axios from 'axios';
import { ExchangeAdapter, Kline } from '../adapter.interface';

const BASE = 'https://api.gateio.ws/api/v4/spot';

const INTERVAL_MAP: Record<string, string> = {
  '15m': '15m',
  '1h':  '1h',
  '4h':  '4h',
  '1d':  '1d',
  '1w':  '7d',
};

export class GateioAdapter implements ExchangeAdapter {
  name = 'gateio';
  type = 'CEX' as const;

  normalizeSymbol(s: string): string {
    // BTC_USDT → BTC/USDT
    return s.replace('_', '/');
  }

  toExchangeSymbol(s: string): string {
    // BTC/USDT → BTC_USDT
    return s.replace('/', '_');
  }

  async getKlines(symbol: string, interval: string, limit: number): Promise<Kline[]> {
    const currencyPair = this.toExchangeSymbol(symbol);
    const intervalStr = INTERVAL_MAP[interval] ?? '1h';

    const { data } = await axios.get(`${BASE}/candlesticks`, {
      params: { currency_pair: currencyPair, interval: intervalStr, limit: Math.min(limit, 1000) },
      timeout: 8000,
    });

    if (!Array.isArray(data)) return [];

    // Gate.io: [timestamp_sec, volume, close, high, low, open, quoteVolume, is_closed]
    return data.map((k: any) => ({
      openTime: parseInt(k[0]),
      open: parseFloat(k[5]),
      high: parseFloat(k[3]),
      low: parseFloat(k[4]),
      close: parseFloat(k[2]),
      volume: parseFloat(k[1]),
      quoteVolume: parseFloat(k[6]),
      takerBuyVolume: 0,
      source: 'gateio',
    }));
  }
}
