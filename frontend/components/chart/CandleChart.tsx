'use client';

import { useEffect, useRef, useCallback, useState } from 'react';
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
import StackedVolumeChart from './StackedVolumeChart';

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

// SVG crosshair line을 React 리렌더 없이 직접 DOM 조작
function updateVolCrosshairLine(lineEl: SVGLineElement | null, x: number | null) {
  if (!lineEl) return;
  if (x !== null) {
    lineEl.setAttribute('x1', String(x));
    lineEl.setAttribute('x2', String(x));
    lineEl.style.display = '';
  } else {
    lineEl.style.display = 'none';
  }
}

export default function CandleChart() {
  const { symbol, timeframe, candleType, indicators, showPatterns } = useChartStore();

  const mainChartHeightRef = useRef(MAIN_CHART_DEFAULT_H);
  // visibleRange 상태 변경 → StackedVolumeChart 재렌더 → timeToCoord로 바 위치 재계산
  const [visibleRange, setVisibleRange] = useState<{ from: number; to: number } | null>(null);

  const mainChartRef    = useRef<HTMLDivElement>(null);
  const subChart1Ref    = useRef<HTMLDivElement>(null);
  const subChart2Ref    = useRef<HTMLDivElement>(null);
  const tooltipRef      = useRef<HTMLDivElement>(null);
  // SVG crosshair line DOM ref — React state 없이 직접 조작해 리렌더 방지
  const volCrosshairRef = useRef<SVGLineElement | null>(null);

  const isSyncingRef     = useRef(false);
  const crosshairSyncRef = useRef(false);

  const mainChartApi  = useRef<IChartApi | null>(null);
  const subChart1Api  = useRef<IChartApi | null>(null);
  const subChart2Api  = useRef<IChartApi | null>(null);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const candleSeries       = useRef<ISeriesApi<any> | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const subChart1SeriesRef = useRef<ISeriesApi<any> | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const subChart2SeriesRef = useRef<ISeriesApi<any> | null>(null);
  // 오버레이 시리즈(BB, EMA) — 차트 재생성 없이 교체하기 위해 ref로 추적
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const overlaySeriesRef   = useRef<ISeriesApi<any>[]>([]);

  // 툴팁 전용 거래량 맵 (timestamp → AggregatedKline)
  const tooltipVolMap  = useRef<Map<number, AggregatedKline>>(new Map());
  // 크로스헤어 가격 조회용 (time → close)
  const candleDataMap  = useRef<Map<number, number>>(new Map());

  const activeList = getActiveIndicatorList(indicators);
  const subIndicators = activeList.filter((k) =>
    ['macd', 'rsi', 'stochRsi', 'obv', 'atr'].includes(k)
  );
  const sub1 = subIndicators[0];
  const sub2 = subIndicators[1];

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

  const { data: aggVolData } = useQuery({
    queryKey: ['agg-volume', stdSymbol, timeframe],
    queryFn: () => fetchAggregatedVolume(stdSymbol, timeframe, 500, true),
    refetchInterval: 60000,
    staleTime: 30000,
  });

  useEffect(() => {
    if (!aggVolData) return;
    const map = new Map<number, AggregatedKline>();
    aggVolData.forEach((k) => map.set(k.timestamp, k));
    tooltipVolMap.current = map;
  }, [aggVolData]);

  // width: 80 — 모든 차트의 rightPriceScale 폭을 동일하게 고정 → X축 바 위치 일치
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
      rightPriceScale: { borderColor: GRID_COLOR, width: 80 },
      timeScale: { borderColor: GRID_COLOR, timeVisible: true, secondsVisible: false },
      height,
    }),
    []
  );

  // 서브차트용: 수평 crosshair 숨김 (vertical line만)
  const subChartOptions = useCallback(
    (height: number) => ({
      ...baseChartOptions(height),
      crosshair: {
        mode: CrosshairMode.Normal,
        horzLine: { visible: false, labelVisible: false },
      },
    }),
    [baseChartOptions]
  );

  const timeToCoord = useCallback(
    (time: number) => mainChartApi.current?.timeScale().timeToCoordinate(time as Time) ?? null,
    []
  );

  // 메인 차트에 크로스헤어·범위 구독을 붙이는 공통 함수 (마운트 시 한 번만 호출)
  const attachMainSubscriptions = useCallback((chart: IChartApi) => {
    chart.subscribeCrosshairMove((param) => {
      // 크로스헤어 전파 (순환 방지)
      if (!crosshairSyncRef.current) {
        crosshairSyncRef.current = true;
        if (param.time) {
          if (subChart1Api.current && subChart1SeriesRef.current)
            subChart1Api.current.setCrosshairPosition(0, param.time, subChart1SeriesRef.current);
          if (subChart2Api.current && subChart2SeriesRef.current)
            subChart2Api.current.setCrosshairPosition(0, param.time, subChart2SeriesRef.current);
          updateVolCrosshairLine(volCrosshairRef.current, param.point?.x ?? null);
        } else {
          subChart1Api.current?.clearCrosshairPosition();
          subChart2Api.current?.clearCrosshairPosition();
          updateVolCrosshairLine(volCrosshairRef.current, null);
        }
        crosshairSyncRef.current = false;
      }

      // 거래소 분포 툴팁
      const tooltip = tooltipRef.current;
      if (!tooltip) return;
      if (!param.time || !param.point) {
        tooltip.style.display = 'none';
        return;
      }
      const ts = param.time as number;
      const aggK = tooltipVolMap.current.get(ts);
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
      tooltip.style.top  = `${param.point.y - 10}px`;
      tooltip.style.display = 'block';
    });

    // X축 동기화 + StackedVolumeChart 재렌더 트리거
    chart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
      if (range) setVisibleRange({ from: range.from, to: range.to });
      if (isSyncingRef.current || !range) return;
      isSyncingRef.current = true;
      subChart1Api.current?.timeScale().setVisibleLogicalRange(range);
      subChart2Api.current?.timeScale().setVisibleLogicalRange(range);
      isSyncingRef.current = false;
    });
  }, []);

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

  // SVG 거래량 차트에서 크로스헤어 이벤트 수신 → 모든 LWC 차트에 전파
  const handleVolumeCrosshair = useCallback((time: number | null) => {
    if (crosshairSyncRef.current) return;
    crosshairSyncRef.current = true;
    if (time !== null) {
      const t = time as Time;
      const price = candleDataMap.current.get(time) ?? 0;
      if (candleSeries.current) mainChartApi.current?.setCrosshairPosition(price, t, candleSeries.current);
      if (subChart1Api.current && subChart1SeriesRef.current)
        subChart1Api.current.setCrosshairPosition(0, t, subChart1SeriesRef.current);
      if (subChart2Api.current && subChart2SeriesRef.current)
        subChart2Api.current.setCrosshairPosition(0, t, subChart2SeriesRef.current);
      const x = mainChartApi.current?.timeScale().timeToCoordinate(t) ?? null;
      updateVolCrosshairLine(volCrosshairRef.current, x);
    } else {
      mainChartApi.current?.clearCrosshairPosition();
      subChart1Api.current?.clearCrosshairPosition();
      subChart2Api.current?.clearCrosshairPosition();
      updateVolCrosshairLine(volCrosshairRef.current, null);
    }
    crosshairSyncRef.current = false;
  }, []);

  // 차트 초기화
  useEffect(() => {
    if (!mainChartRef.current) return;

    mainChartApi.current?.remove();
    mainChartApi.current = createChart(mainChartRef.current, baseChartOptions(mainChartHeightRef.current));

    candleSeries.current = mainChartApi.current.addCandlestickSeries({
      upColor: UP_COLOR,
      downColor: DOWN_COLOR,
      borderUpColor: UP_COLOR,
      borderDownColor: DOWN_COLOR,
      wickUpColor: UP_COLOR,
      wickDownColor: DOWN_COLOR,
    });

    attachMainSubscriptions(mainChartApi.current);

    return () => {
      mainChartApi.current?.remove();
      mainChartApi.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 캔들 데이터 업데이트
  useEffect(() => {
    if (!klinesData || !candleSeries.current) return;

    const source: Candle[] | HeikinAshiCandle[] =
      candleType === 'heikinashi' ? klinesData.heikinAshi : klinesData.candles;

    // 크로스헤어 가격 조회용 맵 갱신 (항상 실제 캔들 close 사용)
    const priceMap = new Map<number, number>();
    (klinesData.candles as Candle[]).forEach((c) => priceMap.set(c.time, c.close));
    candleDataMap.current = priceMap;

    const candleData = source.map((c) => ({
      time: c.time as Time,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    }));

    candleSeries.current.setData(candleData);

    const markers: SeriesMarker<Time>[] = [];

    if (candleType === 'heikinashi') {
      (klinesData.heikinAshi as HeikinAshiCandle[]).forEach((c) => {
        if (c.isReversal === 'bearish') {
          markers.push({ time: c.time as Time, position: 'aboveBar', color: DOWN_COLOR, shape: 'arrowDown', text: '▼', size: 1 });
        } else if (c.isReversal === 'bullish') {
          markers.push({ time: c.time as Time, position: 'belowBar', color: UP_COLOR, shape: 'arrowUp', text: '▲', size: 1 });
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

  // 오버레이 지표 (BB, EMA) — 차트 인스턴스를 유지한 채 시리즈만 교체
  // 기존 방식(차트 destroy/recreate)을 제거해 스크롤 위치 보존 및 구독 재연결 불필요
  useEffect(() => {
    if (!mainChartApi.current) return;

    // 기존 오버레이 시리즈 제거
    overlaySeriesRef.current.forEach((s) => {
      try { mainChartApi.current!.removeSeries(s); } catch { /* 이미 제거된 경우 무시 */ }
    });
    overlaySeriesRef.current = [];

    if (!indData) return;

    const chart = mainChartApi.current;
    const times = indData.times;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const newSeries: ISeriesApi<any>[] = [];

    if (indicators.bb && indData.bb) {
      const upper  = chart.addLineSeries({ color: INDICATOR_COLORS.bb_upper,  lineWidth: 1, lineStyle: LineStyle.Dashed, lastValueVisible: false, priceLineVisible: false });
      const middle = chart.addLineSeries({ color: INDICATOR_COLORS.bb_middle, lineWidth: 1, lineStyle: LineStyle.Dotted, lastValueVisible: false, priceLineVisible: false });
      const lower  = chart.addLineSeries({ color: INDICATOR_COLORS.bb_lower,  lineWidth: 1, lineStyle: LineStyle.Dashed, lastValueVisible: false, priceLineVisible: false });
      upper.setData(indData.bb.map((v, i) => ({ time: times[i] as Time, value: v.upper! })).filter((v) => v.value != null));
      middle.setData(indData.bb.map((v, i) => ({ time: times[i] as Time, value: v.middle! })).filter((v) => v.value != null));
      lower.setData(indData.bb.map((v, i) => ({ time: times[i] as Time, value: v.lower! })).filter((v) => v.value != null));
      newSeries.push(upper, middle, lower);
    }

    (['ema20', 'ema50', 'ema200'] as const).forEach((key) => {
      if (indicators[key] && indData[key]) {
        const s = chart.addLineSeries({ color: INDICATOR_COLORS[key], lineWidth: 1, lastValueVisible: true, priceLineVisible: false });
        s.setData(
          (indData[key] as (number | null)[])
            .map((v, i) => ({ time: times[i] as Time, value: v! }))
            .filter((v) => v.value != null)
        );
        newSeries.push(s);
      }
    });

    overlaySeriesRef.current = newSeries;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [indData, indicators.bb, indicators.ema20, indicators.ema50, indicators.ema200]);

  // 서브차트 1
  useEffect(() => {
    subChart1Api.current?.remove();
    subChart1Api.current = null;
    subChart1SeriesRef.current = null;
    if (!sub1 || !indData || !subChart1Ref.current) return;

    const chart = createChart(subChart1Ref.current, subChartOptions(140));
    subChart1Api.current = chart;
    subChart1SeriesRef.current = renderSubChart(chart, sub1, indData);

    // fitContent 이후 메인 차트 범위로 덮어씌움
    // rAF 내부에서 range 읽기 — fitContent의 비동기 렌더가 완료된 뒤 정확한 range 획득
    requestAnimationFrame(() => {
      const range = mainChartApi.current?.timeScale().getVisibleLogicalRange();
      if (range) chart.timeScale().setVisibleLogicalRange(range);
    });

    // 크로스헤어 전파: sub1 → main + sub2 + volume
    chart.subscribeCrosshairMove((param) => {
      if (crosshairSyncRef.current) return;
      crosshairSyncRef.current = true;
      if (param.time) {
        const price = candleDataMap.current.get(param.time as number) ?? 0;
        if (candleSeries.current) mainChartApi.current?.setCrosshairPosition(price, param.time, candleSeries.current);
        if (subChart2Api.current && subChart2SeriesRef.current)
          subChart2Api.current.setCrosshairPosition(0, param.time, subChart2SeriesRef.current);
        const x = mainChartApi.current?.timeScale().timeToCoordinate(param.time as Time) ?? null;
        updateVolCrosshairLine(volCrosshairRef.current, x);
      } else {
        mainChartApi.current?.clearCrosshairPosition();
        subChart2Api.current?.clearCrosshairPosition();
        updateVolCrosshairLine(volCrosshairRef.current, null);
      }
      crosshairSyncRef.current = false;
    });

    chart.timeScale().subscribeVisibleLogicalRangeChange((r) => {
      if (isSyncingRef.current || !r) return;
      isSyncingRef.current = true;
      mainChartApi.current?.timeScale().setVisibleLogicalRange(r);
      subChart2Api.current?.timeScale().setVisibleLogicalRange(r);
      isSyncingRef.current = false;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sub1, indData]);

  // 서브차트 2
  useEffect(() => {
    subChart2Api.current?.remove();
    subChart2Api.current = null;
    subChart2SeriesRef.current = null;
    if (!sub2 || !indData || !subChart2Ref.current) return;

    const chart = createChart(subChart2Ref.current, subChartOptions(140));
    subChart2Api.current = chart;
    subChart2SeriesRef.current = renderSubChart(chart, sub2, indData);

    requestAnimationFrame(() => {
      const range = mainChartApi.current?.timeScale().getVisibleLogicalRange();
      if (range) chart.timeScale().setVisibleLogicalRange(range);
    });

    // 크로스헤어 전파: sub2 → main + sub1 + volume
    chart.subscribeCrosshairMove((param) => {
      if (crosshairSyncRef.current) return;
      crosshairSyncRef.current = true;
      if (param.time) {
        const price = candleDataMap.current.get(param.time as number) ?? 0;
        if (candleSeries.current) mainChartApi.current?.setCrosshairPosition(price, param.time, candleSeries.current);
        if (subChart1Api.current && subChart1SeriesRef.current)
          subChart1Api.current.setCrosshairPosition(0, param.time, subChart1SeriesRef.current);
        const x = mainChartApi.current?.timeScale().timeToCoordinate(param.time as Time) ?? null;
        updateVolCrosshairLine(volCrosshairRef.current, x);
      } else {
        mainChartApi.current?.clearCrosshairPosition();
        subChart1Api.current?.clearCrosshairPosition();
        updateVolCrosshairLine(volCrosshairRef.current, null);
      }
      crosshairSyncRef.current = false;
    });

    chart.timeScale().subscribeVisibleLogicalRangeChange((r) => {
      if (isSyncingRef.current || !r) return;
      isSyncingRef.current = true;
      mainChartApi.current?.timeScale().setVisibleLogicalRange(r);
      subChart1Api.current?.timeScale().setVisibleLogicalRange(r);
      isSyncingRef.current = false;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sub2, indData]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function renderSubChart(chart: IChartApi, indicator: string, data: typeof indData): ISeriesApi<any> | null {
    if (!data) return null;
    const times = data.times;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let primary: ISeriesApi<any> | null = null;

    if (indicator === 'rsi' && data.rsi) {
      const s = chart.addLineSeries({ color: INDICATOR_COLORS.rsi_line, lineWidth: 1, priceScaleId: 'right' });
      s.setData(data.rsi.map((v, i) => ({ time: times[i] as Time, value: v ?? NaN })));
      s.createPriceLine({ price: 70, color: DOWN_COLOR, lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: 'OB' });
      s.createPriceLine({ price: 30, color: UP_COLOR,   lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: 'OS' });
      primary = s;
    }

    if (indicator === 'macd' && data.macd) {
      const macdLine   = chart.addLineSeries({ color: INDICATOR_COLORS.macd_line,   lineWidth: 1, priceScaleId: 'right' });
      const signalLine = chart.addLineSeries({ color: INDICATOR_COLORS.macd_signal, lineWidth: 1, priceScaleId: 'right' });
      const hist       = chart.addHistogramSeries({ priceScaleId: 'right' });
      macdLine.setData(data.macd.map((v, i) => ({ time: times[i] as Time, value: v.macd ?? NaN })));
      signalLine.setData(data.macd.map((v, i) => ({ time: times[i] as Time, value: v.signal ?? NaN })));
      hist.setData(data.macd.map((v, i) => ({
        time: times[i] as Time,
        value: v.histogram ?? NaN,
        color: (v.histogram ?? 0) >= 0 ? INDICATOR_COLORS.macd_hist_up : INDICATOR_COLORS.macd_hist_down,
      })));
      primary = macdLine;
    }

    if (indicator === 'stochRsi' && data.stochRsi) {
      const k = chart.addLineSeries({ color: INDICATOR_COLORS.stoch_k, lineWidth: 1, priceScaleId: 'right' });
      const d = chart.addLineSeries({ color: INDICATOR_COLORS.stoch_d, lineWidth: 1, priceScaleId: 'right' });
      k.setData(data.stochRsi.map((v, i) => ({ time: times[i] as Time, value: v.k ?? NaN })));
      d.setData(data.stochRsi.map((v, i) => ({ time: times[i] as Time, value: v.d ?? NaN })));
      primary = k;
    }

    if (indicator === 'obv' && data.obv) {
      // priceFormat: 'volume' → LWC가 큰 OBV 값을 B/M/K로 축약 → price scale 폭이 다른 차트와 유사해짐
      const s = chart.addLineSeries({
        color: INDICATOR_COLORS.obv,
        lineWidth: 1,
        priceScaleId: 'right',
        priceFormat: { type: 'volume' },
      });
      s.setData(data.obv.map((v, i) => ({ time: times[i] as Time, value: v ?? NaN })));
      primary = s;
    }

    if (indicator === 'atr' && data.atr) {
      const s = chart.addLineSeries({ color: INDICATOR_COLORS.atr, lineWidth: 1, priceScaleId: 'right' });
      s.setData(data.atr.map((v, i) => ({ time: times[i] as Time, value: v ?? NaN })));
      primary = s;
    }

    chart.timeScale().fitContent();
    return primary;
  }

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

      {/* 거래소별 스택 거래량 */}
      <div className="border-t border-border">
        <StackedVolumeChart
          candles={klinesData?.candles ?? []}
          aggVolData={aggVolData ?? []}
          timeToCoord={timeToCoord}
          crosshairLineRef={volCrosshairRef}
          onCrosshairChange={handleVolumeCrosshair}
        />
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
