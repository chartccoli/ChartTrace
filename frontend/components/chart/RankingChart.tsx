'use client';

import { useEffect, useRef } from 'react';
import { createChart, IChartApi, ColorType } from 'lightweight-charts';
import { useQuery } from '@tanstack/react-query';
import { fetchCoinHistory } from '@/lib/coingecko';
import type { Time } from 'lightweight-charts';

export default function RankingChart({ coinId }: { coinId: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);

  const { data } = useQuery({
    queryKey: ['coin-history', coinId],
    queryFn: () => fetchCoinHistory(coinId),
    staleTime: 5 * 60 * 1000,
  });

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
      rightPriceScale: { borderColor: '#1e1e2e' },
      timeScale: { borderColor: '#1e1e2e', timeVisible: true },
      height: containerRef.current.clientHeight || 192,
    });

    chartRef.current = chart;

    if (data?.prices) {
      const priceSeries = chart.addLineSeries({ color: '#5b6af0', lineWidth: 2 });
      priceSeries.setData(
        data.prices.map(([ts, price]: [number, number]) => ({
          time: Math.floor(ts / 1000) as Time,
          value: price,
        }))
      );
      chart.timeScale().fitContent();
    }

    return () => {
      chart.remove();
      chartRef.current = null;
    };
  }, [data]);

  return (
    <div className="w-full h-full relative">
      {!data && (
        <div className="absolute inset-0 flex items-center justify-center text-text-secondary text-xs">
          로딩 중...
        </div>
      )}
      <div ref={containerRef} className="w-full h-full" />
    </div>
  );
}
