import axios from 'axios';
import { ExchangeAdapter, Kline, VolumeSnapshot, INTERVAL_MAP } from '../adapter.interface';

const BASE = 'https://api.binance.com/api/v3';

export class BinanceAdapter implements ExchangeAdapter {
  name = 'binance';
  type = 'CEX' as const;

  normalizeSymbol(s: string): string {
    // BTCUSDT → BTC/USDT
    if (s.endsWith('USDT')) return `${s.slice(0, -4)}/USDT`;
    if (s.endsWith('BTC'))  return `${s.slice(0, -3)}/BTC`;
    return s;
  }

  toExchangeSymbol(s: string): string {
    // BTC/USDT → BTCUSDT
    return s.replace('/', '');
  }

  async getKlines(symbol: string, interval: string, limit: number): Promise<Kline[]> {
    const exSym = this.toExchangeSymbol(symbol);
    const exInterval = INTERVAL_MAP.binance[interval] ?? interval;
    const { data } = await axios.get(`${BASE}/klines`, {
      params: { symbol: exSym, interval: exInterval, limit },
      timeout: 8000,
    });
    return data.map((k: any) => ({
      openTime: Math.floor(k[0] / 1000),
      open: parseFloat(k[1]),
      high: parseFloat(k[2]),
      low: parseFloat(k[3]),
      close: parseFloat(k[4]),
      volume: parseFloat(k[5]),
      quoteVolume: parseFloat(k[7]),
      takerBuyVolume: parseFloat(k[9]),
      source: 'binance',
    }));
  }
}
