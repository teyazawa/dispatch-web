// src/voice-window-main.tsx
import { useState, useEffect } from "react";
import ReactDOM from "react-dom/client";
import VoicePanel from "./components/VoicePanel";
import type { VoiceLog } from "./components/VoicePanel";
import "./App.css";

function VoiceWindowApp() {
  const [logs, setLogs] = useState<VoiceLog[]>(() => {
    const saved = localStorage.getItem("voiceWindowLogs");
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        return parsed.map((log: any) => ({
          ...log,
          timestamp: new Date(log.timestamp),
        }));
      } catch (e) {
        return [];
      }
    }
    return [];
  });

  useEffect(() => {
    localStorage.setItem("voiceWindowLogs", JSON.stringify(logs));
  }, [logs]);

  // ✅ メッセージ受信処理
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;

      const { type, payload } = event.data;

      console.log("🎤 音声パネル: 受信したメッセージ:", type, payload);

      if (type === "ADD_LOG") {
        handleAddLog(payload.text);
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  const handleAddLog = (text: string) => {
    console.log("📝 ログ追加:", text); // デバッグ用
    const newLog: VoiceLog = {
      id: Date.now().toString(),
      text,
      timestamp: new Date(),
      isSelected: true,
    };
    setLogs((prev) => [...prev, newLog]);
  };

  const handleUpdateLog = (id: string, text: string) => {
    setLogs((prev) =>
      prev.map((log) => (log.id === id ? { ...log, text } : log)),
    );
  };

  const handleDeleteLog = (id: string) => {
    setLogs((prev) => prev.filter((log) => log.id !== id));
  };

  const handleToggleSelect = (id: string) => {
    setLogs((prev) =>
      prev.map((log) =>
        log.id === id ? { ...log, isSelected: !log.isSelected } : log,
      ),
    );
  };

  const handleClearLogs = () => {
    setLogs([]);
  };

  return (
    <div style={{ width: "100%", height: "100%", padding: "16px" }}>
      <VoicePanel
        logs={logs}
        onAddLog={handleAddLog}
        onUpdateLog={handleUpdateLog}
        onDeleteLog={handleDeleteLog}
        onToggleSelect={handleToggleSelect}
        onClearLogs={handleClearLogs}
        isStandalone={true}
      />
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <VoiceWindowApp />,
);

window.addEventListener("beforeunload", () => {
  const config = {
    width: window.outerWidth,
    height: window.outerHeight,
    left: window.screenX,
    top: window.screenY,
  };
  localStorage.setItem("voiceWindowConfig", JSON.stringify(config));
});
