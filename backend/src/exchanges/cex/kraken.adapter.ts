import axios from 'axios';
import { ExchangeAdapter, Kline } from '../adapter.interface';

const BASE = 'https://api.kraken.com/0/public';

// Kraken interval in minutes
const INTERVAL_MAP: Record<string, number> = {
  '15m': 15,
  '1h':  60,
  '4h':  240,
  '1d':  1440,
  '1w':  10080,
};

export class KrakenAdapter implements ExchangeAdapter {
  name = 'kraken';
  type = 'CEX' as const;

  normalizeSymbol(s: string): string {
    return s.replace('XBT', 'BTC').replace('USD', 'USDT');
  }

  toExchangeSymbol(s: string): string {
    // BTC/USDT → XBTUSDT
    const [base, quote] = s.split('/');
    const krakenBase = base === 'BTC' ? 'XBT' : base;
    const krakenQuote = quote === 'USDT' ? 'USDT' : quote;
    return `${krakenBase}${krakenQuote}`;
  }

  async getKlines(symbol: string, interval: string, limit: number): Promise<Kline[]> {
    const pair = this.toExchangeSymbol(symbol);
    const intervalMin = INTERVAL_MAP[interval] ?? 60;
    const since = Math.floor(Date.now() / 1000) - intervalMin * 60 * Math.min(limit, 500);

    const { data } = await axios.get(`${BASE}/OHLC`, {
      params: { pair, interval: intervalMin, since },
      timeout: 8000,
    });

    if (data?.error?.length) return [];

    const result = data?.result ?? {};
    const key = Object.keys(result).find((k) => k !== 'last');
    if (!key) return [];

    const rows: any[][] = result[key];
    // Kraken: [time, open, high, low, close, vwap, volume, count]
    return rows.slice(-limit).map((k) => ({
      openTime: parseInt(k[0]),
      open: parseFloat(k[1]),
      high: parseFloat(k[2]),
      low: parseFloat(k[3]),
      close: parseFloat(k[4]),
      volume: parseFloat(k[6]),
      quoteVolume: parseFloat(k[6]) * parseFloat(k[5]), // volume * vwap
      takerBuyVolume: 0,
      source: 'kraken',
    }));
  }
}
