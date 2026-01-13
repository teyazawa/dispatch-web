// src/components/VoicePanel.tsx
import { useState } from "react";

export interface VoiceLog {
  id: string;
  text: string;
  timestamp: Date;
  isSelected: boolean;
}

interface VoicePanelProps {
  logs: VoiceLog[];
  onLogsChange: (logs: VoiceLog[]) => void;
}

function VoicePanel({ logs, onLogsChange }: VoicePanelProps) {
  const [editingText, setEditingText] = useState("");

  // テンプレート定義（簡単に追加可能）
  const templates = [
    {
      id: "delivery",
      label: "配送依頼",
      template: "○○さん、□□へ配送お願いします",
    },
    {
      id: "return",
      label: "返却依頼",
      template: "○○さん、△△に返却お願いします",
    },
  ];

  // 選択中のログからテキストを生成
  const getSelectedText = () => {
    return logs
      .filter((log) => log.isSelected)
      .map((log) => log.text)
      .join("\n\n");
  };

  // 音声変換・再生
  const handleSpeak = () => {
    const text = editingText || getSelectedText();
    if (!text.trim()) {
      alert("テキストが空です");
      return;
    }

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "ja-JP";
    utterance.rate = 1.0;
    utterance.pitch = 1.0;

    speechSynthesis.cancel();
    speechSynthesis.speak(utterance);
  };

  // ログの選択/非選択
  const toggleLog = (id: string) => {
    onLogsChange(
      logs.map((log) =>
        log.id === id ? { ...log, isSelected: !log.isSelected } : log
      )
    );
  };

  // ログのテキスト編集
  const updateLogText = (id: string, newText: string) => {
    onLogsChange(
      logs.map((log) => (log.id === id ? { ...log, text: newText } : log))
    );
  };

  // ログの削除
  const deleteLog = (id: string) => {
    onLogsChange(logs.filter((log) => log.id !== id));
  };

  // 全削除
  const clearAll = () => {
    if (window.confirm("すべてのログをリセットしますか？")) {
      onLogsChange([]);
      setEditingText("");
    }
  };

  // テンプレート挿入
  const insertTemplate = (template: string) => {
    const newLog: VoiceLog = {
      id: Date.now().toString(),
      text: template,
      timestamp: new Date(),
      isSelected: true,
    };
    onLogsChange([...logs, newLog]);
  };

  // テキストエリアにコピー
  const copyToTextarea = () => {
    setEditingText(getSelectedText());
  };

  return (
    <div className="voice-panel">
      <h3>🔊 音声送信パネル</h3>

      {/* テンプレートボタン */}
      <div
        className="voice-templates"
        style={{
          display: "flex",
          gap: "8px",
          marginBottom: "12px",
          flexWrap: "wrap",
        }}
      >
        <span style={{ fontSize: "12px", color: "#666" }}>テンプレート:</span>
        {templates.map((t) => (
          <button
            key={t.id}
            className="btn-small"
            onClick={() => insertTemplate(t.template)}
            style={{
              padding: "4px 8px",
              fontSize: "12px",
              backgroundColor: "#e5e7eb",
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ログ一覧 */}
      <div
        className="voice-logs"
        style={{
          maxHeight: "150px",
          overflowY: "auto",
          border: "1px solid #ddd",
          borderRadius: "4px",
          marginBottom: "12px",
        }}
      >
        {logs.map((log) => (
          <div
            key={log.id}
            className="voice-log-row"
            style={{
              display: "flex",
              gap: "8px",
              alignItems: "center",
              padding: "8px",
              backgroundColor: log.isSelected ? "#e3f2fd" : "white",
              borderBottom: "1px solid #eee",
            }}
          >
            <input
              type="checkbox"
              checked={log.isSelected}
              onChange={() => toggleLog(log.id)}
            />
            <input
              type="text"
              value={log.text}
              onChange={(e) => updateLogText(log.id, e.target.value)}
              style={{
                flex: 1,
                padding: "4px 8px",
                border: "1px solid #ccc",
                borderRadius: "3px",
                fontSize: "13px",
              }}
            />
            <button
              onClick={() => deleteLog(log.id)}
              className="btn-small btn-delete"
              style={{ padding: "4px 8px", fontSize: "12px" }}
            >
              削除
            </button>
          </div>
        ))}
        {logs.length === 0 && (
          <div style={{ padding: "20px", textAlign: "center", color: "#999" }}>
            操作履歴がありません
          </div>
        )}
      </div>

      {/* 編集エリア */}
      <div style={{ marginTop: "12px" }}>
        <div style={{ display: "flex", gap: "8px", marginBottom: "8px" }}>
          <button
            onClick={copyToTextarea}
            className="btn-small"
            disabled={logs.filter((l) => l.isSelected).length === 0}
            style={{ fontSize: "12px" }}
          >
            選択中をコピー
          </button>
          <button
            onClick={() => setEditingText("")}
            className="btn-small btn-delete"
            style={{ fontSize: "12px" }}
          >
            クリア
          </button>
        </div>
        <textarea
          value={editingText}
          onChange={(e) => setEditingText(e.target.value)}
          placeholder="ここで直接編集できます..."
          style={{
            width: "100%",
            height: "50px",
            padding: "8px",
            fontFamily: "monospace",
            fontSize: "13px",
            border: "1px solid #ccc",
            borderRadius: "4px",
            resize: "vertical",
          }}
        />
      </div>

      {/* 操作ボタン */}
      <div style={{ display: "flex", gap: "8px", marginTop: "12px" }}>
        <button
          onClick={handleSpeak}
          className="btn-primary"
          disabled={
            !editingText && logs.filter((l) => l.isSelected).length === 0
          }
          style={{
            flex: 1,
            padding: "12px",
            fontSize: "14px",
            fontWeight: "bold",
          }}
        >
          🔊 音声変換・再生
        </button>
        <button
          onClick={clearAll}
          className="btn-delete"
          disabled={logs.length === 0}
          style={{ padding: "12px 16px" }}
        >
          全削除
        </button>
      </div>

      {/* 統計 */}
      <div style={{ marginTop: "12px", fontSize: "12px", color: "#666" }}>
        操作履歴: {logs.length}件 / 選択中:{" "}
        {logs.filter((l) => l.isSelected).length}件
      </div>
    </div>
  );
}

// ✅ これが必須！
export default VoicePanel;
