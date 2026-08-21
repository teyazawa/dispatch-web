let dispatchTableWindow: Window | null = null;

function isTauri(): boolean {
  return (
    typeof window !== "undefined" &&
    ("__TAURI_INTERNALS__" in window || "__TAURI__" in window)
  );
}

/**
 * 配車表ウィンドウを開く
 */
export async function openDispatchTable(): Promise<Window | null> {
  // Tauri 環境では WebviewWindow API を使う (window.open は tauri.localhost で失敗する)
  if (isTauri()) {
    const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
    const label = "dispatch-table";
    const existing = await WebviewWindow.getByLabel(label);
    if (existing) {
      await existing.setFocus();
      return null;
    }
    const params = window.location.search || "";
    new WebviewWindow(label, {
      url: `dispatch-table.html${params}`,
      title: "配車表",
      width: 1200,
      height: 800,
    });
    return null;
  }

  // 既に開いている場合はフォーカス
  if (dispatchTableWindow && !dispatchTableWindow.closed) {
    dispatchTableWindow.focus();
    return dispatchTableWindow;
  }

  // ウィンドウの保存された位置とサイズを取得
  const savedConfig = localStorage.getItem('dispatchTableWindowConfig');
  let config = {
    width: 1200,
    height: 800,
    left: Math.max(0, window.screen.width / 2 - 600),
    top: 50,
  };

  if (savedConfig) {
    try {
      config = { ...config, ...JSON.parse(savedConfig) };
    } catch (e) {
      console.error('Failed to parse dispatch table window config:', e);
    }
  }

  // 新しいウィンドウを開く
  const features = `width=${config.width},height=${config.height},left=${config.left},top=${config.top},resizable=yes,scrollbars=yes`;

  dispatchTableWindow = window.open(
    '/dispatch-table.html',
    'DispatchTable',
    features
  );

  if (dispatchTableWindow) {
    const checkClosed = setInterval(() => {
      if (dispatchTableWindow?.closed) {
        clearInterval(checkClosed);
        dispatchTableWindow = null;
      }
    }, 1000);
  }

  return dispatchTableWindow;
}
