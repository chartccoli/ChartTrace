export interface Kline {
  openTime: number;      // Unix seconds
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;        // 코인 기준 거래량
  quoteVolume: number;   // USDT 기준 거래대금
  takerBuyVolume: number;
  source: string;        // 거래소 식별자
}

export interface VolumeSnapshot {
  symbol: string;        // 내부 표준 심볼 (예: BTC/USDT)
  exchange: string;
  volume: number;
  quoteVolume: number;
  timestamp: number;
}

export interface AggregatedVolume {
  timestamp: number;
  totalVolume: number;
  totalQuoteVolume: number;
  breakdown: {
    exchange: string;
    type: 'CEX' | 'DEX';
    volume: number;
    quoteVolume: number;
    share: number;         // 전체 대비 % (quoteVolume 기준)
  }[];
  cexVolume: number;
  dexVolume: number;
  dexRatio: number;        // DEX / Total (0~1)
}

export interface ExchangeAdapter {
  name: string;
  type: 'CEX' | 'DEX';

  /** 거래소 심볼 → 내부 표준 심볼 (BTC/USDT 형식) 변환 */
  normalizeSymbol(exchangeSymbol: string): string;

  /** 내부 표준 심볼 → 거래소 심볼 변환 */
  toExchangeSymbol(standardSymbol: string): string;

  /** OHLCV 반환 (내부 표준 포맷) */
  getKlines(symbol: string, interval: string, limit: number): Promise<Kline[]>;

  /** 실시간 거래량 스트림 구독 (선택 구현) */
  subscribeVolume?(symbol: string, callback: (vol: VolumeSnapshot) => void): void;
  unsubscribeVolume?(symbol: string): void;
}

/** 거래소별 interval 표기 정규화 */
export const INTERVAL_MAP: Record<string, Record<string, string>> = {
  binance: { '15m': '15m', '1h': '1h', '4h': '4h', '1d': '1d', '1w': '1w' },
  okx:     { '15m': '15m', '1h': '1H', '4h': '4H', '1d': '1Dutc', '1w': '1Wutc' },
  bybit:   { '15m': '15', '1h': '60', '4h': '240', '1d': 'D', '1w': 'W' },
  upbit:   { '15m': 'minutes/15', '1h': 'minutes/60', '4h': 'minutes/240', '1d': 'days', '1w': 'weeks' },
  coinbase:{ '15m': 'FIFTEEN_MINUTE', '1h': 'ONE_HOUR', '4h': 'FOUR_HOUR', '1d': 'ONE_DAY', '1w': 'ONE_WEEK' },
};
