// src/settings-window-main.tsx
import React, { useState, useEffect } from "react";
import ReactDOM from "react-dom/client";
import VoiceSettings from "./components/VoiceSettings";
import type { AllSettings } from "./types/settings";
import {
  DEFAULT_VOICE_SETTINGS,
  DEFAULT_TEMPLATES,
  DEFAULT_PRONUNCIATION_FIXES,
} from "./types/settings";

function SettingsWindowApp() {
  const [initialSettings, setInitialSettings] = useState<AllSettings | null>(
    null,
  );

  useEffect(() => {
    // localStorageから現在の設定を読み込む
    const loadSettings = () => {
      try {
        const voiceSettings =
          JSON.parse(localStorage.getItem("voiceSettings") || "null") ||
          DEFAULT_VOICE_SETTINGS;

        const templates =
          JSON.parse(localStorage.getItem("voiceTemplates") || "null") ||
          DEFAULT_TEMPLATES;

        const pronunciationFixes =
          JSON.parse(localStorage.getItem("pronunciationFixes") || "null") ||
          DEFAULT_PRONUNCIATION_FIXES;

        setInitialSettings({
          voiceSettings,
          templates,
          pronunciationFixes,
        });
      } catch (error) {
        console.error("Failed to load settings:", error);
        setInitialSettings({
          voiceSettings: DEFAULT_VOICE_SETTINGS,
          templates: DEFAULT_TEMPLATES,
          pronunciationFixes: DEFAULT_PRONUNCIATION_FIXES,
        });
      }
    };

    loadSettings();
  }, []);

  const handleSave = (settings: AllSettings) => {
    // localStorageに保存
    localStorage.setItem(
      "voiceSettings",
      JSON.stringify(settings.voiceSettings),
    );
    localStorage.setItem("voiceTemplates", JSON.stringify(settings.templates));
    localStorage.setItem(
      "pronunciationFixes",
      JSON.stringify(settings.pronunciationFixes),
    );

    // 親ウィンドウに設定変更を通知
    if (window.opener && !window.opener.closed) {
      window.opener.postMessage(
        {
          type: "SETTINGS_UPDATED",
          payload: settings,
        },
        window.location.origin,
      );
    }

    // ウィンドウを閉じる
    window.close();
  };

  const handleCancel = () => {
    window.close();
  };

  if (!initialSettings) {
    return (
      <div style={{ padding: "20px", textAlign: "center" }}>読み込み中...</div>
    );
  }

  return (
    <VoiceSettings
      initialSettings={initialSettings}
      onSave={handleSave}
      onCancel={handleCancel}
    />
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <SettingsWindowApp />
  </React.StrictMode>,
);
