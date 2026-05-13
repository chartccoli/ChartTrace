'use client';

import { useMemo, useRef, RefObject } from 'react';
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
  // crosshair line을 React state 없이 DOM ref로 직접 조작 (마우스 이동마다 리렌더 방지)
  crosshairLineRef?: RefObject<SVGLineElement>;
  onCrosshairChange?: (time: number | null) => void;
}

export default function StackedVolumeChart({ candles, aggVolData, timeToCoord, height = 88, crosshairLineRef, onCrosshairChange }: Props) {
  // 툴팁 DOM ref — React 상태 없이 직접 조작
  const tooltipRef = useRef<HTMLDivElement>(null);

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
    if (bars.length === 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    let closest = bars[0];
    let minDist = Math.abs(bars[0].x - mx);
    for (let i = 1; i < bars.length; i++) {
      const dist = Math.abs(bars[i].x - mx);
      if (dist < minDist) { minDist = dist; closest = bars[i]; }
    }
    onCrosshairChange?.(closest.candle.time);

    // 거래소 분포 툴팁
    const tooltip = tooltipRef.current;
    if (!tooltip) return;
    const aggK = closest.aggK;
    if (!aggK || aggK.breakdown.length === 0) {
      tooltip.style.display = 'none';
      return;
    }
    const sorted = [...aggK.breakdown].sort((a, b) => b.quoteVolume - a.quoteVolume);
    const lines = sorted
      .map((b) => `<span style="color:${b.type === 'DEX' ? '#a78bfa' : '#e2e2e8'}">${exchangeLabel(b.exchange)}</span> <span style="color:#6b6b80">${b.share.toFixed(1)}%</span>`)
      .join(' · ');
    const dexTag = aggK.dexRatio >= 0.2
      ? `<span style="color:#a78bfa;margin-left:6px">⬡ 온체인</span>`
      : '';
    tooltip.innerHTML = `<div style="font-size:10px;white-space:nowrap">${lines}${dexTag}</div>`;
    // 툴팁 위치: 마우스 오른쪽, 우측 끝 근처면 왼쪽으로 반전
    const tipW = 320;
    const left = mx + 8 + tipW > rect.width ? Math.max(0, mx - tipW - 8) : mx + 8;
    tooltip.style.left = `${left}px`;
    tooltip.style.top = '4px';
    tooltip.style.display = 'block';
  };

  const handleMouseLeave = () => {
    onCrosshairChange?.(null);
    if (tooltipRef.current) tooltipRef.current.style.display = 'none';
  };

  return (
    <div className="w-full flex flex-col" style={{ position: 'relative' }}>
      {/* 거래소 분포 툴팁 — 거래량 차트 내부에 절대 위치 */}
      <div
        ref={tooltipRef}
        className="pointer-events-none bg-card border border-border rounded px-2 py-1 shadow-lg"
        style={{ display: 'none', position: 'absolute', zIndex: 20, maxWidth: 480 }}
      />
      <svg
        width="100%"
        height={height}
        style={{ display: 'block', overflow: 'visible' }}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
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
        {/* 항상 렌더, 초기 hidden — CandleChart가 DOM ref로 직접 위치 조작 */}
        <line
          ref={crosshairLineRef}
          x1={0} x2={0}
          y1={0} y2={height}
          stroke="#6b6b80"
          strokeWidth={1}
          style={{ display: 'none', pointerEvents: 'none' }}
        />
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
