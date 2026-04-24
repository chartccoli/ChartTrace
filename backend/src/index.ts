import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { WebSocketServer, WebSocket } from 'ws';
import http from 'http';
import WebSocketClient from 'ws';
import klinesRouter from './routes/klines';
import indicatorsRouter from './routes/indicators';
import rankingsRouter, { seedRankHistory, startAutoSnapshot, loadRankHistory } from './routes/rankings';
import signalsRouter from './routes/signals';
import volumeRouter from './routes/volume';

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors({ origin: '*' }));
app.use(express.json());

// Routes
app.use('/api/klines', klinesRouter);
app.use('/api/indicators', indicatorsRouter);
app.use('/api/rankings', rankingsRouter);
app.use('/api/signals', signalsRouter);
app.use('/api/volume', volumeRouter);

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

// HTTP 서버 생성 (WebSocket과 공유)
const server = http.createServer(app);

// WebSocket 서버 — Binance 실시간 스트림 프록시
const wss = new WebSocketServer({ server, path: '/ws' });

// 구독 중인 Binance 연결 관리
const binanceConnections = new Map<string, WebSocketClient>();
const clientSubscriptions = new Map<WebSocket, Set<string>>();

function getBinanceStreamKey(symbol: string, interval: string) {
  return `${symbol.toLowerCase()}@kline_${interval}`;
}

function connectBinance(streamKey: string) {
  if (binanceConnections.has(streamKey)) return;

  const url = `wss://stream.binance.com:9443/ws/${streamKey}`;
  const bws = new WebSocketClient(url);

  bws.on('open', () => console.log(`[Binance WS] Connected: ${streamKey}`));

  bws.on('message', (data) => {
    // 구독 중인 클라이언트에 브로드캐스트
    wss.clients.forEach((client) => {
      if (client.readyState !== WebSocket.OPEN) return;
      const subs = clientSubscriptions.get(client);
      if (subs?.has(streamKey)) {
        client.send(data.toString());
      }
    });
  });

  bws.on('error', (err) => console.error(`[Binance WS] Error on ${streamKey}:`, err.message));

  bws.on('close', () => {
    console.log(`[Binance WS] Closed: ${streamKey}`);
    binanceConnections.delete(streamKey);
    // 아직 구독자가 있으면 재연결
    setTimeout(() => {
      const hasSubscribers = Array.from(clientSubscriptions.values()).some((subs) =>
        subs.has(streamKey)
      );
      if (hasSubscribers) connectBinance(streamKey);
    }, 3000);
  });

  binanceConnections.set(streamKey, bws);
}

wss.on('connection', (ws) => {
  console.log('[WS] Client connected');
  clientSubscriptions.set(ws, new Set());

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());

      if (msg.type === 'subscribe' && msg.symbol && msg.interval) {
        const key = getBinanceStreamKey(msg.symbol, msg.interval);
        clientSubscriptions.get(ws)?.add(key);
        connectBinance(key);
      }

      if (msg.type === 'unsubscribe' && msg.symbol && msg.interval) {
        const key = getBinanceStreamKey(msg.symbol, msg.interval);
        clientSubscriptions.get(ws)?.delete(key);
      }
    } catch (e) {
      // ignore parse errors
    }
  });

  ws.on('close', () => {
    console.log('[WS] Client disconnected');
    clientSubscriptions.delete(ws);
  });
});

server.listen(PORT, () => {
  console.log(`ChartTrace backend running on http://localhost:${PORT}`);
  // 서버 시작 후 3초 뒤 순위 히스토리 시드 (비동기, 서버 시작 블로킹 없음)
  setTimeout(() => {
    loadRankHistory();   // 파일에서 먼저 복구 (재시작 시 데이터 유지)
    seedRankHistory();
    startAutoSnapshot(); // 10분 후부터 10분마다 top 200 자동 스냅샷
  }, 3000);
});
