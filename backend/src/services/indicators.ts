import {
  BollingerBands,
  EMA,
  MACD,
  RSI,
  StochasticRSI,
  OBV,
  ATR,
} from 'technicalindicators';
import { OHLCV } from './heikinashi';

export interface IndicatorResult {
  bb?: { upper: number | null; middle: number | null; lower: number | null }[];
  ema20?: (number | null)[];
  ema50?: (number | null)[];
  ema200?: (number | null)[];
  macd?: { macd: number | null; signal: number | null; histogram: number | null }[];
  rsi?: (number | null)[];
  stochRsi?: { k: number | null; d: number | null }[];
  obv?: (number | null)[];
  atr?: (number | null)[];
}

function padArray<T>(arr: T[], totalLength: number, fillValue: T): T[] {
  const padding = new Array(totalLength - arr.length).fill(fillValue);
  return [...padding, ...arr];
}

export function calculateIndicators(candles: OHLCV[], requested: string[]): IndicatorResult {
  const closes = candles.map((c) => c.close);
  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);
  const volumes = candles.map((c) => c.volume);
  const n = candles.length;
  const result: IndicatorResult = {};

  if (requested.includes('bb') && closes.length >= 20) {
    const raw = BollingerBands.calculate({ period: 20, values: closes, stdDev: 2 });
    const nullBB = { upper: null as unknown as number, middle: null as unknown as number, lower: null as unknown as number };
    const padded = padArray(raw, n, nullBB);
    result.bb = padded as IndicatorResult['bb'];
  }

  if (requested.includes('ema20') && closes.length >= 20) {
    const raw = EMA.calculate({ period: 20, values: closes });
    result.ema20 = padArray(raw, n, null);
  }

  if (requested.includes('ema50') && closes.length >= 50) {
    const raw = EMA.calculate({ period: 50, values: closes });
    result.ema50 = padArray(raw, n, null);
  }

  if (requested.includes('ema200') && closes.length >= 200) {
    const raw = EMA.calculate({ period: 200, values: closes });
    result.ema200 = padArray(raw, n, null);
  }

  if (requested.includes('macd') && closes.length >= 26) {
    const raw = MACD.calculate({
      values: closes,
      fastPeriod: 12,
      slowPeriod: 26,
      signalPeriod: 9,
      SimpleMAOscillator: false,
      SimpleMASignal: false,
    });
    const nullMACD = { MACD: null as unknown as number, signal: null as unknown as number, histogram: null as unknown as number };
    const padded = padArray(raw, n, nullMACD);
    result.macd = padded.map((v) => ({
      macd: (v as any).MACD ?? null,
      signal: (v as any).signal ?? null,
      histogram: (v as any).histogram ?? null,
    }));
  }

  if (requested.includes('rsi') && closes.length >= 14) {
    const raw = RSI.calculate({ period: 14, values: closes });
    result.rsi = padArray(raw, n, null);
  }

  if (requested.includes('stochRsi') && closes.length >= 14) {
    const raw = StochasticRSI.calculate({
      values: closes,
      rsiPeriod: 14,
      stochasticPeriod: 14,
      kPeriod: 3,
      dPeriod: 3,
    });
    const nullStoch = { k: null as unknown as number, d: null as unknown as number };
    const padded = padArray(raw, n, nullStoch);
    result.stochRsi = padded as IndicatorResult['stochRsi'];
  }

  if (requested.includes('obv')) {
    const raw = OBV.calculate({ close: closes, volume: volumes });
    result.obv = padArray(raw, n, null);
  }

  if (requested.includes('atr') && candles.length >= 14) {
    const raw = ATR.calculate({ high: highs, low: lows, close: closes, period: 14 });
    result.atr = padArray(raw, n, null);
  }

  return result;
}
