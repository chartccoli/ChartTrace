'use client';

import { useChartStore, ActiveIndicators } from '@/lib/store';
import { INDICATOR_LABELS, OVERLAY_INDICATORS, SUB_CHART_INDICATORS } from '@/components/chart/Indicators';
import { useQuery } from '@tanstack/react-query';
import { fetchKlines } from '@/lib/binance';

function Toggle({ active, onChange }: { active: boolean; onChange: () => void }) {
  return (
    <button
      onClick={onChange}
      className={`w-8 h-4 rounded-full transition-colors relative ${
        active ? 'bg-accent' : 'bg-border'
      }`}
    >
      <span
        className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform ${
          active ? 'translate-x-4' : 'translate-x-0.5'
        }`}
      />
    </button>
  );
}

function IndicatorRow({
  label,
  active,
  onToggle,
  badge,
}: {
  label: string;
  active: boolean;
  onToggle: () => void;
  badge?: string;
}) {
  return (
    <div className="flex items-center justify-between px-3 py-1.5 hover:bg-bg rounded transition-colors">
      <div className="flex items-center gap-2">
        <span className="text-sm text-text-primary">{label}</span>
        {badge && (
          <span className="text-[10px] text-text-secondary bg-border px-1.5 py-0.5 rounded">
            {badge}
          </span>
        )}
      </div>
      <Toggle active={active} onChange={onToggle} />
    </div>
  );
}

export default function IndicatorPanel() {
  const { indicators, toggleIndicator, candleType, setCandleType, showPatterns, togglePatterns, viewMode, setViewMode, symbol, timeframe } =
    useChartStore();

  const { data: klinesData } = useQuery({
    queryKey: ['klines', symbol, timeframe],
    queryFn: () => fetchKlines(symbol, timeframe, 500),
  });

  const lastCandle = klinesData?.candles[klinesData.candles.length - 1];
  const prevCandle = klinesData?.candles[klinesData.candles.length - 2];
  const change24h =
    lastCandle && prevCandle
      ? ((lastCandle.close - prevCandle.close) / prevCandle.close) * 100
      : null;

  // 매수/매도 비율 계산 (Taker Buy Volume)
  const lastN = klinesData?.candles.slice(-20) ?? [];
  const totalVol = lastN.reduce((a, c) => a + c.volume, 0);
  const buyVol = lastN.reduce((a, c) => a + (c.takerBuyVolume ?? 0), 0);
  const buyRatio = totalVol > 0 ? (buyVol / totalVol) * 100 : null;

  const activeSubCount = (Object.keys(indicators) as (keyof ActiveIndicators)[]).filter(
    (k) => indicators[k] && SUB_CHART_INDICATORS.includes(k as any)
  ).length;

  return (
    <aside className="flex flex-col h-full bg-card border-l border-border w-56 shrink-0 overflow-y-auto">
      {/* 코인 정보 */}
      <div className="p-3 border-b border-border">
        <div className="text-xs text-text-secondary mb-1">현재 가격</div>
        {lastCandle ? (
          <>
            <div className="text-lg font-semibold text-text-primary">
              ${lastCandle.close.toLocaleString('en-US', { maximumFractionDigits: 4 })}
            </div>
            {change24h !== null && (
              <span className={`text-sm font-medium ${change24h >= 0 ? 'text-up' : 'text-down'}`}>
                {change24h >= 0 ? '+' : ''}{change24h.toFixed(2)}%
              </span>
            )}
          </>
        ) : (
          <div className="text-sm text-text-secondary">—</div>
        )}
      </div>

      {/* 거래량 분석 */}
      {buyRatio !== null && (
        <div className="p-3 border-b border-border">
          <div className="text-xs text-text-secondary mb-2">매수/매도 비율 (20봉)</div>
          <div className="flex h-2 rounded-full overflow-hidden">
            <div
              className="bg-up transition-all"
              style={{ width: `${buyRatio}%` }}
            />
            <div className="bg-down flex-1" />
          </div>
          <div className="flex justify-between mt-1">
            <span className="text-xs text-up">매수 {buyRatio.toFixed(1)}%</span>
            <span className="text-xs text-down">매도 {(100 - buyRatio).toFixed(1)}%</span>
          </div>
        </div>
      )}

      {/* 순위 비교 뷰 토글 */}
      <div className="px-3 py-2 border-b border-border">
        <IndicatorRow
          label="순위 비교 차트"
          active={viewMode === 'rankings'}
          onToggle={() => setViewMode(viewMode === 'rankings' ? 'chart' : 'rankings')}
        />
      </div>

      {/* 캔들 타입 */}
      <div className="p-3 border-b border-border">
        <div className="text-xs text-text-secondary mb-2">캔들 타입</div>
        <div className="flex gap-1">
          {(['normal', 'heikinashi'] as const).map((type) => (
            <button
              key={type}
              onClick={() => setCandleType(type)}
              className={`flex-1 py-1 rounded text-xs font-medium transition-colors ${
                candleType === type
                  ? 'bg-accent text-white'
                  : 'bg-bg text-text-secondary hover:text-text-primary'
              }`}
            >
              {type === 'normal' ? '일반' : '하이킨아시'}
            </button>
          ))}
        </div>
      </div>

      {/* 패턴 인식 */}
      <div className="px-3 py-2 border-b border-border">
        <IndicatorRow label="패턴 감지" active={showPatterns} onToggle={togglePatterns} />
      </div>

      {/* 오버레이 지표 */}
      <div className="p-3 border-b border-border">
        <div className="text-xs text-text-secondary mb-2 uppercase tracking-wider">오버레이</div>
        {OVERLAY_INDICATORS.map((key) => (
          <IndicatorRow
            key={key}
            label={INDICATOR_LABELS[key]}
            active={indicators[key as keyof ActiveIndicators]}
            onToggle={() => toggleIndicator(key as keyof ActiveIndicators)}
          />
        ))}
      </div>

      {/* 서브차트 지표 */}
      <div className="p-3">
        <div className="flex items-center justify-between mb-2">
          <div className="text-xs text-text-secondary uppercase tracking-wider">서브 차트</div>
          <span className="text-xs text-text-secondary">{activeSubCount}/2</span>
        </div>
        {SUB_CHART_INDICATORS.map((key) => {
          const isActive = indicators[key as keyof ActiveIndicators];
          const isDisabled = !isActive && activeSubCount >= 2;
          return (
            <div key={key} className={isDisabled ? 'opacity-40 pointer-events-none' : ''}>
              <IndicatorRow
                label={INDICATOR_LABELS[key]}
                active={isActive}
                onToggle={() => toggleIndicator(key as keyof ActiveIndicators)}
                badge={isDisabled ? '최대 2개' : undefined}
              />
            </div>
          );
        })}
      </div>
    </aside>
  );
}
