'use client';

import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchRankHistoryBatch } from '@/lib/binance';
import { fetchRankings } from '@/lib/coingecko';
import { useChartStore } from '@/lib/store';

// ─── 상수 ─────────────────────────────────────────────────────────────────────
const STABLECOINS = new Set([
  'USDT', 'USDC', 'DAI', 'BUSD', 'TUSD', 'FDUSD', 'PYUSD', 'FRAX',
  'USDP', 'GUSD', 'LUSD', 'USDD', 'USTC', 'SUSD', 'EURS', 'USDS', 'USDE', 'SUSDE',
  'STETH', 'WBTC', 'WETH', 'WBETH', 'WEETH', 'RETH', 'CBBTC',
]);

// 순위 범위 탭 — 25 단위 균등 구간
const RANK_RANGES = [
  { id: '1-25',   label: '1 ~ 25위',   lo: 1,   hi: 25  },
  { id: '26-50',  label: '26 ~ 50위',  lo: 26,  hi: 50  },
  { id: '51-75',  label: '51 ~ 75위',  lo: 51,  hi: 75  },
  { id: '76-100', label: '76 ~ 100위', lo: 76,  hi: 100 },
] as const;
type RangeId = typeof RANK_RANGES[number]['id'];

// 섹터 정의 — CoinGecko 심볼 기준 (XXXUSDT 변환 전)
const SECTORS: Record<string, string[]> = {
  'L1':       ['BTC','ETH','BNB','XRP','SOL','ADA','AVAX','DOT','TRX','NEAR',
                'ATOM','TON','LTC','BCH','XLM','APT','SUI','ICP','FIL','SEI',
                'INJ','ALGO','HBAR','FTM','XTZ','EOS','EGLD','ONE','KAVA','ZIL'],
  'L2':       ['POL','MATIC','OP','ARB','IMX','STX','ZK','STRK','MNT',
                'METIS','CELO','ZETA','BOBA','SKL','MANTA','SCROLL','BLAST',
                'MODE','TAIKO','LINEA','KROMA'],
  'DeFi':     ['UNI','AAVE','MKR','CRV','COMP','LDO','GMX','DYDX','CAKE',
                'PENDLE','JUP','RAY','BAL','SNX','SUSHI','1INCH','CVX','FXS',
                'OSMO','RUNE','BLUR','LOOKS'],
  'AI':       ['FET','AGIX','OCEAN','RENDER','TAO','WLD','GRT','ARKM','VIRTUAL',
                'NMR','ALT','RSS3','ORDI','OLAS'],
  'Meme':     ['DOGE','SHIB','PEPE','FLOKI','BONK','WIF','POPCAT','MEW','NEIRO',
                'TURBO','BRETT','COQ','BOME'],
  '게임':      ['AXS','SAND','MANA','ENJ','GALA','MAGIC','BEAM','YGG','ILV',
                'RON','ALICE','GMT','SLP','HERO','IMX'],
  'ISO20022': ['XRP','XLM','HBAR','ALGO','QNT','XDC','IOTA'],
  'Privacy':  ['XMR','ZEC','DASH','SCRT','ROSE','FIRO','DERO','KMD','BEAM'],
};
type SectorId = keyof typeof SECTORS;
const SECTOR_IDS = Object.keys(SECTORS) as SectorId[];

type FilterMode = 'rank' | 'sector';

// 시간 범위 — 180일은 200d seed anchor 포함을 위해 windowDays=210 사용
const TIME_RANGES = [
  { days: 30,  label: '30일',  windowDays: 32  },
  { days: 90,  label: '90일',  windowDays: 93  },
  { days: 180, label: '180일', windowDays: 210 },
] as const;
type TimeRangeDays = typeof TIME_RANGES[number]['days'];

const COLORS = [
  '#5b6af0', '#2ebd85', '#f59e0b', '#a78bfa', '#06b6d4',
  '#84cc16', '#f97316', '#ec4899', '#14b8a6', '#8b5cf6',
  '#10b981', '#3b82f6', '#eab308', '#f43f5e', '#22d3ee',
  '#fb923c', '#4ade80', '#c084fc', '#38bdf8', '#fbbf24',
  '#60a5fa', '#34d399', '#fca5a5', '#d8b4fe', '#67e8f9',
  '#a3e635', '#fdba74', '#f9a8d4', '#5eead4', '#c4b5fd',
];

// ─── SVG 레이아웃 ──────────────────────────────────────────────────────────────
const PAD = { left: 40, right: 112, top: 20, bottom: 28 };
const VW  = 960;
const VH  = 460;
const IW  = VW - PAD.left - PAD.right;
const IH  = VH - PAD.top  - PAD.bottom;

interface Pt { rank: number; timestamp: number }

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

// 섹터 내 상대 순위 계산
// 각 타임스탬프에서 해당 코인들의 글로벌 순위를 기준으로 섹터 내 순위(1위=시총 최대)를 재산정
function computeSectorRanks(
  globalHistories: Record<string, Pt[]>,
  sectorSymbols: string[],
): Record<string, Pt[]> {
  const tsSet = new Set<number>();
  for (const sym of sectorSymbols) {
    for (const pt of globalHistories[sym] ?? []) tsSet.add(pt.timestamp);
  }

  const result: Record<string, Pt[]> = {};

  for (const ts of Array.from(tsSet)) {
    const present: { sym: string; globalRank: number }[] = [];
    for (const sym of sectorSymbols) {
      const pt = (globalHistories[sym] ?? []).find((p) => p.timestamp === ts);
      if (pt) present.push({ sym, globalRank: pt.rank });
    }
    present.sort((a, b) => a.globalRank - b.globalRank);
    present.forEach(({ sym }, idx) => {
      if (!result[sym]) result[sym] = [];
      result[sym].push({ rank: idx + 1, timestamp: ts });
    });
  }

  for (const sym of Object.keys(result)) {
    result[sym].sort((a, b) => a.timestamp - b.timestamp);
  }
  return result;
}

// ─── 풀사이즈 범프 차트 ────────────────────────────────────────────────────────
function BumpChartFull({
  histories,
  colorMap,
  highlight,
  onHover,
  yAxisLabel = '시총 순위',
  rangeMinTime,
}: {
  histories: Record<string, Pt[]>;
  colorMap: Record<string, string>;
  highlight: string;
  onHover: (s: string | null) => void;
  yAxisLabel?: string;
  rangeMinTime: number;
}) {
  const now = Math.floor(Date.now() / 1000);

  const entries = Object.entries(histories)
    .filter(([, pts]) => pts.length >= 2)
    .map(([sym, pts]) => {
      // 선택된 시간 범위 내 데이터만 사용
      const inRange = [...pts]
        .filter((p) => p.timestamp >= rangeMinTime)
        .sort((a, b) => a.timestamp - b.timestamp);
      if (inRange.length < 2) return null;
      return { sym, pts: inRange, first: inRange[0], last: inRange[inRange.length - 1] };
    })
    .filter((e): e is NonNullable<typeof e> => e !== null)
    .sort((a, b) => a.last.rank - b.last.rank);

  if (entries.length === 0) return null;

  const allCurrentRanks = entries.map((e) => e.last.rank);
  const loRank  = Math.max(1, Math.min(...allCurrentRanks) - 1);
  const hiRank  = Math.min(105, Math.max(...allCurrentRanks) + 3);
  const rankSpan = hiRank - loRank || 1;

  const toX = (ts: number) =>
    PAD.left + Math.min(1, Math.max(0, (ts - rangeMinTime) / (now - rangeMinTime))) * IW;
  const toY = (rank: number) =>
    PAD.top + (rank - loRank) / rankSpan * IH;

  const gridStep = rankSpan <= 10 ? 1 : rankSpan <= 20 ? 2 : rankSpan <= 50 ? 5 : 10;
  const gridRanks: number[] = [];
  for (let r = Math.ceil(loRank / gridStep) * gridStep; r <= hiRank; r += gridStep) {
    gridRanks.push(r);
  }

  const MIN_GAP = 11;
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

  const top10Set = new Set(entries.slice(0, 10).map((e) => e.sym));

  const xMarkers: { ts: number; label: string }[] = [];
  const d = new Date(rangeMinTime * 1000);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + (7 - d.getDay()) % 7);
  while (d.getTime() / 1000 < now) {
    xMarkers.push({ ts: d.getTime() / 1000, label: `${d.getMonth() + 1}/${d.getDate()}` });
    d.setDate(d.getDate() + 7);
  }

  return (
    <svg viewBox={`0 0 ${VW} ${VH}`} className="w-full h-full" style={{ overflow: 'visible' }}>
      <defs>
        <linearGradient id="hlGradFull" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor={hlColor} stopOpacity={0.22} />
          <stop offset="100%" stopColor={hlColor} stopOpacity={0.0}  />
        </linearGradient>
      </defs>

      <rect x={PAD.left} y={PAD.top} width={IW} height={IH} fill="#0a0a0f" rx={4} />

      {gridRanks.map((r) => (
        <g key={r}>
          <line x1={PAD.left} y1={toY(r)} x2={PAD.left + IW} y2={toY(r)}
            stroke="#1e1e2e" strokeWidth={r % 5 === 0 ? 1 : 0.5} />
          <text x={PAD.left - 6} y={toY(r)} fill={r % 5 === 0 ? '#4a4a60' : '#2e2e40'}
            fontSize={r % 5 === 0 ? 9 : 7.5} textAnchor="end" dominantBaseline="middle">
            {r}
          </text>
        </g>
      ))}

      {xMarkers.map(({ ts, label }) => {
        const x = toX(ts);
        if (x < PAD.left || x > PAD.left + IW) return null;
        return (
          <g key={ts}>
            <line x1={x} y1={PAD.top} x2={x} y2={PAD.top + IH}
              stroke="#1e1e2e" strokeWidth={0.5} strokeDasharray="3 4" />
            <text x={x} y={PAD.top + IH + 14} fill="#3a3a4a" fontSize={8} textAnchor="middle">
              {label}
            </text>
          </g>
        );
      })}

      {entries
        .filter(({ sym }) => sym !== highlight)
        .map(({ sym, pts }) => {
          const isTop10 = top10Set.has(sym);
          const color   = colorMap[sym] ?? '#555';
          const visible = pts.filter((p) => p.rank >= loRank - 2 && p.rank <= hiRank + 2);
          if (visible.length < 2) return null;
          const coords = visible.map((p) => ({ x: toX(p.timestamp), y: toY(p.rank) }));
          return (
            <path
              key={sym}
              d={smoothPath(coords)}
              fill="none"
              stroke={color}
              strokeWidth={isTop10 ? 1.8 : 1.1}
              strokeDasharray={isTop10 ? undefined : '5 3'}
              strokeLinecap="round"
              opacity={isTop10 ? 0.65 : 0.3}
              style={{ cursor: 'pointer' }}
              onMouseEnter={() => onHover(sym)}
              onMouseLeave={() => onHover(null)}
            />
          );
        })}

      {hlEntry && (() => {
        const visiblePts = hlEntry.pts.filter((p) => p.rank >= loRank - 2 && p.rank <= hiRank + 2);
        if (visiblePts.length < 2) return null;
        const coords = visiblePts.map((p) => ({ x: toX(p.timestamp), y: toY(p.rank) }));
        const lastX  = coords[coords.length - 1].x;
        const firstX = coords[0].x;
        const bottom = PAD.top + IH;
        const area   = smoothPath(coords) + ` L${lastX},${bottom} L${firstX},${bottom} Z`;
        return <path d={area} fill="url(#hlGradFull)" />;
      })()}

      {hlEntry && (() => {
        const visiblePts = hlEntry.pts.filter((p) => p.rank >= loRank - 2 && p.rank <= hiRank + 2);
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
            />
            {visiblePts.filter((_, i) => i % 3 === 0 || i === visiblePts.length - 1).map((p, i) => (
              <circle key={i} cx={toX(p.timestamp)} cy={toY(p.rank)} r={3.5} fill={hlColor}
                stroke="#0a0a0f" strokeWidth={1.5} />
            ))}
          </g>
        );
      })()}

      {entries.map(({ sym, first, last }) => {
        const isHL    = sym === highlight;
        const isTop10 = top10Set.has(sym);
        const color   = colorMap[sym] ?? '#555';
        const y       = labelY[sym] ?? toY(last.rank);
        const delta   = first.rank - last.rank;
        const showDelta = Math.abs(delta) >= 2;
        const deltaStr = !showDelta ? '' : delta > 0 ? ` ▲${delta}` : ` ▼${Math.abs(delta)}`;
        const deltaColor = delta > 0 ? '#2ebd85' : delta < 0 ? '#f6465d' : '#6b6b80';
        const opacity    = isHL ? 1 : isTop10 ? 0.75 : 0.35;
        const fontSize   = isHL ? 11 : isTop10 ? 9 : 8;
        const fontWeight = isHL ? 700 : 400;
        return (
          <g key={sym} style={{ cursor: 'pointer' }}
            onMouseEnter={() => onHover(sym)}
            onMouseLeave={() => onHover(null)}>
            <line
              x1={toX(last.timestamp)} y1={toY(last.rank)}
              x2={PAD.left + IW + 6}   y2={y}
              stroke={color} strokeWidth={0.6} opacity={isHL ? 0.5 : 0.18}
              strokeDasharray="2 2"
            />
            <text x={PAD.left + IW + 8} y={y}
              fill={color}
              fontSize={fontSize}
              fontWeight={fontWeight}
              dominantBaseline="middle"
              opacity={opacity}>
              {sym.replace('USDT', '')}
              <tspan fill={isHL ? '#9090a0' : '#505060'}> #{last.rank}</tspan>
              {showDelta && <tspan fill={deltaColor} fontSize={isHL ? 9.5 : 7.5}>{deltaStr}</tspan>}
            </text>
          </g>
        );
      })}

      {(() => {
        const daysDiff = Math.round((now - rangeMinTime) / (24 * 3600));
        const label = daysDiff >= 355 ? '1년 전' : daysDiff >= 190 ? '6개월 전' : daysDiff >= 85 ? '3개월 전' : daysDiff >= 29 ? '1개월 전' : daysDiff >= 13 ? '2주 전' : `${daysDiff}일 전`;
        return <>
          <text x={PAD.left}      y={VH - 6} fill="#3a3a4a" fontSize={9}>{label}</text>
          <text x={PAD.left + IW} y={VH - 6} fill="#3a3a4a" fontSize={9} textAnchor="end">현재</text>
        </>;
      })()}

      <text
        x={PAD.left - 26} y={PAD.top + IH / 2}
        fill="#3a3a4a" fontSize={8.5} textAnchor="middle"
        transform={`rotate(-90, ${PAD.left - 26}, ${PAD.top + IH / 2})`}
      >
        {yAxisLabel}
      </text>
    </svg>
  );
}

// ─── 메인 컴포넌트 ─────────────────────────────────────────────────────────────
export default function RankCompareView() {
  const { symbol: activeSymbol } = useChartStore();
  const [filterMode, setFilterMode]       = useState<FilterMode>('rank');
  const [rangeId, setRangeId]             = useState<RangeId>('1-25');
  const [sectorId, setSectorId]           = useState<SectorId>('L1');
  const [timeRangeDays, setTimeRangeDays] = useState<TimeRangeDays>(30);
  const [hovered, setHovered]             = useState<string | null>(null);

  const rangeMinTime = useMemo(() => {
    const now = Math.floor(Date.now() / 1000);
    const tr = TIME_RANGES.find((r) => r.days === timeRangeDays)!;
    return now - tr.windowDays * 24 * 3600;
  }, [timeRangeDays]);

  // 순위 모드: top 100 / 섹터 모드: top 200 (L2·AI 등 중간 순위 코인 포함)
  const { data: rankings100 } = useQuery({
    queryKey: ['rankings', 1, 100],
    queryFn:  () => fetchRankings(1, 100),
    staleTime: 5 * 60 * 1000,
  });
  const { data: rankings200 } = useQuery({
    queryKey: ['rankings', 1, 200],
    queryFn:  () => fetchRankings(1, 200),
    enabled:  filterMode === 'sector',
    staleTime: 5 * 60 * 1000,
  });

  const rankings = filterMode === 'sector' ? (rankings200 ?? rankings100) : rankings100;

  // 현재 모드에 따른 대상 심볼 목록
  const targetSymbols = useMemo(() => {
    if (!rankings) return [];
    if (filterMode === 'rank') {
      const range = RANK_RANGES.find((r) => r.id === rangeId)!;
      return rankings
        .filter((c) => {
          const rank = c.market_cap_rank ?? 999;
          return !STABLECOINS.has(c.symbol.toUpperCase()) && rank >= range.lo && rank <= range.hi;
        })
        .map((c) => c.symbol.toUpperCase() + 'USDT');
    } else {
      // 섹터 모드: 섹터 정의 코인 중 top 200에 있는 것
      const sectorSet = new Set(SECTORS[sectorId].map((s) => s.toUpperCase() + 'USDT'));
      return rankings
        .filter((c) => sectorSet.has(c.symbol.toUpperCase() + 'USDT'))
        .map((c) => c.symbol.toUpperCase() + 'USDT');
    }
  }, [rankings, filterMode, rangeId, sectorId]);

  const { data: histories, isLoading } = useQuery({
    queryKey: ['rank-history-batch', targetSymbols.join(',')],
    queryFn:  () => fetchRankHistoryBatch(targetSymbols),
    enabled:  targetSymbols.length > 0,
    staleTime: 5 * 60 * 1000,
  });

  // 심볼별 고정 색상
  const colorMap = useMemo(() => {
    const map: Record<string, string> = {};
    const fixed = [
      'BTCUSDT','ETHUSDT','BNBUSDT','XRPUSDT','SOLUSDT','ADAUSDT','AVAXUSDT',
      'DOGEUSDT','DOTUSDT','TRXUSDT','TONUSDT','NEARUSDT','MATICUSDT','LTCUSDT',
      'LINKUSDT','ATOMUSDT','XMRUSDT','ETCUSDT','XLMUSDT','BCHUSDT',
    ];
    fixed.forEach((s, i) => { map[s] = COLORS[i]; });
    let idx = fixed.length;
    targetSymbols.forEach((sym) => {
      if (!map[sym]) { map[sym] = COLORS[idx % COLORS.length]; idx++; }
    });
    return map;
  }, [targetSymbols]);

  // 섹터 모드: 글로벌 순위 → 섹터 내 상대 순위 재산정
  const validHistories = useMemo(() => {
    if (!histories) return {};
    if (filterMode === 'rank') {
      const out: Record<string, Pt[]> = {};
      for (const [sym, pts] of Object.entries(histories)) {
        if (pts.length >= 2) out[sym] = pts;
      }
      return out;
    } else {
      const sectorRanked = computeSectorRanks(histories, targetSymbols);
      const out: Record<string, Pt[]> = {};
      for (const [sym, pts] of Object.entries(sectorRanked)) {
        if (pts.length >= 2) out[sym] = pts;
      }
      return out;
    }
  }, [histories, filterMode, targetSymbols]);

  const hasData   = Object.keys(validHistories).length > 0;
  const highlight = hovered ?? activeSymbol;
  const yAxisLabel = filterMode === 'sector' ? '섹터 내 순위' : '시총 순위';

  return (
    <div className="flex flex-col w-full h-full bg-bg">
      {/* 헤더 */}
      <div className="flex items-center gap-1 px-3 py-1.5 border-b border-border shrink-0">
        <span className="text-[10px] text-text-secondary shrink-0 mr-1 font-medium">시총 순위 변동</span>

        {/* 모드 토글 */}
        <div className="flex rounded overflow-hidden border border-border shrink-0 mr-2">
          {(['rank', 'sector'] as FilterMode[]).map((mode) => (
            <button
              key={mode}
              onClick={() => setFilterMode(mode)}
              className={`px-2.5 py-0.5 text-[10px] font-medium transition-colors ${
                filterMode === mode
                  ? 'bg-accent/20 text-accent'
                  : 'text-text-secondary hover:text-text-primary'
              }`}
            >
              {mode === 'rank' ? '순위' : '섹터'}
            </button>
          ))}
        </div>

        {/* 서브 탭 */}
        {filterMode === 'rank'
          ? RANK_RANGES.map((r) => (
              <button
                key={r.id}
                onClick={() => setRangeId(r.id)}
                className={`px-3 py-1 rounded text-[11px] font-medium whitespace-nowrap transition-colors ${
                  rangeId === r.id
                    ? 'bg-accent/20 text-accent'
                    : 'text-text-secondary hover:text-text-primary'
                }`}
              >
                {r.label}
              </button>
            ))
          : SECTOR_IDS.map((sid) => (
              <button
                key={sid}
                onClick={() => setSectorId(sid)}
                className={`px-3 py-1 rounded text-[11px] font-medium whitespace-nowrap transition-colors ${
                  sectorId === sid
                    ? 'bg-accent/20 text-accent'
                    : 'text-text-secondary hover:text-text-primary'
                }`}
              >
                {sid}
              </button>
            ))
        }

        <div className="flex-1" />

        {/* 시간 범위 선택 */}
        <div className="flex items-center gap-0.5 mr-2">
          {TIME_RANGES.map((tr) => (
            <button
              key={tr.days}
              onClick={() => setTimeRangeDays(tr.days)}
              className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${
                timeRangeDays === tr.days
                  ? 'bg-accent/20 text-accent'
                  : 'text-text-secondary hover:text-text-primary'
              }`}
            >
              {tr.label}
            </button>
          ))}
        </div>

        <span className="text-[10px] text-text-secondary">
          {hasData ? `${Object.keys(validHistories).length}개 코인` : ''}
        </span>
      </div>

      {/* 차트 */}
      <div className="flex-1 min-h-0 relative p-2">
        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center text-text-secondary text-sm">
            로딩 중...
          </div>
        )}
        {!isLoading && !hasData && (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-text-secondary text-sm gap-2">
            <span>순위 히스토리 수집 중</span>
            <span className="text-xs opacity-60">서버 시작 후 약 10초면 데이터가 준비됩니다</span>
          </div>
        )}
        {hasData && (
          <BumpChartFull
            histories={validHistories}
            colorMap={colorMap}
            highlight={highlight}
            onHover={setHovered}
            yAxisLabel={yAxisLabel}
            rangeMinTime={rangeMinTime}
          />
        )}
      </div>
    </div>
  );
}
