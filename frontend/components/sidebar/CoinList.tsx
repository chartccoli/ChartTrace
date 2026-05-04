'use client';

import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { fetchRankings, toBinanceSymbol, CoinMarket } from '@/lib/coingecko';
import { fetchBatchSignalScores, SignalScore } from '@/lib/binance';
import { useChartStore } from '@/lib/store';
import { ScoreBadge } from '@/components/chart/SignalScore';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

type SortMode = 'rank' | 'score' | 'change24h';

const STABLECOINS = new Set([
  // USD 스테이블코인
  'USDT', 'USDC', 'DAI', 'BUSD', 'TUSD', 'FDUSD', 'PYUSD', 'FRAX',
  'USDP', 'GUSD', 'LUSD', 'USDD', 'USTC', 'SUSD', 'USDS', 'USDE',
  'SUSDE', 'RLUSD',
  // 기타 법정화폐 스테이블코인
  'EURS',
  // 래핑/스테이킹 토큰
  'STETH', 'WBTC', 'WETH', 'WBETH', 'WEETH', 'RETH', 'CBBTC',
]);

function useRealtimePrices(symbols: string[]) {
  const [prices, setPrices] = useState<Record<string, { price: number; change: number }>>({});
  const wsRef = useRef<WebSocket | null>(null);
  const symbolsKey = symbols.join(',');

  useEffect(() => {
    if (symbols.length === 0) return;

    const ws = new WebSocket(API_BASE.replace('http', 'ws') + '/ws');
    wsRef.current = ws;

    ws.onopen = () => {
      symbols.forEach((sym) => {
        ws.send(JSON.stringify({ type: 'subscribe', symbol: sym, interval: '1m' }));
      });
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.e === 'kline') {
          const k = data.k;
          const sym = k.s as string;
          const close = parseFloat(k.c);
          const open = parseFloat(k.o);
          const change = ((close - open) / open) * 100;
          setPrices((prev) => ({ ...prev, [sym]: { price: close, change } }));
        }
      } catch {}
    };

    return () => {
      ws.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbolsKey]);

  return prices;
}

function formatPrice(price: number): string {
  if (price >= 1000) return price.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (price >= 1) return price.toFixed(4);
  return price.toFixed(6);
}

function PriceChange({ value }: { value: number | null | undefined }) {
  if (value == null) return <span className="text-[11px] text-text-secondary">—</span>;
  const isUp = value >= 0;
  return (
    <span className={`text-[11px] font-medium ${isUp ? 'text-up' : 'text-down'}`}>
      {isUp ? '+' : ''}
      {value.toFixed(2)}%
    </span>
  );
}

export default function CoinList() {
  const { symbol: activeSymbol, setSymbol } = useChartStore();
  const [search, setSearch] = useState('');
  const [sortMode, setSortMode] = useState<SortMode>('score');

  const { data: coins, isLoading } = useQuery({
    queryKey: ['rankings'],
    queryFn: () => fetchRankings(1, 200),
    refetchInterval: 60000,
  });

  // 스테이블코인·래핑 자산 제거 — 신호 계산·WebSocket 구독 대상에서도 완전히 제외
  const tradableCoins = (coins ?? []).filter(
    (c) => !STABLECOINS.has(c.symbol.toUpperCase())
  );
  const symbols = tradableCoins.map((c) => toBinanceSymbol(c.symbol));

  // WebSocket 실시간 가격: 시총 상위 50개만 구독 (200개 동시 구독은 과부하)
  const top50Symbols = symbols.slice(0, 50);
  const realtimePrices = useRealtimePrices(top50Symbols);

  // Signal Score 배치 조회: 100개씩 2번 나눠서 요청 (2분 주기)
  const { data: scoreMap } = useQuery({
    queryKey: ['batch-scores', symbols.join(',')],
    queryFn: async () => {
      const chunks = [symbols.slice(0, 100), symbols.slice(100)].filter((c) => c.length > 0);
      const results = await Promise.all(chunks.map(fetchBatchSignalScores));
      return Object.assign({}, ...results) as Record<string, any>;
    },
    enabled: symbols.length > 0,
    refetchInterval: 120000,
    staleTime: 60000,
  });

  const filtered = tradableCoins.filter(
    (c) =>
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      c.symbol.toLowerCase().includes(search.toLowerCase())
  );

  const sorted = [...filtered].sort((a, b) => {
    if (sortMode === 'score') {
      const symA = toBinanceSymbol(a.symbol);
      const symB = toBinanceSymbol(b.symbol);
      const sa = scoreMap?.[symA]?.score ?? 0;
      const sb = scoreMap?.[symB]?.score ?? 0;
      return sb - sa;
    }
    if (sortMode === 'change24h') {
      return (b.price_change_percentage_24h ?? 0) - (a.price_change_percentage_24h ?? 0);
    }
    return (a.market_cap_rank ?? 99) - (b.market_cap_rank ?? 99);
  });

  return (
    <aside className="flex flex-col h-full bg-card border-r border-border w-64 shrink-0">
      {/* 검색 */}
      <div className="p-3 border-b border-border">
        <input
          type="text"
          placeholder="코인 검색..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full bg-bg border border-border rounded-md px-3 py-1.5 text-sm text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-accent"
        />
      </div>

      {/* 정렬 탭 */}
      <div className="flex border-b border-border">
        {([['score', '신호'], ['change24h', '등락'], ['rank', '순위']] as const).map(
          ([mode, label]) => (
            <button
              key={mode}
              onClick={() => setSortMode(mode)}
              className={`flex-1 py-1.5 text-[11px] font-medium transition-colors ${
                sortMode === mode
                  ? 'text-accent border-b-2 border-accent'
                  : 'text-text-secondary hover:text-text-primary'
              }`}
            >
              {label}
            </button>
          )
        )}
      </div>

      {/* 코인 목록 */}
      <div className="flex-1 overflow-y-auto">
        {isLoading && (
          <div className="flex items-center justify-center h-20 text-text-secondary text-sm">
            로딩 중...
          </div>
        )}
        {sorted.map((coin) => {
          const binSym = toBinanceSymbol(coin.symbol);
          const rt = realtimePrices[binSym];
          const price = rt?.price ?? coin.current_price;
          const change = rt?.change ?? coin.price_change_percentage_24h;
          const isActive = binSym === activeSymbol;
          const score: SignalScore | undefined = scoreMap?.[binSym];

          return (
            <button
              key={coin.id}
              onClick={() => setSymbol(binSym)}
              className={`w-full flex items-center gap-2 px-3 py-2 hover:bg-bg transition-colors ${
                isActive ? 'bg-accent/10 border-l-2 border-accent' : 'border-l-2 border-transparent'
              }`}
            >
              <span className="text-[11px] text-text-secondary w-4 shrink-0 text-right">
                {coin.market_cap_rank}
              </span>
              <img src={coin.image} alt={coin.symbol} className="w-5 h-5 rounded-full shrink-0" />
              <div className="flex flex-col items-start min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="text-[12px] font-semibold text-text-primary">
                    {coin.symbol.toUpperCase()}
                  </span>
                  <ScoreBadge score={score} />
                </div>
                <span className="text-[10px] text-text-secondary">${formatPrice(price)}</span>
              </div>
              <PriceChange value={change} />
            </button>
          );
        })}
      </div>
    </aside>
  );
}
