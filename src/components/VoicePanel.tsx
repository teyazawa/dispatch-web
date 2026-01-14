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
  voiceSettings: {
    rate: number;
    pitch: number;
    selectedVoice: string;
  };
}

function VoicePanel({ logs, onLogsChange, voiceSettings }: VoicePanelProps) {
  const [editingText, setEditingText] = useState("");

  // ✅ 利用可能な音声エンジン
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);

  // 音声エンジンを取得
  useEffect(() => {
    const loadVoices = () => {
      const availableVoices = speechSynthesis.getVoices();
      setVoices(availableVoices);
    };

    loadVoices();

    // Chromeなどでは非同期で読み込まれる
    if (speechSynthesis.onvoiceschanged !== undefined) {
      speechSynthesis.onvoiceschanged = loadVoices;
    }
  }, []);

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

  // ✅ 数字→カタカナ変換
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

  // ✅ コンテナ番号フォーマット（カタカナ版）
  const formatContainerNumber = (text: string): string => {
    const containerPattern = /([A-Z]{4})(\d{7})/g;

    return text.replace(containerPattern, (_match, letters, numbers) => {
      const first3 = numbers.slice(0, 3);
      const last4 = numbers.slice(3, 7);

      // カタカナに変換して「、」で区切る
      const first3Kana = first3
        .split("")
        .map((d: string) => numToKanji[d])
        .join("、");
      const last4Kana = last4
        .split("")
        .map((d: string) => numToKanji[d])
        .join("、");

      return `${letters}、${first3Kana}、${last4Kana}`;
    });
  };

  // ✅ 読み間違い修正
  const fixPronunciation = (text: string): string => {
    const replacements: { [key: string]: string } = {
      中防: "ちゅうぼう",
      大井: "おおい",
      青海: "あおみ",
      品川: "しながわ",
      本牧: "ほんもく",
      南本牧: "なんもく",
      ft: "ふぃーと",
    };

    let result = text;
    for (const [wrong, correct] of Object.entries(replacements)) {
      result = result.replace(new RegExp(wrong, "g"), correct);
    }
    return result;
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

  // ✅ 音声変換・再生
  const handleSpeak = () => {
    let text = editingText || getSmartConnectedText();
    if (!text.trim()) {
      alert("テキストが空です");
      return;
    }

    // ✅ コンテナ番号を読みやすく変換
    text = formatContainerNumber(text);
    // 読み間違いを修正
    text = fixPronunciation(text);

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "ja-JP";
    utterance.rate = voiceSettings.rate;
    utterance.pitch = voiceSettings.pitch;
    utterance.volume = 1.0;

    // 選択された音声エンジンを使用
    if (voiceSettings.selectedVoice) {
      const voice = voices.find((v) => v.name === voiceSettings.selectedVoice);
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

export default VoicePanel;
