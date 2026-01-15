// src/components/VoicePanel.tsx
import { useState, useEffect } from "react";
import { checkVoicevoxAvailable, speakWithVoicevox } from "../utils/voicevox";
import type {
  VoiceSettings,
  Template,
  PronunciationFix,
} from "../types/settings";
import {
  DEFAULT_VOICE_SETTINGS,
  DEFAULT_TEMPLATES,
  DEFAULT_PRONUNCIATION_FIXES,
} from "../types/settings";

export interface VoiceLog {
  id: string;
  text: string;
  timestamp: Date;
  isSelected: boolean;
}

interface VoicePanelProps {
  logs: VoiceLog[];
  onAddLog: (text: string) => void;
  onUpdateLog: (id: string, text: string) => void;
  onDeleteLog: (id: string) => void;
  onToggleSelect: (id: string) => void;
  onClearLogs: () => void;
  isStandalone?: boolean;
}

let settingsWindow: Window | null = null;

export default function VoicePanel({
  logs,
  onAddLog,
  onUpdateLog,
  onDeleteLog,
  onToggleSelect,
  onClearLogs,
  isStandalone = false,
}: VoicePanelProps) {
  const [editingText, setEditingText] = useState("");

  // 設定
  const [voiceSettings, setVoiceSettings] = useState<VoiceSettings>(() => {
    const saved = localStorage.getItem("voiceSettings");
    return saved ? JSON.parse(saved) : DEFAULT_VOICE_SETTINGS;
  });

  const [templates, setTemplates] = useState<Template[]>(() => {
    const saved = localStorage.getItem("voiceTemplates");
    return saved ? JSON.parse(saved) : DEFAULT_TEMPLATES;
  });

  const [pronunciationFixes, setPronunciationFixes] = useState<
    PronunciationFix[]
  >(() => {
    const saved = localStorage.getItem("pronunciationFixes");
    return saved ? JSON.parse(saved) : DEFAULT_PRONUNCIATION_FIXES;
  });

  // Web Speech API用の音声エンジン
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);

  // 音声エンジンを取得
  useEffect(() => {
    const loadVoices = () => {
      const availableVoices = speechSynthesis.getVoices();
      setVoices(availableVoices);
    };

    loadVoices();

    if (speechSynthesis.onvoiceschanged !== undefined) {
      speechSynthesis.onvoiceschanged = loadVoices;
    }
  }, []);

  // 設定更新を受信
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;

      const { type, payload } = event.data;

      if (type === "SETTINGS_UPDATED") {
        setVoiceSettings(payload.voiceSettings);
        setTemplates(payload.templates);
        setPronunciationFixes(payload.pronunciationFixes);
      } else if (type === "ADD_LOG" && isStandalone) {
        onAddLog(payload.text);
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [isStandalone, onAddLog]);

  // 設定ウィンドウを開く
  const openSettings = () => {
    if (settingsWindow && !settingsWindow.closed) {
      settingsWindow.focus();
      return;
    }

    const width = 700;
    const height = 800;
    const left = window.screen.width - width - 50;
    const top = 50;

    settingsWindow = window.open(
      "/settings-window.html",
      "VoiceSettings",
      `width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=yes`
    );
  };

  // 数字→カタカナ変換
  const numToKanji: { [key: string]: string } = {
    "0": "ゼロ",
    "1": "イチ",
    "2": "ニ",
    "3": "サン",
    "4": "ヨン",
    "5": "ゴ",
    "6": "ロク",
    "7": "ナナ",
    "8": "ハチ",
    "9": "キュウ",
  };

  // コンテナ番号フォーマット
  const formatContainerNumber = (text: string): string => {
    const containerPattern = /([A-Z]{4})(\d{7})/g;

    return text.replace(containerPattern, (_match, letters, numbers) => {
      const first3 = numbers.slice(0, 3);
      const last4 = numbers.slice(3, 7);

      switch (voiceSettings.containerFormat) {
        case "slow":
          const first3Slow = first3
            .split("")
            .map((d: string) => numToKanji[d])
            .join("、");
          const last4Slow = last4
            .split("")
            .map((d: string) => numToKanji[d])
            .join("、");
          return `${letters}、${first3Slow}、${last4Slow}`;

        case "medium":
          const first3Medium = first3
            .split("")
            .map((d: string) => numToKanji[d])
            .join("");
          const last4Medium = last4
            .split("")
            .map((d: string) => numToKanji[d])
            .join("");
          return `${letters}、${first3Medium}、${last4Medium}`;

        case "fast":
          const allNumbers = first3 + last4;
          const numbersFast = allNumbers
            .split("")
            .map((d: string) => numToKanji[d])
            .join("");
          return `${letters} ${numbersFast}`;

        default:
          return _match;
      }
    });
  };

  // 読み間違い修正
  const fixPronunciation = (text: string): string => {
    let result = text;
    for (const fix of pronunciationFixes) {
      result = result.replace(new RegExp(fix.wrong, "g"), fix.correct);
    }
    return result;
  };

  // ドライバー名を抽出
  const extractDriver = (text: string): string | null => {
    const match = text.match(/^(.+?)さん、/);
    return match ? match[1] : null;
  };

  // 選択中のログを賢く連結
  const getSmartConnectedText = () => {
    const selectedLogs = logs.filter((log) => log.isSelected);
    if (selectedLogs.length === 0) return "";
    if (selectedLogs.length === 1) return selectedLogs[0].text;

    const result: string[] = [];
    let currentDriver: string | null = null;
    let currentSentences: string[] = [];

    for (const log of selectedLogs) {
      const driver = extractDriver(log.text);
      const sentence = log.text.replace(/^.+?さん、/, "");

      if (driver === currentDriver && currentDriver !== null) {
        currentSentences.push(sentence);
      } else {
        if (currentDriver && currentSentences.length > 0) {
          result.push(
            `${currentDriver}さん、${currentSentences.join("、その後に")}`
          );
        }
        currentDriver = driver;
        currentSentences = [sentence];
      }
    }

    if (currentDriver && currentSentences.length > 0) {
      result.push(
        `${currentDriver}さん、${currentSentences.join("、その後に")}`
      );
    }

    return result.join("\n\n");
  };

  // Web Speech API再生
  const speakWithWebSpeech = (text: string) => {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "ja-JP";
    utterance.rate = voiceSettings.rate;
    utterance.pitch = voiceSettings.pitch;
    utterance.volume = 1.0;

    if (voiceSettings.selectedVoice) {
      const voice = voices.find((v) => v.name === voiceSettings.selectedVoice);
      if (voice) {
        utterance.voice = voice;
      }
    }

    speechSynthesis.cancel();
    speechSynthesis.speak(utterance);
  };

  // 音声変換・再生
  const handleSpeak = async () => {
    let text = editingText || getSmartConnectedText();
    if (!text.trim()) {
      alert("テキストが空です");
      return;
    }

    text = formatContainerNumber(text);
    text = fixPronunciation(text);

    try {
      if (voiceSettings.engine === "voicevox") {
        const available = await checkVoicevoxAvailable();

        if (!available) {
          alert("VOICEVOXが起動していません。Web Speech APIで再生します。");
          speakWithWebSpeech(text);
          return;
        }

        await speakWithVoicevox(
          text,
          voiceSettings.voicevoxSpeaker,
          voiceSettings.voicevoxSpeed,
          voiceSettings.voicevoxPitch
        );
      } else {
        speakWithWebSpeech(text);
      }
    } catch (error) {
      console.error("音声再生エラー:", error);
      alert("音声の再生に失敗しました");
    }
  };

  const toggleLog = (id: string) => onToggleSelect(id);
  const updateLogText = (id: string, newText: string) =>
    onUpdateLog(id, newText);
  const deleteLog = (id: string) => onDeleteLog(id);

  const clearAll = () => {
    if (window.confirm("すべてのログをリセットしますか？")) {
      onClearLogs();
      setEditingText("");
    }
  };

  const insertTemplate = (template: string) => onAddLog(template);

  const copyToTextarea = () => {
    setEditingText(getSmartConnectedText());
  };

  return (
    <div className="voice-panel">
      {/* ヘッダー */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "12px",
        }}
      >
        <h3>🔊 音声送信パネル</h3>
        <button
          onClick={openSettings}
          style={{
            padding: "6px 12px",
            fontSize: "13px",
            background: "#6c757d",
            color: "white",
            border: "none",
            borderRadius: "4px",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: "4px",
          }}
        >
          ⚙️ 設定
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
            選択中をコピー
          </button>
          <button
            onClick={() => setEditingText("")}
            className="btn-small btn-delete"
            style={{
              fontSize: "12px",
              padding: "6px 12px",
              backgroundColor: "#f44336",
              color: "white",
              border: "none",
              borderRadius: "3px",
              cursor: "pointer",
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
