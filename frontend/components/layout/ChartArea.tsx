'use client';

import dynamic from 'next/dynamic';
import { useQuery } from '@tanstack/react-query';
import { useChartStore } from '@/lib/store';
import { fetchSignalScore } from '@/lib/binance';
import { SignalScorePanel } from '@/components/chart/SignalScore';

const CandleChart = dynamic(() => import('@/components/chart/CandleChart'), {
  ssr: false,
  loading: () => (
    <div className="flex-1 flex items-center justify-center text-text-secondary text-sm">
      차트 로딩 중...
    </div>
  ),
});

const RankCompareView = dynamic(() => import('@/components/chart/RankCompareView'), {
  ssr: false,
});

export default function ChartArea() {
  const { symbol, viewMode, setViewMode } = useChartStore();

  const { data: signalScore } = useQuery({
    queryKey: ['signal-score', symbol],
    queryFn: () => fetchSignalScore(symbol),
    refetchInterval: 60000,
    staleTime: 30000,
  });

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* 헤더: 시그널 점수 + 뷰 모드 탭 */}
      <div className="px-3 pt-2 pb-1 border-b border-border shrink-0">
        <div className="flex items-center gap-3">
          <SignalScorePanel score={signalScore} />
          <div className="flex-1" />
          {/* 뷰 모드 탭 */}
          <div className="flex rounded border border-border overflow-hidden">
            {(['chart', 'rankings'] as const).map((mode) => (
              <button
                key={mode}
                onClick={() => setViewMode(mode)}
                className={`text-xs px-3 py-1.5 transition-colors ${
                  viewMode === mode
                    ? 'bg-accent/20 text-accent border-r border-border last:border-r-0'
                    : 'text-text-secondary hover:text-text-primary border-r border-border last:border-r-0'
                }`}
              >
                {mode === 'chart' ? '캔들' : '순위 비교'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 콘텐츠 영역 */}
      <div className="flex-1 overflow-hidden min-h-0">
        {viewMode === 'chart' ? <CandleChart /> : <RankCompareView />}
      </div>
    </div>
  );
}
