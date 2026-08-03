// src/lib/driverOrder.ts
//
// ドライバー並び順の管理 (常設機能)
//
// - サーバー側 API:
//   GET  /api/driver-order          → { version, order: { groupKey: driverIds[] } }
//   POST /api/driver-order          → { groupKey, driverIds } (単一グループ更新)
//   POST /api/driver-order/replace  → { order } (全体置換)
//
// - サーバー側ストレージ: server/data/driver-order.json (Render再起動でリセットされる点は注意)
//

import { useCallback, useEffect, useState } from "react";

const API_BASE =
  (import.meta as any).env?.VITE_API_BASE_URL ?? "http://localhost:3001";

export type DriverOrderMap = Record<string, string[]>;

export type DriverOrderState = {
  version: number;
  order: DriverOrderMap;
};

const EMPTY_STATE: DriverOrderState = { version: 0, order: {} };

const POLL_MS = 15000;

export function useDriverOrder() {
  const [state, setState] = useState<DriverOrderState>(EMPTY_STATE);

  const applyServerResp = useCallback((resp: any) => {
    if (!resp || typeof resp !== "object") return;
    const version = Number(resp.version ?? 0);
    const orderRaw = resp.order && typeof resp.order === "object" ? resp.order : {};
    const order: DriverOrderMap = {};
    for (const [k, v] of Object.entries(orderRaw)) {
      if (Array.isArray(v)) order[k] = (v as any[]).map(String);
    }
    setState({ version, order });
  }, []);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    async function pollOnce() {
      try {
        const res = await fetch(`${API_BASE}/api/driver-order`);
        if (!res.ok) {
          console.warn(
            `[driver-order] GET failed: ${res.status} @ ${API_BASE}`,
          );
          return;
        }
        const data = await res.json();
        if (cancelled) return;
        applyServerResp(data);
      } catch (e) {
        console.warn(`[driver-order] GET error @ ${API_BASE}`, e);
      }
    }

    pollOnce();
    timer = setInterval(pollOnce, POLL_MS);
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [applyServerResp]);

  const setGroupOrder = useCallback(
    async (groupKey: string, driverIds: string[]) => {
      // 楽観更新
      setState((prev) => ({
        ...prev,
        order: { ...prev.order, [groupKey]: [...driverIds] },
      }));
      try {
        const res = await fetch(`${API_BASE}/api/driver-order`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ groupKey, driverIds }),
        });
        if (!res.ok) {
          console.warn(
            `[driver-order] POST failed: ${res.status} @ ${API_BASE}`,
          );
          return;
        }
        const data = await res.json();
        applyServerResp(data);
      } catch (e) {
        console.warn(`[driver-order] POST error @ ${API_BASE}`, e);
      }
    },
    [applyServerResp],
  );

  return { state, setGroupOrder };
}

/**
 * ドライバー配列を保存順で並び替える。
 * 保存順にないドライバーは末尾に (kintone取得順を保持)。
 */
export function sortDriversByOrder<T extends { id: string }>(
  drivers: T[],
  orderedIds: string[] | undefined,
): T[] {
  if (!orderedIds || orderedIds.length === 0) return drivers;
  const rank = new Map<string, number>();
  orderedIds.forEach((id, i) => rank.set(String(id), i));
  const known: T[] = [];
  const unknown: T[] = [];
  for (const d of drivers) {
    if (rank.has(String(d.id))) known.push(d);
    else unknown.push(d);
  }
  known.sort((a, b) => (rank.get(String(a.id))! - rank.get(String(b.id))!));
  return [...known, ...unknown];
}
