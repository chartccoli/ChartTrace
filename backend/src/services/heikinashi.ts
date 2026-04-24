export interface OHLCV {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface HeikinAshiCandle extends OHLCV {
  isReversal?: 'bullish' | 'bearish';
}

export function calculateHeikinAshi(candles: OHLCV[]): HeikinAshiCandle[] {
  if (candles.length === 0) return [];

  const haCandles: HeikinAshiCandle[] = [];

  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    const haClose = (c.open + c.high + c.low + c.close) / 4;

    let haOpen: number;
    if (i === 0) {
      // 첫 번째 봉: 실제 OHLC값 그대로 사용
      haOpen = (c.open + c.close) / 2;
    } else {
      const prev = haCandles[i - 1];
      haOpen = (prev.open + prev.close) / 2;
    }

    const haHigh = Math.max(c.high, haOpen, haClose);
    const haLow = Math.min(c.low, haOpen, haClose);

    haCandles.push({
      time: c.time,
      open: haOpen,
      high: haHigh,
      low: haLow,
      close: haClose,
      volume: c.volume,
    });
  }

  // 반전 신호 감지
  for (let i = 1; i < haCandles.length; i++) {
    const prev = haCandles[i - 1];
    const curr = haCandles[i];

    const prevBullish = prev.close > prev.open;
    const currBullish = curr.close > curr.open;
    const prevBearish = prev.close < prev.open;
    const currBearish = curr.close < curr.open;

    const body = Math.abs(curr.close - curr.open);
    const upperWick = curr.high - Math.max(curr.open, curr.close);
    const lowerWick = Math.min(curr.open, curr.close) - curr.low;
    const wickThreshold = body * 0.1; // 꼬리가 몸통의 10% 미만이면 "없는" 것으로 간주

    // 청→적 반전: 직전 청색, 현재 적색, 위꼬리 없음
    if (prevBullish && currBearish && upperWick <= wickThreshold) {
      curr.isReversal = 'bearish';
    }
    // 적→청 반전: 직전 적색, 현재 청색, 아래꼬리 없음
    else if (prevBearish && currBullish && lowerWick <= wickThreshold) {
      curr.isReversal = 'bullish';
    }
  }

  return haCandles;
}
