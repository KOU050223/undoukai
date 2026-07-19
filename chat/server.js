import { WebSocketServer } from "ws";
import os from "os";

const PORT = 3001;
const wss = new WebSocketServer({ port: PORT, maxPayload: 20 * 1024 * 1024 });

// 直近のメッセージを保持（新規接続時に履歴を送る）
const history = [];
const HISTORY_LIMIT = 100;

wss.on("connection", (ws) => {
  // 接続直後に履歴を送信
  ws.send(JSON.stringify({ type: "history", messages: history }));

  ws.on("message", (data) => {
    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return;
    }
    // サーバー側でタイムスタンプ付与
    const enriched = { ...msg, ts: Date.now() };
    history.push(enriched);
    if (history.length > HISTORY_LIMIT) history.shift();

    const payload = JSON.stringify({ type: "message", message: enriched });
    for (const client of wss.clients) {
      if (client.readyState === 1) client.send(payload);
    }
  });
});

// LAN内のIPアドレスを表示
const nets = os.networkInterfaces();
const ips = [];
for (const name of Object.keys(nets)) {
  for (const net of nets[name] ?? []) {
    if (net.family === "IPv4" && !net.internal) ips.push(net.address);
  }
}
console.log(`WebSocket server running on port ${PORT}`);
console.log("接続先候補:");
for (const ip of ips) console.log(`  ws://${ip}:${PORT}`);
