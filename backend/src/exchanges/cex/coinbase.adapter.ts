import axios from 'axios';
import { ExchangeAdapter, Kline } from '../adapter.interface';

const BASE = 'https://api.coinbase.com/api/v3/brokerage/market';

// Coinbase Advanced API granularity (seconds)
const GRANULARITY: Record<string, string> = {
  '15m': 'FIFTEEN_MINUTE',
  '1h':  'ONE_HOUR',
  '4h':  'FOUR_HOUR',
  '1d':  'ONE_DAY',
  '1w':  'ONE_WEEK',
};

// interval → seconds (end - start 계산용)
const INTERVAL_SECONDS: Record<string, number> = {
  '15m': 900,
  '1h':  3600,
  '4h':  14400,
  '1d':  86400,
  '1w':  604800,
};

export class CoinbaseAdapter implements ExchangeAdapter {
  name = 'coinbase';
  type = 'CEX' as const;

  normalizeSymbol(s: string): string {
    // BTC-USD → BTC/USDT (USD ≈ USDT)
    return s.replace('-USD', '/USDT').replace('-USDT', '/USDT');
  }

  toExchangeSymbol(s: string): string {
    // BTC/USDT → BTC-USD
    const [base] = s.split('/');
    return `${base}-USD`;
  }

  async getKlines(symbol: string, interval: string, limit: number): Promise<Kline[]> {
    const exSym = this.toExchangeSymbol(symbol);
    const granularity = GRANULARITY[interval] ?? 'ONE_HOUR';
    const intervalSec = INTERVAL_SECONDS[interval] ?? 3600;

    const end = Math.floor(Date.now() / 1000);
    const start = end - intervalSec * Math.min(limit, 300);

    const { data } = await axios.get(`${BASE}/products/${exSym}/candles`, {
      params: { start: String(start), end: String(end), granularity },
      timeout: 8000,
    });

    const candles: any[] = data?.candles ?? [];
    if (!candles.length) return [];

    // Coinbase: { start, low, high, open, close, volume } — 최신이 먼저
    return candles.reverse().map((k: any) => ({
      openTime: parseInt(k.start),
      open: parseFloat(k.open),
      high: parseFloat(k.high),
      low: parseFloat(k.low),
      close: parseFloat(k.close),
      volume: parseFloat(k.volume),
      quoteVolume: parseFloat(k.volume) * parseFloat(k.close), // 근사값
      takerBuyVolume: 0,
      source: 'coinbase',
    }));
  }
}
