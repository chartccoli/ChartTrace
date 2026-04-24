'use client';

import Link from 'next/link';
import { useChartStore } from '@/lib/store';
import type { Timeframe } from '@/lib/binance';

const TIMEFRAMES: Timeframe[] = ['15m', '1h', '4h', '1d', '1w'];

export default function Header() {
  const { symbol, timeframe, setTimeframe } = useChartStore();

  return (
    <header className="flex items-center gap-4 h-12 px-4 border-b border-border bg-card shrink-0">
      {/* 로고 */}
      <Link href="/" className="text-base font-bold text-accent shrink-0">
        ChartTrace
      </Link>

      <div className="w-px h-5 bg-border shrink-0" />

      {/* 현재 심볼 */}
      <span className="text-sm font-semibold text-text-primary shrink-0">{symbol}</span>

      <div className="w-px h-5 bg-border shrink-0" />

      {/* 타임프레임 선택 */}
      <div className="flex items-center gap-1">
        {TIMEFRAMES.map((tf) => (
          <button
            key={tf}
            onClick={() => setTimeframe(tf)}
            className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
              timeframe === tf
                ? 'bg-accent text-white'
                : 'text-text-secondary hover:text-text-primary hover:bg-bg'
            }`}
          >
            {tf}
          </button>
        ))}
      </div>

      <div className="flex-1" />

      {/* 네비게이션 */}
      <nav className="flex items-center gap-1">
        <Link
          href="/"
          className="px-3 py-1 rounded text-xs text-text-secondary hover:text-text-primary hover:bg-bg transition-colors"
        >
          차트
        </Link>
        <Link
          href="/compare"
          className="px-3 py-1 rounded text-xs text-text-secondary hover:text-text-primary hover:bg-bg transition-colors"
        >
          비교
        </Link>
        <Link
          href="/rankings"
          className="px-3 py-1 rounded text-xs text-text-secondary hover:text-text-primary hover:bg-bg transition-colors"
        >
          순위
        </Link>
      </nav>
    </header>
  );
}
