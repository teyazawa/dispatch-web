// src/components/VoiceSettings.tsx
import { useState, useEffect } from "react";
import {
  checkVoicevoxAvailable,
  RECOMMENDED_SPEAKERS,
} from "../utils/voicevox";
import type {
  VoiceSettings as VoiceSettingsType,
  Template,
  PronunciationFix,
  AllSettings,
} from "../types/settings";

interface VoiceSettingsProps {
  initialSettings: AllSettings;
  onSave: (settings: AllSettings) => void;
  onCancel: () => void;
}

export default function VoiceSettings({
  initialSettings,
  onSave,
  onCancel,
}: VoiceSettingsProps) {
  // 編集中の設定
  const [voiceSettings, setVoiceSettings] = useState<VoiceSettingsType>(
    initialSettings.voiceSettings
  );
  const [templates, setTemplates] = useState<Template[]>(
    initialSettings.templates
  );
  const [pronunciationFixes, setPronunciationFixes] = useState<
    PronunciationFix[]
  >(initialSettings.pronunciationFixes);

  // 新規追加用
  const [newTemplateLabel, setNewTemplateLabel] = useState("");
  const [newTemplateContent, setNewTemplateContent] = useState("");
  const [newFixWrong, setNewFixWrong] = useState("");
  const [newFixCorrect, setNewFixCorrect] = useState("");

  // Web Speech API用の音声エンジン
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [voicevoxAvailable, setVoicevoxAvailable] = useState(false);

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

  // VOICEVOX起動チェック
  useEffect(() => {
    const checkStatus = async () => {
      const available = await checkVoicevoxAvailable();
      setVoicevoxAvailable(available);
    };

    checkStatus();
  }, []);

  // テンプレート追加
  const addTemplate = () => {
    if (!newTemplateLabel.trim() || !newTemplateContent.trim()) {
      alert("ラベルと内容を入力してください");
      return;
    }

    const newTemplate: Template = {
      id: Date.now().toString(),
      label: newTemplateLabel,
      template: newTemplateContent,
    };

    setTemplates([...templates, newTemplate]);
    setNewTemplateLabel("");
    setNewTemplateContent("");
  };

  // テンプレート削除
  const deleteTemplate = (id: string) => {
    setTemplates(templates.filter((t) => t.id !== id));
  };

  // 読み間違い修正追加
  const addPronunciationFix = () => {
    if (!newFixWrong.trim() || !newFixCorrect.trim()) {
      alert("誤と正を入力してください");
      return;
    }

    const newFix: PronunciationFix = {
      id: Date.now().toString(),
      wrong: newFixWrong,
      correct: newFixCorrect,
    };

    setPronunciationFixes([...pronunciationFixes, newFix]);
    setNewFixWrong("");
    setNewFixCorrect("");
  };

  // 読み間違い修正削除
  const deletePronunciationFix = (id: string) => {
    setPronunciationFixes(pronunciationFixes.filter((f) => f.id !== id));
  };

  // 保存
  const handleSave = () => {
    const allSettings: AllSettings = {
      voiceSettings,
      templates,
      pronunciationFixes,
    };
    onSave(allSettings);
  };

  return (
    <div
      style={{
        padding: "20px",
        maxWidth: "600px",
        margin: "0 auto",
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      }}
    >
      <h2 style={{ marginBottom: "24px" }}>⚙️ 音声設定</h2>

      {/* 音声エンジン設定 */}
      <section style={{ marginBottom: "32px" }}>
        <h3 style={{ fontSize: "16px", marginBottom: "12px" }}>音声エンジン</h3>

        <label
          style={{
            display: "flex",
            alignItems: "center",
            marginBottom: "8px",
            cursor: "pointer",
          }}
        >
          <input
            type="radio"
            value="webspeech"
            checked={voiceSettings.engine === "webspeech"}
            onChange={(e) =>
              setVoiceSettings({
                ...voiceSettings,
                engine: e.target.value as "webspeech",
              })
            }
            style={{ marginRight: "8px" }}
          />
          <span>Web Speech API (標準)</span>
        </label>

        <label
          style={{
            display: "flex",
            alignItems: "center",
            cursor: voicevoxAvailable ? "pointer" : "not-allowed",
            color: voicevoxAvailable ? "inherit" : "#999",
          }}
        >
          <input
            type="radio"
            value="voicevox"
            checked={voiceSettings.engine === "voicevox"}
            onChange={(e) =>
              setVoiceSettings({
                ...voiceSettings,
                engine: e.target.value as "voicevox",
              })
            }
            disabled={!voicevoxAvailable}
            style={{ marginRight: "8px" }}
          />
          <span>
            VOICEVOX (高品質)
            {!voicevoxAvailable && " ⚠️ 起動してください"}
          </span>
        </label>

        {/* Web Speech API設定 */}
        {voiceSettings.engine === "webspeech" && (
          <div
            style={{
              marginTop: "16px",
              padding: "16px",
              background: "#f9fafb",
              borderRadius: "6px",
              border: "1px solid #e5e7eb",
            }}
          >
            <div style={{ marginBottom: "12px" }}>
              <label
                style={{
                  display: "block",
                  fontSize: "13px",
                  marginBottom: "4px",
                }}
              >
                音声エンジン
              </label>
              <select
                value={voiceSettings.selectedVoice}
                onChange={(e) =>
                  setVoiceSettings({
                    ...voiceSettings,
                    selectedVoice: e.target.value,
                  })
                }
                style={{
                  width: "100%",
                  padding: "6px",
                  borderRadius: "4px",
                  border: "1px solid #ccc",
                }}
              >
                <option value="">デフォルト</option>
                {voices
                  .filter((v) => v.lang.startsWith("ja"))
                  .map((voice, index) => (
                    <option key={index} value={voice.name}>
                      {voice.name}
                    </option>
                  ))}
              </select>
            </div>

            <div style={{ marginBottom: "12px" }}>
              <label
                style={{
                  display: "block",
                  fontSize: "13px",
                  marginBottom: "4px",
                }}
              >
                速度: {voiceSettings.rate.toFixed(2)}
              </label>
              <input
                type="range"
                min="0.5"
                max="1.5"
                step="0.05"
                value={voiceSettings.rate}
                onChange={(e) =>
                  setVoiceSettings({
                    ...voiceSettings,
                    rate: Number(e.target.value),
                  })
                }
                style={{ width: "100%" }}
              />
            </div>

            <div>
              <label
                style={{
                  display: "block",
                  fontSize: "13px",
                  marginBottom: "4px",
                }}
              >
                ピッチ: {voiceSettings.pitch.toFixed(2)}
              </label>
              <input
                type="range"
                min="0.5"
                max="1.5"
                step="0.05"
                value={voiceSettings.pitch}
                onChange={(e) =>
                  setVoiceSettings({
                    ...voiceSettings,
                    pitch: Number(e.target.value),
                  })
                }
                style={{ width: "100%" }}
              />
            </div>
          </div>
        )}

        {/* VOICEVOX設定 */}
        {voiceSettings.engine === "voicevox" && voicevoxAvailable && (
          <div
            style={{
              marginTop: "16px",
              padding: "16px",
              background: "#f9fafb",
              borderRadius: "6px",
              border: "1px solid #e5e7eb",
            }}
          >
            <div style={{ marginBottom: "12px" }}>
              <label
                style={{
                  display: "block",
                  fontSize: "13px",
                  marginBottom: "4px",
                }}
              >
                キャラクター
              </label>
              <select
                value={voiceSettings.voicevoxSpeaker}
                onChange={(e) =>
                  setVoiceSettings({
                    ...voiceSettings,
                    voicevoxSpeaker: Number(e.target.value),
                  })
                }
                style={{
                  width: "100%",
                  padding: "6px",
                  borderRadius: "4px",
                  border: "1px solid #ccc",
                }}
              >
                {RECOMMENDED_SPEAKERS.map((speaker) => (
                  <option key={speaker.id} value={speaker.id}>
                    {speaker.name} - {speaker.description}
                  </option>
                ))}
              </select>
            </div>

            <div style={{ marginBottom: "12px" }}>
              <label
                style={{
                  display: "block",
                  fontSize: "13px",
                  marginBottom: "4px",
                }}
              >
                速度: {voiceSettings.voicevoxSpeed.toFixed(2)}
              </label>
              <input
                type="range"
                min="0.5"
                max="2.0"
                step="0.1"
                value={voiceSettings.voicevoxSpeed}
                onChange={(e) =>
                  setVoiceSettings({
                    ...voiceSettings,
                    voicevoxSpeed: Number(e.target.value),
                  })
                }
                style={{ width: "100%" }}
              />
            </div>

            <div>
              <label
                style={{
                  display: "block",
                  fontSize: "13px",
                  marginBottom: "4px",
                }}
              >
                ピッチ: {voiceSettings.voicevoxPitch.toFixed(2)}
              </label>
              <input
                type="range"
                min="-0.15"
                max="0.15"
                step="0.01"
                value={voiceSettings.voicevoxPitch}
                onChange={(e) =>
                  setVoiceSettings({
                    ...voiceSettings,
                    voicevoxPitch: Number(e.target.value),
                  })
                }
                style={{ width: "100%" }}
              />
            </div>
          </div>
        )}
      </section>

      {/* コンテナ番号読み上げ速度 */}
      <section style={{ marginBottom: "32px" }}>
        <h3 style={{ fontSize: "16px", marginBottom: "12px" }}>
          コンテナ番号の読み上げ速度
        </h3>

        <label
          style={{
            display: "block",
            marginBottom: "8px",
            cursor: "pointer",
          }}
        >
          <input
            type="radio"
            value="slow"
            checked={voiceSettings.containerFormat === "slow"}
            onChange={(e) =>
              setVoiceSettings({
                ...voiceSettings,
                containerFormat: e.target.value as "slow",
              })
            }
            style={{ marginRight: "8px" }}
          />
          <span>遅い（各数字区切り）</span>
          <span style={{ fontSize: "12px", color: "#666", marginLeft: "8px" }}>
            例: ABCD、イチ、ニ、サン...
          </span>
        </label>

        <label
          style={{
            display: "block",
            marginBottom: "8px",
            cursor: "pointer",
          }}
        >
          <input
            type="radio"
            value="medium"
            checked={voiceSettings.containerFormat === "medium"}
            onChange={(e) =>
              setVoiceSettings({
                ...voiceSettings,
                containerFormat: e.target.value as "medium",
              })
            }
            style={{ marginRight: "8px" }}
          />
          <span>中速（3桁-4桁区切り）</span>
          <span style={{ fontSize: "12px", color: "#666", marginLeft: "8px" }}>
            例: ABCD、イチニサン、ヨンゴロク...
          </span>
        </label>

        <label
          style={{
            display: "block",
            cursor: "pointer",
          }}
        >
          <input
            type="radio"
            value="fast"
            checked={voiceSettings.containerFormat === "fast"}
            onChange={(e) =>
              setVoiceSettings({
                ...voiceSettings,
                containerFormat: e.target.value as "fast",
              })
            }
            style={{ marginRight: "8px" }}
          />
          <span>速い（英字後のみ区切り）</span>
          <span style={{ fontSize: "12px", color: "#666", marginLeft: "8px" }}>
            例: ABCD イチニサンヨンゴロク...
          </span>
        </label>
      </section>

      <hr
        style={{
          margin: "32px 0",
          border: "none",
          borderTop: "1px solid #e5e7eb",
        }}
      />

      {/* テンプレート設定 */}
      <section style={{ marginBottom: "32px" }}>
        <h3 style={{ fontSize: "16px", marginBottom: "12px" }}>
          テンプレート設定
        </h3>

        <div
          style={{
            border: "1px solid #e5e7eb",
            borderRadius: "6px",
            marginBottom: "16px",
            maxHeight: "200px",
            overflowY: "auto",
          }}
        >
          {templates.map((template) => (
            <div
              key={template.id}
              style={{
                padding: "12px",
                borderBottom: "1px solid #e5e7eb",
                background: "#fff",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "start",
                }}
              >
                <div style={{ flex: 1 }}>
                  <div
                    style={{
                      fontWeight: "bold",
                      fontSize: "13px",
                      marginBottom: "4px",
                    }}
                  >
                    {template.label}
                  </div>
                  <div style={{ fontSize: "12px", color: "#666" }}>
                    {template.template}
                  </div>
                </div>
                <button
                  onClick={() => deleteTemplate(template.id)}
                  style={{
                    padding: "4px 12px",
                    fontSize: "12px",
                    background: "#f44336",
                    color: "white",
                    border: "none",
                    borderRadius: "4px",
                    cursor: "pointer",
                    marginLeft: "12px",
                  }}
                >
                  削除
                </button>
              </div>
            </div>
          ))}
          {templates.length === 0 && (
            <div
              style={{
                padding: "20px",
                textAlign: "center",
                color: "#999",
              }}
            >
              テンプレートがありません
            </div>
          )}
        </div>

        {/* 新規追加 */}
        <div
          style={{
            padding: "12px",
            background: "#f9fafb",
            borderRadius: "6px",
            border: "1px solid #e5e7eb",
          }}
        >
          <div style={{ marginBottom: "8px" }}>
            <label
              style={{
                display: "block",
                fontSize: "13px",
                marginBottom: "4px",
              }}
            >
              ラベル
            </label>
            <input
              type="text"
              value={newTemplateLabel}
              onChange={(e) => setNewTemplateLabel(e.target.value)}
              placeholder="例: 空台回送"
              style={{
                width: "100%",
                padding: "6px",
                borderRadius: "4px",
                border: "1px solid #ccc",
              }}
            />
          </div>
          <div style={{ marginBottom: "8px" }}>
            <label
              style={{
                display: "block",
                fontSize: "13px",
                marginBottom: "4px",
              }}
            >
              内容
            </label>
            <input
              type="text"
              value={newTemplateContent}
              onChange={(e) => setNewTemplateContent(e.target.value)}
              placeholder="例: ○○さん、空台で□□へ回送お願いします"
              style={{
                width: "100%",
                padding: "6px",
                borderRadius: "4px",
                border: "1px solid #ccc",
              }}
            />
          </div>
          <button
            onClick={addTemplate}
            style={{
              padding: "6px 16px",
              background: "#4CAF50",
              color: "white",
              border: "none",
              borderRadius: "4px",
              cursor: "pointer",
              fontSize: "13px",
            }}
          >
            + 追加
          </button>
        </div>
      </section>

      <hr
        style={{
          margin: "32px 0",
          border: "none",
          borderTop: "1px solid #e5e7eb",
        }}
      />

      {/* 読み間違い修正辞書 */}
      <section style={{ marginBottom: "32px" }}>
        <h3 style={{ fontSize: "16px", marginBottom: "12px" }}>
          読み間違い修正辞書
        </h3>

        <div
          style={{
            border: "1px solid #e5e7eb",
            borderRadius: "6px",
            marginBottom: "16px",
            maxHeight: "200px",
            overflowY: "auto",
          }}
        >
          {pronunciationFixes.map((fix) => (
            <div
              key={fix.id}
              style={{
                padding: "12px",
                borderBottom: "1px solid #e5e7eb",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                background: "#fff",
              }}
            >
              <div style={{ fontSize: "13px" }}>
                <span style={{ fontWeight: "bold" }}>{fix.wrong}</span>
                <span style={{ margin: "0 8px", color: "#666" }}>→</span>
                <span>{fix.correct}</span>
              </div>
              <button
                onClick={() => deletePronunciationFix(fix.id)}
                style={{
                  padding: "4px 12px",
                  fontSize: "12px",
                  background: "#f44336",
                  color: "white",
                  border: "none",
                  borderRadius: "4px",
                  cursor: "pointer",
                }}
              >
                削除
              </button>
            </div>
          ))}
          {pronunciationFixes.length === 0 && (
            <div
              style={{
                padding: "20px",
                textAlign: "center",
                color: "#999",
              }}
            >
              辞書がありません
            </div>
          )}
        </div>

        {/* 新規追加 */}
        <div
          style={{
            padding: "12px",
            background: "#f9fafb",
            borderRadius: "6px",
            border: "1px solid #e5e7eb",
          }}
        >
          <div style={{ display: "flex", gap: "8px", marginBottom: "8px" }}>
            <div style={{ flex: 1 }}>
              <label
                style={{
                  display: "block",
                  fontSize: "13px",
                  marginBottom: "4px",
                }}
              >
                誤
              </label>
              <input
                type="text"
                value={newFixWrong}
                onChange={(e) => setNewFixWrong(e.target.value)}
                placeholder="例: 有明"
                style={{
                  width: "100%",
                  padding: "6px",
                  borderRadius: "4px",
                  border: "1px solid #ccc",
                }}
              />
            </div>
            <div style={{ flex: 1 }}>
              <label
                style={{
                  display: "block",
                  fontSize: "13px",
                  marginBottom: "4px",
                }}
              >
                正
              </label>
              <input
                type="text"
                value={newFixCorrect}
                onChange={(e) => setNewFixCorrect(e.target.value)}
                placeholder="例: ありあけ"
                style={{
                  width: "100%",
                  padding: "6px",
                  borderRadius: "4px",
                  border: "1px solid #ccc",
                }}
              />
            </div>
          </div>
          <button
            onClick={addPronunciationFix}
            style={{
              padding: "6px 16px",
              background: "#4CAF50",
              color: "white",
              border: "none",
              borderRadius: "4px",
              cursor: "pointer",
              fontSize: "13px",
            }}
          >
            + 追加
          </button>
        </div>
      </section>

      <hr
        style={{
          margin: "32px 0",
          border: "none",
          borderTop: "1px solid #e5e7eb",
        }}
      />

      {/* 保存・キャンセルボタン */}
      <div
        style={{
          display: "flex",
          gap: "12px",
          justifyContent: "flex-end",
        }}
      >
        <button
          onClick={onCancel}
          style={{
            padding: "12px 24px",
            fontSize: "14px",
            background: "#6c757d",
            color: "white",
            border: "none",
            borderRadius: "6px",
            cursor: "pointer",
          }}
        >
          キャンセル
        </button>
        <button
          onClick={handleSave}
          style={{
            padding: "12px 24px",
            fontSize: "14px",
            fontWeight: "bold",
            background: "#4CAF50",
            color: "white",
            border: "none",
            borderRadius: "6px",
            cursor: "pointer",
          }}
        >
          💾 保存
        </button>
      </div>
    </div>
  );
}
