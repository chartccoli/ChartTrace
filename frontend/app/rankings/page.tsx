'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { fetchRankings, CoinMarket } from '@/lib/coingecko';
import Header from '@/components/layout/Header';
import RankRow from '@/components/rankings/RankRow';

// ─── 섹터 정의 ────────────────────────────────────────────────────────────────
const SECTOR_MAP: Record<string, string[]> = {
  'Layer 1': ['BTC', 'ETH', 'SOL', 'ADA', 'AVAX', 'DOT', 'ATOM', 'NEAR', 'APT', 'SUI', 'TON', 'TRX', 'XLM', 'ALGO', 'ICP', 'HBAR', 'VET', 'ETC', 'XMR', 'EGLD'],
  'DeFi': ['UNI', 'AAVE', 'CAKE', 'CRV', 'MKR', 'COMP', 'SNX', 'LDO', 'RPL', 'GMX', 'DYDX', 'BAL', 'YFI', 'SUSHI', 'INJ', 'PENDLE'],
  'Exchange': ['BNB', 'OKB', 'CRO', 'GT', 'KCS', 'HT', 'MX'],
  'Stablecoin': ['USDT', 'USDC', 'DAI', 'BUSD', 'TUSD', 'FDUSD', 'PYUSD', 'FRAX'],
  'Gaming': ['AXS', 'MANA', 'SAND', 'ENJ', 'GALA', 'IMX', 'RON', 'MAGIC', 'GMT', 'STEPN'],
  'AI': ['FET', 'AGIX', 'OCEAN', 'RNDR', 'WLD', 'TAO', 'GRT', 'AKT', 'NMR'],
  'Layer 2': ['MATIC', 'POL', 'OP', 'ARB', 'IMX', 'STRK', 'METIS', 'BOBA', 'ZK'],
};

type Tab = '1-50' | '51-100' | 'sector';

function TableHeader() {
  return (
    <thead>
      <tr className="border-b border-border text-text-secondary text-xs">
        <th className="pb-2 px-3 text-center w-10">#</th>
        <th className="pb-2 px-2 text-left">코인</th>
        <th className="pb-2 px-2 text-right">가격</th>
        <th className="pb-2 px-2 text-right">24h</th>
        <th className="pb-2 px-2 text-right">7d</th>
        <th className="pb-2 px-2 text-center">순위변동 7d</th>
        <th className="pb-2 px-2 text-right">순위 히스토리</th>
      </tr>
    </thead>
  );
}

function CoinTable({ coins }: { coins: CoinMarket[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <TableHeader />
        <tbody>
          {coins.map((coin) => (
            <RankRow key={coin.id} coin={coin} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SectorBadge({ sector, active, onClick }: { sector: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors border
        ${active
          ? 'bg-accent text-white border-accent'
          : 'bg-card text-text-secondary border-border hover:border-accent/50 hover:text-text-primary'
        }`}
    >
      {sector}
    </button>
  );
}

export default function RankingsPage() {
  const [tab, setTab] = useState<Tab>('1-50');
  const [activeSector, setActiveSector] = useState<string>('Layer 1');

  const { data: coins1to50, isLoading: loading1 } = useQuery({
    queryKey: ['rankings', 1],
    queryFn: () => fetchRankings(1, 50),
    refetchInterval: 60 * 1000,
    enabled: tab === '1-50' || tab === 'sector',
  });

  const { data: coins51to100, isLoading: loading2 } = useQuery({
    queryKey: ['rankings', 2],
    queryFn: () => fetchRankings(2, 50),
    refetchInterval: 60 * 1000,
    enabled: tab === '51-100',
  });

  const allCoins = [...(coins1to50 ?? []), ...(coins51to100 ?? [])];

  const sectorCoins = (coins1to50 ?? []).filter((c) =>
    (SECTOR_MAP[activeSector] ?? []).includes(c.symbol.toUpperCase())
  );

  const tabs: { id: Tab; label: string }[] = [
    { id: '1-50', label: '1 ~ 50위' },
    { id: '51-100', label: '51 ~ 100위' },
    { id: 'sector', label: '섹터별' },
  ];

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-bg">
      <Header />

      <div className="flex-1 overflow-y-auto">
        {/* 페이지 헤더 */}
        <div className="px-6 pt-5 pb-0">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h1 className="text-xl font-bold text-text-primary">시총 순위 변동</h1>
              <p className="text-xs text-text-secondary mt-0.5">
                7일 순위 히스토리 · 스파크라인 · 실시간 시총 순위
              </p>
            </div>
          </div>

          {/* 탭 */}
          <div className="flex gap-1 border-b border-border">
            {tabs.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px
                  ${tab === t.id
                    ? 'border-accent text-accent'
                    : 'border-transparent text-text-secondary hover:text-text-primary'
                  }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* 탭 콘텐츠 */}
        <div className="px-6 py-4">

          {/* 섹터 필터 (섹터별 탭에서만) */}
          {tab === 'sector' && (
            <div className="flex flex-wrap gap-2 mb-4">
              {Object.keys(SECTOR_MAP).map((sector) => (
                <SectorBadge
                  key={sector}
                  sector={sector}
                  active={activeSector === sector}
                  onClick={() => setActiveSector(sector)}
                />
              ))}
            </div>
          )}

          {/* 로딩 */}
          {((tab === '1-50' && loading1) ||
            (tab === '51-100' && loading2) ||
            (tab === 'sector' && loading1)) && (
            <div className="text-text-secondary text-sm py-8 text-center">로딩 중...</div>
          )}

          {/* 1~50위 */}
          {tab === '1-50' && !loading1 && coins1to50 && (
            <CoinTable coins={coins1to50} />
          )}

          {/* 51~100위 */}
          {tab === '51-100' && !loading2 && coins51to100 && (
            <CoinTable coins={coins51to100} />
          )}

          {/* 섹터별 */}
          {tab === 'sector' && !loading1 && (
            <>
              {sectorCoins.length === 0 ? (
                <div className="text-text-secondary text-sm py-8 text-center">
                  이 섹터의 코인이 Top 50에 없습니다.
                </div>
              ) : (
                <CoinTable coins={sectorCoins} />
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
