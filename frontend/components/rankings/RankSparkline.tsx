'use client';

interface Point {
  rank: number;
  timestamp: number;
}

interface Props {
  history: Point[];
  width?: number;
  height?: number;
}

export default function RankSparkline({ history, width = 80, height = 24 }: Props) {
  if (history.length < 2) {
    return <div style={{ width, height }} className="flex items-center justify-center text-text-secondary text-xs">—</div>;
  }

  const ranks = history.map((p) => p.rank);
  const minRank = Math.min(...ranks);
  const maxRank = Math.max(...ranks);
  const range = maxRank - minRank || 1;

  // Invert: lower rank (better) = higher on chart
  const toY = (rank: number) =>
    ((rank - minRank) / range) * (height - 4) + 2;

  const points = history.map((p, i) => {
    const x = (i / (history.length - 1)) * (width - 2) + 1;
    const y = toY(p.rank);
    return `${x},${y}`;
  });

  const first = history[0].rank;
  const last = history[history.length - 1].rank;
  const improved = last < first; // lower rank number = better

  const color = improved ? '#22c55e' : last > first ? '#ef4444' : '#6b7280';

  return (
    <svg width={width} height={height} className="overflow-visible">
      <polyline
        points={points.join(' ')}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}
