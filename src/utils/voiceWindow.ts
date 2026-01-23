// 音声送信ウィンドウ管理ユーティリティ

export interface VoiceWindowMessage {
  type: 'ADD_LOG' | 'UPDATE_SETTINGS' | 'GET_STATE' | 'STATE_RESPONSE';
  payload?: any;
}

// グローバルに保持（リロードしても参照を維持）
let voiceWindow: Window | null = null;

// ウィンドウが既に開いているか確認する関数
function findExistingVoiceWindow(): Window | null {
  // 開いているウィンドウを探す
  const name = 'VoicePanel';
  try {
    // すでに開いている同名ウィンドウを取得
    const existing = window.open('', name);
    if (existing && existing.location.href.includes('voice-panel.html')) {
      return existing;
    }
  } catch (e) {
    // アクセスできない場合は null
  }
  return null;
}

/**
 * 音声送信ウィンドウを開く
 */
export function openVoiceWindow(): Window | null {
  // まず既存のウィンドウを探す
  const existing = findExistingVoiceWindow();
  if (existing && !existing.closed) {
    voiceWindow = existing;
    voiceWindow.focus();
    return voiceWindow;
  }

  // voiceWindow が null でも、実際には開いているかもしれない
  if (voiceWindow && !voiceWindow.closed) {
    voiceWindow.focus();
    return voiceWindow;
  }

  // ウィンドウの保存された位置とサイズを取得
  const savedConfig = localStorage.getItem('voiceWindowConfig');
  let config = {
    width: 600,
    height: 800,
    left: window.screen.width - 650,
    top: 50,
  };

  if (savedConfig) {
    try {
      config = { ...config, ...JSON.parse(savedConfig) };
    } catch (e) {
      console.error('Failed to parse window config:', e);
    }
  }

  // 新しいウィンドウを開く
  const features = `width=${config.width},height=${config.height},left=${config.left},top=${config.top},resizable=yes,scrollbars=yes`;
  
  voiceWindow = window.open(
    '/voice-panel.html',
    'VoicePanel',
    features
  );

  if (voiceWindow) {
    // ウィンドウが閉じられた時の処理
    const checkClosed = setInterval(() => {
      if (voiceWindow?.closed) {
        clearInterval(checkClosed);
        voiceWindow = null;
      }
    }, 1000);
  }

  return voiceWindow;
}

/**
 * 音声送信ウィンドウにメッセージを送信
 */
function sendToVoiceWindow(message: any): void {
  // まず既存ウィンドウを探す
  const existing = findExistingVoiceWindow();
  if (existing) {
    voiceWindow = existing;
  }

  console.log('📤 voiceWindow.ts: 送信', message, voiceWindow);
  
  if (voiceWindow && !voiceWindow.closed) {
    voiceWindow.postMessage(message, window.location.origin);
    console.log('✅ 送信成功');
  } else {
    console.warn('⚠️ 音声ウィンドウが開いていません');
  }
}

/**
 * 音声ログを追加
 */
export function addVoiceLog(text: string): void {
  sendToVoiceWindow({
    type: 'ADD_LOG',
    payload: { text },
  });
}

/**
 * ウィンドウが開いているかチェック
 */
export function isVoiceWindowOpen(): boolean {
  return voiceWindow !== null && !voiceWindow.closed;
}

/**
 * ウィンドウを閉じる
 */
export function closeVoiceWindow(): void {
  if (voiceWindow && !voiceWindow.closed) {
    voiceWindow.close();
    voiceWindow = null;
  }
}