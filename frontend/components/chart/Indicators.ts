// 프론트엔드 지표 타입 정의 및 색상 설정
export const INDICATOR_COLORS = {
  bb_upper: '#5b6af0',
  bb_middle: '#5b6af090',
  bb_lower: '#5b6af0',
  ema20: '#f59e0b',
  ema50: '#a78bfa',
  ema200: '#ec4899',
  macd_line: '#5b6af0',
  macd_signal: '#f59e0b',
  macd_hist_up: '#2ebd85',
  macd_hist_down: '#f6465d',
  rsi_line: '#a78bfa',
  rsi_ob: '#f6465d40',
  rsi_os: '#2ebd8540',
  stoch_k: '#5b6af0',
  stoch_d: '#f59e0b',
  obv: '#2ebd85',
  atr: '#fb923c',
};

export const INDICATOR_LABELS: Record<string, string> = {
  bb: 'Bollinger Bands',
  ema20: 'EMA 20',
  ema50: 'EMA 50',
  ema200: 'EMA 200',
  macd: 'MACD',
  rsi: 'RSI',
  stochRsi: 'Stoch RSI',
  obv: 'OBV',
  atr: 'ATR',
};

// 서브차트 지표 목록
export const SUB_CHART_INDICATORS = ['macd', 'rsi', 'stochRsi', 'obv', 'atr'] as const;
export const OVERLAY_INDICATORS = ['bb', 'ema20', 'ema50', 'ema200'] as const;
