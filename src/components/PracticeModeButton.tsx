// src/components/PracticeModeButton.tsx
//
// PRACTICE MODE (temporary) UI
// - PracticeSettingsButton : 右上に置く小さなボタン。開くとグループ非表示の設定モーダル。
// - PracticeColorPickerModal : App.tsx から制御される色ピッカーモーダル。
//
// 削除時はこのファイルと lib/practiceMode.ts、App.tsx の PRACTICE MODE コメント箇所を除去。
//

import { useEffect, useMemo, useState } from "react";
import type { PracticeHiddenGroups } from "../lib/practiceMode";

type DriverGroupEntry = { key: string; label: string };

type SettingsProps = {
  ownedGroups: DriverGroupEntry[];
  outsourcedGroups: DriverGroupEntry[];
  hiddenGroups: PracticeHiddenGroups;
  onChange: (owned: string[], outsourced: string[]) => void;
  onResetAll: () => void;
};

export function PracticeSettingsButton({
  ownedGroups,
  outsourcedGroups,
  hiddenGroups,
  onChange,
  onResetAll,
}: SettingsProps) {
  const [open, setOpen] = useState(false);

  const ownedSet = useMemo(() => new Set(hiddenGroups.owned), [hiddenGroups]);
  const outsourcedSet = useMemo(
    () => new Set(hiddenGroups.outsourced),
    [hiddenGroups],
  );

  const toggleOwned = (key: string) => {
    const next = new Set(ownedSet);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    onChange(Array.from(next), Array.from(outsourcedSet));
  };
  const toggleOutsourced = (key: string) => {
    const next = new Set(outsourcedSet);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    onChange(Array.from(ownedSet), Array.from(next));
  };

  const clearHidden = () => {
    onChange([], []);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="練習モード設定 (グループ非表示・色リセット)"
        style={{
          position: "fixed",
          top: 6,
          right: 8,
          zIndex: 5000,
          padding: "2px 8px",
          fontSize: 11,
          background: "#f5f5f5",
          border: "1px solid #ccc",
          borderRadius: 4,
          cursor: "pointer",
          opacity: 0.7,
        }}
      >
        🛠 練習
      </button>

      {open && (
        <div
          onClick={() => setOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.35)",
            zIndex: 5100,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "#fff",
              padding: 16,
              borderRadius: 8,
              minWidth: 340,
              maxHeight: "80vh",
              overflow: "auto",
              boxShadow: "0 4px 20px rgba(0,0,0,0.2)",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 8,
              }}
            >
              <h3 style={{ margin: 0, fontSize: 16 }}>🛠 練習モード設定</h3>
              <button
                onClick={() => setOpen(false)}
                style={{
                  background: "none",
                  border: "none",
                  fontSize: 18,
                  cursor: "pointer",
                }}
              >
                ✕
              </button>
            </div>

            <p style={{ fontSize: 11, color: "#666", margin: "0 0 12px" }}>
              この設定は全端末で共有されます。一時的な機能です。
            </p>

            <section style={{ marginBottom: 12 }}>
              <div style={{ fontWeight: "bold", fontSize: 13, marginBottom: 4 }}>
                自車のグループを隠す
              </div>
              {ownedGroups.length === 0 && (
                <div style={{ fontSize: 12, color: "#888" }}>(なし)</div>
              )}
              {ownedGroups.map((g) => (
                <label
                  key={`o-${g.key}`}
                  style={{
                    display: "block",
                    padding: "3px 0",
                    fontSize: 13,
                    cursor: "pointer",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={ownedSet.has(g.key)}
                    onChange={() => toggleOwned(g.key)}
                    style={{ marginRight: 6 }}
                  />
                  {g.label} <span style={{ color: "#999" }}>({g.key})</span>
                </label>
              ))}
            </section>

            <section style={{ marginBottom: 12 }}>
              <div style={{ fontWeight: "bold", fontSize: 13, marginBottom: 4 }}>
                傭車のグループを隠す
              </div>
              {outsourcedGroups.length === 0 && (
                <div style={{ fontSize: 12, color: "#888" }}>(なし)</div>
              )}
              {outsourcedGroups.map((g) => (
                <label
                  key={`x-${g.key}`}
                  style={{
                    display: "block",
                    padding: "3px 0",
                    fontSize: 13,
                    cursor: "pointer",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={outsourcedSet.has(g.key)}
                    onChange={() => toggleOutsourced(g.key)}
                    style={{ marginRight: 6 }}
                  />
                  {g.label} <span style={{ color: "#999" }}>({g.key})</span>
                </label>
              ))}
            </section>

            <div
              style={{
                display: "flex",
                gap: 8,
                justifyContent: "space-between",
                marginTop: 12,
                paddingTop: 8,
                borderTop: "1px solid #eee",
              }}
            >
              <button
                onClick={clearHidden}
                style={{
                  padding: "4px 10px",
                  fontSize: 12,
                  background: "#fff",
                  border: "1px solid #ccc",
                  borderRadius: 4,
                  cursor: "pointer",
                }}
              >
                非表示を全て解除
              </button>
              <button
                onClick={() => {
                  if (
                    window.confirm(
                      "コンテナの色変更と非表示グループを全てリセットします。よろしいですか？",
                    )
                  ) {
                    onResetAll();
                  }
                }}
                style={{
                  padding: "4px 10px",
                  fontSize: 12,
                  background: "#fee",
                  border: "1px solid #c88",
                  borderRadius: 4,
                  cursor: "pointer",
                }}
              >
                練習データを全リセット
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/* ============================================================
 * PracticeColorPickerModal
 * ============================================================ */

type ColorPickerProps = {
  visible: boolean;
  initialColor: string | null;
  containerLabel: string;
  onApply: (color: string) => void;
  onReset: () => void;
  onClose: () => void;
};

const PRESET_COLORS = [
  "#ff4d4f", // 赤
  "#fa8c16", // オレンジ
  "#fadb14", // 黄
  "#52c41a", // 緑
  "#13c2c2", // シアン
  "#1890ff", // 青
  "#722ed1", // 紫
  "#eb2f96", // ピンク
  "#8c8c8c", // グレー
  "#ffffff", // 白
];

export function PracticeColorPickerModal({
  visible,
  initialColor,
  containerLabel,
  onApply,
  onReset,
  onClose,
}: ColorPickerProps) {
  const [color, setColor] = useState<string>(initialColor ?? "#ffe58f");

  useEffect(() => {
    if (visible) setColor(initialColor ?? "#ffe58f");
  }, [visible, initialColor]);

  if (!visible) return null;

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.35)",
        zIndex: 6000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#fff",
          padding: 16,
          borderRadius: 8,
          minWidth: 300,
          boxShadow: "0 4px 20px rgba(0,0,0,0.2)",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 8,
          }}
        >
          <h3 style={{ margin: 0, fontSize: 15 }}>🎨 色を変更</h3>
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              fontSize: 18,
              cursor: "pointer",
            }}
          >
            ✕
          </button>
        </div>

        <div style={{ fontSize: 12, color: "#666", marginBottom: 10 }}>
          対象: {containerLabel}
        </div>

        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 12, marginBottom: 4 }}>プリセット</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {PRESET_COLORS.map((c) => (
              <button
                key={c}
                onClick={() => setColor(c)}
                title={c}
                style={{
                  width: 28,
                  height: 28,
                  background: c,
                  border:
                    c.toLowerCase() === color.toLowerCase()
                      ? "3px solid #333"
                      : "1px solid #ccc",
                  borderRadius: 4,
                  cursor: "pointer",
                }}
              />
            ))}
          </div>
        </div>

        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 12, display: "block", marginBottom: 4 }}>
            自由に選ぶ
          </label>
          <input
            type="color"
            value={color}
            onChange={(e) => setColor(e.target.value)}
            style={{ width: 60, height: 32, cursor: "pointer" }}
          />
          <span style={{ marginLeft: 8, fontSize: 12, fontFamily: "monospace" }}>
            {color}
          </span>
        </div>

        <div
          style={{
            display: "flex",
            gap: 8,
            justifyContent: "space-between",
            paddingTop: 8,
            borderTop: "1px solid #eee",
          }}
        >
          <button
            onClick={() => {
              onReset();
              onClose();
            }}
            style={{
              padding: "4px 10px",
              fontSize: 12,
              background: "#fff",
              border: "1px solid #ccc",
              borderRadius: 4,
              cursor: "pointer",
            }}
          >
            色をリセット
          </button>
          <button
            onClick={() => {
              onApply(color);
              onClose();
            }}
            style={{
              padding: "4px 14px",
              fontSize: 13,
              background: "#1890ff",
              color: "#fff",
              border: "1px solid #1890ff",
              borderRadius: 4,
              cursor: "pointer",
            }}
          >
            適用
          </button>
        </div>
      </div>
    </div>
  );
}
