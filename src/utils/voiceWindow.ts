// 音声送信ウィンドウ管理ユーティリティ

export interface VoiceWindowMessage {
  type: 'ADD_LOG' | 'UPDATE_SETTINGS' | 'GET_STATE' | 'STATE_RESPONSE';
  payload?: any;
}

let voiceWindow: Window | null = null;

/**
 * 音声送信ウィンドウを開く
 */
export function openVoiceWindow(): Window | null {
  // 既に開いている場合はフォーカス
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
export function sendToVoiceWindow(message: VoiceWindowMessage): void {
  console.log('📤 voiceWindow.ts: 送信', message, voiceWindow); 
  if (voiceWindow && !voiceWindow.closed) {
    voiceWindow.postMessage(message, window.location.origin);
  }else {
    console.warn('⚠️ 音声ウィンドウが開いていません'); // ← 追加
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