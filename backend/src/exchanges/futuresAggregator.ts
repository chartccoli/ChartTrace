import axios from 'axios';
import NodeCache from 'node-cache';

// ── 타입 ──────────────────────────────────────────────────────────

export interface FuturesKline {
  timestamp: number;              // Unix seconds (candle openTime 기준)
  fundingRateDailyPct: number;    // OI 가중 일일 % (예: 0.09 = 0.09%/day)
  openInterestUsd: number;        // 전체 미결제약정 USD 합산
  oiBreakdown: { exchange: string; oiUsd: number; share: number }[];
  frBreakdown: { exchange: string; dailyPct: number }[];
}

type FRPoint  = { timestamp: number; rate: number };   // timestamp: Unix seconds
type OIPoint  = { timestamp: number; oiUsd: number };

// ── 캐시 (4분 TTL — 8h 펀딩 주기 대비 충분) ──────────────────────
const cache = new NodeCache({ stdTTL: 240 });

// ── 심볼 변환 헬퍼 ────────────────────────────────────────────────
function toRaw(symbol: string) {
  return symbol.replace('/', '').toUpperCase(); // BTC/USDT → BTCUSDT
}
function baseCoin(symbol: string) {
  return symbol.split('/')[0].toUpperCase();    // BTC/USDT → BTC
}

// ── interval 매핑 ────────────────────────────────────────────────
function binancePeriod(interval: string): string {
  return ({ '15m': '15m', '1h': '1h', '4h': '4h', '1d': '1d' } as Record<string, string>)[interval] ?? '1h';
}
function bybitInterval(interval: string): string {
  return ({ '15m': '15min', '1h': '1h', '4h': '4h', '1d': '1d' } as Record<string, string>)[interval] ?? '1h';
}

// ── Binance Futures ───────────────────────────────────────────────
// 선물 klines — 캔들(spot)과 동일한 UTC 정렬 타임스탬프를 limit개만큼 제공
async function binanceKlines(symbol: string, interval: string, limit: number): Promise<number[]> {
  const { data } = await axios.get('https://fapi.binance.com/fapi/v1/klines', {
    params: { symbol: toRaw(symbol), interval, limit },
    timeout: 8000,
  });
  return (data as any[]).map((k: any) => Math.floor(k[0] / 1000)); // openTime → Unix seconds
}

async function binanceFR(symbol: string, limit: number): Promise<FRPoint[]> {
  const { data } = await axios.get('https://fapi.binance.com/fapi/v1/fundingRate', {
    params: { symbol: toRaw(symbol), limit },
    timeout: 8000,
  });
  return (data as any[]).map((d) => ({
    timestamp: Math.floor(d.fundingTime / 1000),
    rate: parseFloat(d.fundingRate),
  }));
}

async function binanceOI(symbol: string, interval: string, limit: number): Promise<OIPoint[]> {
  const { data } = await axios.get('https://fapi.binance.com/futures/data/openInterestHist', {
    params: { symbol: toRaw(symbol), period: binancePeriod(interval), limit },
    timeout: 8000,
  });
  return (data as any[]).map((d) => ({
    timestamp: Math.floor(d.timestamp / 1000),
    oiUsd: parseFloat(d.sumOpenInterestValue),
  }));
}

// ── Bybit ─────────────────────────────────────────────────────────
async function bybitFR(symbol: string, limit: number): Promise<FRPoint[]> {
  const { data } = await axios.get('https://api.bybit.com/v5/market/funding/history', {
    params: { category: 'linear', symbol: toRaw(symbol), limit },
    timeout: 8000,
  });
  return (data.result?.list ?? []).map((d: any) => ({
    timestamp: Math.floor(parseInt(d.fundingRateTimestamp) / 1000),
    rate: parseFloat(d.fundingRate),
  }));
}

async function bybitOI(symbol: string, interval: string, limit: number): Promise<OIPoint[]> {
  const { data } = await axios.get('https://api.bybit.com/v5/market/open-interest', {
    params: { category: 'linear', symbol: toRaw(symbol), intervalTime: bybitInterval(interval), limit },
    timeout: 8000,
  });
  return (data.result?.list ?? []).map((d: any) => ({
    timestamp: Math.floor(parseInt(d.timestamp) / 1000),
    oiUsd: parseFloat(d.openInterestValue ?? '0'),
  }));
}

// ── OKX ──────────────────────────────────────────────────────────
async function okxFR(symbol: string, limit: number): Promise<FRPoint[]> {
  const instId = `${baseCoin(symbol)}-USDT-SWAP`;
  const { data } = await axios.get('https://www.okx.com/api/v5/public/funding-rate-history', {
    params: { instId, limit },
    timeout: 8000,
  });
  return (data.data ?? []).map((d: any) => ({
    timestamp: Math.floor(parseInt(d.fundingTime) / 1000),
    rate: parseFloat(d.fundingRate),
  }));
}

// ── Bitget ───────────────────────────────────────────────────────
async function bitgetFR(symbol: string, limit: number): Promise<FRPoint[]> {
  const sym = `${toRaw(symbol)}_UMCBL`;
  const { data } = await axios.get('https://api.bitget.com/api/mix/v1/market/history-fundRate', {
    params: { symbol: sym, pageSize: limit },
    timeout: 8000,
  });
  return (data.data ?? []).map((d: any) => ({
    timestamp: Math.floor(parseInt(d.settleTime) / 1000),
    rate: parseFloat(d.fundingRate),
  }));
}

// ── Hyperliquid (1h 주기) ─────────────────────────────────────────
async function hyperliquidFR(symbol: string, startTime: number): Promise<FRPoint[]> {
  const coin = baseCoin(symbol);
  const { data } = await axios.post(
    'https://api.hyperliquid.xyz/info',
    { type: 'fundingHistory', coin, startTime },
    { timeout: 8000 }
  );
  return (data ?? []).map((d: any) => ({
    timestamp: Math.floor(d.time / 1000),
    rate: parseFloat(d.fundingRate),
  }));
}

// ── 정규화: 거래소별 지급 주기 → 일일 % ───────────────────────────
function toDailyPct(rate: number, exchange: string): number {
  // Hyperliquid: 1h 주기 → ×24
  // 나머지(Binance/Bybit/OKX/Bitget): 8h 주기 → ×3
  const multiplier = exchange === 'hyperliquid' ? 24 : 3;
  return rate * multiplier * 100;
}

// 시점 T 이전 가장 최근 FR 반환
function latestFR(list: FRPoint[], t: number): number | null {
  let best: FRPoint | null = null;
  for (const p of list) {
    if (p.timestamp <= t && (!best || p.timestamp > best.timestamp)) best = p;
  }
  return best?.rate ?? null;
}

// 시점 T에 가장 가까운 OI 반환 (±2h 이내)
function closestOI(list: OIPoint[], t: number): number | null {
  const WINDOW = 7200;
  let best: OIPoint | null = null;
  for (const p of list) {
    if (Math.abs(p.timestamp - t) <= WINDOW) {
      if (!best || Math.abs(p.timestamp - t) < Math.abs(best.timestamp - t)) best = p;
    }
  }
  return best?.oiUsd ?? null;
}

// ── 메인 집계 함수 ────────────────────────────────────────────────
export async function getAggregatedFutures(
  symbol: string,
  interval: string,
  limit: number
): Promise<FuturesKline[]> {
  const cacheKey = `futures:${symbol}:${interval}:${limit}`;
  const cached = cache.get<FuturesKline[]>(cacheKey);
  if (cached) return cached;

  // 펀딩 limit: 8h 주기 기준, 캔들 수 대비 넉넉히
  const hoursPerCandle = ({ '15m': 0.25, '1h': 1, '4h': 4, '1d': 24 } as Record<string, number>)[interval] ?? 4;
  const frLimit = Math.min(Math.ceil(limit * hoursPerCandle / 8) + 20, 1000);
  // Hyperliquid: 캔들 전체 기간 커버 (최소 30일)
  const hl_startTime = Date.now() - Math.max(Math.ceil(limit * hoursPerCandle) * 3600 * 1000, 30 * 24 * 3600 * 1000);

  const [
    resKlines,
    resBinanceFR, resBinanceOI,
    resBybitFR,   resBybitOI,
    resOkxFR,
    resBitgetFR,
    resHlFR,
  ] = await Promise.allSettled([
    binanceKlines(symbol, interval, limit),
    binanceFR(symbol, frLimit),
    binanceOI(symbol, interval, Math.min(limit, 500)),
    bybitFR(symbol, Math.min(frLimit, 200)),
    bybitOI(symbol, interval, Math.min(limit, 200)),
    okxFR(symbol, Math.min(frLimit, 100)),
    bitgetFR(symbol, Math.min(frLimit, 100)),
    hyperliquidFR(symbol, hl_startTime),
  ]);

  // FR 소스: 모두 사용
  const frSources: { exchange: string; data: FRPoint[] }[] = [];
  if (resBinanceFR.status === 'fulfilled') frSources.push({ exchange: 'binance',     data: resBinanceFR.value });
  if (resBybitFR.status   === 'fulfilled') frSources.push({ exchange: 'bybit',       data: resBybitFR.value });
  if (resOkxFR.status     === 'fulfilled') frSources.push({ exchange: 'okx',         data: resOkxFR.value });
  if (resBitgetFR.status  === 'fulfilled') frSources.push({ exchange: 'bitget',      data: resBitgetFR.value });
  if (resHlFR.status      === 'fulfilled') frSources.push({ exchange: 'hyperliquid', data: resHlFR.value });

  // OI 소스: Binance + Bybit (히스토리 제공)
  const oiSources: { exchange: string; data: OIPoint[] }[] = [];
  if (resBinanceOI.status === 'fulfilled' && resBinanceOI.value.length > 0)
    oiSources.push({ exchange: 'binance', data: resBinanceOI.value });
  if (resBybitOI.status === 'fulfilled' && resBybitOI.value.length > 0)
    oiSources.push({ exchange: 'bybit', data: resBybitOI.value });

  // 기준 타임스탬프: 선물 klines (캔들과 동일한 타임스탬프 → setVisibleLogicalRange 싱크 보장)
  // fallback: Binance OI → 첫 번째 OI 소스
  let timestamps: number[];
  if (resKlines.status === 'fulfilled' && resKlines.value.length > 0) {
    timestamps = resKlines.value;
  } else if (oiSources.length > 0) {
    const primary = oiSources.find((s) => s.exchange === 'binance') ?? oiSources[0];
    timestamps = primary.data.slice(-limit).map((p) => p.timestamp);
  } else {
    return [];
  }

  const result: FuturesKline[] = timestamps.map((ts) => {
    // OI 집계
    const oiBreakdown: FuturesKline['oiBreakdown'] = [];
    for (const src of oiSources) {
      const oi = closestOI(src.data, ts);
      if (oi !== null && oi > 0) oiBreakdown.push({ exchange: src.exchange, oiUsd: oi, share: 0 });
    }
    const totalOI = oiBreakdown.reduce((s, o) => s + o.oiUsd, 0);
    if (totalOI > 0) oiBreakdown.forEach((o) => { o.share = (o.oiUsd / totalOI) * 100; });

    // FR 집계 (OI 가중평균)
    const frBreakdown: FuturesKline['frBreakdown'] = [];
    for (const src of frSources) {
      const raw = latestFR(src.data, ts);
      if (raw !== null) frBreakdown.push({ exchange: src.exchange, dailyPct: toDailyPct(raw, src.exchange) });
    }

    // 가중치: 해당 거래소 OI 있으면 OI, 없으면 동등 가중
    let weightedFR = 0;
    const totalWeight = frBreakdown.reduce((s, f) => {
      const oiEntry = oiBreakdown.find((o) => o.exchange === f.exchange);
      return s + (oiEntry?.oiUsd ?? 0);
    }, 0);

    if (totalWeight > 0) {
      for (const f of frBreakdown) {
        const oiEntry = oiBreakdown.find((o) => o.exchange === f.exchange);
        weightedFR += f.dailyPct * (oiEntry?.oiUsd ?? 0);
      }
      weightedFR /= totalWeight;
    } else if (frBreakdown.length > 0) {
      weightedFR = frBreakdown.reduce((s, f) => s + f.dailyPct, 0) / frBreakdown.length;
    }

    return {
      timestamp: ts,
      fundingRateDailyPct: weightedFR,
      openInterestUsd: totalOI,
      oiBreakdown,
      frBreakdown,
    };
  });

  cache.set(cacheKey, result);
  return result;
}
