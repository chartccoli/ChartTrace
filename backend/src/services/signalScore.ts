import { BollingerBands, EMA, MACD, RSI } from 'technicalindicators';
import { OHLCV } from './heikinashi';
import { calculateHeikinAshi } from './heikinashi';

// ── 인터페이스 ──────────────────────────────────────────────────────────────

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
  timestamp: number;
  totalQuoteVolume: number;
  dexRatio: number;
  breakdown: { exchange: string; type: 'CEX' | 'DEX'; quoteVolume: number; share: number }[];
}

export interface FRSnapshot {
  timestamp: number;
  fundingRateDailyPct: number;
}

// ── 유틸 ────────────────────────────────────────────────────────────────────

function simpleSMA(values: number[], period: number): number[] {
  const result: number[] = [];
  for (let i = period - 1; i < values.length; i++) {
    const slice = values.slice(i - period + 1, i + 1);
    result.push(slice.reduce((a, b) => a + b, 0) / period);
  }
  return result;
}

// StochRSI 수동 계산 (rsiPeriod=14, stochPeriod=14, smoothK=3, smoothD=3)
function calcStochRSI(
  closes: number[],
  rsiPeriod = 14,
  stochPeriod = 14,
  smoothK = 3,
  smoothD = 3
): { k: number; d: number }[] {
  const rsi = RSI.calculate({ period: rsiPeriod, values: closes });
  if (rsi.length < stochPeriod + smoothK + smoothD - 2) return [];
  const rawK: number[] = [];
  for (let i = stochPeriod - 1; i < rsi.length; i++) {
    const win = rsi.slice(i - stochPeriod + 1, i + 1);
    const lo = Math.min(...win);
    const hi = Math.max(...win);
    rawK.push(hi === lo ? 50 : ((rsi[i] - lo) / (hi - lo)) * 100);
  }
  const kLine = simpleSMA(rawK, smoothK);
  const dLine = simpleSMA(kLine, smoothD);
  const off = kLine.length - dLine.length;
  return dLine.map((d, i) => ({ k: kLine[i + off], d }));
}

// 타임프레임 편향 — EMA20 위치 + RSI50 + MACD 히스토그램 다수결(2/3)
function timeframeBias(candles: OHLCV[]): 'bullish' | 'bearish' | 'neutral' {
  if (candles.length < 22) return 'neutral';
  const closes = candles.map((c) => c.close);
  const last = closes[closes.length - 1];

  const ema20 = EMA.calculate({ period: 20, values: closes });
  const aboveEMA = ema20.length > 0 && last > ema20[ema20.length - 1];

  const rsi = RSI.calculate({ period: 14, values: closes });
  const rsiUp = rsi.length > 0 && rsi[rsi.length - 1] > 50;

  let macdUp = false;
  if (closes.length >= 27) {
    const m = MACD.calculate({ values: closes, fastPeriod: 12, slowPeriod: 26, signalPeriod: 9,
      SimpleMAOscillator: false, SimpleMASignal: false });
    if (m.length > 0) macdUp = (m[m.length - 1].histogram ?? 0) > 0;
  }

  const bullCount = [aboveEMA, rsiUp, macdUp].filter(Boolean).length;
  return bullCount >= 2 ? 'bullish' : bullCount === 0 ? 'bearish' : 'neutral';
}

// ── 신호 감지 함수들 ─────────────────────────────────────────────────────────

// RSI 다이버전스
function detectRSIDivergence(candles: OHLCV[], timeLabel: string): SignalDetail[] {
  const LOOKBACK = 30;
  const HALF = 15;
  const RSI_BUFFER = 3;
  if (candles.length < LOOKBACK + 14) return [];

  const slice = candles.slice(-LOOKBACK);
  const highs = slice.map((c) => c.high);
  const lows  = slice.map((c) => c.low);
  const allRsi = RSI.calculate({ period: 14, values: candles.map((c) => c.close) });
  const rsiSlice = allRsi.slice(-LOOKBACK);
  const getRsi = (i: number): number | null => rsiSlice[i] ?? null;

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

  const bullish = rsiMinLowA !== null && rsiMinLowB !== null &&
    minLowB < minLowA && rsiMinLowB > rsiMinLowA + RSI_BUFFER;
  const bearish = rsiMaxHighA !== null && rsiMaxHighB !== null &&
    maxHighB > maxHighA && rsiMaxHighB < rsiMaxHighA - RSI_BUFFER;

  return [
    { key: `rsi_bull_div_${timeLabel}`, label: `RSI 강세 다이버전스 (${timeLabel})`,
      weight: 3, triggered: bullish, direction: bullish ? 'bullish' : 'neutral' },
    { key: `rsi_bear_div_${timeLabel}`, label: `RSI 약세 다이버전스 (${timeLabel})`,
      weight: 3, triggered: bearish, direction: bearish ? 'bearish' : 'neutral' },
  ];
}

// OBV 다이버전스
function detectOBVDivergence(candles4h: OHLCV[], aggVol: AggVolSnapshot[]): SignalDetail[] {
  const LOOKBACK = 30;
  const HALF = 15;
  const OBV_BUFFER_PCT = 0.03;
  if (candles4h.length < LOOKBACK) return [];

  const aggMap = new Map<number, number>();
  aggVol.forEach((k) => aggMap.set(k.timestamp, k.totalQuoteVolume));

  const allOBV: number[] = [];
  let obv = 0;
  for (let i = 0; i < candles4h.length; i++) {
    const c = candles4h[i];
    const vol = aggMap.get(c.time) ?? c.volume;
    if (i === 0) { obv = vol; }
    else { obv += c.close > candles4h[i - 1].close ? vol : c.close < candles4h[i - 1].close ? -vol : 0; }
    allOBV.push(obv);
  }

  const sliceC = candles4h.slice(-LOOKBACK);
  const sliceO = allOBV.slice(-LOOKBACK);
  const highs = sliceC.map((c) => c.high);
  const lows  = sliceC.map((c) => c.low);

  let minLowA = Infinity, obvMinLowA = Infinity;
  let minLowB = Infinity, obvMinLowB = Infinity;
  let maxHighA = -Infinity, obvMaxHighA = -Infinity;
  let maxHighB = -Infinity, obvMaxHighB = -Infinity;

  for (let i = 0; i < HALF; i++) {
    if (lows[i]  < minLowA)  { minLowA  = lows[i];  obvMinLowA  = sliceO[i]; }
    if (highs[i] > maxHighA) { maxHighA = highs[i]; obvMaxHighA = sliceO[i]; }
  }
  for (let i = HALF; i < LOOKBACK - 1; i++) {
    if (lows[i]  < minLowB)  { minLowB  = lows[i];  obvMinLowB  = sliceO[i]; }
    if (highs[i] > maxHighB) { maxHighB = highs[i]; obvMaxHighB = sliceO[i]; }
  }

  const obvScale = Math.abs(obv) || 1;
  const bullish = minLowB < minLowA && obvMinLowB > obvMinLowA &&
    (obvMinLowB - obvMinLowA) / obvScale > OBV_BUFFER_PCT;
  const bearish = maxHighB > maxHighA && obvMaxHighB < obvMaxHighA &&
    (obvMaxHighA - obvMaxHighB) / obvScale > OBV_BUFFER_PCT;

  return [
    { key: 'obv_bull_div', label: 'OBV 강세 다이버전스',
      weight: 2, triggered: bullish, direction: bullish ? 'bullish' : 'neutral' },
    { key: 'obv_bear_div', label: 'OBV 약세 다이버전스',
      weight: 2, triggered: bearish, direction: bearish ? 'bearish' : 'neutral' },
  ];
}

// BB 스퀴즈 — 밴드폭이 최근 50봉 하위 20% = 에너지 압축. 돌파 시작 시 방향 결정
function detectBBSqueeze(candles4h: OHLCV[]): SignalDetail[] {
  if (candles4h.length < 70) return [];
  const closes = candles4h.map((c) => c.close);
  const bb = BollingerBands.calculate({ period: 20, values: closes, stdDev: 2 });
  if (bb.length < 52) return [];

  const widths = bb.map((b) => (b.upper - b.lower) / b.middle);
  const recent50 = widths.slice(-50);
  const sorted = [...recent50].sort((a, b) => a - b);
  const p20 = sorted[Math.floor(sorted.length * 0.2)];

  const curr = widths[widths.length - 1];
  const prev = widths[widths.length - 2];
  const inSqueeze = curr <= p20;
  // 돌파: 이전 봉보다 5% 이상 확장 = 스퀴즈 해제 시작
  const expanding = curr > prev * 1.05;
  const lastClose = closes[closes.length - 1];
  const midline   = bb[bb.length - 1].middle;

  const bullBreak = inSqueeze && expanding && lastClose > midline;
  const bearBreak = inSqueeze && expanding && lastClose <= midline;

  return [{
    key: 'bb_squeeze',
    label: bullBreak ? 'BB 스퀴즈 상향 돌파' : bearBreak ? 'BB 스퀴즈 하향 돌파' : 'BB 스퀴즈 (압축 중)',
    weight: (bullBreak || bearBreak) ? 3 : 1,
    triggered: inSqueeze,
    direction: bullBreak ? 'bullish' : bearBreak ? 'bearish' : 'neutral',
  }];
}

// StochRSI — 과매도/과매수 구간에서 K가 D를 돌파하는 순간
function detectStochRSI(candles: OHLCV[], label: string): SignalDetail[] {
  const closes = candles.map((c) => c.close);
  const stoch = calcStochRSI(closes);
  if (stoch.length < 2) return [];

  const prev = stoch[stoch.length - 2];
  const curr = stoch[stoch.length - 1];
  const bullCross = prev.k <= prev.d && curr.k > curr.d && prev.k < 30;
  const bearCross = prev.k >= prev.d && curr.k < curr.d && prev.k > 70;

  return [
    { key: `stochrsi_bull_${label}`, label: `StochRSI 과매도 반등 (${label})`,
      weight: 3, triggered: bullCross, direction: bullCross ? 'bullish' : 'neutral' },
    { key: `stochrsi_bear_${label}`, label: `StochRSI 과매수 반락 (${label})`,
      weight: 3, triggered: bearCross, direction: bearCross ? 'bearish' : 'neutral' },
  ];
}

// ── 쐐기 패턴 감지 ──────────────────────────────────────────────────────────

function findPivotHighs(candles: OHLCV[], N: number): { idx: number; value: number }[] {
  const pivots: { idx: number; value: number }[] = [];
  for (let i = N; i < candles.length - N; i++) {
    const h = candles[i].high;
    let isPeak = true;
    for (let j = i - N; j <= i + N; j++) {
      if (j !== i && candles[j].high >= h) { isPeak = false; break; }
    }
    if (isPeak) pivots.push({ idx: i, value: h });
  }
  return pivots;
}

function findPivotLows(candles: OHLCV[], N: number): { idx: number; value: number }[] {
  const pivots: { idx: number; value: number }[] = [];
  for (let i = N; i < candles.length - N; i++) {
    const l = candles[i].low;
    let isTrough = true;
    for (let j = i - N; j <= i + N; j++) {
      if (j !== i && candles[j].low <= l) { isTrough = false; break; }
    }
    if (isTrough) pivots.push({ idx: i, value: l });
  }
  return pivots;
}

function linReg(pts: { x: number; y: number }[]): { slope: number; intercept: number; r2: number } {
  const n = pts.length;
  if (n < 2) return { slope: 0, intercept: 0, r2: 0 };
  const sx  = pts.reduce((s, p) => s + p.x, 0);
  const sy  = pts.reduce((s, p) => s + p.y, 0);
  const sxy = pts.reduce((s, p) => s + p.x * p.y, 0);
  const sx2 = pts.reduce((s, p) => s + p.x ** 2, 0);
  const den = n * sx2 - sx ** 2;
  if (den === 0) return { slope: 0, intercept: sy / n, r2: 0 };
  const slope     = (n * sxy - sx * sy) / den;
  const intercept = (sy - slope * sx) / n;
  const my    = sy / n;
  const ssTot = pts.reduce((s, p) => s + (p.y - my) ** 2, 0);
  const ssRes = pts.reduce((s, p) => s + (p.y - (slope * p.x + intercept)) ** 2, 0);
  return { slope, intercept, r2: ssTot === 0 ? 1 : Math.max(0, 1 - ssRes / ssTot) };
}

function detectWedge(candles: OHLCV[], label: string): SignalDetail[] {
  const N       = label === '4H' ? 3 : 2;
  const LOOKBACK = Math.min(90, candles.length);
  if (candles.length < 30) return [];

  const slice      = candles.slice(-LOOKBACK);
  const currentIdx = slice.length - 1;

  const allHighs = findPivotHighs(slice, N);
  const allLows  = findPivotLows(slice, N);
  if (allHighs.length < 2 || allLows.length < 2) return [];

  const useHighs = allHighs.slice(-Math.min(5, allHighs.length));
  const useLows  = allLows.slice(-Math.min(5, allLows.length));

  const upper = linReg(useHighs.map((p) => ({ x: p.idx, y: p.value })));
  const lower = linReg(useLows.map((p) => ({ x: p.idx, y: p.value })));

  if (useHighs.length >= 3 && upper.r2 < 0.6) return [];
  if (useLows.length  >= 3 && lower.r2 < 0.6) return [];

  // 핵심: 두 선이 수렴해야 쐐기
  if (upper.slope >= lower.slope) return [];

  const bothPos = upper.slope > 0 && lower.slope > 0; // 상승쐐기 (하락 반전 예상)
  const bothNeg = upper.slope < 0 && lower.slope < 0; // 하락쐐기 (상승 반전 예상)
  if (!bothPos && !bothNeg) return [];

  // 수렴점(apex) 계산
  const apexX = (lower.intercept - upper.intercept) / (upper.slope - lower.slope);
  if (apexX <= currentIdx) return []; // apex 이미 지남

  const patternStart = Math.min(useHighs[0].idx, useLows[0].idx);
  const patternSpan  = currentIdx - patternStart;
  if (patternSpan < 15) return [];

  const completion = patternSpan / (apexX - patternStart);
  if (completion < 0.4 || completion > 1.0) return [];

  // 현재 봉 기준 추세선 값
  const upperVal = upper.slope * currentIdx + upper.intercept;
  const lowerVal = lower.slope * currentIdx + lower.intercept;
  if (upperVal <= lowerVal) return [];

  const lastC = slice[currentIdx];

  // 태그: 최근 봉이 추세선에 닿되 종가는 채널 안쪽으로 마감
  const TAG_TOL   = 0.005; // 0.5% 허용
  const tagUpper  = lastC.high >= upperVal * (1 - TAG_TOL) && lastC.close < upperVal;
  const tagLower  = lastC.low  <= lowerVal * (1 + TAG_TOL) && lastC.close > lowerVal;

  // 쐐기 내부 RSI 다이버전스 (패턴 전반부 vs 후반부 비교)
  let internalDiv = false;
  const patLen = currentIdx - patternStart + 1;
  if (patLen >= 10) {
    const rsiAll = RSI.calculate({ period: 14, values: candles.map((c) => c.close) });
    const rsiPat = rsiAll.slice(-patLen);
    if (rsiPat.length >= 6) {
      const half = Math.floor(rsiPat.length / 2);
      const patSlice = slice.slice(patternStart);
      if (bothPos) {
        // 상승쐐기: 가격 고점 갱신이지만 RSI 고점은 낮아지는 약세 다이버전스
        const priceHiA = Math.max(...patSlice.slice(0, half).map((c) => c.high));
        const priceHiB = Math.max(...patSlice.slice(half).map((c) => c.high));
        const rsiHiA   = Math.max(...rsiPat.slice(0, half));
        const rsiHiB   = Math.max(...rsiPat.slice(half));
        internalDiv = priceHiB > priceHiA && rsiHiB < rsiHiA - 2;
      } else {
        // 하락쐐기: 가격 저점 갱신이지만 RSI 저점은 높아지는 강세 다이버전스
        const priceLoA = Math.min(...patSlice.slice(0, half).map((c) => c.low));
        const priceLoB = Math.min(...patSlice.slice(half).map((c) => c.low));
        const rsiLoA   = Math.min(...rsiPat.slice(0, half));
        const rsiLoB   = Math.min(...rsiPat.slice(half));
        internalDiv = priceLoB < priceLoA && rsiLoB > rsiLoA + 2;
      }
    }
  }

  const pct = Math.round(completion * 100);
  const results: SignalDetail[] = [];

  if (bothNeg && tagUpper) {
    // 하락쐐기 + 저항 태그 → 매수 예비 신호
    const weight = internalDiv ? (completion >= 0.8 ? 5 : 4) : (completion >= 0.8 ? 4 : 3);
    results.push({
      key: `wedge_fall_${label}`,
      label: internalDiv
        ? `하락쐐기 압축 반전 (${label}) ${pct}%`
        : `하락쐐기 저항 태그 (${label}) ${pct}%`,
      weight, triggered: true, direction: 'bullish',
    });
  } else if (bothPos && tagLower) {
    // 상승쐐기 + 지지 태그 → 매도 예비 신호
    const weight = internalDiv ? (completion >= 0.8 ? 5 : 4) : (completion >= 0.8 ? 4 : 3);
    results.push({
      key: `wedge_rise_${label}`,
      label: internalDiv
        ? `상승쐐기 압축 반전 (${label}) ${pct}%`
        : `상승쐐기 지지 태그 (${label}) ${pct}%`,
      weight, triggered: true, direction: 'bearish',
    });
  } else if (completion >= 0.7) {
    // 태그 없어도 고완성도 쐐기 → 중립 주의 신호
    results.push({
      key: `wedge_forming_${label}`,
      label: bothNeg
        ? `하락쐐기 형성 중 (${label}) ${pct}%`
        : `상승쐐기 형성 중 (${label}) ${pct}%`,
      weight: 1, triggered: true, direction: 'neutral',
    });
  }

  return results;
}

// ── 선행/확인 신호 분류 ──────────────────────────────────────────────────────
// 선행: 방향 전환 초기 감지
const LEADING_BULL = new Set([
  'rsi_bull_div_1H', 'rsi_bull_div_4H', 'obv_bull_div',
  'stochrsi_bull_4H', 'stochrsi_bull_1H', 'bb_squeeze', 'fr_flip',
  'wedge_fall_4H', 'wedge_fall_1H',
]);
const LEADING_BEAR = new Set([
  'rsi_bear_div_1H', 'rsi_bear_div_4H', 'obv_bear_div',
  'stochrsi_bear_4H', 'stochrsi_bear_1H', 'fr_overheat', 'fr_flip',
  'wedge_rise_4H', 'wedge_rise_1H',
]);
// 확인: 이미 시작된 움직임을 검증
const CONFIRMING = new Set(['ha_4h', 'ha_1d', 'macd_cross', 'vol_spike', 'engulfing']);

// ── 메인 함수 ────────────────────────────────────────────────────────────────

export function calculateSignalScore(
  candles1h: OHLCV[],
  candles4h: OHLCV[],
  candles1d: OHLCV[],
  rankChange7d: number | null,
  aggVol?: AggVolSnapshot[],
  frData?: FRSnapshot[]
): SignalScoreResult {
  const signals: SignalDetail[] = [];

  // ── 추세 컨텍스트: EMA200(1D) ─────────────────────────────────────────────
  const ema200_1d = EMA.calculate({ period: 200, values: candles1d.map((c) => c.close) });
  const lastClose1d = candles1d[candles1d.length - 1]?.close ?? 0;
  const trendUp   = ema200_1d.length > 0 && lastClose1d > ema200_1d[ema200_1d.length - 1];
  const trendDown = ema200_1d.length > 0 && lastClose1d < ema200_1d[ema200_1d.length - 1];

  // ── 멀티타임프레임 정렬 ───────────────────────────────────────────────────
  const bias1h = timeframeBias(candles1h);
  const bias4h = timeframeBias(candles4h);
  const bias1d = timeframeBias(candles1d);
  const biases = [bias1h, bias4h, bias1d];
  const bullCount = biases.filter((b) => b === 'bullish').length;
  const bearCount = biases.filter((b) => b === 'bearish').length;

  const mtfAll3Bull = bullCount === 3;
  const mtfAll3Bear = bearCount === 3;
  const mtf2Bull    = !mtfAll3Bull && bullCount === 2;
  const mtf2Bear    = !mtfAll3Bear && bearCount === 2;

  signals.push({
    key: 'mtf_align',
    label: mtfAll3Bull ? '멀티타임프레임 전체 상승 정렬 (1H·4H·1D)' :
           mtfAll3Bear ? '멀티타임프레임 전체 하락 정렬 (1H·4H·1D)' :
           mtf2Bull    ? `멀티타임프레임 2/3 상승 정렬 (${[bias1h==='bullish'?'1H':'',bias4h==='bullish'?'4H':'',bias1d==='bullish'?'1D':''].filter(Boolean).join('·')})` :
           mtf2Bear    ? `멀티타임프레임 2/3 하락 정렬 (${[bias1h==='bearish'?'1H':'',bias4h==='bearish'?'4H':'',bias1d==='bearish'?'1D':''].filter(Boolean).join('·')})` :
           '멀티타임프레임 혼조',
    weight: mtfAll3Bull || mtfAll3Bear ? 3 : 1,
    triggered: mtfAll3Bull || mtfAll3Bear || mtf2Bull || mtf2Bear,
    direction: (mtfAll3Bull || mtf2Bull) ? 'bullish' : (mtfAll3Bear || mtf2Bear) ? 'bearish' : 'neutral',
  });

  // ── 하이킨아시 반전 ───────────────────────────────────────────────────────
  if (candles4h.length >= 3) {
    const ha = calculateHeikinAshi(candles4h);
    const last = ha[ha.length - 1];
    signals.push({ key: 'ha_4h', label: '하이킨아시 반전 (4H)', weight: 3,
      triggered: last.isReversal === 'bullish' || last.isReversal === 'bearish',
      direction: last.isReversal === 'bullish' ? 'bullish' : last.isReversal === 'bearish' ? 'bearish' : 'neutral' });
  }
  if (candles1d.length >= 3) {
    const ha = calculateHeikinAshi(candles1d);
    const last = ha[ha.length - 1];
    signals.push({ key: 'ha_1d', label: '하이킨아시 반전 (1D)', weight: 4,
      triggered: last.isReversal === 'bullish' || last.isReversal === 'bearish',
      direction: last.isReversal === 'bullish' ? 'bullish' : last.isReversal === 'bearish' ? 'bearish' : 'neutral' });
  }

  // ── 거래량 신호 ───────────────────────────────────────────────────────────
  if (aggVol && aggVol.length >= 21) {
    const qvols = aggVol.map((v) => v.totalQuoteVolume);
    const avg20 = qvols.slice(-21, -1).reduce((a, b) => a + b, 0) / 20;
    const spiked = qvols[qvols.length - 1] > avg20 * 2;
    const lastC4h = candles4h[candles4h.length - 1];
    const volDir = lastC4h?.close > lastC4h?.open ? 'bullish' : 'bearish';
    signals.push({ key: 'vol_spike', label: '합산 거래량 이상 (2배+)', weight: 2,
      triggered: spiked, direction: spiked ? volDir : 'neutral' });

    const dexRatios = aggVol.map((v) => v.dexRatio);
    const prevDexAvg = dexRatios.slice(-6, -1).reduce((a, b) => a + b, 0) / 5;
    const dexSurge = dexRatios[dexRatios.length - 1] > 0.1 &&
      dexRatios[dexRatios.length - 1] - prevDexAvg > 0.1;
    signals.push({ key: 'dex_surge', label: 'DEX 거래량 급등', weight: 2,
      triggered: dexSurge, direction: dexSurge ? 'bullish' : 'neutral' });

    const maxShare = Math.max(...aggVol[aggVol.length - 1].breakdown.map((b) => b.share));
    signals.push({ key: 'vol_concentration', label: '거래량 편중 감지', weight: 1,
      triggered: maxShare >= 80, direction: 'neutral' });
  } else if (candles4h.length >= 21) {
    const vols = candles4h.map((c) => c.volume);
    const avg20 = vols.slice(-21, -1).reduce((a, b) => a + b, 0) / 20;
    const spiked = vols[vols.length - 1] > avg20 * 2;
    const lastC4h = candles4h[candles4h.length - 1];
    const volDir = lastC4h.close > lastC4h.open ? 'bullish' : 'bearish';
    signals.push({ key: 'vol_spike', label: '거래량 이상 (2배+)', weight: 2,
      triggered: spiked, direction: spiked ? volDir : 'neutral' });
  }

  // ── RSI 과매도/과매수 — freshness 개선 (극단 터치 후 회복 여부 확인) ───────
  if (candles4h.length >= 18) {
    const closes4h = candles4h.map((c) => c.close);
    const rsi4h = RSI.calculate({ period: 14, values: closes4h });
    if (rsi4h.length >= 4) {
      const curr  = rsi4h[rsi4h.length - 1];
      const prev  = rsi4h[rsi4h.length - 2];
      const back3 = rsi4h.slice(-4, -1); // 직전 3봉 RSI

      // 극단에 최근 닿은 뒤 회복 중인 경우만 fresh로 처리
      const freshOversold   = back3.some((r) => r < 30) && curr > 35 && curr > prev;
      const freshOverbought = back3.some((r) => r > 70) && curr < 65 && curr < prev;

      signals.push({ key: 'rsi_oversold', label: 'RSI 과매도 반등', weight: 2,
        triggered: freshOversold, direction: freshOversold ? 'bullish' : 'neutral' });
      signals.push({ key: 'rsi_overbought', label: 'RSI 과매수 반락', weight: 2,
        triggered: freshOverbought, direction: freshOverbought ? 'bearish' : 'neutral' });
    }
  }

  // ── 볼린저 밴드 터치 — freshness 개선 (방금 터치한 경우만) ─────────────────
  if (candles4h.length >= 21) {
    const closes4h = candles4h.map((c) => c.close);
    const bb = BollingerBands.calculate({ period: 20, values: closes4h, stdDev: 2 });
    if (bb.length >= 2) {
      const last = bb[bb.length - 1];
      const lastClose = closes4h[closes4h.length - 1];
      const prevClose = closes4h[closes4h.length - 2];
      const prevBB    = bb[bb.length - 2];
      // 이전 봉은 밴드 안에 있었는데 현재 봉에서 터치 = 방금 터치
      const justLower = lastClose <= last.lower && prevClose > prevBB.lower;
      const justUpper = lastClose >= last.upper && prevClose < prevBB.upper;
      signals.push({ key: 'bb_touch', label: '볼린저 밴드 터치', weight: 1,
        triggered: justLower || justUpper,
        direction: justLower ? 'bullish' : justUpper ? 'bearish' : 'neutral' });
    }
  }

  // ── BB 스퀴즈 ─────────────────────────────────────────────────────────────
  signals.push(...detectBBSqueeze(candles4h));

  // ── StochRSI 타이밍 ───────────────────────────────────────────────────────
  signals.push(...detectStochRSI(candles4h, '4H'));
  signals.push(...detectStochRSI(candles1h, '1H'));

  // ── 쐐기 패턴 (태그 기반 예비 신호) ─────────────────────────────────────
  signals.push(...detectWedge(candles4h, '4H'));
  signals.push(...detectWedge(candles1h, '1H'));

  // ── 장악형 캔들 ───────────────────────────────────────────────────────────
  if (candles4h.length >= 2) {
    const c    = candles4h[candles4h.length - 1];
    const prev = candles4h[candles4h.length - 2];
    const bullEngulf = prev.close < prev.open && c.close > c.open &&
      c.open <= prev.close && c.close >= prev.open;
    const bearEngulf = prev.close > prev.open && c.close < c.open &&
      c.open >= prev.close && c.close <= prev.open;
    signals.push({ key: 'engulfing', label: '장악형 캔들', weight: 2,
      triggered: bullEngulf || bearEngulf,
      direction: bullEngulf ? 'bullish' : bearEngulf ? 'bearish' : 'neutral' });
  }

  // ── 시총 순위 상승 ────────────────────────────────────────────────────────
  if (rankChange7d !== null) {
    signals.push({ key: 'rank_rising', label: '시총 순위 상승', weight: 1,
      triggered: rankChange7d > 2, direction: rankChange7d > 2 ? 'bullish' : 'neutral' });
  }

  // ── RSI 다이버전스 (1H / 4H) ─────────────────────────────────────────────
  signals.push(...detectRSIDivergence(candles1h, '1H'));
  signals.push(...detectRSIDivergence(candles4h, '4H'));

  // ── OBV 다이버전스 ────────────────────────────────────────────────────────
  if (aggVol && aggVol.length >= 30) {
    signals.push(...detectOBVDivergence(candles4h, aggVol));
  }

  // ── MACD 크로스 ───────────────────────────────────────────────────────────
  if (candles4h.length >= 27) {
    const m = MACD.calculate({ values: candles4h.map((c) => c.close),
      fastPeriod: 12, slowPeriod: 26, signalPeriod: 9,
      SimpleMAOscillator: false, SimpleMASignal: false });
    if (m.length >= 2) {
      const prev = m[m.length - 2];
      const curr = m[m.length - 1];
      const golden = prev.MACD !== undefined && prev.signal !== undefined &&
        curr.MACD !== undefined && curr.signal !== undefined &&
        prev.MACD <= prev.signal && curr.MACD > curr.signal;
      const death  = prev.MACD !== undefined && prev.signal !== undefined &&
        curr.MACD !== undefined && curr.signal !== undefined &&
        prev.MACD >= prev.signal && curr.MACD < curr.signal;
      signals.push({ key: 'macd_cross', label: 'MACD 크로스', weight: 2,
        triggered: golden || death,
        direction: golden ? 'bullish' : death ? 'bearish' : 'neutral' });
    }
  }

  // ── 펀딩비 신호 ───────────────────────────────────────────────────────────
  if (frData && frData.length >= 5) {
    const recent = frData.slice(-5);
    const curr   = recent[recent.length - 1].fundingRateDailyPct;
    const prev4  = recent.slice(0, -1);

    const highCount = prev4.filter((f) => f.fundingRateDailyPct > 0.15).length;
    const lowCount  = prev4.filter((f) => f.fundingRateDailyPct < -0.09).length;
    const overheatBear = highCount >= 3 && curr > 0.15;
    const overheatBull = lowCount  >= 3 && curr < -0.09;
    signals.push({
      key: 'fr_overheat',
      label: overheatBear ? '펀딩비 과열 (롱 과레버리지)' : '펀딩비 역과열 (숏 과레버리지)',
      weight: 2, triggered: overheatBear || overheatBull,
      direction: overheatBear ? 'bearish' : overheatBull ? 'bullish' : 'neutral',
    });

    const prev3     = recent.slice(-4, -1);
    const allHighPos = prev3.every((f) => f.fundingRateDailyPct > 0.03);
    const allNeg     = prev3.every((f) => f.fundingRateDailyPct < -0.01);
    const flipToNeg  = allHighPos && curr <= 0;
    const flipToPos  = allNeg     && curr >= 0;
    signals.push({
      key: 'fr_flip',
      label: flipToNeg ? '펀딩비 전환 (양→음)' : '펀딩비 전환 (음→양)',
      weight: 2, triggered: flipToNeg || flipToPos,
      direction: flipToNeg ? 'bullish' : flipToPos ? 'bearish' : 'neutral',
    });
  }

  // ── 추세 필터 적용: EMA200(1D) 역방향 신호 가중치 50% 감소 ─────────────────
  for (const s of signals) {
    if (!s.triggered || s.direction === 'neutral') continue;
    if ((s.direction === 'bullish' && trendDown) || (s.direction === 'bearish' && trendUp)) {
      s.weight = Math.max(1, Math.floor(s.weight / 2));
      s.label  = `${s.label} ↓추세역행`;
    }
  }

  // ── 2단계 구조 보너스: 선행 + 확인 신호 동시 발동 ─────────────────────────
  const triggeredBull = new Set(signals.filter((s) => s.triggered && s.direction === 'bullish').map((s) => s.key));
  const triggeredBear = new Set(signals.filter((s) => s.triggered && s.direction === 'bearish').map((s) => s.key));

  const hasLeadBull    = [...LEADING_BULL].some((k) => triggeredBull.has(k));
  const hasConfirmBull = [...CONFIRMING].some((k) => triggeredBull.has(k));
  const hasLeadBear    = [...LEADING_BEAR].some((k) => triggeredBear.has(k));
  const hasConfirmBear = [...CONFIRMING].some((k) => triggeredBear.has(k));

  const twoStageBull = hasLeadBull && hasConfirmBull;
  const twoStageBear = hasLeadBear && hasConfirmBear;
  if (twoStageBull || twoStageBear) {
    signals.push({
      key: 'two_stage',
      label: twoStageBull ? '선행+확인 신호 조합 (강세)' : '선행+확인 신호 조합 (약세)',
      weight: 2, triggered: true,
      direction: twoStageBull ? 'bullish' : 'bearish',
    });
  }

  // ── 최종 집계 ─────────────────────────────────────────────────────────────
  let bullScore = 0;
  let bearScore = 0;
  for (const s of signals) {
    if (!s.triggered || s.direction === 'neutral') continue;
    if (s.direction === 'bullish') bullScore += s.weight;
    else if (s.direction === 'bearish') bearScore += s.weight;
  }

  const score = Math.max(bullScore, bearScore);
  const direction: 'bullish' | 'bearish' | 'neutral' =
    bullScore > bearScore ? 'bullish' : bearScore > bullScore ? 'bearish' : 'neutral';

  // 신호 추가로 최대 점수가 높아졌으므로 임계값 상향 조정
  const level: SignalScoreResult['level'] =
    score >= 12 ? 'strong' : score >= 8 ? 'medium' : score >= 5 ? 'weak' : 'none';

  return { score, level, signals, direction };
}
