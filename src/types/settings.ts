// src/types/settings.ts
// 音声設定の型定義

export interface VoiceSettings {
  rate: number;
  pitch: number;
  selectedVoice: string;
  engine: 'webspeech' | 'voicevox';
  voicevoxSpeaker: number;
  voicevoxSpeed: number;
  voicevoxPitch: number;
  containerFormat: 'slow' | 'medium' | 'fast';
}

export interface Template {
  id: string;
  label: string;
  template: string;
}

export interface PronunciationFix {
  id: string;
  wrong: string;
  correct: string;
}

export interface AllSettings {
  voiceSettings: VoiceSettings;
  templates: Template[];
  pronunciationFixes: PronunciationFix[];
}

// デフォルト設定
export const DEFAULT_VOICE_SETTINGS: VoiceSettings = {
  rate: 0.95,
  pitch: 0.95,
  selectedVoice: '',
  engine: 'webspeech',
  voicevoxSpeaker: 8,
  voicevoxSpeed: 1.0,
  voicevoxPitch: 0.0,
  containerFormat: 'medium',
};

export const DEFAULT_TEMPLATES: Template[] = [
  {
    id: 'delivery',
    label: '配送依頼',
    template: '○○さん、□□へ配送お願いします',
  },
  {
    id: 'return',
    label: '返却依頼',
    template: '○○さん、△△に返却お願いします',
  },
];

export const DEFAULT_PRONUNCIATION_FIXES: PronunciationFix[] = [
  { id: '1', wrong: '中防', correct: 'ちゅうぼう' },
  { id: '2', wrong: '大井', correct: 'おおい' },
  { id: '3', wrong: '青海', correct: 'あおみ' },
  { id: '4', wrong: '品川', correct: 'しながわ' },
  { id: '5', wrong: '本牧', correct: 'ほんもく' },
  { id: '6', wrong: '南本牧', correct: 'なんもく' },
  { id: '7', wrong: 'ft', correct: 'ふぃーと' },
];