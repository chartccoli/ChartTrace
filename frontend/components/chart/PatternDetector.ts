import { Candle, PatternResult } from '@/lib/binance';

export function detectPatterns(candles: Candle[]): PatternResult[] {
  const results: PatternResult[] = [];

  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    const prev = candles[i - 1];
    const body = Math.abs(c.close - c.open);
    const range = c.high - c.low;
    const upperWick = c.high - Math.max(c.open, c.close);
    const lowerWick = Math.min(c.open, c.close) - c.low;

    if (range === 0) continue;

    if (body / range < 0.1) {
      results.push({ time: c.time, pattern: 'doji', direction: 'neutral' });
      continue;
    }

    if (lowerWick > body * 2 && upperWick < body * 0.3) {
      results.push({ time: c.time, pattern: 'hammer', direction: 'bullish' });
      continue;
    }

    if (upperWick > body * 2 && lowerWick < body * 0.3) {
      results.push({ time: c.time, pattern: 'inverted_hammer', direction: 'bullish' });
      continue;
    }

    if (
      prev.close < prev.open &&
      c.close > c.open &&
      c.open <= prev.close &&
      c.close >= prev.open
    ) {
      results.push({ time: c.time, pattern: 'bullish_engulfing', direction: 'bullish' });
      continue;
    }

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

export function patternLabel(pattern: string): string {
  const map: Record<string, string> = {
    doji: 'Doji',
    hammer: 'Hammer',
    inverted_hammer: 'Inv. Hammer',
    bullish_engulfing: 'Bull. Engulf',
    bearish_engulfing: 'Bear. Engulf',
  };
  return map[pattern] ?? pattern;
}
