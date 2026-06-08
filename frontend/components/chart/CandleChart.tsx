'use client';

import { useEffect, useRef, useCallback, useState } from 'react';
import {
  createChart,
  IChartApi,
  ISeriesApi,
  ColorType,
  CrosshairMode,
  PriceScaleMode,
  SeriesMarker,
  Time,
  LineStyle,
} from 'lightweight-charts';
import { useQuery } from '@tanstack/react-query';
import { fetchKlines, fetchIndicators, fetchAggregatedVolume, fetchFuturesData, FuturesKline, Candle, HeikinAshiCandle } from '@/lib/binance';
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

const SUB_CHART_DEFAULT_H = 140;
const SUB_CHART_MIN_H     = 60;
const SUB_CHART_MAX_H     = 400;

const HEIGHTS_STORAGE_KEY = 'charttrace_heights';

function loadStoredHeights(): { main: number; indicators: Record<string, number>; logScale: boolean } {
  if (typeof window === 'undefined') return { main: MAIN_CHART_DEFAULT_H, indicators: {}, logScale: false };
  try {
    const raw = localStorage.getItem(HEIGHTS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        main: typeof parsed.main === 'number' ? parsed.main : MAIN_CHART_DEFAULT_H,
        indicators: parsed.indicators && typeof parsed.indicators === 'object' ? parsed.indicators : {},
        logScale: parsed.logScale === true,
      };
    }
  } catch {}
  return { main: MAIN_CHART_DEFAULT_H, indicators: {}, logScale: false };
}

function saveStoredHeights(main: number, indicators: Record<string, number>, logScale: boolean) {
  try { localStorage.setItem(HEIGHTS_STORAGE_KEY, JSON.stringify({ main, indicators, logScale })); } catch {}
}

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
  const subHeightsRef      = useRef<Record<string, number>>({});
  const [isLogScale, setIsLogScale] = useState(false);
  // visibleRange 상태 변경 → StackedVolumeChart 재렌더 → timeToCoord로 바 위치 재계산
  const [visibleRange, setVisibleRange] = useState<{ from: number; to: number } | null>(null);

  const mainChartRef    = useRef<HTMLDivElement>(null);
  const subChart1Ref    = useRef<HTMLDivElement>(null);
  const subChart2Ref    = useRef<HTMLDivElement>(null);
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

  // 크로스헤어 가격 조회용 (time → close)
  const candleDataMap  = useRef<Map<number, number>>(new Map());

  const activeList = getActiveIndicatorList(indicators);
  const subIndicators = activeList.filter((k) =>
    ['macd', 'rsi', 'stochRsi', 'obv', 'atr', 'fr', 'oi'].includes(k)
  );
  const sub1 = subIndicators[0];
  const sub2 = subIndicators[1];

  const needsFutures = indicators.fr || indicators.oi;

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

  const { data: futuresData } = useQuery({
    queryKey: ['futures', symbol, timeframe],
    queryFn: () => fetchFuturesData(symbol, timeframe, 500),
    enabled: needsFutures,
    refetchInterval: 240000, // 4분
    staleTime: 120000,
  });

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

  // fitContent → 가격축 autoScale → 최신 캔들 중앙(60/40) 정렬
  const fitAndCenter = useCallback(() => {
    const chart = mainChartApi.current;
    if (!chart) return;
    chart.timeScale().fitContent();
    chart.priceScale('right').applyOptions({ autoScale: true });
    // fitContent 렌더 완료 후 range 읽어 최신 캔들을 60% 지점으로 이동
    requestAnimationFrame(() => {
      const range = chart.timeScale().getVisibleLogicalRange();
      if (!range) return;
      const width = range.to - range.from;
      chart.timeScale().setVisibleLogicalRange({
        from: range.to - width * 0.6,
        to:   range.to + width * 0.4,
      });
      chart.priceScale('right').applyOptions({ autoScale: true });
      subChart1Api.current?.priceScale('right').applyOptions({ autoScale: true });
      subChart2Api.current?.priceScale('right').applyOptions({ autoScale: true });
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
      saveStoredHeights(mainChartHeightRef.current, subHeightsRef.current, isLogScale);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [isLogScale]);

  const handleSub1Drag = useCallback((e: React.MouseEvent) => {
    if (!sub1) return;
    e.preventDefault();
    const startY = e.clientY;
    const startH = subHeightsRef.current[sub1] ?? SUB_CHART_DEFAULT_H;
    const onMove = (ev: MouseEvent) => {
      const newH = Math.max(SUB_CHART_MIN_H, Math.min(SUB_CHART_MAX_H, startH + ev.clientY - startY));
      subHeightsRef.current[sub1] = newH;
      subChart1Api.current?.applyOptions({ height: newH });
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      saveStoredHeights(mainChartHeightRef.current, subHeightsRef.current, isLogScale);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [sub1, isLogScale]);

  const handleSub2Drag = useCallback((e: React.MouseEvent) => {
    if (!sub2) return;
    e.preventDefault();
    const startY = e.clientY;
    const startH = subHeightsRef.current[sub2] ?? SUB_CHART_DEFAULT_H;
    const onMove = (ev: MouseEvent) => {
      const newH = Math.max(SUB_CHART_MIN_H, Math.min(SUB_CHART_MAX_H, startH + ev.clientY - startY));
      subHeightsRef.current[sub2] = newH;
      subChart2Api.current?.applyOptions({ height: newH });
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      saveStoredHeights(mainChartHeightRef.current, subHeightsRef.current, isLogScale);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [sub2, isLogScale]);

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

  // localStorage에서 높이 + 로그 척도 복원 (차트 init 이후 클라이언트에서만 실행)
  useEffect(() => {
    const stored = loadStoredHeights();
    mainChartHeightRef.current = stored.main;
    mainChartApi.current?.applyOptions({ height: stored.main });
    subHeightsRef.current = stored.indicators;
    if (stored.logScale) {
      setIsLogScale(true);
      mainChartApi.current?.priceScale('right').applyOptions({ mode: PriceScaleMode.Logarithmic });
    }
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
    fitAndCenter();
  }, [klinesData, candleType, showPatterns, fitAndCenter]);

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
    const isFuturesSub1 = sub1 === 'fr' || sub1 === 'oi';
    if (!sub1 || (!indData && !isFuturesSub1) || !subChart1Ref.current) return;

    const chart = createChart(subChart1Ref.current, subChartOptions(subHeightsRef.current[sub1] ?? SUB_CHART_DEFAULT_H));
    subChart1Api.current = chart;
    subChart1SeriesRef.current = renderSubChart(chart, sub1, indData, futuresData);

    // fitContent 이후 메인 차트 범위로 덮어씌움
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
  }, [sub1, indData, futuresData]);

  // 서브차트 2
  useEffect(() => {
    subChart2Api.current?.remove();
    subChart2Api.current = null;
    subChart2SeriesRef.current = null;
    const isFuturesSub2 = sub2 === 'fr' || sub2 === 'oi';
    if (!sub2 || (!indData && !isFuturesSub2) || !subChart2Ref.current) return;

    const chart = createChart(subChart2Ref.current, subChartOptions(subHeightsRef.current[sub2] ?? SUB_CHART_DEFAULT_H));
    subChart2Api.current = chart;
    subChart2SeriesRef.current = renderSubChart(chart, sub2, indData, futuresData);

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
  }, [sub2, indData, futuresData]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function renderSubChart(chart: IChartApi, indicator: string, data: typeof indData, futures?: FuturesKline[]): ISeriesApi<any> | null {
    // FR / OI — futures 데이터로 렌더 (indData 불필요)
    if (indicator === 'fr') {
      if (!futures || futures.length === 0) return null;
      const hist = chart.addHistogramSeries({
        priceScaleId: 'right',
        priceFormat: { type: 'custom', formatter: (v: number) => `${v.toFixed(4)}%` },
      });
      hist.setData(futures.map((f) => ({
        time: f.timestamp as Time,
        value: f.fundingRateDailyPct,
        color: f.fundingRateDailyPct >= 0 ? '#2ebd8599' : '#f6465d99',
      })));
      hist.createPriceLine({ price: 0, color: '#6b6b80', lineWidth: 1, lineStyle: LineStyle.Solid, axisLabelVisible: false, title: '' });
      chart.timeScale().fitContent();
      return hist;
    }

    if (indicator === 'oi') {
      if (!futures || futures.length === 0) return null;
      const s = chart.addLineSeries({
        color: '#a78bfa',
        lineWidth: 1,
        priceScaleId: 'right',
        priceFormat: { type: 'volume' },
      });
      s.setData(futures.map((f) => ({ time: f.timestamp as Time, value: f.openInterestUsd })));
      chart.timeScale().fitContent();
      return s;
    }

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

  const handleFitContent = useCallback(() => fitAndCenter(), [fitAndCenter]);

  const handleToggleLogScale = useCallback(() => {
    setIsLogScale((prev) => {
      const next = !prev;
      mainChartApi.current?.priceScale('right').applyOptions({
        mode: next ? PriceScaleMode.Logarithmic : PriceScaleMode.Normal,
      });
      saveStoredHeights(mainChartHeightRef.current, subHeightsRef.current, next);
      return next;
    });
  }, []);

  return (
    <div className="flex flex-col w-full h-full bg-bg overflow-hidden relative">
      {/* 차트 우상단 버튼 그룹 */}
      <div className="absolute top-2 right-[88px] z-10 flex items-center gap-1">
        {/* Log Scale 토글 */}
        <button
          onClick={handleToggleLogScale}
          title="로그 척도 토글"
          className={`flex items-center justify-center w-6 h-6 rounded border text-[9px] font-bold transition-colors ${
            isLogScale
              ? 'bg-accent border-accent text-white'
              : 'bg-card/80 border-border text-text-secondary hover:text-text hover:bg-card'
          }`}
        >
          Log
        </button>
        {/* Fit Content */}
        <button
          onClick={handleFitContent}
          title="화면에 맞춤 (Fit Content)"
          className="flex items-center justify-center w-6 h-6 rounded bg-card/80 border border-border text-text-secondary hover:text-text hover:bg-card transition-colors"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M1 5V1h4M9 1h4v4M13 9v4H9M5 13H1V9" />
          </svg>
        </button>
      </div>
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
          <div
            onMouseDown={handleSub1Drag}
            className="h-1.5 w-full shrink-0 bg-border hover:bg-accent cursor-row-resize transition-colors select-none"
            title="드래그하여 차트 높이 조절"
          />
        </div>
      )}
      {sub2 && (
        <div className="w-full border-t border-border">
          <div className="px-3 py-0.5 text-[10px] text-text-secondary uppercase tracking-wider bg-card">
            {sub2.toUpperCase()}
          </div>
          <div ref={subChart2Ref} className="w-full" />
          <div
            onMouseDown={handleSub2Drag}
            className="h-1.5 w-full shrink-0 bg-border hover:bg-accent cursor-row-resize transition-colors select-none"
            title="드래그하여 차트 높이 조절"
          />
        </div>
      )}
    </div>
  );
}
