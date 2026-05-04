import { create } from 'zustand';
import { Timeframe } from './binance';

export type CandleType = 'normal' | 'heikinashi';

export interface ActiveIndicators {
  bb: boolean;
  ema20: boolean;
  ema50: boolean;
  ema200: boolean;
  macd: boolean;
  rsi: boolean;
  stochRsi: boolean;
  obv: boolean;
  atr: boolean;
}

interface ChartStore {
  symbol: string;
  timeframe: Timeframe;
  candleType: CandleType;
  indicators: ActiveIndicators;
  showPatterns: boolean;
  viewMode: 'chart' | 'rankings';
  setSymbol: (symbol: string) => void;
  setTimeframe: (tf: Timeframe) => void;
  setCandleType: (type: CandleType) => void;
  toggleIndicator: (key: keyof ActiveIndicators) => void;
  togglePatterns: () => void;
  setViewMode: (mode: 'chart' | 'rankings') => void;
}

export const useChartStore = create<ChartStore>((set, get) => ({
  symbol: 'BTCUSDT',
  timeframe: '4h',
  candleType: 'normal',
  showPatterns: false,
  viewMode: 'chart' as const,
  indicators: {
    bb: false,
    ema20: false,
    ema50: false,
    ema200: false,
    macd: false,
    rsi: true,
    stochRsi: false,
    obv: false,
    atr: false,
  },
  setSymbol: (symbol) => set({ symbol }),
  setTimeframe: (timeframe) => set({ timeframe }),
  setCandleType: (candleType) => set({ candleType }),
  toggleIndicator: (key) =>
    set({ indicators: { ...get().indicators, [key]: !get().indicators[key] } }),
  togglePatterns: () => set({ showPatterns: !get().showPatterns }),
  setViewMode: (mode) => set({ viewMode: mode }),
}));
