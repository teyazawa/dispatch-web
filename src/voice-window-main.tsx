import React, { useState, useEffect } from "react";
import ReactDOM from "react-dom/client";
import VoicePanel from "./components/VoicePanel";
import type { VoiceLog } from "./components/VoicePanel";
import "./App.css";

// 独立ウィンドウ用のラッパーコンポーネント
function VoiceWindowApp() {
  const [logs, setLogs] = useState<VoiceLog[]>(() => {
    // localStorageから復元
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

  const [voiceSettings] = useState(() => {
    const saved = localStorage.getItem("voiceSettings");
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        return { rate: 0.95, pitch: 0.95, selectedVoice: "" };
      }
    }
    return { rate: 0.95, pitch: 0.95, selectedVoice: "" };
  });

  // logsが変更されたらlocalStorageに保存
  useEffect(() => {
    localStorage.setItem("voiceWindowLogs", JSON.stringify(logs));
  }, [logs]);

  // 音声設定が変更されたらlocalStorageに保存
  useEffect(() => {
    localStorage.setItem("voiceSettings", JSON.stringify(voiceSettings));
  }, [voiceSettings]);

  const handleAddLog = (text: string) => {
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
      prev.map((log) => (log.id === id ? { ...log, text } : log))
    );
  };

  const handleDeleteLog = (id: string) => {
    setLogs((prev) => prev.filter((log) => log.id !== id));
  };

  const handleToggleSelect = (id: string) => {
    setLogs((prev) =>
      prev.map((log) =>
        log.id === id ? { ...log, isSelected: !log.isSelected } : log
      )
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
        voiceSettings={voiceSettings}
        isStandalone={true}
      />
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <VoiceWindowApp />
  </React.StrictMode>
);

// ウィンドウ位置とサイズの保存
window.addEventListener("beforeunload", () => {
  const config = {
    width: window.outerWidth,
    height: window.outerHeight,
    left: window.screenX,
    top: window.screenY,
  };
  localStorage.setItem("voiceWindowConfig", JSON.stringify(config));
});
