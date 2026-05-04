'use client';

import { useEffect, useRef, useCallback } from 'react';
import {
  createChart,
  IChartApi,
  ISeriesApi,
  ColorType,
  CrosshairMode,
  SeriesMarker,
  Time,
  LineStyle,
} from 'lightweight-charts';
import { useQuery } from '@tanstack/react-query';
import { fetchKlines, fetchIndicators, fetchAggregatedVolume, Candle, HeikinAshiCandle, AggregatedKline } from '@/lib/binance';
import { useChartStore, ActiveIndicators } from '@/lib/store';
import { INDICATOR_COLORS } from './Indicators';

const CHART_BG = '#0a0a0f';
const GRID_COLOR = '#1e1e2e';
const TEXT_COLOR = '#6b6b80';
const UP_COLOR = '#2ebd85';
const DOWN_COLOR = '#f6465d';

function getActiveIndicatorList(indicators: ActiveIndicators): string[] {
  return (Object.keys(indicators) as (keyof ActiveIndicators)[]).filter((k) => indicators[k]);
}

const MAIN_CHART_DEFAULT_H = 420;
const MAIN_CHART_MIN_H     = 180;
const MAIN_CHART_MAX_H     = 800;

export default function CandleChart() {
  const { symbol, timeframe, candleType, indicators, showPatterns } = useChartStore();

  const mainChartHeightRef = useRef(MAIN_CHART_DEFAULT_H);

  const mainChartRef = useRef<HTMLDivElement>(null);
  const volumeChartRef = useRef<HTMLDivElement>(null);
  const subChart1Ref = useRef<HTMLDivElement>(null);
  const subChart2Ref = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  // 모든 차트가 공유하는 동기화 플래그 — 순환 업데이트 방지
  const isSyncingRef = useRef(false);

  const mainChartApi = useRef<IChartApi | null>(null);
  const volumeChartApi = useRef<IChartApi | null>(null);
  const subChart1Api = useRef<IChartApi | null>(null);
  const subChart2Api = useRef<IChartApi | null>(null);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const candleSeries = useRef<ISeriesApi<any> | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const volumeSeries = useRef<ISeriesApi<any> | null>(null);

  // 집계 거래량 맵 (timestamp → AggregatedKline)
  const aggVolMap = useRef<Map<number, AggregatedKline>>(new Map());

  const activeList = getActiveIndicatorList(indicators);
  const subIndicators = activeList.filter((k) =>
    ['macd', 'rsi', 'stochRsi', 'obv', 'atr'].includes(k)
  );
  const sub1 = subIndicators[0];
  const sub2 = subIndicators[1];

  // 표준 심볼 변환 (BTC/USDT 형식)
  const stdSymbol = symbol.endsWith('USDT')
    ? `${symbol.slice(0, -4)}/USDT`
    : symbol;

  const { data: klinesData } = useQuery({
    queryKey: ['klines', symbol, timeframe],
    queryFn: () => fetchKlines(symbol, timeframe, 500),
    refetchInterval: 30000,
  });

  const { data: indData } = useQuery({
    queryKey: ['indicators', symbol, timeframe, activeList],
    queryFn: () => fetchIndicators(symbol, timeframe, activeList, 500),
    enabled: activeList.length > 0,
    refetchInterval: 30000,
  });

  // 집계 거래량 (CEX 전용 — 속도 우선)
  const { data: aggVolData } = useQuery({
    queryKey: ['agg-volume', stdSymbol, timeframe],
    queryFn: () => fetchAggregatedVolume(stdSymbol, timeframe, 500, false),
    refetchInterval: 60000,
    staleTime: 30000,
  });

  // aggVolMap 업데이트
  useEffect(() => {
    if (!aggVolData) return;
    const map = new Map<number, AggregatedKline>();
    aggVolData.forEach((k) => map.set(k.timestamp, k));
    aggVolMap.current = map;
  }, [aggVolData]);

  const baseChartOptions = useCallback(
    (height: number) => ({
      layout: {
        background: { type: ColorType.Solid, color: CHART_BG },
        textColor: TEXT_COLOR,
      },
      grid: {
        vertLines: { color: GRID_COLOR },
        horzLines: { color: GRID_COLOR },
      },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: GRID_COLOR },
      timeScale: { borderColor: GRID_COLOR, timeVisible: true, secondsVisible: false },
      height,
    }),
    []
  );

  const handleMainChartDrag = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = mainChartHeightRef.current;

    const onMove = (ev: MouseEvent) => {
      const newH = Math.max(MAIN_CHART_MIN_H, Math.min(MAIN_CHART_MAX_H, startH + ev.clientY - startY));
      mainChartHeightRef.current = newH;
      mainChartApi.current?.applyOptions({ height: newH });
    };

    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, []);

  // 차트 초기화
  useEffect(() => {
    if (!mainChartRef.current || !volumeChartRef.current) return;

    mainChartApi.current?.remove();
    volumeChartApi.current?.remove();

    mainChartApi.current = createChart(mainChartRef.current, baseChartOptions(mainChartHeightRef.current));
    volumeChartApi.current = createChart(volumeChartRef.current, {
      ...baseChartOptions(100),
      crosshair: { mode: CrosshairMode.Normal },
    });

    candleSeries.current = mainChartApi.current.addCandlestickSeries({
      upColor: UP_COLOR,
      downColor: DOWN_COLOR,
      borderUpColor: UP_COLOR,
      borderDownColor: DOWN_COLOR,
      wickUpColor: UP_COLOR,
      wickDownColor: DOWN_COLOR,
    });

    volumeSeries.current = volumeChartApi.current.addHistogramSeries({
      priceFormat: { type: 'volume' },
      priceScaleId: '',
    });

    // 크로스헤어 동기화 + breakdown 툴팁
    mainChartApi.current.subscribeCrosshairMove((param) => {
      if (param.time && volumeChartApi.current && volumeSeries.current) {
        try {
          volumeChartApi.current.setCrosshairPosition(0, param.time, volumeSeries.current);
        } catch {
          // series/chart mismatch during re-initialization — safe to ignore
        }
      }

      const tooltip = tooltipRef.current;
      if (!tooltip) return;

      if (!param.time || !param.point) {
        tooltip.style.display = 'none';
        return;
      }

      const ts = param.time as number;
      const aggK = aggVolMap.current.get(ts);
      if (!aggK || aggK.breakdown.length === 0) {
        tooltip.style.display = 'none';
        return;
      }

      const sorted = [...aggK.breakdown].sort((a, b) => b.quoteVolume - a.quoteVolume);
      const lines = sorted
        .map((b) => `<span style="color:${b.type === 'DEX' ? '#a78bfa' : '#e2e2e8'}">${b.exchange}</span> <span style="color:#6b6b80">${b.share.toFixed(1)}%</span>`)
        .join(' · ');
      const dexTag = aggK.dexRatio >= 0.2
        ? `<span style="color:#a78bfa;margin-left:4px">⬡ 온체인</span>`
        : '';

      tooltip.innerHTML = `<div style="font-size:10px;white-space:nowrap">${lines}${dexTag}</div>`;

      const chartEl = mainChartRef.current;
      if (!chartEl) return;
      const rect = chartEl.getBoundingClientRect();
      let left = param.point.x + 10;
      if (left + 200 > rect.width) left = param.point.x - 210;
      tooltip.style.left = `${left}px`;
      tooltip.style.top = `${param.point.y - 10}px`;
      tooltip.style.display = 'block';
    });

    // ─── X축 동기화 (logical range — 서브차트는 NaN 패딩으로 동일 길이 보장) ──────
    const syncAll = (range: { from: number; to: number } | null, except?: IChartApi) => {
      if (!range) return;
      [mainChartApi.current, volumeChartApi.current, subChart1Api.current, subChart2Api.current].forEach((c) => {
        if (c && c !== except) c.timeScale().setVisibleLogicalRange(range);
      });
    };

    const makeSync = (self: () => IChartApi | null) =>
      (range: { from: number; to: number } | null) => {
        if (isSyncingRef.current || !range) return;
        isSyncingRef.current = true;
        syncAll(range, self() ?? undefined);
        isSyncingRef.current = false;
      };

    mainChartApi.current.timeScale().subscribeVisibleLogicalRangeChange(
      makeSync(() => mainChartApi.current)
    );
    volumeChartApi.current.timeScale().subscribeVisibleLogicalRangeChange(
      makeSync(() => volumeChartApi.current)
    );

    return () => {
      mainChartApi.current?.remove();
      volumeChartApi.current?.remove();
      mainChartApi.current = null;
      volumeChartApi.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 캔들 데이터 업데이트
  useEffect(() => {
    if (!klinesData || !candleSeries.current || !volumeSeries.current) return;

    const source: Candle[] | HeikinAshiCandle[] =
      candleType === 'heikinashi' ? klinesData.heikinAshi : klinesData.candles;

    const candleData = source.map((c) => ({
      time: c.time as Time,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    }));

    candleSeries.current.setData(candleData);

    // 거래량 — 집계 거래량 우선, 없으면 Binance 단일
    const aggMap = aggVolMap.current;
    const useAgg = aggMap.size > 0;

    const getQuoteVol = (c: Candle) =>
      useAgg ? (aggMap.get(c.time)?.totalQuoteVolume ?? c.volume) : c.volume;

    const qvols = klinesData.candles.map((c) => getQuoteVol(c));
    const avg20qv = (i: number) => {
      const slice = qvols.slice(Math.max(0, i - 20), i);
      return slice.reduce((a, b) => a + b, 0) / (slice.length || 1);
    };

    const volData = klinesData.candles.map((c, i) => {
      const isBull = c.close >= c.open;
      const qv = qvols[i];
      const isSpike = qv > avg20qv(i) * 2;
      const aggK = useAgg ? aggMap.get(c.time) : null;
      const hasDex = aggK ? aggK.dexRatio >= 0.2 : false;

      const baseColor = isBull ? UP_COLOR : DOWN_COLOR;
      // 이상 거래량: 밝게, DEX 20%+ 시 추가 강조 (보라)
      const color = isSpike
        ? hasDex
          ? '#a78bfa'   // DEX 활발 + 이상 거래량 = 보라
          : isBull ? '#00ff9d' : '#ff1744'
        : baseColor + '99';

      return { time: c.time as Time, value: qv, color };
    });

    volumeSeries.current.setData(volData);

    // 마커 (패턴 + 하이킨아시 반전)
    const markers: SeriesMarker<Time>[] = [];

    if (candleType === 'heikinashi') {
      (klinesData.heikinAshi as HeikinAshiCandle[]).forEach((c) => {
        if (c.isReversal === 'bearish') {
          markers.push({
            time: c.time as Time,
            position: 'aboveBar',
            color: DOWN_COLOR,
            shape: 'arrowDown',
            text: '▼',
            size: 1,
          });
        } else if (c.isReversal === 'bullish') {
          markers.push({
            time: c.time as Time,
            position: 'belowBar',
            color: UP_COLOR,
            shape: 'arrowUp',
            text: '▲',
            size: 1,
          });
        }
      });
    }

    if (showPatterns) {
      klinesData.patterns.forEach((p) => {
        const isBull = p.direction === 'bullish';
        const isNeutral = p.direction === 'neutral';
        markers.push({
          time: p.time as Time,
          position: isBull ? 'belowBar' : isNeutral ? 'inBar' : 'aboveBar',
          color: isBull ? UP_COLOR : isNeutral ? '#f59e0b' : DOWN_COLOR,
          shape: isBull ? 'arrowUp' : isNeutral ? 'circle' : 'arrowDown',
          text: p.pattern.charAt(0).toUpperCase(),
          size: 1,
        });
      });
    }

    markers.sort((a, b) => (a.time as number) - (b.time as number));
    candleSeries.current.setMarkers(markers);
    mainChartApi.current?.timeScale().fitContent();
  }, [klinesData, candleType, showPatterns]);

  // 오버레이 지표 업데이트 — 심볼/타임프레임 변경 시 기존 시리즈 제거 후 재생성
  useEffect(() => {
    if (!mainChartApi.current) return;

    // 기존 메인 차트를 재생성하여 오버레이 시리즈 초기화
    if (!mainChartRef.current) return;
    mainChartApi.current.remove();
    mainChartApi.current = createChart(mainChartRef.current, baseChartOptions(mainChartHeightRef.current));

    candleSeries.current = mainChartApi.current.addCandlestickSeries({
      upColor: UP_COLOR,
      downColor: DOWN_COLOR,
      borderUpColor: UP_COLOR,
      borderDownColor: DOWN_COLOR,
      wickUpColor: UP_COLOR,
      wickDownColor: DOWN_COLOR,
    });

    mainChartApi.current.subscribeCrosshairMove((param) => {
      if (param.time && volumeChartApi.current && volumeSeries.current) {
        try {
          volumeChartApi.current.setCrosshairPosition(0, param.time, volumeSeries.current);
        } catch {
          // series/chart mismatch during re-initialization — safe to ignore
        }
      }
    });

    // 오버레이 재생성 후 X축 동기화 재구독
    mainChartApi.current.timeScale().subscribeVisibleLogicalRangeChange((range) => {
      if (isSyncingRef.current || !range) return;
      isSyncingRef.current = true;
      volumeChartApi.current?.timeScale().setVisibleLogicalRange(range);
      subChart1Api.current?.timeScale().setVisibleLogicalRange(range);
      subChart2Api.current?.timeScale().setVisibleLogicalRange(range);
      isSyncingRef.current = false;
    });

    // 캔들 재설정 트리거를 위해 data 재적용
    if (klinesData) {
      const source = candleType === 'heikinashi' ? klinesData.heikinAshi : klinesData.candles;
      candleSeries.current.setData(
        source.map((c) => ({
          time: c.time as Time,
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
        }))
      );
    }

    if (!indData) return;
    const chart = mainChartApi.current;
    const times = indData.times;

    // BB
    if (indicators.bb && indData.bb) {
      const upper = chart.addLineSeries({ color: INDICATOR_COLORS.bb_upper, lineWidth: 1, lineStyle: LineStyle.Dashed, lastValueVisible: false, priceLineVisible: false });
      const middle = chart.addLineSeries({ color: INDICATOR_COLORS.bb_middle, lineWidth: 1, lineStyle: LineStyle.Dotted, lastValueVisible: false, priceLineVisible: false });
      const lower = chart.addLineSeries({ color: INDICATOR_COLORS.bb_lower, lineWidth: 1, lineStyle: LineStyle.Dashed, lastValueVisible: false, priceLineVisible: false });
      upper.setData(indData.bb.map((v, i) => ({ time: times[i] as Time, value: v.upper! })).filter((v) => v.value != null));
      middle.setData(indData.bb.map((v, i) => ({ time: times[i] as Time, value: v.middle! })).filter((v) => v.value != null));
      lower.setData(indData.bb.map((v, i) => ({ time: times[i] as Time, value: v.lower! })).filter((v) => v.value != null));
    }

    (['ema20', 'ema50', 'ema200'] as const).forEach((key) => {
      if (indicators[key] && indData[key]) {
        const s = chart.addLineSeries({ color: INDICATOR_COLORS[key], lineWidth: 1, lastValueVisible: true, priceLineVisible: false });
        s.setData(
          (indData[key] as (number | null)[])
            .map((v, i) => ({ time: times[i] as Time, value: v! }))
            .filter((v) => v.value != null)
        );
      }
    });

    chart.timeScale().fitContent();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [indData, indicators.bb, indicators.ema20, indicators.ema50, indicators.ema200]);

  // 서브차트 1
  useEffect(() => {
    subChart1Api.current?.remove();
    subChart1Api.current = null;
    if (!sub1 || !indData || !subChart1Ref.current) return;
    const chart = createChart(subChart1Ref.current, baseChartOptions(140));
    subChart1Api.current = chart;
    renderSubChart(chart, sub1, indData);

    // 생성 직후 메인 차트의 현재 범위 적용
    const range1 = mainChartApi.current?.timeScale().getVisibleLogicalRange();
    if (range1) chart.timeScale().setVisibleLogicalRange(range1);

    chart.timeScale().subscribeVisibleLogicalRangeChange((r) => {
      if (isSyncingRef.current || !r) return;
      isSyncingRef.current = true;
      mainChartApi.current?.timeScale().setVisibleLogicalRange(r);
      volumeChartApi.current?.timeScale().setVisibleLogicalRange(r);
      subChart2Api.current?.timeScale().setVisibleLogicalRange(r);
      isSyncingRef.current = false;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sub1, indData]);

  // 서브차트 2
  useEffect(() => {
    subChart2Api.current?.remove();
    subChart2Api.current = null;
    if (!sub2 || !indData || !subChart2Ref.current) return;
    const chart = createChart(subChart2Ref.current, baseChartOptions(140));
    subChart2Api.current = chart;
    renderSubChart(chart, sub2, indData);

    const range2 = mainChartApi.current?.timeScale().getVisibleLogicalRange();
    if (range2) chart.timeScale().setVisibleLogicalRange(range2);

    chart.timeScale().subscribeVisibleLogicalRangeChange((r) => {
      if (isSyncingRef.current || !r) return;
      isSyncingRef.current = true;
      mainChartApi.current?.timeScale().setVisibleLogicalRange(r);
      volumeChartApi.current?.timeScale().setVisibleLogicalRange(r);
      subChart1Api.current?.timeScale().setVisibleLogicalRange(r);
      isSyncingRef.current = false;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sub2, indData]);

  function renderSubChart(chart: IChartApi, indicator: string, data: typeof indData) {
    if (!data) return;
    const times = data.times;

    // null 대신 NaN 사용 → 워밍업 구간도 데이터 포인트로 유지 → 메인 차트와 logical index 일치
    if (indicator === 'rsi' && data.rsi) {
      const s = chart.addLineSeries({ color: INDICATOR_COLORS.rsi_line, lineWidth: 1, priceScaleId: 'right' });
      s.setData(data.rsi.map((v, i) => ({ time: times[i] as Time, value: v ?? NaN })));
      s.createPriceLine({ price: 70, color: DOWN_COLOR, lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: 'OB' });
      s.createPriceLine({ price: 30, color: UP_COLOR, lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: 'OS' });
    }

    if (indicator === 'macd' && data.macd) {
      const macdLine  = chart.addLineSeries({ color: INDICATOR_COLORS.macd_line,   lineWidth: 1, priceScaleId: 'right' });
      const signalLine = chart.addLineSeries({ color: INDICATOR_COLORS.macd_signal, lineWidth: 1, priceScaleId: 'right' });
      const hist = chart.addHistogramSeries({ priceScaleId: 'right' });
      macdLine.setData(data.macd.map((v, i) => ({ time: times[i] as Time, value: v.macd ?? NaN })));
      signalLine.setData(data.macd.map((v, i) => ({ time: times[i] as Time, value: v.signal ?? NaN })));
      hist.setData(data.macd.map((v, i) => ({
        time: times[i] as Time,
        value: v.histogram ?? NaN,
        color: (v.histogram ?? 0) >= 0 ? INDICATOR_COLORS.macd_hist_up : INDICATOR_COLORS.macd_hist_down,
      })));
    }

    if (indicator === 'stochRsi' && data.stochRsi) {
      const k = chart.addLineSeries({ color: INDICATOR_COLORS.stoch_k, lineWidth: 1, priceScaleId: 'right' });
      const d = chart.addLineSeries({ color: INDICATOR_COLORS.stoch_d, lineWidth: 1, priceScaleId: 'right' });
      k.setData(data.stochRsi.map((v, i) => ({ time: times[i] as Time, value: v.k ?? NaN })));
      d.setData(data.stochRsi.map((v, i) => ({ time: times[i] as Time, value: v.d ?? NaN })));
    }

    if (indicator === 'obv' && data.obv) {
      const s = chart.addLineSeries({ color: INDICATOR_COLORS.obv, lineWidth: 1, priceScaleId: 'right' });
      s.setData(data.obv.map((v, i) => ({ time: times[i] as Time, value: v ?? NaN })));
    }

    if (indicator === 'atr' && data.atr) {
      const s = chart.addLineSeries({ color: INDICATOR_COLORS.atr, lineWidth: 1, priceScaleId: 'right' });
      s.setData(data.atr.map((v, i) => ({ time: times[i] as Time, value: v ?? NaN })));
    }

    chart.timeScale().fitContent();
  }

  const aggExchangeCount = aggVolData?.[0]?.breakdown.length ?? 0;

  return (
    <div className="flex flex-col w-full h-full bg-bg overflow-hidden relative">
      {/* breakdown 툴팁 오버레이 */}
      <div
        ref={tooltipRef}
        className="absolute z-20 pointer-events-none hidden bg-card border border-border rounded px-2 py-1 shadow-lg"
        style={{ maxWidth: 320 }}
      />

      <div ref={mainChartRef} className="w-full" />

      {/* 세로 리사이즈 핸들 */}
      <div
        onMouseDown={handleMainChartDrag}
        className="h-1.5 w-full shrink-0 bg-border hover:bg-accent cursor-row-resize transition-colors select-none"
        title="드래그하여 차트 높이 조절"
      />

      {/* 거래량 차트 + 집계 출처 표시 */}
      <div className="relative border-t border-border">
        {aggExchangeCount > 1 && (
          <div className="absolute top-0.5 left-2 z-10 flex items-center gap-1">
            <span className="text-[9px] text-accent">⬡ {aggExchangeCount}개 거래소 합산</span>
          </div>
        )}
        <div ref={volumeChartRef} className="w-full" />
      </div>
      {sub1 && (
        <div className="w-full border-t border-border">
          <div className="px-3 py-0.5 text-[10px] text-text-secondary uppercase tracking-wider bg-card">
            {sub1.toUpperCase()}
          </div>
          <div ref={subChart1Ref} className="w-full" />
        </div>
      )}
      {sub2 && (
        <div className="w-full border-t border-border">
          <div className="px-3 py-0.5 text-[10px] text-text-secondary uppercase tracking-wider bg-card">
            {sub2.toUpperCase()}
          </div>
          <div ref={subChart2Ref} className="w-full" />
        </div>
      )}
    </div>
  );
}
