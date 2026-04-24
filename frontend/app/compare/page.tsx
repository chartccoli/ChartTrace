'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { fetchRankings, toBinanceSymbol } from '@/lib/coingecko';
import { fetchKlines } from '@/lib/binance';
import { fetchIndicators } from '@/lib/binance';
import type { Timeframe } from '@/lib/binance';
import Header from '@/components/layout/Header';

const MiniChart = dynamic(() => import('@/components/chart/MiniChart'), { ssr: false });

const TIMEFRAMES: Timeframe[] = ['15m', '1h', '4h', '1d', '1w'];
const MAX_COINS = 4;

function CompareRow({ symbol, timeframe }: { symbol: string; timeframe: Timeframe }) {
  const { data: klines } = useQuery({
    queryKey: ['klines', symbol, timeframe],
    queryFn: () => fetchKlines(symbol, timeframe, 200),
  });
  const { data: ind } = useQuery({
    queryKey: ['indicators', symbol, timeframe, ['rsi']],
    queryFn: () => fetchIndicators(symbol, timeframe, ['rsi'], 200),
  });

  const last = klines?.candles[klines.candles.length - 1];
  const first = klines?.candles[0];
  const change = last && first ? ((last.close - first.close) / first.close) * 100 : null;
  const lastRsi = ind?.rsi?.filter((v) => v !== null).slice(-1)[0] ?? null;

  return (
    <div className="bg-card border border-border rounded-lg p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-semibold text-text-primary">{symbol}</span>
        <div className="flex items-center gap-3 text-xs">
          {last && (
            <span className="text-text-primary">${last.close.toLocaleString('en-US', { maximumFractionDigits: 4 })}</span>
          )}
          {change !== null && (
            <span className={change >= 0 ? 'text-up' : 'text-down'}>
              {change >= 0 ? '+' : ''}{change.toFixed(2)}%
            </span>
          )}
          {lastRsi !== null && (
            <span className={`${lastRsi > 70 ? 'text-down' : lastRsi < 30 ? 'text-up' : 'text-text-secondary'}`}>
              RSI {lastRsi.toFixed(1)}
            </span>
          )}
        </div>
      </div>
      <div className="h-48">
        <MiniChart candles={klines?.candles ?? []} />
      </div>
    </div>
  );
}

export default function ComparePage() {
  const [selectedSymbols, setSelectedSymbols] = useState<string[]>(['BTCUSDT', 'ETHUSDT']);
  const [timeframe, setTimeframe] = useState<Timeframe>('4h');
  const [search, setSearch] = useState('');

  const { data: coins } = useQuery({
    queryKey: ['rankings'],
    queryFn: () => fetchRankings(1, 50),
    refetchInterval: 60000,
  });

  const filtered = coins?.filter(
    (c) =>
      (c.name.toLowerCase().includes(search.toLowerCase()) ||
        c.symbol.toLowerCase().includes(search.toLowerCase())) &&
      !selectedSymbols.includes(toBinanceSymbol(c.symbol))
  );

  function toggleCoin(sym: string) {
    setSelectedSymbols((prev) => {
      if (prev.includes(sym)) return prev.filter((s) => s !== sym);
      if (prev.length >= MAX_COINS) return prev;
      return [...prev, sym];
    });
  }

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-bg">
      <Header />
      <div className="flex flex-1 overflow-hidden">
        {/* 코인 선택 사이드바 */}
        <aside className="w-56 bg-card border-r border-border flex flex-col shrink-0">
          <div className="p-3 border-b border-border">
            <div className="text-xs text-text-secondary mb-2">
              코인 선택 ({selectedSymbols.length}/{MAX_COINS})
            </div>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="검색..."
              className="w-full bg-bg border border-border rounded px-2 py-1.5 text-sm text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-accent"
            />
          </div>
          {/* 선택됨 */}
          <div className="p-2 border-b border-border">
            {selectedSymbols.map((sym) => (
              <div
                key={sym}
                className="flex items-center justify-between px-2 py-1 rounded bg-accent/10 mb-1"
              >
                <span className="text-xs text-accent font-medium">{sym.replace('USDT', '')}</span>
                <button
                  onClick={() => toggleCoin(sym)}
                  className="text-text-secondary hover:text-down text-xs"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
          {/* 선택 가능 */}
          <div className="flex-1 overflow-y-auto">
            {filtered?.map((c) => {
              const sym = toBinanceSymbol(c.symbol);
              return (
                <button
                  key={c.id}
                  onClick={() => toggleCoin(sym)}
                  disabled={selectedSymbols.length >= MAX_COINS}
                  className="w-full flex items-center gap-2 px-3 py-2 hover:bg-bg transition-colors disabled:opacity-40"
                >
                  <img src={c.image} alt={c.symbol} className="w-4 h-4 rounded-full" />
                  <span className="text-xs text-text-primary">{c.symbol.toUpperCase()}</span>
                  <span className="text-xs text-text-secondary ml-auto">
                    #{c.market_cap_rank}
                  </span>
                </button>
              );
            })}
          </div>
        </aside>

        {/* 메인 콘텐츠 */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* 타임프레임 */}
          <div className="flex items-center gap-1 px-4 py-2 border-b border-border bg-card">
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

          {/* 차트 그리드 */}
          <div className="flex-1 overflow-auto p-4">
            <div
              className={`grid gap-3 h-full ${
                selectedSymbols.length <= 2 ? 'grid-cols-1 lg:grid-cols-2' : 'grid-cols-2'
              }`}
            >
              {selectedSymbols.map((sym) => (
                <CompareRow key={sym} symbol={sym} timeframe={timeframe} />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
