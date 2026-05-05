'use client';

import { useMemo } from 'react';
import type { Candle, AggregatedKline } from '@/lib/binance';

const EXCHANGE_COLORS: Record<string, string> = {
  // CEX
  'binance':     '#F0B90B',
  'okx':         '#7B8FA1',
  'bybit':       '#FF6B35',
  'mexc':        '#16C784',
  'kucoin':      '#00A3FF',
  'bitget':      '#00F0FF',
  'htx':         '#2DB7F5',
  'gateio':      '#E040FB',
  'kraken':      '#5741D9',
  'coinbase':    '#4D8EFF',
  'cryptocom':   '#103F68',
  'upbit':       '#1AC8DB',
  // DEX
  'hyperliquid': '#00E5A0',
  'uniswap':     '#FF007A',
  'pancakeswap': '#1FC7D4',
  'dydx':        '#6966FF',
};

const EXCHANGE_LABELS: Record<string, string> = {
  'binance':     'Binance',
  'okx':         'OKX',
  'bybit':       'Bybit',
  'mexc':        'MEXC',
  'kucoin':      'KuCoin',
  'bitget':      'Bitget',
  'htx':         'HTX',
  'gateio':      'Gate.io',
  'kraken':      'Kraken',
  'coinbase':    'Coinbase',
  'cryptocom':   'Crypto.com',
  'upbit':       'Upbit',
  'hyperliquid': 'Hyperliquid',
  'uniswap':     'Uniswap',
  'pancakeswap': 'PancakeSwap',
  'dydx':        'dYdX',
};

function exchangeColor(name: string) {
  return EXCHANGE_COLORS[name.toLowerCase()] ?? '#6b6b80';
}

function exchangeLabel(name: string) {
  return EXCHANGE_LABELS[name.toLowerCase()] ?? name;
}

interface Props {
  candles: Candle[];
  aggVolData: AggregatedKline[];
  timeToCoord: (time: number) => number | null;
  height?: number;
  crosshairX?: number | null;
  onCrosshairChange?: (time: number | null) => void;
}

export default function StackedVolumeChart({ candles, aggVolData, timeToCoord, height = 88, crosshairX, onCrosshairChange }: Props) {
  // aggVolData가 바뀔 때만 Map 재생성
  const aggVolMap = useMemo(() => {
    const map = new Map<number, AggregatedKline>();
    aggVolData.forEach((k) => map.set(k.timestamp, k));
    return map;
  }, [aggVolData]);

  // 매 렌더마다 호출 — 부모의 visibleRange state 변화로 re-render 발생 시 최신 좌표 반영
  const bars = candles
    .map((candle) => {
      const x = timeToCoord(candle.time);
      if (x === null) return null;
      return { x, candle, aggK: aggVolMap.get(candle.time) };
    })
    .filter((b): b is NonNullable<typeof b> => b !== null);

  if (bars.length === 0) return <div style={{ height }} />;

  // 인접한 두 바의 간격으로 바 너비 계산 (LWC barSpacing과 자동 일치)
  const barHalfW =
    bars.length >= 2 ? Math.abs(bars[1].x - bars[0].x) * 0.38 : 4;

  const maxVol = Math.max(
    ...bars.map((b) => b.aggK?.totalQuoteVolume ?? b.candle.volume),
    1
  );

  // 범례용 거래소 목록 (중복 제거)
  const seenExchanges: string[] = [];
  bars.forEach((b) => {
    b.aggK?.breakdown.forEach((bd) => {
      if (!seenExchanges.includes(bd.exchange)) seenExchanges.push(bd.exchange);
    });
  });

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!onCrosshairChange || bars.length === 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    let closest = bars[0];
    let minDist = Math.abs(bars[0].x - mx);
    for (let i = 1; i < bars.length; i++) {
      const dist = Math.abs(bars[i].x - mx);
      if (dist < minDist) { minDist = dist; closest = bars[i]; }
    }
    onCrosshairChange(closest.candle.time);
  };

  return (
    <div className="w-full flex flex-col" style={{ overflow: 'hidden' }}>
      <svg
        width="100%"
        height={height}
        style={{ display: 'block', overflow: 'visible' }}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => onCrosshairChange?.(null)}
      >
        {bars.map(({ x, candle, aggK }) => {
          const totalVol = aggK?.totalQuoteVolume ?? candle.volume;
          const totalH   = (totalVol / maxVol) * height;
          const barX     = x - barHalfW;
          const barW     = barHalfW * 2;

          // breakdown 없으면 단색 폴백
          if (!aggK || aggK.breakdown.length === 0) {
            const isBull = candle.close >= candle.open;
            return (
              <rect
                key={candle.time}
                x={barX}
                width={Math.max(barW, 1)}
                y={height - totalH}
                height={Math.max(totalH, 1)}
                fill={isBull ? '#2ebd8570' : '#f6465d70'}
              />
            );
          }

          // 거래량 내림차순 쌓기 (큰 거래소가 아래)
          const sorted = [...aggK.breakdown].sort((a, b) => b.quoteVolume - a.quoteVolume);
          let yStack = height;

          return (
            <g key={candle.time}>
              {sorted.map((b) => {
                const segH = (b.quoteVolume / maxVol) * height;
                yStack -= segH;
                return (
                  <rect
                    key={b.exchange}
                    x={barX}
                    width={Math.max(barW, 1)}
                    y={yStack}
                    height={Math.max(segH, 0.5)}
                    fill={exchangeColor(b.exchange)}
                    opacity={0.9}
                  />
                );
              })}
            </g>
          );
        })}
        {crosshairX !== null && crosshairX !== undefined && (
          <line
            x1={crosshairX} x2={crosshairX}
            y1={0} y2={height}
            stroke="#6b6b80"
            strokeWidth={1}
            style={{ pointerEvents: 'none' }}
          />
        )}
      </svg>

      {seenExchanges.length > 0 && (
        <div className="flex flex-wrap gap-x-3 px-2 py-0.5 bg-card">
          {seenExchanges.map((ex) => (
            <span key={ex} className="flex items-center gap-1 text-[9px] text-text-secondary">
              <span className="inline-block w-2 h-2 rounded-sm shrink-0"
                style={{ backgroundColor: exchangeColor(ex) }} />
              {exchangeLabel(ex)}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
