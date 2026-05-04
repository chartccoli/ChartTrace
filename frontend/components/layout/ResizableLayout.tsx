'use client';

import { useRef, useState, useCallback } from 'react';

interface Props {
  sidebar: React.ReactNode;
  chart: React.ReactNode;
  panel: React.ReactNode;
}

const SIDEBAR_DEFAULT = 256;
const PANEL_DEFAULT   = 224;
const SIDEBAR_MIN     = 160;
const SIDEBAR_MAX     = 480;
const PANEL_MIN       = 160;
const PANEL_MAX       = 480;

export default function ResizableLayout({ sidebar, chart, panel }: Props) {
  const [sidebarW, setSidebarW] = useState(SIDEBAR_DEFAULT);
  const [panelW,   setPanelW]   = useState(PANEL_DEFAULT);

  const startX = useRef(0);
  const startW = useRef(0);

  const onMouseDown = useCallback(
    (side: 'left' | 'right') => (e: React.MouseEvent) => {
      e.preventDefault();
      startX.current = e.clientX;
      startW.current = side === 'left' ? sidebarW : panelW;

      const onMove = (ev: MouseEvent) => {
        const delta = ev.clientX - startX.current;
        if (side === 'left') {
          setSidebarW(Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, startW.current + delta)));
        } else {
          setPanelW(Math.max(PANEL_MIN, Math.min(PANEL_MAX, startW.current - delta)));
        }
      };

      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    },
    [sidebarW, panelW]
  );

  return (
    <div className="flex flex-1 overflow-hidden">
      <div style={{ width: sidebarW }} className="shrink-0 overflow-hidden">
        {sidebar}
      </div>

      {/* 왼쪽 드래그 핸들 */}
      <div
        onMouseDown={onMouseDown('left')}
        className="w-1 shrink-0 bg-border hover:bg-accent cursor-col-resize transition-colors select-none"
      />

      <main className="flex-1 overflow-hidden flex flex-col min-w-0">
        {chart}
      </main>

      {/* 오른쪽 드래그 핸들 */}
      <div
        onMouseDown={onMouseDown('right')}
        className="w-1 shrink-0 bg-border hover:bg-accent cursor-col-resize transition-colors select-none"
      />

      <div style={{ width: panelW }} className="shrink-0 overflow-hidden">
        {panel}
      </div>
    </div>
  );
}
