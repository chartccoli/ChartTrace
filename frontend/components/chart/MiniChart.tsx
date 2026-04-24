'use client';

import { useEffect, useRef } from 'react';
import { createChart, IChartApi, ColorType, CrosshairMode } from 'lightweight-charts';
import { Candle } from '@/lib/binance';
import type { Time } from 'lightweight-charts';

const UP_COLOR = '#2ebd85';
const DOWN_COLOR = '#f6465d';

export default function MiniChart({ candles }: { candles: Candle[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    chartRef.current?.remove();

    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: '#12121a' },
        textColor: '#6b6b80',
      },
      grid: {
        vertLines: { color: '#1e1e2e' },
        horzLines: { color: '#1e1e2e' },
      },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: '#1e1e2e', scaleMargins: { top: 0.1, bottom: 0.1 } },
      timeScale: { borderColor: '#1e1e2e', timeVisible: true },
      height: containerRef.current.clientHeight || 192,
    });

    chartRef.current = chart;

    const series = chart.addCandlestickSeries({
      upColor: UP_COLOR,
      downColor: DOWN_COLOR,
      borderUpColor: UP_COLOR,
      borderDownColor: DOWN_COLOR,
      wickUpColor: UP_COLOR,
      wickDownColor: DOWN_COLOR,
    });

    if (candles.length > 0) {
      series.setData(
        candles.map((c) => ({
          time: c.time as Time,
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
        }))
      );
      chart.timeScale().fitContent();
    }

    return () => {
      chart.remove();
      chartRef.current = null;
    };
  }, [candles]);

  return <div ref={containerRef} className="w-full h-full" />;
}
