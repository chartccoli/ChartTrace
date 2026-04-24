import axios from 'axios';
import { ExchangeAdapter, Kline } from '../adapter.interface';

const BASE = 'https://api.upbit.com/v1';

// KRW → USDT 환율 캐시 (1시간 TTL)
let krwRateCache: { rate: number; updatedAt: number } = { rate: 1380, updatedAt: 0 };

async function getKrwUsdRate(): Promise<number> {
  const now = Date.now();
  if (now - krwRateCache.updatedAt < 60 * 60 * 1000) return krwRateCache.rate;

  try {
    // 업비트에서 USDT/KRW 가격 조회
    const { data } = await axios.get(`${BASE}/ticker`, {
      params: { markets: 'KRW-USDT' },
      timeout: 5000,
    });
    if (data?.[0]?.trade_price) {
      krwRateCache = { rate: data[0].trade_price, updatedAt: now };
      return data[0].trade_price;
    }
  } catch {}

  return krwRateCache.rate; // 실패 시 캐시 값 유지
}

// Upbit interval → API path
const UPBIT_PATH: Record<string, string> = {
  '15m': 'candles/minutes/15',
  '1h':  'candles/minutes/60',
  '4h':  'candles/minutes/240',
  '1d':  'candles/days',
  '1w':  'candles/weeks',
};

export class UpbitAdapter implements ExchangeAdapter {
  name = 'upbit';
  type = 'CEX' as const;

  normalizeSymbol(s: string): string {
    // KRW-BTC → BTC/USDT (업비트는 원화 기준)
    const [quote, base] = s.split('-');
    if (quote === 'KRW') return `${base}/USDT`;
    return s;
  }

  toExchangeSymbol(s: string): string {
    // BTC/USDT → KRW-BTC
    const [base] = s.split('/');
    return `KRW-${base}`;
  }

  async getKlines(symbol: string, interval: string, limit: number): Promise<Kline[]> {
    const exSym = this.toExchangeSymbol(symbol);
    const path = UPBIT_PATH[interval] ?? 'candles/minutes/60';
    const krwRate = await getKrwUsdRate();

    const { data } = await axios.get(`${BASE}/${path}`, {
      params: { market: exSym, count: Math.min(limit, 200) },
      headers: { Accept: 'application/json' },
      timeout: 8000,
    });

    if (!Array.isArray(data)) return [];

    // 업비트: candle_date_time_utc, opening_price, high_price, low_price,
    //         trade_price, candle_acc_trade_volume, candle_acc_trade_price
    // 최신이 먼저 → reverse
    return data.reverse().map((k: any) => {
      const quoteVolumeKrw: number = k.candle_acc_trade_price ?? 0;
      return {
        openTime: Math.floor(new Date(k.candle_date_time_utc + 'Z').getTime() / 1000),
        open: k.opening_price,
        high: k.high_price,
        low: k.low_price,
        close: k.trade_price,
        volume: k.candle_acc_trade_volume ?? 0,
        quoteVolume: quoteVolumeKrw / krwRate, // KRW → USDT 환산
        takerBuyVolume: 0,
        source: 'upbit',
      };
    });
  }
}
