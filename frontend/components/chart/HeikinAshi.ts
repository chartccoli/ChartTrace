import { Candle, HeikinAshiCandle } from '@/lib/binance';

export function calculateHeikinAshi(candles: Candle[]): HeikinAshiCandle[] {
  if (candles.length === 0) return [];

  const result: HeikinAshiCandle[] = [];

  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    const haClose = (c.open + c.high + c.low + c.close) / 4;

    let haOpen: number;
    if (i === 0) {
      haOpen = (c.open + c.close) / 2;
    } else {
      const prev = result[i - 1];
      haOpen = (prev.open + prev.close) / 2;
    }

    const haHigh = Math.max(c.high, haOpen, haClose);
    const haLow = Math.min(c.low, haOpen, haClose);

    result.push({
      ...c,
      open: haOpen,
      high: haHigh,
      low: haLow,
      close: haClose,
    });
  }

  // 반전 신호 감지
  for (let i = 1; i < result.length; i++) {
    const prev = result[i - 1];
    const curr = result[i];
    const body = Math.abs(curr.close - curr.open);
    const upperWick = curr.high - Math.max(curr.open, curr.close);
    const lowerWick = Math.min(curr.open, curr.close) - curr.low;
    const threshold = body * 0.1;

    if (prev.close > prev.open && curr.close < curr.open && upperWick <= threshold) {
      curr.isReversal = 'bearish';
    } else if (prev.close < prev.open && curr.close > curr.open && lowerWick <= threshold) {
      curr.isReversal = 'bullish';
    }
  }

  return result;
}
