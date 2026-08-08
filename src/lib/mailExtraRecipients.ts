// src/lib/mailExtraRecipients.ts
//
// 一斉メール 追加宛先 (グループ別) の管理
//
// - サーバー側 API:
//   GET  /api/mail-extra-recipients          → { version, recipients: { groupKey: string } }
//   POST /api/mail-extra-recipients          → { groupKey, value } (単一グループ更新, 空文字/null で削除)
//   POST /api/mail-extra-recipients/replace  → { recipients } (全体置換)
//
// - サーバー側ストレージ: server/data/mail-extra-recipients.json
//
// 以前は Supabase board_state に相乗り保存していたが、カード操作の
// stale-state 保存で clobber される事故が発生したため、driver-order と同型で
// 独立ストレージへ移動した。
//

import { useCallback, useEffect, useRef, useState } from "react";

const API_BASE =
  (import.meta as any).env?.VITE_API_BASE_URL ?? "http://localhost:3001";

export type MailExtraRecipientsMap = Record<string, string>;

export type MailExtraRecipientsState = {
  version: number;
  recipients: MailExtraRecipientsMap;
};

const EMPTY_STATE: MailExtraRecipientsState = { version: 0, recipients: {} };

const POLL_MS = 15000;

export function useMailExtraRecipients() {
  const [state, setState] = useState<MailExtraRecipientsState>(EMPTY_STATE);
  // 最新 state を event 内から参照するための ref
  const stateRef = useRef<MailExtraRecipientsState>(EMPTY_STATE);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const applyServerResp = useCallback((resp: any) => {
    if (!resp || typeof resp !== "object") return;
    const version = Number(resp.version ?? 0);
    const raw =
      resp.recipients && typeof resp.recipients === "object"
        ? resp.recipients
        : {};
    const recipients: MailExtraRecipientsMap = {};
    for (const [k, v] of Object.entries(raw)) {
      if (typeof v === "string") recipients[k] = v;
    }
    setState({ version, recipients });
  }, []);

  const pollOnce = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/mail-extra-recipients`);
      if (!res.ok) {
        console.warn(
          `[mail-extra-recipients] GET failed: ${res.status} @ ${API_BASE}`,
        );
        return;
      }
      const data = await res.json();
      applyServerResp(data);
    } catch (e) {
      console.warn(`[mail-extra-recipients] GET error @ ${API_BASE}`, e);
    }
  }, [applyServerResp]);

  useEffect(() => {
    let cancelled = false;
    const wrapper = async () => {
      if (cancelled) return;
      await pollOnce();
    };
    wrapper();
    const timer = setInterval(wrapper, POLL_MS);

    // window focus 時にも即再取得
    const onFocus = () => {
      wrapper();
    };
    window.addEventListener("focus", onFocus);

    return () => {
      cancelled = true;
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [pollOnce]);

  // 単一グループの追加宛先を更新
  const setGroupRecipients = useCallback(
    async (groupKey: string, value: string) => {
      // 楽観更新
      setState((prev) => {
        const nextRecipients = { ...prev.recipients };
        if (value === "" || value === null || value === undefined) {
          delete nextRecipients[groupKey];
        } else {
          nextRecipients[groupKey] = value;
        }
        return { ...prev, recipients: nextRecipients };
      });
      try {
        const res = await fetch(`${API_BASE}/api/mail-extra-recipients`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ groupKey, value }),
        });
        if (!res.ok) {
          console.warn(
            `[mail-extra-recipients] POST failed: ${res.status} @ ${API_BASE}`,
          );
          return;
        }
        const data = await res.json();
        applyServerResp(data);
      } catch (e) {
        console.warn(`[mail-extra-recipients] POST error @ ${API_BASE}`, e);
      }
    },
    [applyServerResp],
  );

  return { state, setGroupRecipients, refresh: pollOnce };
}
