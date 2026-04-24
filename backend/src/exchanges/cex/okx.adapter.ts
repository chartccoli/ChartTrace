import axios from 'axios';
import { ExchangeAdapter, Kline, INTERVAL_MAP } from '../adapter.interface';

const BASE = 'https://www.okx.com/api/v5/market';

export class OKXAdapter implements ExchangeAdapter {
  name = 'okx';
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
    const exInterval = INTERVAL_MAP.okx[interval] ?? interval;
    const { data } = await axios.get(`${BASE}/candles`, {
      params: { instId: exSym, bar: exInterval, limit: Math.min(limit, 300) },
      timeout: 8000,
    });

    if (!data?.data) return [];

    // OKX 반환: [ts, o, h, l, c, vol, volCcy, volCcyQuote, confirm]
    // 최신이 먼저 오므로 reverse
    return data.data.reverse().map((k: string[]) => ({
      openTime: Math.floor(parseInt(k[0]) / 1000),
      open: parseFloat(k[1]),
      high: parseFloat(k[2]),
      low: parseFloat(k[3]),
      close: parseFloat(k[4]),
      volume: parseFloat(k[5]),
      quoteVolume: parseFloat(k[7]),
      takerBuyVolume: 0, // OKX REST에서 미제공
      source: 'okx',
    }));
  }
}
