import dynamic from 'next/dynamic';
import Header from '@/components/layout/Header';
import CoinList from '@/components/sidebar/CoinList';
import IndicatorPanel from '@/components/panels/IndicatorPanel';
import ChartArea from '@/components/layout/ChartArea';

export default function DashboardPage() {
  return (
    <div className="flex flex-col h-screen overflow-hidden bg-bg">
      <Header />
      <div className="flex flex-1 overflow-hidden">
        <CoinList />
        <main className="flex-1 overflow-hidden flex flex-col min-w-0">
          <ChartArea />
        </main>
        <IndicatorPanel />
      </div>
    </div>
  );
}
