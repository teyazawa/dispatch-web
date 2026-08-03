// src/lib/practiceMode.ts
//
// PRACTICE MODE (temporary)
// 配車マン練習用の一時機能。削除時はこのファイルと components/PracticeModeButton.tsx、
// および App.tsx 内の `// PRACTICE MODE` コメント箇所を削除すればよい。
//
// - コンテナ(A+C)の背景色を右クリックで手動変更 (全端末で共有)
// - ドライバーグループを指定して丸ごと非表示 (全端末で共有)
//
// サーバー: /api/practice/state, /api/practice/color, /api/practice/hidden-groups, /api/practice/reset
//

import { useCallback, useEffect, useRef, useState } from "react";

const API_BASE =
  (import.meta as any).env?.VITE_API_BASE_URL ?? "http://localhost:3001";

export type PracticeHiddenGroups = {
  owned: string[];
  outsourced: string[];
};

export type PracticeState = {
  version: number;
  colors: Record<string, string>;
  hiddenGroups: PracticeHiddenGroups;
};

const EMPTY_STATE: PracticeState = {
  version: 0,
  colors: {},
  hiddenGroups: { owned: [], outsourced: [] },
};

const POLL_MS = 10000;

/**
 * 練習モードのサーバー状態を購読するフック。
 * 変更操作(setContainerColor, setHiddenGroups, reset) はレスポンスで即座にローカル state を更新する。
 */
export function usePracticeMode() {
  const [state, setState] = useState<PracticeState>(EMPTY_STATE);
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const applyServerResp = useCallback((resp: any) => {
    if (!resp || typeof resp !== "object") return;
    const version = Number(resp.version ?? 0);
    const colors =
      resp.colors && typeof resp.colors === "object" ? resp.colors : {};
    const hg = resp.hiddenGroups ?? {};
    const hiddenGroups: PracticeHiddenGroups = {
      owned: Array.isArray(hg.owned) ? hg.owned.map(String) : [],
      outsourced: Array.isArray(hg.outsourced)
        ? hg.outsourced.map(String)
        : [],
    };
    setState({ version, colors, hiddenGroups });
  }, []);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    async function pollOnce() {
      try {
        const res = await fetch(`${API_BASE}/api/practice/state`);
        if (!res.ok) {
          console.warn(
            `[practice] GET /api/practice/state failed: ${res.status} @ ${API_BASE}`,
          );
          return;
        }
        const data = await res.json();
        if (cancelled) return;
        applyServerResp(data);
      } catch (e) {
        console.warn(`[practice] GET /api/practice/state error @ ${API_BASE}`, e);
      }
    }

    pollOnce();
    timer = setInterval(pollOnce, POLL_MS);
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [applyServerResp]);

  const setContainerColor = useCallback(
    async (containerId: string, color: string | null) => {
      // 楽観更新: サーバー往復を待たずに UI に反映
      setState((prev) => {
        const nextColors = { ...prev.colors };
        if (color === null || color === undefined || color === "") {
          delete nextColors[containerId];
        } else {
          nextColors[containerId] = color;
        }
        return { ...prev, colors: nextColors };
      });
      try {
        const res = await fetch(`${API_BASE}/api/practice/color`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ containerId, color }),
        });
        if (!res.ok) {
          console.warn(
            `[practice] POST /api/practice/color failed: ${res.status} @ ${API_BASE}`,
          );
          return;
        }
        const data = await res.json();
        applyServerResp(data);
      } catch (e) {
        console.warn(`[practice] POST /api/practice/color error @ ${API_BASE}`, e);
      }
    },
    [applyServerResp],
  );

  const setHiddenGroups = useCallback(
    async (owned: string[], outsourced: string[]) => {
      // 楽観更新
      setState((prev) => ({
        ...prev,
        hiddenGroups: { owned: [...owned], outsourced: [...outsourced] },
      }));
      try {
        const res = await fetch(`${API_BASE}/api/practice/hidden-groups`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ owned, outsourced }),
        });
        if (!res.ok) {
          console.warn(
            `[practice] POST /api/practice/hidden-groups failed: ${res.status} @ ${API_BASE}`,
          );
          return;
        }
        const data = await res.json();
        applyServerResp(data);
      } catch (e) {
        console.warn(
          `[practice] POST /api/practice/hidden-groups error @ ${API_BASE}`,
          e,
        );
      }
    },
    [applyServerResp],
  );

  const resetAll = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/practice/reset`, {
        method: "POST",
      });
      if (res.ok) {
        const data = await res.json();
        applyServerResp(data);
      }
    } catch (e) {
      console.warn("practice/reset failed", e);
    }
  }, [applyServerResp]);

  return {
    state,
    setContainerColor,
    setHiddenGroups,
    resetAll,
  };
}
