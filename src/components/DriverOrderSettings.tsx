// src/components/DriverOrderSettings.tsx
//
// ドライバー並び順設定モーダル (常設機能)
// - グループごとにドライバー行をHTML5ドラッグ&ドロップで並び替え
// - 変更は即座に onChange (楽観更新でサーバー保存)
//
// 既存の @dnd-kit ベースの D&D (配車ボード上のカード操作) と干渉させないため、
// このモーダル内では HTML5 native draggable を採用。
//

import { useMemo, useState } from "react";
import type { DriverOrderMap } from "../lib/driverOrder";
import { sortDriversByOrder } from "../lib/driverOrder";

type DriverLike = {
  id: string;
  name: string;
  groupName?: string;
  kind?: "owned" | "outsourced" | "unknown";
};

type GroupEntry = { key: string; label: string };

type Props = {
  visible: boolean;
  onClose: () => void;
  ownedGroups: GroupEntry[];
  outsourcedGroups: GroupEntry[];
  ownedDrivers: DriverLike[];
  outsourcedDrivers: DriverLike[];
  orderMap: DriverOrderMap;
  onGroupOrderChange: (groupKey: string, driverIds: string[]) => void;

  // Phase2 拡張: 各グループの列 (1..N) / サブ列 (1|2|3) 設定
  driverGroupColumn?: Record<string, number>;
  driverGroupSubColumns?: Record<string, 1 | 2 | 3>;
  driverGridColumns?: 3 | 4 | 5;
  defaultColForDriverGroup?: (key: string) => number;
  onDriverGroupColumnChange?: (key: string, col: number) => void;
  onDriverGroupSubColumnsChange?: (key: string, count: 1 | 2 | 3) => void;
  onDriverGridColumnsChange?: (n: 3 | 4 | 5) => void;
};

export function DriverOrderSettings({
  visible,
  onClose,
  ownedGroups,
  outsourcedGroups,
  ownedDrivers,
  outsourcedDrivers,
  orderMap,
  onGroupOrderChange,
  driverGroupColumn,
  driverGroupSubColumns,
  driverGridColumns,
  defaultColForDriverGroup,
  onDriverGroupColumnChange,
  onDriverGroupSubColumnsChange,
  onDriverGridColumnsChange,
}: Props) {
  const [tab, setTab] = useState<"order" | "layout">("order");
  if (!visible) return null;

  const allGroups: (GroupEntry & { kind: "owned" | "outsourced" })[] = [
    ...ownedGroups.map((g) => ({ ...g, kind: "owned" as const })),
    ...outsourcedGroups.map((g) => ({ ...g, kind: "outsourced" as const })),
  ];

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.35)",
        zIndex: 5200,
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
          minWidth: 420,
          maxWidth: 560,
          maxHeight: "85vh",
          overflow: "auto",
          boxShadow: "0 4px 20px rgba(0,0,0,0.2)",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 6,
          }}
        >
          <h3 style={{ margin: 0, fontSize: 16 }}>ドライバー並び順</h3>
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

        {/* Phase2: タブ (並び順 / グループ配置) */}
        <div style={{ display: "flex", gap: 4, marginBottom: 10 }}>
          <button
            onClick={() => setTab("order")}
            style={{
              flex: 1,
              padding: "6px 10px",
              fontSize: 12,
              background: tab === "order" ? "#3b82f6" : "#f3f4f6",
              color: tab === "order" ? "#fff" : "#374151",
              border: "1px solid #d1d5db",
              borderRadius: 4,
              cursor: "pointer",
              fontWeight: tab === "order" ? "bold" : "normal",
            }}
          >
            ドライバー並び順
          </button>
          <button
            onClick={() => setTab("layout")}
            style={{
              flex: 1,
              padding: "6px 10px",
              fontSize: 12,
              background: tab === "layout" ? "#3b82f6" : "#f3f4f6",
              color: tab === "layout" ? "#fff" : "#374151",
              border: "1px solid #d1d5db",
              borderRadius: 4,
              cursor: "pointer",
              fontWeight: tab === "layout" ? "bold" : "normal",
            }}
          >
            グループ配置
          </button>
        </div>

        {tab === "layout" && (
          <>
            <p style={{ fontSize: 11, color: "#666", margin: "0 0 12px" }}>
              全体列数と、各グループの配置列・内部サブ列数を設定します。
            </p>
            {/* 全体列数選択 */}
            <div
              style={{
                display: "flex",
                gap: 8,
                alignItems: "center",
                padding: "8px 10px",
                marginBottom: 10,
                background: "#f0f9ff",
                border: "1px solid #bae6fd",
                borderRadius: 4,
              }}
            >
              <span style={{ fontSize: 12, color: "#0c4a6e", fontWeight: 600 }}>
                全体の列数
              </span>
              <div style={{ display: "flex", gap: 2 }}>
                {[3, 4, 5].map((n) => (
                  <button
                    key={n}
                    onClick={() =>
                      onDriverGridColumnsChange?.(n as 3 | 4 | 5)
                    }
                    style={{
                      width: 40,
                      height: 26,
                      padding: 0,
                      fontSize: 12,
                      background:
                        (driverGridColumns ?? 3) === n ? "#0ea5e9" : "#ffffff",
                      color:
                        (driverGridColumns ?? 3) === n ? "#fff" : "#374151",
                      border: "1px solid #7dd3fc",
                      borderRadius: 3,
                      cursor: "pointer",
                      fontWeight:
                        (driverGridColumns ?? 3) === n ? "bold" : "normal",
                    }}
                  >
                    {n}列
                  </button>
                ))}
              </div>
            </div>

            <div style={{ display: "grid", gap: 6, marginBottom: 16 }}>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr auto auto",
                  gap: 8,
                  padding: "4px 8px",
                  fontSize: 11,
                  color: "#6b7280",
                  fontWeight: "bold",
                  borderBottom: "1px solid #e5e7eb",
                }}
              >
                <span>グループ</span>
                <span>配置列</span>
                <span>内部サブ列</span>
              </div>
              {allGroups.map((g) => {
                const curCol =
                  driverGroupColumn?.[g.key] ??
                  defaultColForDriverGroup?.(g.key) ??
                  1;
                const curSub = driverGroupSubColumns?.[g.key] ?? 1;
                const gridN = driverGridColumns ?? 3;
                return (
                  <div
                    key={`layout-${g.key}`}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr auto auto",
                      gap: 8,
                      padding: "6px 8px",
                      alignItems: "center",
                      background: "#f9fafb",
                      border: "1px solid #e5e7eb",
                      borderRadius: 4,
                    }}
                  >
                    <span style={{ fontSize: 13 }}>
                      {g.label}
                      <span
                        style={{
                          fontSize: 10,
                          color: "#9ca3af",
                          marginLeft: 6,
                        }}
                      >
                        ({g.kind === "owned" ? "自車" : "傭車"})
                      </span>
                    </span>
                    <div style={{ display: "flex", gap: 2 }}>
                      {Array.from({ length: gridN }, (_, i) => i + 1).map(
                        (c) => (
                          <button
                            key={c}
                            onClick={() =>
                              onDriverGroupColumnChange?.(g.key, c)
                            }
                            style={{
                              width: 26,
                              height: 24,
                              padding: 0,
                              fontSize: 11,
                              background:
                                curCol === c ? "#3b82f6" : "#ffffff",
                              color: curCol === c ? "#fff" : "#374151",
                              border: "1px solid #d1d5db",
                              borderRadius: 3,
                              cursor: "pointer",
                              fontWeight: curCol === c ? "bold" : "normal",
                            }}
                          >
                            {c}
                          </button>
                        ),
                      )}
                    </div>
                    <div style={{ display: "flex", gap: 2 }}>
                      {[1, 2, 3].map((s) => (
                        <button
                          key={s}
                          onClick={() =>
                            onDriverGroupSubColumnsChange?.(
                              g.key,
                              s as 1 | 2 | 3,
                            )
                          }
                          style={{
                            width: 32,
                            height: 24,
                            padding: 0,
                            fontSize: 11,
                            background:
                              curSub === s ? "#7c3aed" : "#ffffff",
                            color: curSub === s ? "#fff" : "#374151",
                            border: "1px solid #d1d5db",
                            borderRadius: 3,
                            cursor: "pointer",
                            fontWeight: curSub === s ? "bold" : "normal",
                          }}
                        >
                          {s}列
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {tab === "order" && (
          <>
            <p style={{ fontSize: 11, color: "#666", margin: "0 0 12px" }}>
              行をドラッグして並び替え。変更は自動保存されて全端末に反映されます。
            </p>

            <section style={{ marginBottom: 16 }}>
              <div style={{ fontWeight: "bold", fontSize: 13, marginBottom: 6 }}>
                自車
              </div>
              {ownedGroups.map((g) => (
            <GroupOrderList
              key={`o-${g.key}`}
              groupLabel={g.label}
              groupKey={g.key}
              drivers={ownedDrivers.filter((d) => (d.groupName || "") === g.key)}
              order={orderMap[g.key]}
              onChange={onGroupOrderChange}
            />
          ))}
            </section>

            <section>
              <div style={{ fontWeight: "bold", fontSize: 13, marginBottom: 6 }}>
                傭車
              </div>
              {outsourcedGroups.map((g) => (
                <GroupOrderList
                  key={`x-${g.key}`}
                  groupLabel={g.label}
                  groupKey={g.key}
                  drivers={outsourcedDrivers.filter(
                    (d) => (d.groupName || "") === g.key,
                  )}
                  order={orderMap[g.key]}
                  onChange={onGroupOrderChange}
                />
              ))}
            </section>
          </>
        )}
      </div>
    </div>
  );
}

/* ============================================================
 * 個別グループのドライバーリスト (HTML5 D&D)
 * ============================================================ */

type GroupListProps = {
  groupKey: string;
  groupLabel: string;
  drivers: DriverLike[];
  order: string[] | undefined;
  onChange: (groupKey: string, driverIds: string[]) => void;
};

function GroupOrderList({
  groupKey,
  groupLabel,
  drivers,
  order,
  onChange,
}: GroupListProps) {
  const sorted = useMemo(
    () => sortDriversByOrder(drivers, order),
    [drivers, order],
  );

  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [overIdx, setOverIdx] = useState<number | null>(null);

  const commit = (nextIds: string[]) => {
    onChange(groupKey, nextIds);
  };

  const handleDragStart = (e: React.DragEvent, i: number) => {
    setDragIdx(i);
    // 一部ブラウザで dataTransfer が空だと dragover が発火しないので何かセット
    e.dataTransfer.effectAllowed = "move";
    try {
      e.dataTransfer.setData("text/plain", String(i));
    } catch {
      // ignore
    }
  };

  const handleDragOver = (e: React.DragEvent, i: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (overIdx !== i) setOverIdx(i);
  };

  const handleDrop = (e: React.DragEvent, targetIdx: number) => {
    e.preventDefault();
    const srcIdx = dragIdx;
    setDragIdx(null);
    setOverIdx(null);
    if (srcIdx === null || srcIdx === targetIdx) return;
    const ids = sorted.map((d) => d.id);
    const [moved] = ids.splice(srcIdx, 1);
    ids.splice(targetIdx, 0, moved);
    commit(ids);
  };

  const handleDragEnd = () => {
    setDragIdx(null);
    setOverIdx(null);
  };

  return (
    <div
      style={{
        marginBottom: 10,
        border: "1px solid #eee",
        borderRadius: 4,
        padding: "6px 8px",
        background: "#fafafa",
      }}
    >
      <div
        style={{
          fontSize: 12,
          color: "#555",
          marginBottom: 4,
          display: "flex",
          justifyContent: "space-between",
        }}
      >
        <span>・{groupLabel}</span>
        <span style={{ color: "#999" }}>{sorted.length}名</span>
      </div>
      {sorted.length === 0 && (
        <div style={{ fontSize: 12, color: "#999", padding: "4px 6px" }}>
          (このグループにドライバーはいません)
        </div>
      )}
      {sorted.map((d, i) => (
        <div
          key={d.id}
          draggable
          onDragStart={(e) => handleDragStart(e, i)}
          onDragOver={(e) => handleDragOver(e, i)}
          onDrop={(e) => handleDrop(e, i)}
          onDragEnd={handleDragEnd}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "4px 6px",
            marginBottom: 2,
            background: dragIdx === i ? "#e3f2fd" : "#fff",
            border:
              overIdx === i && dragIdx !== null && dragIdx !== i
                ? "1px dashed #1890ff"
                : "1px solid #ddd",
            borderRadius: 3,
            cursor: "grab",
            fontSize: 13,
            userSelect: "none",
          }}
        >
          <span style={{ color: "#aaa", fontSize: 14 }}>⋮⋮</span>
          <span style={{ flex: 1 }}>{d.name}</span>
          <span style={{ color: "#bbb", fontSize: 10, fontFamily: "monospace" }}>
            {d.id}
          </span>
        </div>
      ))}
    </div>
  );
}
