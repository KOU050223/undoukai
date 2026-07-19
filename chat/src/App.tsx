import { useEffect, useRef, useState } from "react";
import "./App.css";

type ChatMessage = {
  id: string;
  name: string;
  text?: string;
  image?: string; // data URL
  ts: number;
};

// 接続先はアクセス中のホスト名から自動決定（別端末からでも同じサーバーに繋がる）
const WS_URL = `ws://${window.location.hostname}:3001`;

// crypto.randomUUID はHTTPS/localhostでしか使えないため、LAN内IPアクセス用に自前生成
function uid(): string {
  return Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
}

// 名前は初回に決めてlocalStorageに保存
function getName(): string {
  let n = localStorage.getItem("chat-name");
  if (!n) {
    n = "user-" + Math.floor(Math.random() * 1000);
    localStorage.setItem("chat-name", n);
  }
  return n;
}

export default function App() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [text, setText] = useState("");
  const [name, setName] = useState(getName);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // WebSocket接続（切断時は自動再接続）
  useEffect(() => {
    let alive = true;
    let ws: WebSocket;

    const connect = () => {
      ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.onopen = () => setConnected(true);
      ws.onclose = () => {
        setConnected(false);
        if (alive) setTimeout(connect, 1000);
      };
      ws.onmessage = (e) => {
        const data = JSON.parse(e.data);
        if (data.type === "history") {
          setMessages(data.messages);
        } else if (data.type === "message") {
          setMessages((prev) => [...prev, data.message]);
        }
      };
    };
    connect();

    return () => {
      alive = false;
      ws?.close();
    };
  }, []);

  // 新着で最下部にスクロール
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const send = (payload: Partial<ChatMessage>) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(
      JSON.stringify({
        id: uid(),
        name,
        ...payload,
      })
    );
  };

  const sendText = () => {
    const t = text.trim();
    if (!t) return;
    send({ text: t });
    setText("");
  };

  // 画像を選択 → data URLに変換して送信
  const sendImage = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => send({ image: reader.result as string });
    reader.readAsDataURL(file);
  };

  const onNameChange = (v: string) => {
    setName(v);
    localStorage.setItem("chat-name", v);
  };

  return (
    <div className="chat">
      <header className="header">
        <input
          className="name-input"
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          placeholder="名前"
        />
        <span className={connected ? "status on" : "status off"}>
          {connected ? "接続中" : "切断"}
        </span>
      </header>

      <main className="messages">
        {messages.map((m) => (
          <div key={m.id} className={m.name === name ? "msg mine" : "msg"}>
            <div className="meta">{m.name}</div>
            <div className="bubble">
              {m.text && <div className="text">{m.text}</div>}
              {m.image && <img className="image" src={m.image} alt="uploaded" />}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </main>

      <footer className="composer">
        <label className="upload-btn">
          📷
          <input
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) sendImage(f);
              e.target.value = "";
            }}
          />
        </label>
        <input
          className="text-input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && sendText()}
          placeholder="メッセージを入力..."
        />
        <button className="send-btn" onClick={sendText}>
          送信
        </button>
      </footer>
    </div>
  );
}
