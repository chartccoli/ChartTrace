import axios from 'axios';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  takerBuyVolume?: number;
  takerBuyQuoteVolume?: number;
}

export interface HeikinAshiCandle extends Candle {
  isReversal?: 'bullish' | 'bearish';
}

export interface PatternResult {
  time: number;
  pattern: string;
  direction: 'bullish' | 'bearish' | 'neutral';
}

export interface KlinesResponse {
  candles: Candle[];
  heikinAshi: HeikinAshiCandle[];
  patterns: PatternResult[];
}

export type Timeframe = '15m' | '1h' | '4h' | '1d' | '1w';

export async function fetchKlines(
  symbol: string,
  interval: Timeframe,
  limit = 500
): Promise<KlinesResponse> {
  const { data } = await axios.get<KlinesResponse>(`${API_BASE}/api/klines`, {
    params: { symbol, interval, limit },
  });
  return data;
}

export interface IndicatorsResponse {
  times: number[];
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

export async function fetchIndicators(
  symbol: string,
  interval: Timeframe,
  indicators: string[],
  limit = 500
): Promise<IndicatorsResponse> {
  const { data } = await axios.post<IndicatorsResponse>(`${API_BASE}/api/indicators`, {
    symbol,
    interval,
    limit,
    indicators,
  });
  return data;
}

export interface SignalDetail {
  key: string;
  label: string;
  weight: number;
  triggered: boolean;
  direction: 'bullish' | 'bearish' | 'neutral';
}

export interface SignalScore {
  score: number;
  level: 'none' | 'weak' | 'medium' | 'strong';
  signals: SignalDetail[];
  direction: 'bullish' | 'bearish' | 'neutral';
}

export async function fetchSignalScore(symbol: string): Promise<SignalScore> {
  const { data } = await axios.get<SignalScore>(`${API_BASE}/api/signals/${symbol}`);
  return data;
}

export async function fetchBatchSignalScores(
  symbols: string[]
): Promise<Record<string, SignalScore>> {
  const { data } = await axios.get<Record<string, SignalScore>>(`${API_BASE}/api/signals`, {
    params: { symbols: symbols.join(',') },
  });
  return data;
}

export interface RankHistory {
  symbol: string;
  history: { rank: number; timestamp: number }[];
}

export async function fetchRankHistory(symbol: string): Promise<RankHistory> {
  const { data } = await axios.get<RankHistory>(
    `${API_BASE}/api/rankings/history/${symbol}`
  );
  return data;
}

export async function fetchRankHistoryBatch(
  symbols?: string[]
): Promise<Record<string, { rank: number; timestamp: number }[]>> {
  const params = symbols?.length ? { symbols: symbols.join(',') } : {};
  const { data } = await axios.get<Record<string, { rank: number; timestamp: number }[]>>(
    `${API_BASE}/api/rankings/history-batch`,
    { params }
  );
  return data;
}

export interface VolumeBreakdown {
  exchange: string;
  type: 'CEX' | 'DEX';
  volume: number;
  quoteVolume: number;
  share: number;
}

export interface AggregatedKline {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  totalVolume: number;
  totalQuoteVolume: number;
  breakdown: VolumeBreakdown[];
  cexVolume: number;
  dexVolume: number;
  dexRatio: number;
}

export async function fetchAggregatedVolume(
  symbol: string,
  interval: string,
  limit = 500,
  dex = false
): Promise<AggregatedKline[]> {
  const { data } = await axios.get<AggregatedKline[]>(`${API_BASE}/api/volume`, {
    params: { symbol, interval, limit, dex: dex ? 'true' : 'false' },
  });
  return data;
}
