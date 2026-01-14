import React from 'react';
import ReactDOM from 'react-dom/client';
import VoicePanel from './components/VoicePanel';
import './App.css';

// 独立ウィンドウ用のラッパーコンポーネント
function VoiceWindowApp() {
  return (
    <div style={{ width: '100%', height: '100%' }}>
      <VoicePanel isStandalone={true} />
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <VoiceWindowApp />
  </React.StrictMode>
);

// ウィンドウ位置とサイズの保存
window.addEventListener('beforeunload', () => {
  const config = {
    width: window.outerWidth,
    height: window.outerHeight,
    left: window.screenX,
    top: window.screenY,
  };
  localStorage.setItem('voiceWindowConfig', JSON.stringify(config));
});