import { useState, useEffect, useCallback, useMemo } from "react";

type DispatchRow = {
  no: number;
  time: string;
  customer: string;
  containerNumber: string;
  sizeType: string;
  yardOut: string;
  yardIn: string;
  workplace: string;
};

type DriverKind = "owned" | "outsourced" | "unknown";

type DriverOption = {
  id: string;
  name: string;
  kind: DriverKind;
  groupName: string;
};

// ドライバー割当 (案件index → カラム → ドライバーID)
type DriverAssignment = Record<number, Record<string, string>>;

const ASSIGN_COLUMNS = ["積み", "行き", "帰り", "降ろし"] as const;

const API_BASE =
  import.meta.env.VITE_API_BASE_URL || "http://localhost:3001";

function formatDateForInput(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export default function DispatchTable() {
  const [date, setDate] = useState(() => formatDateForInput(new Date()));
  const [rows, setRows] = useState<DispatchRow[]>([]);
  const [drivers, setDrivers] = useState<DriverOption[]>([]);
  const [hiddenGroups, setHiddenGroups] = useState<{
    owned: string[];
    outsourced: string[];
  }>({ owned: [], outsourced: [] });
  const [assignments, setAssignments] = useState<DriverAssignment>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [noSortDir, setNoSortDir] = useState<"asc" | "desc">("asc");

  const sortedRows = useMemo(() => {
    return [...rows].sort((a, b) =>
      noSortDir === "asc" ? a.no - b.no : b.no - a.no
    );
  }, [rows, noSortDir]);

  // ドライバー一覧を kintone から取得(自車+傭車 両方)
  useEffect(() => {
    fetch(`${API_BASE}/api/drivers`)
      .then((r) => r.json())
      .then((data) => {
        const list: DriverOption[] = (data.drivers ?? []).map((d: any) => {
          const rawType = (d.driverType ?? "").toString().trim();
          const rawGroup = (d.driverGroup ?? "").toString().trim();
          let kind: DriverKind = "unknown";
          if (rawType === "自車" || rawType === "自社") kind = "owned";
          else if (rawType === "傭車") kind = "outsourced";
          return {
            id: String(d.id),
            name: String(d.name ?? ""),
            kind,
            groupName: rawGroup,
          };
        });
        setDrivers(list);
      })
      .catch((e) => console.error("ドライバー取得失敗:", e));
  }, []);

  // 練習モード hiddenGroups (ドライバー枠で表示OFFにしたグループ) を取得
  useEffect(() => {
    const fetchHidden = () => {
      fetch(`${API_BASE}/api/practice/state`)
        .then((r) => r.json())
        .then((data) => {
          const hg = data?.hiddenGroups ?? {};
          setHiddenGroups({
            owned: Array.isArray(hg.owned) ? hg.owned.map(String) : [],
            outsourced: Array.isArray(hg.outsourced)
              ? hg.outsourced.map(String)
              : [],
          });
        })
        .catch((e) => console.error("practice/state 取得失敗:", e));
    };
    fetchHidden();
    const t = setInterval(fetchHidden, 10000);
    return () => clearInterval(t);
  }, []);

  // 表示ONグループのみに絞ったドライバー
  const { ownedDrivers, outsourcedDrivers } = useMemo(() => {
    const hiddenOwned = new Set(hiddenGroups.owned);
    const hiddenOutsourced = new Set(hiddenGroups.outsourced);
    const owned: DriverOption[] = [];
    const outsourced: DriverOption[] = [];
    for (const d of drivers) {
      if (d.kind === "owned") {
        if (!hiddenOwned.has(d.groupName)) owned.push(d);
      } else if (d.kind === "outsourced") {
        if (!hiddenOutsourced.has(d.groupName)) outsourced.push(d);
      } else {
        owned.push(d);
      }
    }
    return { ownedDrivers: owned, outsourcedDrivers: outsourced };
  }, [drivers, hiddenGroups]);

  // 配車データを取得
  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `${API_BASE}/api/dispatch-sheet?date=${date}`
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setRows(data.rows || []);
      setAssignments({}); // 日付切替時にリセット
    } catch (e: any) {
      setError(e.message || "取得失敗");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [date]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleAssign = (rowIdx: number, col: string, driverId: string) => {
    setAssignments((prev) => ({
      ...prev,
      [rowIdx]: {
        ...prev[rowIdx],
        [col]: driverId,
      },
    }));
  };

  return (
    <div style={{ fontFamily: "sans-serif" }}>
      {/* ヘッダー */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "16px",
          marginBottom: "16px",
          flexWrap: "wrap",
        }}
      >
        <h2 style={{ margin: 0, whiteSpace: "nowrap" }}>配車表</h2>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          style={{
            padding: "6px 10px",
            fontSize: "16px",
            border: "1px solid #ccc",
            borderRadius: "4px",
          }}
        />
        <button
          onClick={fetchData}
          style={{
            padding: "6px 16px",
            fontSize: "14px",
            background: "#1976d2",
            color: "#fff",
            border: "none",
            borderRadius: "4px",
            cursor: "pointer",
          }}
        >
          更新
        </button>
        {loading && <span style={{ color: "#888" }}>読込中...</span>}
        {error && <span style={{ color: "red" }}>{error}</span>}
        <span style={{ color: "#666", fontSize: "14px" }}>
          {rows.length} 件
        </span>
      </div>

      {/* テーブル */}
      <div style={{ overflowX: "auto" }}>
        <table
          style={{
            borderCollapse: "collapse",
            width: "100%",
            fontSize: "13px",
            background: "#fff",
          }}
        >
          <thead>
            <tr style={{ background: "#e3f2fd" }}>
              <th
                style={sortThStyle}
                onClick={() => setNoSortDir((d) => (d === "asc" ? "desc" : "asc"))}
              >
                No.{noSortDir === "asc" ? " ↑" : " ↓"}
              </th>
              <th style={thStyle}>時間</th>
              <th style={thStyle}>得意先</th>
              <th style={thStyle}>
                コンテナ番号
                <br />
                <span style={{ fontWeight: "normal", fontSize: "11px" }}>サイズ:種類</span>
              </th>
              <th style={thStyle}>
                搬出
                <br />
                <span style={{ fontWeight: "normal", fontSize: "11px" }}>搬入</span>
              </th>
              <th style={thStyle}>作業先</th>
              {ASSIGN_COLUMNS.map((col) => (
                <th key={col} style={{ ...thStyle, minWidth: "100px" }}>
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && !loading ? (
              <tr>
                <td
                  colSpan={10}
                  style={{ textAlign: "center", padding: "32px", color: "#999" }}
                >
                  データがありません
                </td>
              </tr>
            ) : (
              sortedRows.map((row, idx) => (
                <tr
                  key={idx}
                  style={{
                    borderBottom: "1px solid #ddd",
                    background: idx % 2 === 0 ? "#fff" : "#fafafa",
                  }}
                >
                  <td style={tdStyle}>{row.no}</td>
                  <td style={tdStyle}>{row.time}</td>
                  <td style={tdStyle}>{row.customer}</td>
                  <td style={tdStyle}>
                    <div>{row.containerNumber}</div>
                    <div style={{ fontSize: "11px", color: "#666" }}>
                      {row.sizeType}
                    </div>
                  </td>
                  <td style={tdStyle}>
                    <div>{row.yardOut}</div>
                    <div style={{ fontSize: "11px", color: "#666" }}>
                      {row.yardIn}
                    </div>
                  </td>
                  <td style={tdStyle}>{row.workplace}</td>
                  {ASSIGN_COLUMNS.map((col) => (
                    <td key={col} style={tdStyle}>
                      <select
                        value={assignments[idx]?.[col] || ""}
                        onChange={(e) =>
                          handleAssign(idx, col, e.target.value)
                        }
                        style={{
                          width: "100%",
                          padding: "4px",
                          fontSize: "12px",
                          border: "1px solid #ccc",
                          borderRadius: "3px",
                          background:
                            assignments[idx]?.[col] ? "#e8f5e9" : "#fff",
                        }}
                      >
                        <option value="">--</option>
                        {ownedDrivers.length > 0 && (
                          <optgroup label="自車">
                            {ownedDrivers.map((d) => (
                              <option key={d.id} value={d.name}>
                                {d.name}
                              </option>
                            ))}
                          </optgroup>
                        )}
                        {outsourcedDrivers.length > 0 && (
                          <optgroup label="傭車">
                            {outsourcedDrivers.map((d) => (
                              <option key={d.id} value={d.name}>
                                {d.name}
                              </option>
                            ))}
                          </optgroup>
                        )}
                      </select>
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const thStyle: React.CSSProperties = {
  padding: "8px 6px",
  borderBottom: "2px solid #1976d2",
  textAlign: "left",
  whiteSpace: "nowrap",
  fontSize: "13px",
  fontWeight: "bold",
};

const sortThStyle: React.CSSProperties = {
  ...thStyle,
  cursor: "pointer",
  userSelect: "none",
};

const tdStyle: React.CSSProperties = {
  padding: "6px",
  verticalAlign: "top",
};
