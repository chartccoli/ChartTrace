'use client';

import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchRankHistoryBatch } from '@/lib/binance';
import { fetchRankings } from '@/lib/coingecko';

// ─── 상수 ─────────────────────────────────────────────────────────────────────
const STABLECOINS = new Set([
  'USDT', 'USDC', 'DAI', 'BUSD', 'TUSD', 'FDUSD', 'PYUSD', 'FRAX',
  'USDP', 'GUSD', 'LUSD', 'USDD', 'USTC', 'SUSD', 'EURS',
  'STETH', 'WBTC', 'WETH', 'WBETH',
]);

const SECTORS: Record<string, string[]> = {
  'L1':     ['BTC', 'ETH', 'SOL', 'ADA', 'AVAX', 'DOT', 'ATOM', 'NEAR', 'APT', 'SUI', 'TON', 'TRX', 'ICP', 'HBAR'],
  'DeFi':   ['UNI', 'AAVE', 'LDO', 'MKR', 'CRV', 'GMX', 'DYDX', 'INJ', 'PENDLE', 'RPL'],
  'CEX':    ['BNB', 'OKB', 'CRO', 'GT', 'KCS'],
  'Gaming': ['AXS', 'MANA', 'SAND', 'GALA', 'IMX', 'RON'],
  'AI':     ['FET', 'AGIX', 'RNDR', 'WLD', 'TAO', 'GRT', 'OCEAN'],
  'L2':     ['MATIC', 'POL', 'OP', 'ARB', 'STRK', 'METIS'],
};

const COLORS = [
  '#5b6af0', '#2ebd85', '#f59e0b', '#a78bfa', '#06b6d4',
  '#84cc16', '#f97316', '#ec4899', '#14b8a6', '#8b5cf6',
  '#10b981', '#3b82f6', '#eab308', '#f43f5e', '#22d3ee',
  '#fb923c', '#4ade80', '#c084fc', '#38bdf8', '#fbbf24',
];

// ─── SVG 레이아웃 ──────────────────────────────────────────────────────────────
const PAD = { left: 30, right: 88, top: 12, bottom: 20 };
const VW  = 860;
const VH  = 152;
const IW  = VW - PAD.left - PAD.right;
const IH  = VH - PAD.top  - PAD.bottom;

interface Pt { rank: number; timestamp: number }

// 베지에 곡선 경로 생성
function smoothPath(pts: { x: number; y: number }[]): string {
  if (pts.length === 0) return '';
  if (pts.length === 1) return `M${pts[0].x},${pts[0].y}`;
  let d = `M${pts[0].x},${pts[0].y}`;
  for (let i = 1; i < pts.length; i++) {
    const prev = pts[i - 1];
    const curr = pts[i];
    const cpx  = (prev.x + curr.x) / 2;
    d += ` C${cpx},${prev.y} ${cpx},${curr.y} ${curr.x},${curr.y}`;
  }
  return d;
}

// ─── 범프 차트 ────────────────────────────────────────────────────────────────
function BumpChart({
  histories,
  colorMap,
  top5Set,
  highlight,
  onHover,
}: {
  histories: Record<string, Pt[]>;
  colorMap: Record<string, string>;
  top5Set: Set<string>;
  highlight: string;
  onHover: (s: string | null) => void;
}) {
  const now     = Math.floor(Date.now() / 1000);
  const minTime = now - 30 * 24 * 3600;

  // 최신 순위 기준 정렬된 항목
  const entries = Object.entries(histories)
    .filter(([, pts]) => pts.length >= 2)
    .map(([sym, pts]) => {
      const sorted = [...pts].sort((a, b) => a.timestamp - b.timestamp);
      return { sym, pts: sorted, first: sorted[0], last: sorted[sorted.length - 1] };
    })
    .sort((a, b) => a.last.rank - b.last.rank);

  if (entries.length === 0) return null;

  // Y축 범위: 상위 5개 항목의 현재 순위만 기준으로 계산
  // (숨겨진 하위 코인들의 순위가 Y축을 불필요하게 늘리는 문제 방지)
  const top5Entries = entries.slice(0, 5);
  const displayRanks = top5Entries.map((e) => e.last.rank);
  const loRank = Math.max(1, Math.min(...displayRanks) - 1);
  const hiRank = Math.max(...displayRanks) + 3;
  const rankSpan = hiRank - loRank || 1;

  const toX = (ts: number) =>
    PAD.left + Math.min(1, Math.max(0, (ts - minTime) / (now - minTime))) * IW;
  const toY = (rank: number) =>
    PAD.top + (rank - loRank) / rankSpan * IH;

  // 격자
  const gridStep = rankSpan <= 6 ? 1 : rankSpan <= 12 ? 2 : rankSpan <= 25 ? 5 : 10;
  const gridRanks: number[] = [];
  for (let r = Math.ceil(loRank / gridStep) * gridStep; r <= hiRank; r += gridStep) {
    gridRanks.push(r);
  }

  // 라벨 Y 겹침 방지 (12px 최소 간격)
  const MIN_GAP = 12;
  const labelY: Record<string, number> = {};
  let prevY = -Infinity;
  for (const { sym, last } of entries) {
    const raw = toY(last.rank);
    const y   = Math.max(raw, prevY + MIN_GAP);
    labelY[sym] = y;
    prevY = y;
  }

  const hlColor = colorMap[highlight] ?? '#5b6af0';
  const hlEntry = entries.find((e) => e.sym === highlight);

  return (
    <svg viewBox={`0 0 ${VW} ${VH}`} className="w-full h-full" style={{ overflow: 'visible' }}>
      <defs>
        {/* 강조 코인 그라디언트 면적 */}
        <linearGradient id="hlGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor={hlColor} stopOpacity={0.18} />
          <stop offset="100%" stopColor={hlColor} stopOpacity={0.0}  />
        </linearGradient>
      </defs>

      {/* 격자 */}
      {gridRanks.map((r) => (
        <g key={r}>
          <line x1={PAD.left} y1={toY(r)} x2={PAD.left + IW} y2={toY(r)}
            stroke="#1e1e2e" strokeWidth={0.8} />
          <text x={PAD.left - 5} y={toY(r)} fill="#3a3a4a" fontSize={8}
            textAnchor="end" dominantBaseline="middle">{r}</text>
        </g>
      ))}

      {/* 비강조 라인 (뒤에 그리기) */}
      {entries
        .filter(({ sym }) => sym !== highlight)
        .map(({ sym, pts }) => {
          const isTop5 = top5Set.has(sym);
          const color  = colorMap[sym] ?? '#555';
          // hiRank 범위 밖 포인트 제거 (스파이크 방지)
          const visible = pts.filter((p) => p.rank >= loRank - 1 && p.rank <= hiRank + 1);
          if (visible.length < 2) return null;
          const coords = visible.map((p) => ({ x: toX(p.timestamp), y: toY(p.rank) }));
          return (
            <path
              key={sym}
              d={smoothPath(coords)}
              fill="none"
              stroke={color}
              strokeWidth={isTop5 ? 1.8 : 1.1}
              strokeDasharray={isTop5 ? undefined : '5 3'}
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity={isTop5 ? 0.6 : 0.25}
              style={{ cursor: 'pointer' }}
              onMouseEnter={() => onHover(sym)}
              onMouseLeave={() => onHover(null)}
            />
          );
        })}

      {/* 강조 코인 그라디언트 면적 */}
      {hlEntry && (() => {
        const visiblePts = hlEntry.pts.filter((p) => p.rank >= loRank - 1 && p.rank <= hiRank + 1);
        if (visiblePts.length < 2) return null;
        const coords = visiblePts.map((p) => ({ x: toX(p.timestamp), y: toY(p.rank) }));
        const lastX  = coords[coords.length - 1].x;
        const firstX = coords[0].x;
        const bottom = PAD.top + IH;
        const area   = smoothPath(coords) + ` L${lastX},${bottom} L${firstX},${bottom} Z`;
        return <path d={area} fill="url(#hlGrad)" />;
      })()}

      {/* 강조 라인 (앞에 그리기) */}
      {hlEntry && (() => {
        const visiblePts = hlEntry.pts.filter((p) => p.rank >= loRank - 1 && p.rank <= hiRank + 1);
        if (visiblePts.length < 2) return null;
        const coords = visiblePts.map((p) => ({ x: toX(p.timestamp), y: toY(p.rank) }));
        return (
          <g>
            <path
              d={smoothPath(coords)}
              fill="none"
              stroke={hlColor}
              strokeWidth={3}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            {visiblePts.map((p, i) => (
              <circle key={i} cx={toX(p.timestamp)} cy={toY(p.rank)} r={3.2} fill={hlColor}
                stroke="#0a0a0f" strokeWidth={1.2} />
            ))}
          </g>
        );
      })()}

      {/* 오른쪽 라벨 */}
      {entries.map(({ sym, first, last }) => {
        const isHL   = sym === highlight;
        const isTop5 = top5Set.has(sym);
        if (!isHL && !isTop5) return null;
        const color   = colorMap[sym] ?? '#555';
        const y       = labelY[sym] ?? toY(last.rank);
        const delta   = first.rank - last.rank; // 양수 = 순위 상승
        // ±1은 시딩 근사값 오차 범위 → 표시하지 않음
        const showDelta = Math.abs(delta) >= 2;
        const deltaStr = !showDelta ? '' : delta > 0 ? ` ▲${delta}` : ` ▼${Math.abs(delta)}`;
        const deltaColor = delta > 0 ? '#2ebd85' : delta < 0 ? '#f6465d' : '#6b6b80';
        return (
          <g key={sym} style={{ cursor: 'pointer' }}
            onMouseEnter={() => onHover(sym)}
            onMouseLeave={() => onHover(null)}>
            {/* 연결선 */}
            <line
              x1={toX(last.timestamp)} y1={toY(last.rank)}
              x2={PAD.left + IW + 5}   y2={y}
              stroke={color} strokeWidth={0.6} opacity={isHL ? 0.5 : 0.3}
              strokeDasharray="2 2"
            />
            <text x={PAD.left + IW + 7} y={y - 1}
              fill={color} fontSize={isHL ? 10 : 8.5} fontWeight={isHL ? 700 : 400}
              dominantBaseline="middle" opacity={isHL ? 1 : 0.8}>
              {sym.replace('USDT', '')} <tspan fill="#6b6b80">#{last.rank}</tspan>
              {showDelta && <tspan fill={deltaColor} fontSize={isHL ? 9 : 7.5}>{deltaStr}</tspan>}
            </text>
          </g>
        );
      })}

      {/* X축 */}
      <text x={PAD.left}      y={VH - 4} fill="#3a3a4a" fontSize={8}>30일 전</text>
      <text x={PAD.left + IW} y={VH - 4} fill="#3a3a4a" fontSize={8} textAnchor="end">현재</text>
    </svg>
  );
}

// ─── 메인 컴포넌트 ─────────────────────────────────────────────────────────────
type FilterTab = 'all' | keyof typeof SECTORS;

export default function RankSubChart({ symbol }: { symbol: string }) {
  const [filter, setFilter]   = useState<FilterTab>('all');
  const [hovered, setHovered] = useState<string | null>(null);

  const { data: rankings } = useQuery({
    queryKey: ['rankings', 1],
    queryFn:  () => fetchRankings(1, 50),
    staleTime: 5 * 60 * 1000,
  });

  // 대상 심볼 목록 — 스테이블코인 제외
  const targetSymbols = useMemo(() => {
    if (!rankings) return [];
    const base = rankings.filter((c) => !STABLECOINS.has(c.symbol.toUpperCase()));
    const coins =
      filter === 'all'
        ? base.slice(0, 20)
        : base.filter((c) => (SECTORS[filter as string] ?? []).includes(c.symbol.toUpperCase()));
    return coins.map((c) => c.symbol.toUpperCase() + 'USDT');
  }, [rankings, filter]);

  const { data: histories, isLoading } = useQuery({
    queryKey: ['rank-history-batch', targetSymbols.join(',')],
    queryFn:  () => fetchRankHistoryBatch(targetSymbols),
    enabled:  targetSymbols.length > 0,
    staleTime: 5 * 60 * 1000,
  });

  // 심볼 → 색상 고정 매핑
  const colorMap = useMemo(() => {
    const map: Record<string, string> = {};
    targetSymbols.forEach((sym, i) => { map[sym] = COLORS[i % COLORS.length]; });
    return map;
  }, [targetSymbols]);

  // 포인트 2개 이상인 코인만 사용
  const validHistories = useMemo(() => {
    if (!histories) return {};
    const out: Record<string, Pt[]> = {};
    for (const [sym, pts] of Object.entries(histories)) {
      if (pts.length >= 2) out[sym] = pts;
    }
    return out;
  }, [histories]);

  // 최신 순위 기준 상위 5개 심볼
  const top5Set = useMemo(() => {
    const sorted = Object.entries(validHistories)
      .map(([sym, pts]) => {
        const last = [...pts].sort((a, b) => a.timestamp - b.timestamp).at(-1);
        return { sym, rank: last?.rank ?? 999 };
      })
      .sort((a, b) => a.rank - b.rank)
      .slice(0, 5);
    return new Set(sorted.map((e) => e.sym));
  }, [validHistories]);

  const hasData = Object.keys(validHistories).length > 0;
  const highlight = hovered ?? symbol;

  const tabs: { id: FilterTab; label: string }[] = [
    { id: 'all', label: 'Top 20' },
    ...Object.keys(SECTORS).map((k) => ({ id: k as FilterTab, label: k })),
  ];

  return (
    <div className="flex flex-col w-full h-full">
      {/* 필터 탭 */}
      <div className="flex items-center gap-1 px-2 py-0.5 bg-card border-b border-border shrink-0 overflow-x-auto">
        <span className="text-[9px] text-text-secondary shrink-0 mr-1">시총 순위 변동</span>
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setFilter(t.id)}
            className={`px-2 py-0.5 rounded text-[10px] font-medium whitespace-nowrap transition-colors ${
              filter === t.id
                ? 'bg-accent/20 text-accent'
                : 'text-text-secondary hover:text-text-primary'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* 차트 */}
      <div className="flex-1 min-h-0 relative">
        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center text-text-secondary text-xs">
            로딩 중...
          </div>
        )}
        {!isLoading && !hasData && (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-text-secondary text-xs gap-1">
            <span>순위 히스토리 수집 중</span>
            <span className="text-[10px]">서버 실행 후 데이터가 누적됩니다</span>
          </div>
        )}
        {hasData && (
          <BumpChart
            histories={validHistories}
            colorMap={colorMap}
            top5Set={top5Set}
            highlight={highlight}
            onHover={setHovered}
          />
        )}
      </div>
    </div>
  );
}
