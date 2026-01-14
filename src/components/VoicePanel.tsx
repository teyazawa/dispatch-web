// src/components/VoicePanel.tsx
import { useState, useEffect } from "react";

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

  // ✅ 音声設定
  const [voiceSettings, setVoiceSettings] = useState({
    rate: 0.95,
    pitch: 0.95,
  });

  // ✅ 利用可能な音声エンジン
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [selectedVoice, setSelectedVoice] = useState<string>("");

  // 音声エンジンを取得
  useEffect(() => {
    const loadVoices = () => {
      const availableVoices = speechSynthesis.getVoices();
      const japaneseVoices = availableVoices.filter((v) =>
        v.lang.startsWith("ja")
      );
      setVoices(japaneseVoices);

      // デフォルトの日本語音声を選択
      if (japaneseVoices.length > 0 && !selectedVoice) {
        setSelectedVoice(japaneseVoices[0].name);
      }
    };

    loadVoices();

    // Chromeなどでは非同期で読み込まれる
    if (speechSynthesis.onvoiceschanged !== undefined) {
      speechSynthesis.onvoiceschanged = loadVoices;
    }
  }, [selectedVoice]);

  // テンプレート定義
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

  // ✅ ドライバー名を抽出する関数
  const extractDriver = (text: string): string | null => {
    const match = text.match(/^(.+?)さん、/);
    return match ? match[1] : null;
  };

  // ✅ 選択中のログを賢く連結する関数
  const getSmartConnectedText = () => {
    const selectedLogs = logs.filter((log) => log.isSelected);
    if (selectedLogs.length === 0) return "";
    if (selectedLogs.length === 1) return selectedLogs[0].text;

    const result: string[] = [];
    let currentDriver: string | null = null;
    let currentSentences: string[] = [];

    for (const log of selectedLogs) {
      const driver = extractDriver(log.text);
      const sentence = log.text.replace(/^.+?さん、/, ""); // "○○さん、" を削除

      if (driver === currentDriver && currentDriver !== null) {
        // 同じドライバー → 「その後に」で繋ぐ
        currentSentences.push(sentence);
      } else {
        // 違うドライバーまたは最初
        if (currentDriver && currentSentences.length > 0) {
          // 前のドライバーの文章を結合
          result.push(
            `${currentDriver}さん、${currentSentences.join("、その後に")}`
          );
        }
        // 新しいドライバー開始
        currentDriver = driver;
        currentSentences = [sentence];
      }
    }

    // 最後のドライバーの文章を追加
    if (currentDriver && currentSentences.length > 0) {
      result.push(
        `${currentDriver}さん、${currentSentences.join("、その後に")}`
      );
    }

    return result.join("\n\n");
  };

  // ✅ 音声変換・再生（改良版）
  const handleSpeak = () => {
    const text = editingText || getSmartConnectedText();
    if (!text.trim()) {
      alert("テキストが空です");
      return;
    }

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "ja-JP";
    utterance.rate = voiceSettings.rate;
    utterance.pitch = voiceSettings.pitch;
    utterance.volume = 1.0;

    // 選択された音声エンジンを使用
    if (selectedVoice) {
      const voice = voices.find((v) => v.name === selectedVoice);
      if (voice) {
        utterance.voice = voice;
      }
    }

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

  // ✅ テキストエリアにコピー（スマート連結版）
  const copyToTextarea = () => {
    setEditingText(getSmartConnectedText());
  };

  return (
    <div className="voice-panel">
      <h3>🔊 音声送信パネル</h3>

      {/* ✅ 音声設定UI */}
      <div
        style={{
          marginBottom: "12px",
          padding: "8px",
          backgroundColor: "#f0f0f0",
          borderRadius: "4px",
        }}
      >
        <div
          style={{ fontSize: "12px", fontWeight: "bold", marginBottom: "8px" }}
        >
          音声設定
        </div>

        {/* 音声エンジン選択 */}
        {voices.length > 0 && (
          <div style={{ marginBottom: "8px" }}>
            <label
              style={{
                fontSize: "11px",
                display: "block",
                marginBottom: "4px",
              }}
            >
              音声エンジン:
            </label>
            <select
              value={selectedVoice}
              onChange={(e) => setSelectedVoice(e.target.value)}
              style={{
                width: "100%",
                padding: "4px",
                fontSize: "12px",
                borderRadius: "3px",
                border: "1px solid #ccc",
              }}
            >
              {voices.map((voice) => (
                <option key={voice.name} value={voice.name}>
                  {voice.name}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* 速度・ピッチ調整 */}
        <div style={{ display: "flex", gap: "12px" }}>
          <label style={{ flex: 1 }}>
            <div style={{ fontSize: "11px", marginBottom: "2px" }}>
              速度: {voiceSettings.rate.toFixed(2)}
            </div>
            <input
              type="range"
              min="0.5"
              max="1.5"
              step="0.05"
              value={voiceSettings.rate}
              onChange={(e) =>
                setVoiceSettings((prev) => ({
                  ...prev,
                  rate: Number(e.target.value),
                }))
              }
              style={{ width: "100%" }}
            />
          </label>
          <label style={{ flex: 1 }}>
            <div style={{ fontSize: "11px", marginBottom: "2px" }}>
              声の高さ: {voiceSettings.pitch.toFixed(2)}
            </div>
            <input
              type="range"
              min="0.5"
              max="1.5"
              step="0.05"
              value={voiceSettings.pitch}
              onChange={(e) =>
                setVoiceSettings((prev) => ({
                  ...prev,
                  pitch: Number(e.target.value),
                }))
              }
              style={{ width: "100%" }}
            />
          </label>
        </div>

        {/* リセットボタン */}
        <button
          onClick={() => setVoiceSettings({ rate: 0.95, pitch: 0.95 })}
          style={{
            marginTop: "6px",
            padding: "4px 8px",
            fontSize: "11px",
            backgroundColor: "#e5e7eb",
            border: "none",
            borderRadius: "3px",
            cursor: "pointer",
          }}
        >
          設定をリセット
        </button>
      </div>

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
              border: "none",
              borderRadius: "3px",
              cursor: "pointer",
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
          maxHeight: "200px",
          overflowY: "auto",
          border: "1px solid #ddd",
          borderRadius: "4px",
          marginBottom: "12px",
          backgroundColor: "white",
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
              style={{
                padding: "4px 8px",
                fontSize: "12px",
                backgroundColor: "#f44336",
                color: "white",
                border: "none",
                borderRadius: "3px",
                cursor: "pointer",
              }}
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
            style={{
              fontSize: "12px",
              backgroundColor: "#3b82f6",
              color: "white",
              border: "none",
              padding: "6px 12px",
              borderRadius: "4px",
              cursor:
                logs.filter((l) => l.isSelected).length === 0
                  ? "not-allowed"
                  : "pointer",
              opacity: logs.filter((l) => l.isSelected).length === 0 ? 0.5 : 1,
            }}
          >
            選択中をコピー（スマート連結）
          </button>
          <button
            onClick={() => setEditingText("")}
            className="btn-small btn-delete"
            style={{
              fontSize: "12px",
              padding: "6px 12px",
            }}
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
            padding: "12px 8px",
            fontSize: "14px",
            fontWeight: "bold",
            lineHeight: "1.5",
            minHeight: "44px",
            backgroundColor: "#4CAF50",
            color: "white",
            border: "none",
            borderRadius: "4px",
            cursor:
              !editingText && logs.filter((l) => l.isSelected).length === 0
                ? "not-allowed"
                : "pointer",
            opacity:
              !editingText && logs.filter((l) => l.isSelected).length === 0
                ? 0.5
                : 1,
          }}
        >
          🔊 音声変換・再生
        </button>
        <button
          onClick={clearAll}
          className="btn-delete"
          disabled={logs.length === 0}
          style={{
            padding: "12px 16px",
            minHeight: "44px",
            backgroundColor: "#f44336",
            color: "white",
            border: "none",
            borderRadius: "4px",
            cursor: logs.length === 0 ? "not-allowed" : "pointer",
            opacity: logs.length === 0 ? 0.5 : 1,
          }}
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

export default VoicePanel;
