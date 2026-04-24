import { OHLCV } from './heikinashi';

export type PatternType = 'doji' | 'hammer' | 'inverted_hammer' | 'bullish_engulfing' | 'bearish_engulfing';

export interface PatternResult {
  time: number;
  pattern: PatternType;
  direction: 'bullish' | 'bearish' | 'neutral';
}

function isBearishTrend(candles: OHLCV[], index: number, lookback = 5): boolean {
  if (index < lookback) return false;
  const slice = candles.slice(index - lookback, index);
  return slice[0].close > slice[slice.length - 1].close;
}

function isBullishTrend(candles: OHLCV[], index: number, lookback = 5): boolean {
  if (index < lookback) return false;
  const slice = candles.slice(index - lookback, index);
  return slice[0].close < slice[slice.length - 1].close;
}

export function detectPatterns(candles: OHLCV[]): PatternResult[] {
  const results: PatternResult[] = [];

  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    const prev = candles[i - 1];

    const body = Math.abs(c.close - c.open);
    const range = c.high - c.low;
    const upperWick = c.high - Math.max(c.open, c.close);
    const lowerWick = Math.min(c.open, c.close) - c.low;

    if (range === 0) continue;

    // 도지 (Doji): 몸통이 전체 범위의 10% 미만
    if (body / range < 0.1) {
      results.push({ time: c.time, pattern: 'doji', direction: 'neutral' });
      continue;
    }

    // 망치형 (Hammer): 아래꼬리 > 몸통 * 2, 위꼬리 거의 없음, 하락 추세 후
    if (
      lowerWick > body * 2 &&
      upperWick < body * 0.3 &&
      isBearishTrend(candles, i)
    ) {
      results.push({ time: c.time, pattern: 'hammer', direction: 'bullish' });
      continue;
    }

    // 역망치형 (Inverted Hammer): 위꼬리 > 몸통 * 2, 아래꼬리 거의 없음, 하락 추세 후
    if (
      upperWick > body * 2 &&
      lowerWick < body * 0.3 &&
      isBearishTrend(candles, i)
    ) {
      results.push({ time: c.time, pattern: 'inverted_hammer', direction: 'bullish' });
      continue;
    }

    // 불리시 장악형 (Bullish Engulfing): 직전 적색, 현재 청색이 완전히 감싸는 경우
    if (
      prev.close < prev.open &&
      c.close > c.open &&
      c.open <= prev.close &&
      c.close >= prev.open
    ) {
      results.push({ time: c.time, pattern: 'bullish_engulfing', direction: 'bullish' });
      continue;
    }

    // 베어리시 장악형 (Bearish Engulfing): 직전 청색, 현재 적색이 완전히 감싸는 경우
    if (
      prev.close > prev.open &&
      c.close < c.open &&
      c.open >= prev.close &&
      c.close <= prev.open
    ) {
      results.push({ time: c.time, pattern: 'bearish_engulfing', direction: 'bearish' });
      continue;
    }
  }

  return results;
}
