// src/utils/voicevox.ts
// VOICEVOX API連携ユーティリティ

const VOICEVOX_URL = 'http://localhost:50021';

export interface VoicevoxSpeaker {
  name: string;
  speaker_uuid: string;
  styles: VoicevoxStyle[];
  version: string;
}

export interface VoicevoxStyle {
  name: string;
  id: number;
}

/**
 * VOICEVOXが起動しているかチェック
 */
export async function checkVoicevoxAvailable(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 1000); // 1秒でタイムアウト

    const response = await fetch(`${VOICEVOX_URL}/version`, {
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    return response.ok;
  } catch (error) {
    return false;
  }
}

/**
 * 利用可能な話者一覧を取得
 */
export async function getVoicevoxSpeakers(): Promise<VoicevoxSpeaker[]> {
  try {
    const response = await fetch(`${VOICEVOX_URL}/speakers`);
    if (!response.ok) throw new Error('Failed to fetch speakers');
    return await response.json();
  } catch (error) {
    console.error('Failed to get VOICEVOX speakers:', error);
    return [];
  }
}

/**
 * 音声合成用のクエリを作成
 */
async function createAudioQuery(
  text: string,
  speaker: number
): Promise<any> {
  const response = await fetch(
    `${VOICEVOX_URL}/audio_query?text=${encodeURIComponent(text)}&speaker=${speaker}`,
    {
      method: 'POST',
    }
  );

  if (!response.ok) {
    throw new Error('Failed to create audio query');
  }

  return await response.json();
}

/**
 * 音声を合成
 */
async function synthesize(
  query: any,
  speaker: number
): Promise<Blob> {
  const response = await fetch(
    `${VOICEVOX_URL}/synthesis?speaker=${speaker}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(query),
    }
  );

  if (!response.ok) {
    throw new Error('Failed to synthesize audio');
  }

  return await response.blob();
}

/**
 * テキストを音声に変換して再生
 */
export async function speakWithVoicevox(
  text: string,
  speakerId: number,
  speedScale: number = 1.0,
  pitchScale: number = 0.0
): Promise<void> {
  try {
    // 音声クエリ作成
    const query = await createAudioQuery(text, speakerId);

    // 速度とピッチを調整
    query.speedScale = speedScale;
    query.pitchScale = pitchScale;

    // 音声合成
    const audioBlob = await synthesize(query, speakerId);

    // 音声再生
    const audioUrl = URL.createObjectURL(audioBlob);
    const audio = new Audio(audioUrl);

    return new Promise((resolve, reject) => {
      audio.onended = () => {
        URL.revokeObjectURL(audioUrl);
        resolve();
      };
      audio.onerror = (error) => {
        URL.revokeObjectURL(audioUrl);
        reject(error);
      };
      audio.play();
    });
  } catch (error) {
    console.error('VOICEVOX speech error:', error);
    throw error;
  }
}

/**
 * 業務向けの推奨キャラクター（落ち着いた声）
 */
export const RECOMMENDED_SPEAKERS = [
  { id: 8, name: '春日部つむぎ', description: '落ち着いた女性の声' },
  { id: 10, name: '雨晴はう', description: '穏やかな女性の声' },
  { id: 11, name: '玄野武宏', description: '落ち着いた男性の声' },
  { id: 2, name: '四国めたん (ノーマル)', description: '標準的な女性の声' },
];