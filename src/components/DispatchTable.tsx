import { useState, useEffect, useCallback } from "react";

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

type DriverName = string;

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
  const [drivers, setDrivers] = useState<DriverName[]>([]);
  const [assignments, setAssignments] = useState<DriverAssignment>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 作業者名一覧を取得（スプレッドシートのリストシートから）
  useEffect(() => {
    fetch(`${API_BASE}/api/dispatch-workers`)
      .then((r) => r.json())
      .then((data) => {
        if (data.drivers) {
          setDrivers(data.drivers);
        }
      })
      .catch((e) => console.error("作業者名取得失敗:", e));
  }, []);

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
              <th style={thStyle}>No.</th>
              <th style={thStyle}>時間</th>
              <th style={thStyle}>得意先略称</th>
              <th style={thStyle}>コンテナ番号<br />サイズ:種類</th>
              <th style={thStyle}>搬出<br />搬入</th>
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
              rows.map((row, idx) => (
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
                        {drivers.map((name) => (
                          <option key={name} value={name}>
                            {name}
                          </option>
                        ))}
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

const tdStyle: React.CSSProperties = {
  padding: "6px",
  verticalAlign: "top",
};
