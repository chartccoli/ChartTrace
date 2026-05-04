import { BollingerBands, EMA, MACD, RSI } from 'technicalindicators';
import { OHLCV } from './heikinashi';
import { calculateHeikinAshi } from './heikinashi';

export interface SignalDetail {
  key: string;
  label: string;
  weight: number;
  triggered: boolean;
  direction: 'bullish' | 'bearish' | 'neutral';
}

export interface SignalScoreResult {
  score: number;
  level: 'none' | 'weak' | 'medium' | 'strong';
  signals: SignalDetail[];
  direction: 'bullish' | 'bearish' | 'neutral';
}

export interface AggVolSnapshot {
  totalQuoteVolume: number;
  dexRatio: number;
  breakdown: { exchange: string; type: 'CEX' | 'DEX'; quoteVolume: number; share: number }[];
}

// RSI 다이버전스 감지 (강세/약세 각각 SignalDetail 반환)
function detectRSIDivergence(candles: OHLCV[], timeLabel: string): SignalDetail[] {
  const LOOKBACK = 30;
  const HALF = 15;
  const RSI_BUFFER = 3; // 노이즈 필터: RSI 최소 3pt 차이 필요
  if (candles.length < LOOKBACK + 14) return [];

  const slice  = candles.slice(-LOOKBACK);
  const closes = slice.map((c) => c.close);
  const highs  = slice.map((c) => c.high);
  const lows   = slice.map((c) => c.low);

  const rsiVals  = RSI.calculate({ period: 14, values: closes });
  const rsiStart = closes.length - rsiVals.length; // 항상 14

  const getRsi = (i: number): number | null => {
    const ri = i - rsiStart;
    return ri >= 0 ? rsiVals[ri] : null;
  };

  // Window A (older): 0..HALF-1 / Window B (newer): HALF..LOOKBACK-2 (현재봉 제외)
  let minLowA = Infinity,  rsiMinLowA: number | null = null;
  let minLowB = Infinity,  rsiMinLowB: number | null = null;
  let maxHighA = -Infinity, rsiMaxHighA: number | null = null;
  let maxHighB = -Infinity, rsiMaxHighB: number | null = null;

  for (let i = 0; i < HALF; i++) {
    if (lows[i]  < minLowA)  { minLowA  = lows[i];  rsiMinLowA  = getRsi(i); }
    if (highs[i] > maxHighA) { maxHighA = highs[i]; rsiMaxHighA = getRsi(i); }
  }
  for (let i = HALF; i < LOOKBACK - 1; i++) {
    if (lows[i]  < minLowB)  { minLowB  = lows[i];  rsiMinLowB  = getRsi(i); }
    if (highs[i] > maxHighB) { maxHighB = highs[i]; rsiMaxHighB = getRsi(i); }
  }

  const bullish =
    rsiMinLowA !== null && rsiMinLowB !== null &&
    minLowB < minLowA &&                          // 가격: 더 낮은 저점
    rsiMinLowB > rsiMinLowA + RSI_BUFFER;         // RSI: 더 높은 저점

  const bearish =
    rsiMaxHighA !== null && rsiMaxHighB !== null &&
    maxHighB > maxHighA &&                         // 가격: 더 높은 고점
    rsiMaxHighB < rsiMaxHighA - RSI_BUFFER;        // RSI: 더 낮은 고점

  return [
    {
      key: `rsi_bull_div_${timeLabel}`,
      label: `RSI 강세 다이버전스 (${timeLabel})`,
      weight: 3,
      triggered: bullish,
      direction: bullish ? 'bullish' : 'neutral',
    },
    {
      key: `rsi_bear_div_${timeLabel}`,
      label: `RSI 약세 다이버전스 (${timeLabel})`,
      weight: 3,
      triggered: bearish,
      direction: bearish ? 'bearish' : 'neutral',
    },
  ];
}

export function calculateSignalScore(
  candles1h: OHLCV[],
  candles4h: OHLCV[],
  candles1d: OHLCV[],
  rankChange7d: number | null,
  aggVol?: AggVolSnapshot[] // 최근 N봉의 집계 거래량 스냅샷 (선택)
): SignalScoreResult {
  const signals: SignalDetail[] = [];

  // ─── 하이킨아시 반전 (4H) ───
  if (candles4h.length >= 3) {
    const ha4h = calculateHeikinAshi(candles4h);
    const last = ha4h[ha4h.length - 1];
    const bullReversal = last.isReversal === 'bullish';
    const bearReversal = last.isReversal === 'bearish';
    signals.push({
      key: 'ha_4h',
      label: '하이킨아시 반전 (4H)',
      weight: 3,
      triggered: bullReversal || bearReversal,
      direction: bullReversal ? 'bullish' : bearReversal ? 'bearish' : 'neutral',
    });
  }

  // ─── 하이킨아시 반전 (1D) ───
  if (candles1d.length >= 3) {
    const ha1d = calculateHeikinAshi(candles1d);
    const last = ha1d[ha1d.length - 1];
    const bullReversal = last.isReversal === 'bullish';
    const bearReversal = last.isReversal === 'bearish';
    signals.push({
      key: 'ha_1d',
      label: '하이킨아시 반전 (1D)',
      weight: 4,
      triggered: bullReversal || bearReversal,
      direction: bullReversal ? 'bullish' : bearReversal ? 'bearish' : 'neutral',
    });
  }

  // ─── 거래량 이상 (최근 봉 기준) ───
  // ─── 거래량 이상: 합산 거래량 우선, 없으면 Binance 단일 ───
  if (aggVol && aggVol.length >= 21) {
    const qvols = aggVol.map((v) => v.totalQuoteVolume);
    const last20Avg = qvols.slice(-21, -1).reduce((a, b) => a + b, 0) / 20;
    const lastQvol = qvols[qvols.length - 1];
    const spiked = lastQvol > last20Avg * 2;
    const lastCandle = candles4h[candles4h.length - 1];
    const dir = lastCandle?.close > lastCandle?.open ? 'bullish' : 'bearish';
    signals.push({
      key: 'vol_spike',
      label: '합산 거래량 이상 (2배+)',
      weight: 2,
      triggered: spiked,
      direction: spiked ? dir : 'neutral',
    });

    // ─── DEX 거래량 급등 ───
    const dexRatios = aggVol.map((v) => v.dexRatio);
    const prevDexAvg = dexRatios.slice(-6, -1).reduce((a, b) => a + b, 0) / 5;
    const lastDexRatio = dexRatios[dexRatios.length - 1];
    const dexSurge = lastDexRatio > 0.1 && lastDexRatio - prevDexAvg > 0.1;
    signals.push({
      key: 'dex_surge',
      label: 'DEX 거래량 급등',
      weight: 2,
      triggered: dexSurge,
      direction: dexSurge ? 'bullish' : 'neutral',
    });

    // ─── 거래소 간 거래량 쏠림 ───
    const lastBreakdown = aggVol[aggVol.length - 1].breakdown;
    const maxShare = Math.max(...lastBreakdown.map((b) => b.share));
    signals.push({
      key: 'vol_concentration',
      label: '거래량 편중 감지',
      weight: 1,
      triggered: maxShare >= 80,
      direction: 'neutral',
    });
  } else if (candles4h.length >= 21) {
    // fallback: 단일 Binance 거래량
    const vols = candles4h.map((c) => c.volume);
    const last20Avg = vols.slice(-21, -1).reduce((a, b) => a + b, 0) / 20;
    const spiked = vols[vols.length - 1] > last20Avg * 2;
    const lastCandle = candles4h[candles4h.length - 1];
    const dir = lastCandle.close > lastCandle.open ? 'bullish' : 'bearish';
    signals.push({
      key: 'vol_spike',
      label: '거래량 이상 (2배+)',
      weight: 2,
      triggered: spiked,
      direction: spiked ? dir : 'neutral',
    });
  }

  // ─── RSI 과매도 반등 / 과매수 반락 ───
  if (candles4h.length >= 16) {
    const closes = candles4h.map((c) => c.close);
    const rsiValues = RSI.calculate({ period: 14, values: closes });
    if (rsiValues.length >= 2) {
      const prev = rsiValues[rsiValues.length - 2];
      const curr = rsiValues[rsiValues.length - 1];
      const oversoldBounce = prev < 35 && curr > prev;
      const overboughtDrop = prev > 65 && curr < prev;
      signals.push({
        key: 'rsi_oversold',
        label: 'RSI 과매도 반등',
        weight: 2,
        triggered: oversoldBounce,
        direction: oversoldBounce ? 'bullish' : 'neutral',
      });
      signals.push({
        key: 'rsi_overbought',
        label: 'RSI 과매수 반락',
        weight: 2,
        triggered: overboughtDrop,
        direction: overboughtDrop ? 'bearish' : 'neutral',
      });
    }
  }

  // ─── 볼린저 밴드 하단 터치 ───
  if (candles4h.length >= 20) {
    const closes = candles4h.map((c) => c.close);
    const bb = BollingerBands.calculate({ period: 20, values: closes, stdDev: 2 });
    if (bb.length > 0) {
      const lastBB = bb[bb.length - 1];
      const lastClose = closes[closes.length - 1];
      const lowerTouch = lastClose <= lastBB.lower;
      const upperTouch = lastClose >= lastBB.upper;
      signals.push({
        key: 'bb_touch',
        label: '볼린저 밴드 터치',
        weight: 1,
        triggered: lowerTouch || upperTouch,
        direction: lowerTouch ? 'bullish' : upperTouch ? 'bearish' : 'neutral',
      });
    }
  }

  // ─── 불리시 장악형 (Engulfing) ───
  if (candles4h.length >= 2) {
    const c = candles4h[candles4h.length - 1];
    const prev = candles4h[candles4h.length - 2];
    const bullEngulf =
      prev.close < prev.open &&
      c.close > c.open &&
      c.open <= prev.close &&
      c.close >= prev.open;
    const bearEngulf =
      prev.close > prev.open &&
      c.close < c.open &&
      c.open >= prev.close &&
      c.close <= prev.open;
    signals.push({
      key: 'engulfing',
      label: '장악형 캔들',
      weight: 2,
      triggered: bullEngulf || bearEngulf,
      direction: bullEngulf ? 'bullish' : bearEngulf ? 'bearish' : 'neutral',
    });
  }

  // ─── 시총 순위 상승 ───
  if (rankChange7d !== null) {
    const rising = rankChange7d > 2; // 2위 이상 상승
    signals.push({
      key: 'rank_rising',
      label: '시총 순위 상승',
      weight: 1,
      triggered: rising,
      direction: rising ? 'bullish' : 'neutral',
    });
  }

  // ─── RSI 다이버전스 (1H / 4H) ───
  signals.push(...detectRSIDivergence(candles1h, '1H'));
  signals.push(...detectRSIDivergence(candles4h, '4H'));

  // ─── MACD 골든크로스 ───
  if (candles4h.length >= 27) {
    const closes = candles4h.map((c) => c.close);
    const macdResult = MACD.calculate({
      values: closes,
      fastPeriod: 12,
      slowPeriod: 26,
      signalPeriod: 9,
      SimpleMAOscillator: false,
      SimpleMASignal: false,
    });
    if (macdResult.length >= 2) {
      const prev = macdResult[macdResult.length - 2];
      const curr = macdResult[macdResult.length - 1];
      const goldenCross =
        prev.MACD !== undefined &&
        prev.signal !== undefined &&
        curr.MACD !== undefined &&
        curr.signal !== undefined &&
        prev.MACD <= prev.signal &&
        curr.MACD > curr.signal;
      const deathCross =
        prev.MACD !== undefined &&
        prev.signal !== undefined &&
        curr.MACD !== undefined &&
        curr.signal !== undefined &&
        prev.MACD >= prev.signal &&
        curr.MACD < curr.signal;
      signals.push({
        key: 'macd_cross',
        label: 'MACD 크로스',
        weight: 2,
        triggered: goldenCross || deathCross,
        direction: goldenCross ? 'bullish' : deathCross ? 'bearish' : 'neutral',
      });
    }
  }

  // ─── 집계 ───
  const triggeredBullish = signals.filter((s) => s.triggered && s.direction === 'bullish');
  const triggeredBearish = signals.filter((s) => s.triggered && s.direction === 'bearish');

  const bullScore = triggeredBullish.reduce((a, s) => a + s.weight, 0);
  const bearScore = triggeredBearish.reduce((a, s) => a + s.weight, 0);
  const score = Math.max(bullScore, bearScore);
  const direction: 'bullish' | 'bearish' | 'neutral' =
    bullScore > bearScore ? 'bullish' : bearScore > bullScore ? 'bearish' : 'neutral';

  const level: SignalScoreResult['level'] =
    score >= 10 ? 'strong' : score >= 7 ? 'medium' : score >= 4 ? 'weak' : 'none';

  return { score, level, signals, direction };
}
