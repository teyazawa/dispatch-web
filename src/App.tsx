import React, { useEffect, useRef, useState } from "react";
import "./App.css";
import { DndContext, useDraggable, useDroppable } from "@dnd-kit/core";
import { supabase } from "./lib/supabase";
import AuthBar from "./components/AuthBar";



/** サイズ種別 */
type Size = "20" | "40";

/** 型定義 */

type DriverKind = "owned" | "outsourced" | "unknown";

type Driver = {
  id: string;
  name: string;
  email?: string;      // 表示はしないけど保持
  baseTruckNo?: string; // 基本車両
  kind: DriverKind;
  groupName?: string;
};

type TruckLocation = 
  | { type: "spare" }
  | { type: "driver"; driverId: string };

type Truck = {
  id: string;
  label: string;      // ← 車両_番号
  carNo?: string;     // ← 車両_車番（ツールチップ用）
  location: TruckLocation;
};

/** どこまで進んでいるか（将来用） */
type ContainerStep = 0 | 1 | 2 | 3 | 4; // 0=未着手, 1〜4=①〜④

/** コンテナ（A） */
type Container = {
  id: string;
  size: Size;           // 20F / 40F 用
  date: string;         // 表示・グルーピング用の日付キー（例: "11/28"）
  eta: string;          // 着時間 例: "9:00"
  pickupYardGroup: string; // 搬出ヤードグループ 例: "青海"（列の縦軸用）
  pickupYard: string;   // 搬出ヤード詳細 例: "青海A-1"
  no: string;           // コンテナ番号 例: "ABCD1234567"
  ship: string;         // 本船名
  booking: string;      // booking
  destadd: string;      // 配送先住所
  desttel: string;      // 配送先電話番号
  kindCode: string;     // D, R など略称
  destination: string;  // 配送先名 例: "千葉RDC"
  dropoffYard: string;  // 搬入ヤード 例: "青海EIR"

  /** 工程ステップ（サーバーから渡してもらう想定） */
  step?: ContainerStep;
  worker4?: string; 
};


type PoolLocation = {
  type: "pool";
  yardId: string;
  laneId: string;
  pos: "front" | "middle" | "back";
};

type DriverLocation = {
  type: "driver";
  driverId: string;
};

type DriverGroup = { key: string; label: string };

type DriverGroupConfig = {
  owned: DriverGroup[];      // 自車側のグループ
  outsourced: DriverGroup[]; // 傭車側のグループ
};

const DEFAULT_DRIVER_GROUPS: DriverGroupConfig = {
  owned: [
    { key: "ドレー",     label: "ドレー" },
    { key: "ポジション", label: "ポジ" },
  ],
  outsourced: [
    { key: "ガレージ",   label: "ガレージ" },
    { key: "山翔",       label: "山翔" },
    { key: "セトリヤマ", label: "セトリヤマ" },
  ],
};

// driverId → groupId の対応表

type ChassisLocation = PoolLocation | DriverLocation;

type AxleKind = "1" | "2" | "3" | "MG" | "2stack" | "both";

type ApiChassis = {
  id: string;
  displayNo: string;
  carNo: string;
  size: "20" | "40";
  sizeLabel: string;   // "20F" / "40F"
  axle: AxleKind;
  kindLabel: string;   // "3軸" など
  note?: string;
  status: string;
};

type ChassisGroup = {
  id: string; // C
  chassisLabel: string;
  size: Size;
  axle: AxleKind;
  container?: Container;
  location: ChassisLocation;
  extra?: {
    carNo?: string;      // シャーシ_車番
    sizeLabel?: string;  // "20F" / "40F"
    kindLabel?: string;  // "3軸" など
    note?: string;       // シャーシ_備考
  };
};

type MailMenuState = {
  visible: boolean;
  x: number;
  y: number;
  group: ChassisGroup | null;
  driver: Driver | null;
};


/** シャーシプール定義 */
type SlotMode = "single" | "two" | "three";

type YardLane = { id: string; label: string };

type YardConfig = {
  id: string;
  name: string;
  lanes: YardLane[];

  // 1マス / 2マス / 3マス
  slotMode?: SlotMode;

  // 前・中・奥の表示名
  positionLabels?: {
    front: string;
    middle: string;
    back: string;
  };
};

// デフォルトのラベル
const DEFAULT_POSITION_LABELS = {
  front: "前",
  middle: "中",
  back: "奥",
};

const defaultYards: YardConfig[] = [
  {
    id: "ohi",
    name: "大井",
    slotMode: "three",
    positionLabels: { ...DEFAULT_POSITION_LABELS },
    lanes: [
      { id: "lane1", label: "A43" },
      { id: "lane2", label: "A45" },
      { id: "lane3", label: "A47" },
      { id: "lane4", label: "A49" },
      { id: "lane5", label: "A51" },
      { id: "lane6", label: "A53" },
      { id: "lane7", label: "A55" },
      { id: "lane8", label: "A57" },
      { id: "lane9", label: "A59" },
      { id: "lane10", label: "A61" },
      { id: "lane11", label: "A63" },
      { id: "lane12", label: "A65" },
      { id: "lane13", label: "A139" },
      { id: "lane14", label: "A141" },
    ],
  },
  {
    id: "shinagawa",
    name: "品川",
    slotMode: "three",
    positionLabels: { ...DEFAULT_POSITION_LABELS },
    lanes: [{ id: "lane1", label: "19" }],
  },
  {
    id: "nakabo",
    name: "中防",
    slotMode: "three",
    positionLabels: { ...DEFAULT_POSITION_LABELS },
    lanes: [
      { id: "lane1", label: "35" },
      { id: "lane2", label: "39" },
      { id: "lane3", label: "68" },
    ],
  },
  {
    id: "kawaguchi",
    name: "川口車庫",
    slotMode: "single", // ★ 1マスフリー
    positionLabels: { front: "", middle: "", back: "" },
    lanes: [{ id: "lane1", label: "レーン1" }],
  },
  {
    id: "custom",
    name: "現場（カスタマイズ可）",
    slotMode: "single", // ★ 1マスフリー
    positionLabels: { front: "", middle: "", back: "" },
    lanes: [
      { id: "lane1", label: "レーン1" },
      { id: "lane2", label: "レーン2" },
    ],
  },
];

/** コンテナ表示用のまとめ文字列 */

function formatContainerSummary(c: Container): string {
  return `${c.date} ${c.eta} ${c.pickupYard} ${c.no} ${c.size}F ${c.kindCode} ${c.destination} ${c.dropoffYard}`;
}

/** "11/28" → "28日" */
function buildDayLabel(date: string): string {
  if (!date) return "";
  const parts = date.split("/");
  const day = parts[1] || parts[0];
  return `${day.replace(/^0/, "")}日`;
}

/** 取り用の件名＋本文 */
function buildPickupMail(container: Container, driver: Driver): {
  subject: string;
  body: string;
} {
  const dayLabel = buildDayLabel(container.date);
  const sizeLabel = container.size === "40" ? "40F" : "20F";

  const subject = `【取り】${dayLabel} ${container.eta} ${container.pickupYard} ${sizeLabel} ${container.no}`;

  const bodyLines = [
    `${driver.name} さん`,
    "",
    "下記コンテナの取りのご依頼です。",
    "",
    `日付：${dayLabel}`,
    `時間：${container.eta}`,
    `搬出：${container.pickupYard}`,
    `搬入：${container.dropoffYard}`,
    `コンテナ：${container.no}（${sizeLabel}／${container.kindCode}）`,
    `配送先：${container.destination}`,
    container.destadd ? `住所：${container.destadd}` : "",
    container.desttel ? `TEL：${container.desttel}` : "",
    "",
    "よろしくお願いします。",
  ].filter(Boolean);

  return {
    subject,
    body: bodyLines.join("\n"),
  };
}

/** 配送用の件名＋本文 */
function buildDeliveryMail(container: Container, driver: Driver): {
  subject: string;
  body: string;
} {
  const dayLabel = buildDayLabel(container.date);
  const sizeLabel = container.size === "40" ? "40F" : "20F";

  const subject = `【配送】${dayLabel} ${container.eta} ${container.destination} ${sizeLabel} ${container.no}`;

  const bodyLines = [
    `${driver.name} さん`,
    "",
    "下記コンテナの配送のご依頼です。",
    "",
    `日付：${dayLabel}`,
    `時間：${container.eta}`,
    `搬出：${container.pickupYard}`,
    `搬入：${container.dropoffYard}`,
    `コンテナ：${container.no}（${sizeLabel}／${container.kindCode}）`,
    `配送先：${container.destination}`,
    container.destadd ? `住所：${container.destadd}` : "",
    container.desttel ? `TEL：${container.desttel}` : "",
    "",
    "よろしくお願いします。",
  ].filter(Boolean);

  return {
    subject,
    body: bodyLines.join("\n"),
  };
}

const BOARD_LS_KEY = "dispatch-board-id";

function getInitialBoardId() {
  const qs = new URLSearchParams(window.location.search);
  return qs.get("board") || localStorage.getItem(BOARD_LS_KEY) || "";
}

/** DnD コンポーネント */
type DraggableGroupCardProps = {
  group: ChassisGroup;
  onContextMenuGroup?: (
    e: React.MouseEvent<HTMLDivElement>,
    group: ChassisGroup
  ) => void;
};

function DraggableGroupCard({ group, onContextMenuGroup }: DraggableGroupCardProps) {
  const { attributes, listeners, setNodeRef, transform } = useDraggable({
    id: `group-${group.id}`,
  });

  const style: React.CSSProperties = {
    transform: transform ? `translate(${transform.x}px, ${transform.y}px)` : undefined,
    zIndex: transform ? 9999 : "auto",
    position: transform ? "relative" : "static",
  };

  const isAC = !!group.container;
  const statusClass = isAC ? "chassis-loaded" : "chassis-empty";
  const axleClass = `axle-${group.axle}`;

  // === kintone 由来のシャーシ情報 ===
  const carNo = group.extra?.carNo ?? "";
  const sizeLabel = group.extra?.sizeLabel ?? `${group.size}F`;
  const kindLabel = group.extra?.kindLabel ?? "";
  const note = group.extra?.note?.trim();

  // ===============================
  //  ホバー時のツールチップ文字列
  // ===============================
  let tooltip: string;

  if (isAC && group.container) {
    const c = group.container;

    // 11/28 → 28日
    const [, d] = c.date.split("/");
    const dayLabel = d ? `${d}日` : c.date;

    // ▼ 1行目：28日 9:00 千葉RDC 青海A-1 ABCD1234567 青海EIR
    const line1 = `${dayLabel} ${c.eta} ${c.destination} ${c.pickupYard} ${c.no} ${c.dropoffYard}`;

    // ▼ 2行目：車番 / サイズ / 種別 / 備考
    const parts: string[] = [
      carNo || `シャーシ ${group.chassisLabel}`,
      sizeLabel,
      kindLabel,
    ];
    if (note) parts.push(note);
    const line2 = parts.join(" / ");

    tooltip = `${line1}\n${line2}`;
  } else {
    // Cだけのとき
    const parts: string[] = [
      carNo || `シャーシ ${group.chassisLabel}`,
      sizeLabel,
      kindLabel,
    ];
    if (note) parts.push(note);
    tooltip = parts.join(" / ");
  }

  // ===============================
  //  カード上の表示（A+C の 1行目）
  // ===============================
  let acLine1 = "";
  if (isAC && group.container) {
    const c = group.container;
    const [, d] = c.date.split("/");
    const dayLabel = d ? `${d}日` : c.date;

    // ★ 1行目：28日 9:00 千葉RDC
    acLine1 = `${dayLabel} ${c.eta} ${c.destination}`;
  }

  const handleContextMenu = (e: React.MouseEvent<HTMLDivElement>) => {
    // A+C だけ右クリックメニューを出す
    if (!group.container) return;
    if (!onContextMenuGroup) return;

    e.preventDefault(); // ブラウザ標準のメニューを出さない
    onContextMenuGroup(e, group);
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`obj-card chassis-card ${
        isAC ? "group-loaded" : "group-empty"
      } size-${group.size} ${statusClass} ${axleClass}`}
      {...listeners}
      {...attributes}
      title={tooltip}
      onContextMenu={handleContextMenu}
    >
      <div className="card-body">
        {isAC && group.container ? (
  <>
    {/* 1段目：28日 9:00 千葉RDC */}
    <div className="card-title card-title-container">{acLine1}</div>

    {/* 2段目：青海A-1 青海EIR / 154 */}
    <div className="card-sub card-sub-chassis">
      <span className="card-sub-text ac-loaded">
        {/* 搬出ヤード + 搬入ヤード + グレーのスラッシュ + 赤いシャーシ番号 */}
        <span className="ac-yard">{group.container.pickupYard}</span>{" "}
        <span className="ac-yard">{group.container.dropoffYard}</span>{" "}
        <span className="ac-slash">/</span>{" "}
        <span className="chassis-no-highlight">
          {group.chassisLabel}
        </span>
      </span>
    </div>
  </>
) : (
  // Cだけのとき
  <div className="chassis-only-row">
    <span className="chassis-only-label">{group.chassisLabel}</span>
    <span className="chassis-only-meta">
      {sizeLabel} {kindLabel}
    </span>
  </div>
)}
      </div>
    </div>
  );
}


function DraggableTruckCard({ truck }: { truck: Truck }) {
  const { attributes, listeners, setNodeRef, transform } = useDraggable({
    id: `truck-${truck.id}`,
  });

  const style: React.CSSProperties = {
    transform: transform ? `translate(${transform.x}px, ${transform.y}px)` : undefined,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="obj-card truck-card"
      {...listeners}
      {...attributes}
      title={truck.carNo || truck.label}
    >
      <div className="card-body">
        <div className="card-title"> {truck.label}</div>
      </div>
    </div>
  );
}

function DraggableContainerCard({
  container,
  isCompleted,
}: {
  container: Container;
  isCompleted?: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform } = useDraggable({
    id: `cont-${container.id}`,
  });

  const style: React.CSSProperties = {
    transform: transform ? `translate(${transform.x}px, ${transform.y}px)` : undefined,
  };

  const full = formatContainerSummary(container);

  const dateParts = container.date.split("/");
  const day = dateParts[1] || container.date;
  const dayLabel = `${day}日`;

  const pickupShort =
    container.pickupYard.length > 6
      ? container.pickupYard.slice(0, 6) + "…"
      : container.pickupYard;

  const destShort =
    container.destination.length > 6
      ? container.destination.slice(0, 6) + "…"
      : container.destination;

  const short = `${dayLabel} ${container.eta} ${pickupShort} ${destShort}`;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`obj-card container-card size-${container.size}${
        isCompleted ? " container-completed" : ""
      }`}
      {...listeners}
      {...attributes}
      title={full}
    >
      <div className="card-body">
        <div className="card-title">{short}</div>
      </div>
    </div>
  );
}


function DroppableArea({
  id,
  children,
  placeholder,
  className,
}: {
  id: string;
  children?: React.ReactNode;
  placeholder?: string;
  className?: string;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div
      ref={setNodeRef}
      className={`card-container ${className ?? ""}`}
      style={{ borderColor: isOver ? "#3b82f6" : "#e2e8f0" }}
    >
      {React.Children.count(children) > 0
        ? children
        : placeholder && <div className="placeholder">{placeholder}</div>}
    </div>
  );
}

/** メイン */

function App() {

    const [boardId, setBoardId] = useState<string>("");
    const [userId, setUserId] = useState<string>("");
    
    // ✅ ログイン状態（userId）だけを App で保持
    useEffect(() => {
      let mounted = true;

      supabase.auth.getUser().then(({ data, error }) => {
        if (!mounted) return;
        if (error) {
          console.error("getUser error", error);
          return;
        }
        setUserId(data.user?.id ?? "");
      });

      const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
        if (!mounted) return;
        setUserId(session?.user?.id ?? "");
      });

      return () => {
        mounted = false;
        sub.subscription.unsubscribe();
      };
    }, []);

    // ✅ ログイン後に boardId を確定（URL優先 → localStorage → 新規作成）
    const initBoardRanRef = useRef(false);

    useEffect(() => {
      // 未ログインなら何もしない
      if (!userId) {
        initBoardRanRef.current = false; // ログアウト→再ログイン時に再実行できるように
        setBoardId("");
        return;
      }

      // React(Vite)の StrictMode で useEffect が2回走る対策
      if (initBoardRanRef.current) return;
      initBoardRanRef.current = true;

      const initBoard = async () => {
        const url = new URL(window.location.href);

        // 1) URL ?board=xxxx
        const q = url.searchParams.get("board");
        if (q) {
          setBoardId(q);
          localStorage.setItem("dispatch-board-id", q);
          return;
        }

        // 2) localStorage
        const ls = localStorage.getItem("dispatch-board-id");
        if (ls) {
          url.searchParams.set("board", ls);
          window.history.replaceState({}, "", url.toString());
          setBoardId(ls);
          return;
        }

        // 3) 新規作成（RPC）
        const { data, error } = await supabase.rpc("create_dispatch_board", {
          p_name: "テスト配車表",
        });

        if (error) {
          console.error("create_dispatch_board error", error);
          alert("ボード作成に失敗しました。コンソールを見てください。");
          initBoardRanRef.current = false; // 失敗時は再試行できるように戻す
          return;
        }

        const newId = String(data);
        url.searchParams.set("board", newId);
        window.history.replaceState({}, "", url.toString());
        localStorage.setItem("dispatch-board-id", newId);
        setBoardId(newId);
      };

      initBoard();
    }, [userId]);

    

    const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3001";
    const [groups, setGroups] = useState<ChassisGroup[]>([]);
    // 一時保管枠
    const [tempContainers, setTempContainers] = useState<Container[]>([]);
    // 完了一覧
    const [completedContainers, setCompletedContainers] = useState<Container[]>([]);
    const [containers, setContainers] = useState<Container[]>([]);

    // --- 最新 state を interval 内から参照するための Ref ---
    const containersRef = useRef<Container[]>([]);
    const tempRef = useRef<Container[]>([]);
    const doneRef = useRef<Container[]>([]);
    const groupsRef = useRef<ChassisGroup[]>([]);

    // state が変わったら ref へ反映
    useEffect(() => { containersRef.current = containers; }, [containers]);
    useEffect(() => { tempRef.current = tempContainers; }, [tempContainers]);
    useEffect(() => { doneRef.current = completedContainers; }, [completedContainers]);
    useEffect(() => { groupsRef.current = groups; }, [groups]);
    

  // ドライバーグループ設定（自車／傭車）
  const [driverGroups, setDriverGroups] = useState<DriverGroupConfig>(() => {
    const saved = localStorage.getItem("dispatch-driver-groups");
    if (saved) {
      try {
        const parsed = JSON.parse(saved);

        // 旧フォーマット（配列）のときは無視してデフォルトに戻す
        if (Array.isArray(parsed)) {
          return DEFAULT_DRIVER_GROUPS;
        }

        // 新フォーマット：owned / outsourced が配列なら採用
        if (
          parsed &&
          typeof parsed === "object" &&
          Array.isArray((parsed as any).owned) &&
          Array.isArray((parsed as any).outsourced)
        ) {
          return parsed as DriverGroupConfig;
        }
      } catch {
        // 壊れてたら何もしない（下でデフォルト）
      }
    }
    return DEFAULT_DRIVER_GROUPS;
  });

  // 画面表示用の並び順
  const OWNED_GROUP_ORDER = driverGroups.owned;
  const OUTSOURCED_GROUP_ORDER = driverGroups.outsourced;

  // 設定が変わったときに保存
  useEffect(() => {
    localStorage.setItem(
      "dispatch-driver-groups",
      JSON.stringify(driverGroups)
    );
  }, [driverGroups]);

  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  const [yards, setYards] = useState<YardConfig[]>(() => {
  const applyDefaults = (list: any[]): YardConfig[] =>
    list.map((raw) => {
      const y = raw as YardConfig;

      const slotMode: SlotMode =
        y.slotMode ??
        (y.id === "kawaguchi" || y.id === "custom" ? "single" : "three");

      const positionLabels =
        y.positionLabels ?? { ...DEFAULT_POSITION_LABELS };

      return {
        ...y,
        slotMode,
        positionLabels,
      };
    });

  const saved = localStorage.getItem("dispatch-yards");
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed)) {
        return applyDefaults(parsed);
      }
    } catch {
      // 壊れてたら defaultYards にフォールバック
    }
  }
  return applyDefaults(defaultYards);
});



  useEffect(() => {
    localStorage.setItem("dispatch-yards", JSON.stringify(yards));
  }, [yards]);

  const [mailMenu, setMailMenu] = useState<MailMenuState>({
    visible: false,
    x: 0,
    y: 0,
    group: null,
    driver: null,
  });

  // どこかクリックしたらメニューを閉じる
  useEffect(() => {
    const close = () =>
      setMailMenu((s) => ({ ...s, visible: false }));
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, []);

  const openMailMenu = (
    e: React.MouseEvent<HTMLDivElement>,
    group: ChassisGroup,
    driver: Driver
  ) => {
    setMailMenu({
      visible: true,
      x: e.clientX,
      y: e.clientY,
      group,
      driver,
    });
  };

  const handleSendMail = (mode: "pickup" | "delivery") => {
    if (!mailMenu.group || !mailMenu.driver) return;
    const g = mailMenu.group;
    const d = mailMenu.driver;
    const c = g.container;
    if (!c) return;

    if (!d.email) {
      alert("このドライバーにはメールアドレスが設定されていません。");
      return;
    }

    const { subject, body } =
      mode === "pickup"
        ? buildPickupMail(c, d)
        : buildDeliveryMail(c, d);

    const mailto = `mailto:${encodeURIComponent(
      d.email
    )}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

    window.location.href = mailto;

    setMailMenu((s) => ({ ...s, visible: false }));
  };

  const [drivers, setDrivers] = useState<Driver[]>([]);

    // ★ 初回マウント時に kintone からドライバー一覧を取得
  useEffect(() => {
  async function fetchDrivers() {
    try {
      const res = await fetch(`${API_BASE}/api/drivers`);
      if (!res.ok) {
        console.error("ドライバーAPIエラー", await res.text());
        return;
      }
      const data = await res.json();

      const apiDrivers: Driver[] = (data.drivers ?? []).map((d: any) => {
        const rawType = (d.driverType ?? "").toString().trim();      // 自車 / 傭車
        const rawGroup = (d.driverGroup ?? "").toString().trim();    // ドレー / ポジ / ガレージ など

        let kind: DriverKind = "unknown";
        if (rawType === "自車" || rawType === "自社") {
          kind = "owned";
        } else if (rawType === "傭車") {
          kind = "outsourced";
        }

        return {
          id: String(d.id),
          name: d.name,
          email: d.email,
          baseTruckNo: d.baseTruckNo || "",
          kind,
          groupName: rawGroup || undefined,
        };
      });

      setDrivers(apiDrivers);
    } catch (err) {
      console.error("ドライバー取得に失敗", err);
    }
  }

  fetchDrivers();
}, []);

  const [trucks, setTrucks] = useState<Truck[]>([]);



// ★ kintone から車両一覧を取得して、基本車両をドライバーに割り当てる
useEffect(() => {
  async function fetchTrucks() {
    try {
      const res = await fetch(`${API_BASE}/api/trucks`);
      if (!res.ok) {
        console.error("車両APIエラー", await res.text());
        return;
      }
      const data = await res.json();

      // 1) まず全部「予備車」として作成
      const apiTrucks: Truck[] = (data.trucks ?? []).map((t: any) => ({
        id: String(t.id),
        label: t.number,      // 車両_番号
        carNo: t.carNo,       // 車両_車番
        location: { type: "spare" as const },
      }));

      // 2) drivers の baseTruckNo に合わせてドライバー枠に割り当て
      const trucksWithLocation = [...apiTrucks];
      const usedIndex = new Set<number>();

      drivers.forEach((d) => {
        const num = d.baseTruckNo?.trim();
        if (!num) return;

        const idx = trucksWithLocation.findIndex(
          (t, i) => t.label === num && !usedIndex.has(i)
        );
        if (idx === -1) return;

        trucksWithLocation[idx] = {
          ...trucksWithLocation[idx],
          location: { type: "driver", driverId: d.id },
        };
        usedIndex.add(idx);
      });

      setTrucks(trucksWithLocation);
    } catch (err) {
      console.error("車両取得に失敗", err);
    }
  }

  // ドライバー情報（baseTruckNo）が入ってから読み込んだ方が都合が良いので drivers を依存にしておく
  fetchTrucks();
}, [drivers]);

// ★ 初回マウント時に kintone からシャーシ一覧を取得（全部 川口車庫 に初期配置）
useEffect(() => {
  async function fetchChassis() {
    try {
      const res = await fetch(`${API_BASE}/api/chassis`);
      if (!res.ok) {
        console.error("シャーシAPIエラー", await res.text());
        return;
      }
      const data = await res.json();

      const apiGroups: ChassisGroup[] = (data.chassis ?? []).map(
        (c: ApiChassis) => ({
          id: c.id,
          chassisLabel: c.displayNo,
          size: c.size,
          axle: c.axle,
          container: undefined,
          location: {
            type: "pool",
            yardId: "kawaguchi", // ★ 初期位置は全部 川口車庫
            laneId: "single",
            pos: "front",
          },
          extra: {
            carNo: c.carNo,
            sizeLabel: c.sizeLabel,
            kindLabel: c.kindLabel,
            note: c.note,
          },
        })
      );

      setGroups(apiGroups);
    } catch (err) {
      console.error("シャーシ取得に失敗", err);
    }
  }

  fetchChassis();
}, []);




const moveContainerToDelivered = (id: string, patch?: Partial<Container>) => {
  const findBase = (): Container | null => {
    const gid = String(id);

    // 1) A+C（積載中）から優先
    const fromAC = groupsRef.current.find((g) => g.container?.id === gid)?.container;
    if (fromAC) return fromAC;

    // 2) A（配送枠）
    const fromA = containersRef.current.find((c) => c.id === gid);
    if (fromA) return fromA;

    // 3) temp
    const fromT = tempRef.current.find((c) => c.id === gid);
    if (fromT) return fromT;

    // 4) done（既に完了にいる場合）
    const fromD = doneRef.current.find((c) => c.id === gid);
    if (fromD) return fromD;

    return null;
  };

  const base = findBase();
  if (!base) return;

  const merged: Container = {
    ...base,
    ...(patch ?? {}),
    id: String(id),
    worker4: (patch?.worker4 ?? base.worker4 ?? "").toString().trim(),
  };

  // ① シャーシ上にあれば「コンテナだけ外す」（シャーシはそのまま）
  setGroups((prev) =>
    prev.map((g) => (g.container?.id === String(id) ? { ...g, container: undefined } : g))
  );

  // ② 他リストから消す
  setContainers((prev) => prev.filter((c) => c.id !== String(id)));
  setTempContainers((prev) => prev.filter((c) => c.id !== String(id)));

  // ③ 完了へ upsert（重複防止）
  setCompletedContainers((prev) => {
    const exists = prev.find((c) => c.id === String(id));
    if (exists) {
      return prev.map((c) => (c.id === String(id) ? { ...c, ...merged } : c));
    }
    return [...prev, merged];
  });
};


// ★ kintone からコンテナをポーリングで取得（新規追加＋更新を両方反映）
useEffect(() => {
  let isCancelled = false;

  async function syncContainersOnce() {
    try {
      const res = await fetch(`${API_BASE}/api/containers`);
      if (!res.ok) {
        console.error("コンテナAPIエラー", await res.text());
        return;
      }
      const data = await res.json();

      // サーバ側の JSON → Container 型に整形
      const fetched: Container[] = (data.containers ?? []).map((c: any) => ({
        id: String(c.id),
        size: c.size as Size,
        date: c.date,
        eta: c.eta,
        pickupYardGroup: c.pickupYardGroup,
        pickupYard: c.pickupYard,
        no: c.no,
        kindCode: c.kindCode,
        destination: c.destination,
        dropoffYard: c.dropoffYard,
        ship: c.ship,
        booking: c.booking,
        destadd: c.destadd,
        desttel: c.desttel,
        worker4: (c.worker4 ?? "").toString().trim(),
        step: c.step ?? undefined, // ← サーバーが渡してくれる場合
      }));

      if (isCancelled) return;

      setContainers((prev) => {
        // id → 既存コンテナ のマップ
        const map = new Map<string, Container>();
        prev.forEach((p) => map.set(p.id, p));

        // 同じ id があれば上書き、なければ追加
        for (const nc of fetched) {
          const existing = map.get(nc.id);
          map.set(nc.id, existing ? { ...existing, ...nc } : nc);
        }

        return Array.from(map.values());
      });
    } catch (err) {
      if (!isCancelled) {
        console.error("コンテナ同期に失敗", err);
      }
    }
  }

  // 初回
  syncContainersOnce();

  // 30秒ごとポーリング
  const timer = setInterval(syncContainersOnce, 30000);

  return () => {
    isCancelled = true;
    clearInterval(timer);
  };
}, []);

useEffect(() => {
  let isCancelled = false;

  async function syncContainerUpdatesOnce() {
    try {
      const res = await fetch(`${API_BASE}/api/containers/updates`);
      if (!res.ok) {
        console.error("updates APIエラー", await res.text());
        return;
      }

      const data = await res.json();

      const patches: Array<{
        id: string;
        no?: string;
        dropoffYard?: string;
        step?: any;
        worker4?: string;
      }> = data.containers ?? [];

      if (isCancelled) return;
      if (patches.length === 0) return;

      // id -> patch のMap
      const patchMap = new Map<string, any>();
      for (const p of patches) patchMap.set(String(p.id), p);

      const applyPatch = (c: Container): Container => {
        const p = patchMap.get(String(c.id));
        if (!p) return c;

        return {
          ...c,
          no: p.no ?? c.no,
          dropoffYard: p.dropoffYard ?? c.dropoffYard,
          step: p.step ?? c.step,
          worker4: (p.worker4 ?? c.worker4 ?? "").toString().trim(),
        };
      };

      // ① まず全リストへ patch を反映（表示の追随）
      setContainers((prev) => prev.map(applyPatch));
      setTempContainers((prev) => prev.map(applyPatch));
      setCompletedContainers((prev) => prev.map(applyPatch));
      setGroups((prev) =>
        prev.map((g) =>
          g.container ? { ...g, container: applyPatch(g.container) } : g
        )
      );

      // ② worker4 が入ったものは「コンテナだけ」配送完了へ移動
      for (const p of patches) {
        const worker4 = (p.worker4 ?? "").toString().trim();
        if (!worker4) continue;

        // move は ref を使って “最新状態から” 探す（interval問題を回避）
        moveContainerToDelivered(String(p.id), {
          no: p.no,
          dropoffYard: p.dropoffYard,
          step: p.step,
          worker4,
        });
      }
    } catch (err) {
      if (!isCancelled) console.error("updates同期に失敗", err);
    }
  }

  // 初回
  syncContainerUpdatesOnce();

  // 10秒ごと
  const timer = setInterval(syncContainerUpdatesOnce, 10000);

  return () => {
    isCancelled = true;
    clearInterval(timer);
  };
}, []);

  
  const [leftWidth, setLeftWidth] = useState<number>(650);   // シャーシプール
  const [middleWidth, setMiddleWidth] = useState<number>(600); // ドライバー
  const [deliveryWidth, setDeliveryWidth] = useState<number>(480); // 配送分

    useEffect(() => {
    if (!boardId) return;

      (async () => {
        const { data, error } = await supabase
        .from("dispatch_board_state")
        .select("state")
        .eq("board_id", boardId)
        .maybeSingle();

      if (error) {
        console.error("load board state error", error);
        return;
      }
      const s = (data?.state ?? {}) as any;

      // 保存が無い（初回）なら何もしない
      if (!s || Object.keys(s).length === 0) return;

      if (s.groups) setGroups(s.groups);
      if (s.trucks) setTrucks(s.trucks);
      if (s.containers) setContainers(s.containers);
      if (s.tempContainers) setTempContainers(s.tempContainers);
      if (s.completedContainers) setCompletedContainers(s.completedContainers);
      if (s.driverGroups) setDriverGroups(s.driverGroups);
      if (s.yards) setYards(s.yards);
    })();
  }, [boardId]);

  useEffect(() => {
    if (!boardId) return;

    const timer = window.setTimeout(async () => {
      const state = {
        groups,
        trucks,
        containers,
        tempContainers,
        completedContainers,
        driverGroups,
        yards,
      };

      const { error } = await supabase
        .from("dispatch_board_state")
        .upsert({ board_id: boardId, state }, { onConflict: "board_id" });

      if (error) console.error("save board state error", error);
    }, 800);

    return () => window.clearTimeout(timer);
  }, [
    boardId,
    groups,
    trucks,
    containers,
    tempContainers,
    completedContainers,
    driverGroups,
    yards,
  ]);

  // ヤードグループ（大井・青海・品川・本牧）
  const yardGroups = ["大井", "青海", "中防","品川", "本牧",  "その他"];

  // 仕切り線ドラッグでリサイズ
  const startResize = (target: "left" | "middle" | "right") =>
  (e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    const startX = e.clientX;
    const startLeft = leftWidth;
    const startMiddle = middleWidth;
    const startDelivery = deliveryWidth;

    function onMouseMove(ev: MouseEvent) {
      const dx = ev.clientX - startX;

      if (target === "left") {
        let newLeft = startLeft + dx;
        newLeft = Math.max(260, Math.min(newLeft, 700));
        setLeftWidth(newLeft);
      } else if (target === "middle") {
        let newMiddle = startMiddle + dx;
        newMiddle = Math.max(260, Math.min(newMiddle, 700));
        setMiddleWidth(newMiddle);
      } else {
        // ★ right（配送分）
        let newDelivery = startDelivery - dx; // 右からつまむイメージなら ± は好みで
        newDelivery = Math.max(260, Math.min(newDelivery, 900));
        setDeliveryWidth(newDelivery);
      }
    }

    function onMouseUp() {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    }

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  };


  function getTruckForDriver(driverId: string) {
    return trucks.find(
      (t) => t.location.type === "driver" && t.location.driverId === driverId
    );
  }

  function getGroupForDriver(driverId: string) {
    return groups.find(
      (g) => g.location.type === "driver" && g.location.driverId === driverId
    );
  }

  function getSlotGroup(
    yardId: string,
    laneId: string,
    pos: "front" | "middle" | "back"
  ) {
    return groups.find(
      (g) =>
        g.location.type === "pool" &&
        g.location.yardId === yardId &&
        g.location.laneId === laneId &&
        g.location.pos === pos
    );
  }

  const spareTrucks = trucks.filter((t) => t.location.type === "spare");

  // コンテナIDからどこにいるかを探す（配送枠 / 一時保管 / 完了）
  function findContainerById(id: string):
    | { container: Container; source: "containers" | "temp" | "done" }
    | null {
    let c = containers.find((x) => x.id === id);
    if (c) return { container: c, source: "containers" };
    c = tempContainers.find((x) => x.id === id);
    if (c) return { container: c, source: "temp" };
    c = completedContainers.find((x) => x.id === id);
    if (c) return { container: c, source: "done" };
    return null;
  }

  function handleDragEnd(event: any) {
    const { active, over } = event;
    if (!over) return;

    const activeId = String(active.id);
    const overId = String(over.id);

    // ---- C / A+C ----
    if (activeId.startsWith("group-")) {
      const groupId = activeId.replace("group-", "");
      const currentGroup = groups.find((g) => g.id === groupId);
      if (!currentGroup) return;

      // プールのマス
      if (overId.startsWith("yard-")) {
  const parts = overId.split("-");
  const yardId = parts[1];

  // ★ 川口車庫・現場など「1スロットで横並び」の場合
  if (parts[2] === "single") {
    setGroups((prev) =>
      prev.map((g) =>
        g.id === groupId
          ? {
              ...g,
              location: {
                type: "pool",
                yardId,
                laneId: "single",
                pos: "front", // ダミー値（使わない）
              },
            }
          : g
      )
    );
    return;
  }

  // ★ 通常ヤード（大井・品川・中防など）のレーン×前中奥
  const laneId = parts[2];
  const pos = parts[3] as "front" | "middle" | "back";

  const occupied = getSlotGroup(yardId, laneId, pos);
  if (occupied && occupied.id !== groupId) return;

  setGroups((prev) =>
    prev.map((g) =>
      g.id === groupId
        ? {
            ...g,
            location: { type: "pool", yardId, laneId, pos },
          }
        : g
    )
  );
  return;
}

      // ドライバー枠（排他：既存がいたらスワップ）
      if (overId.startsWith("driver-") && overId.endsWith("-group")) {
        const driverId = overId.replace("driver-", "").replace("-group", "");

        const hasTruck = trucks.some(
          (t) => t.location.type === "driver" && t.location.driverId === driverId
        );
        if (!hasTruck) return;

        // 既にそのドライバー枠にいる別の group（重なりの原因）
        const occupied = groups.find(
          (g) =>
            g.location.type === "driver" &&
            g.location.driverId === driverId &&
            g.id !== groupId
        );

        const fromLoc = currentGroup.location; // ← ドラッグ元の場所を保持（swap用）

        setGroups((prev) =>
          prev.map((g) => {
            if (g.id === groupId) {
              return { ...g, location: { type: "driver", driverId } };
            }
            if (occupied && g.id === occupied.id) {
              // 既存の方を「ドラッグ元の場所」へ戻す（スワップ）
              return { ...g, location: fromLoc };
            }
            return g;
          })
        );
        return;
      }

      // 一時保管枠へ：A+C → Cだけにしてコンテナは tempContainers へ
      if (overId === "zone-temp") {
        if (!currentGroup.container) return;
        const released = currentGroup.container;

        setGroups((prev) =>
          prev.map((g) =>
            g.id === currentGroup.id ? { ...g, container: undefined } : g
          )
        );
        setTempContainers((prev) => [...prev, released]);
        return;
      }

      // 配送完了枠へ：A+C → Cだけにしてコンテナは completedContainers へ
      if (overId === "zone-delivered") {
        if (!currentGroup.container) return;
        const released = currentGroup.container;

        setGroups((prev) =>
          prev.map((g) =>
            g.id === currentGroup.id ? { ...g, container: undefined } : g
          )
        );
        setCompletedContainers((prev) => [...prev, released]);
        return;
      }

      return;
    }

    // ---- 車両 B ----
    if (activeId.startsWith("truck-")) {
      const truckId = activeId.replace("truck-", "");

      if (overId.startsWith("driver-") && overId.endsWith("-truck")) {
        const driverId = overId.replace("driver-", "").replace("-truck", "");
        setTrucks((prev) =>
          prev.map((t) =>
            t.id === truckId
              ? { ...t, location: { type: "driver", driverId } }
              : t
          )
        );
        return;
      }

      if (overId === "zone-spare-trucks") {
        setTrucks((prev) =>
          prev.map((t) =>
            t.id === truckId ? { ...t, location: { type: "spare" } } : t
          )
        );
        return;
      }

      return;
    }

    // ---- コンテナ A ----
    if (activeId.startsWith("cont-")) {
      const contId = activeId.replace("cont-", "");
      const found = findContainerById(contId);
      if (!found) return;
      const { container, source } = found;

      // ▼ ① 日付自動振分枠：コンテナが持っている date で配送列に戻す
      if (overId === "zone-delivery-own-date") {
        const updated: Container = { ...container }; // date はそのまま

        // 元の場所から削除
        if (source === "containers") {
          setContainers((prev) => prev.filter((c) => c.id !== contId));
        } else if (source === "temp") {
          setTempContainers((prev) => prev.filter((c) => c.id !== contId));
        } else {
          setCompletedContainers((prev) => prev.filter((c) => c.id !== contId));
        }

        // 配送枠に追加（date が一覧にない場合はここで新しい列が生える）
        setContainers((prev) => [...prev, updated]);
        return;
      }

      // 配送レーン（日付×ヤード列）へ
      if (overId.startsWith("delivery-")) {
        const parts = overId.split("-");
        // overId: "delivery-11/28-青海" の想定
        const dateKey = parts[1];         // "11/28"
        const yardGroup = parts[2] ?? ""; // "青海"

        // 日付は絶対に変えない：自分の日付以外の列には入れない
        if (dateKey !== container.date) {
          return; // 何もしない
        }

        // ヤードの変更は許可（同じ日付内での青海→品川 などの変更はOK）
        const updated: Container = {
          ...container,
          pickupYardGroup: yardGroup || container.pickupYardGroup,
        };

        // 元のリストから削除
        if (source === "containers") {
          setContainers((prev) => prev.filter((c) => c.id !== contId));
        } else if (source === "temp") {
          setTempContainers((prev) => prev.filter((c) => c.id !== contId));
        } else {
          setCompletedContainers((prev) => prev.filter((c) => c.id !== contId));
        }

        // 配送分に追加（date は一切いじらない）
        setContainers((prev) => [...prev, updated]);
        return;
      }

      // 一時保管枠へ
      if (overId === "zone-temp") {
        const updated: Container = { ...container };

        if (source === "containers") {
          setContainers((prev) => prev.filter((c) => c.id !== contId));
        } else if (source === "done") {
          setCompletedContainers((prev) => prev.filter((c) => c.id !== contId));
        } else {
          setTempContainers((prev) => prev.filter((c) => c.id !== contId));
        }

        setTempContainers((prev) => [...prev, updated]);
        return;
      }

      // 配送完了枠へ
      if (overId === "zone-delivered") {
        const updated: Container = { ...container };

        if (source === "containers") {
          setContainers((prev) => prev.filter((c) => c.id !== contId));
        } else if (source === "temp") {
          setTempContainers((prev) => prev.filter((c) => c.id !== contId));
        } else {
          setCompletedContainers((prev) => prev.filter((c) => c.id !== contId));
        }

        setCompletedContainers((prev) => [...prev, updated]);
        return;
      }

      // ドライバーの C / A+C に積み込む
      if (overId.startsWith("driver-") && overId.endsWith("-group")) {
        const driverId = overId.replace("driver-", "").replace("-group", "");

        const group = groups.find(
          (g) =>
            g.location.type === "driver" && g.location.driverId === driverId
        );
        if (!group) return;
        if (group.container) return;
        if (group.size !== container.size) return;

        // 元の場所から削除
        if (source === "containers") {
          setContainers((prev) => prev.filter((c) => c.id !== contId));
        } else if (source === "temp") {
          setTempContainers((prev) => prev.filter((c) => c.id !== contId));
        } else {
          setCompletedContainers((prev) => prev.filter((c) => c.id !== contId));
        }

        // シャーシに積む
        setGroups((prev) =>
          prev.map((g) =>
            g.id === group.id ? { ...g, container } : g
          )
        );
        return;
      }

      return;
    }
  }

  // kind が入っていないドライバーは除外
  const effectiveDrivers = drivers.filter((d) => d.kind !== "unknown");

  const ownedDrivers = effectiveDrivers.filter((d) => d.kind === "owned");
  const outsourcedDrivers = effectiveDrivers.filter((d) => d.kind === "outsourced");

  // ===== シャーシプール（ヤード／レーン）操作ヘルパー =====
  const addYard = () => {
    setYards((prev) => [
      ...prev,
      {
        id: `yard-${Date.now()}`,        // 新しいID
        name: "新しいヤード",
        slotMode: "single",              // ★ 追加: 最初は1マスフリー
        positionLabels: {                // ★ 追加: ラベル（とりあえず空）
          front: "",
          middle: "",
          back: "",
        },
        lanes: [{ id: "lane1", label: "レーン1" }],
      },
    ]);
  };

  const removeYard = (yardIndex: number) => {
    setYards((prev) => {
      // ヤードが1つも無くなると困るので最低1つは残す
      if (prev.length <= 1) return prev;
      return prev.filter((_, i) => i !== yardIndex);
    });
  };

  const addLane = (yardIndex: number) => {
    setYards((prev) => {
      const copy = [...prev];
      const yard = copy[yardIndex];

      const newNo = yard.lanes.length + 1;
      const newLane: YardLane = {
        id: `lane${newNo}`,
        label: `レーン${newNo}`,
      };

      copy[yardIndex] = {
        ...yard,
        lanes: [...yard.lanes, newLane],
      };
      return copy;
    });
  };

  const removeLane = (yardIndex: number, laneIndex: number) => {
    setYards((prev) => {
      const copy = [...prev];
      const yard = copy[yardIndex];

      let newLanes = yard.lanes.filter((_, i) => i !== laneIndex);
      // 1本も無くなると困るので最低1本は残す
      if (newLanes.length === 0) {
        newLanes = [{ id: "lane1", label: "レーン1" }];
      }

      copy[yardIndex] = {
        ...yard,
        lanes: newLanes,
      };
      return copy;
    });
  };
  
    // ===== ドライバーグループ設定の更新ヘルパー =====
  const updateOwnedGroup = (index: number, patch: Partial<DriverGroup>) => {
    setDriverGroups((prev) => {
      const owned = [...prev.owned];
      owned[index] = { ...owned[index], ...patch };
      return { ...prev, owned };
    });
  };

  const addOwnedGroup = () => {
    setDriverGroups((prev) => ({
      ...prev,
      owned: [...prev.owned, { key: "", label: "" }],
    }));
  };

  const removeOwnedGroup = (index: number) => {
    setDriverGroups((prev) => {
      const owned = prev.owned.filter((_, i) => i !== index);
      return { ...prev, owned };
    });
  };

  const updateOutsourcedGroup = (index: number, patch: Partial<DriverGroup>) => {
    setDriverGroups((prev) => {
      const outsourced = [...prev.outsourced];
      outsourced[index] = { ...outsourced[index], ...patch };
      return { ...prev, outsourced };
    });
  };

  const addOutsourcedGroup = () => {
    setDriverGroups((prev) => ({
      ...prev,
      outsourced: [...prev.outsourced, { key: "", label: "" }],
    }));
  };

  const removeOutsourcedGroup = (index: number) => {
    setDriverGroups((prev) => {
      const outsourced = prev.outsourced.filter((_, i) => i !== index);
      return { ...prev, outsourced };
    });
  };


  // 配送レーンに表示すべき日付一覧（containers から動的に）
  const dayKeys = Array.from(new Set(containers.map((c) => c.date))).sort();

  return (
    <>
      <div className="app-root">
      <header className="header">
        

    {/* 左側：タイトル＋サブタイトル */}
    <div className="header-main">

      <h1 className="title">
        配車表
      </h1>
      <p className="subtitle">
        左：シャーシプール／ 中央：ドライバー＋車両B＋C・A+C ／
        右：配送分（A）＋一時保管＋配送完了
      </p>
    </div>

    <div className="header-right">

        <AuthBar />

        {/* ★ ここがヘッダー右側の凡例 */}
        <div className="header-legend">
        {/* アイコン群を 3ブロックで横並び */}
        <div className="legend-icons-row">
        {/* サイズ */}
        <div className="legend-group legend-group-size">
          <div className="legend-row">
            <span className="legend-item">
              <span className="legend-color legend-size-20" />20F
            </span>
            <span className="legend-item">
              <span className="legend-color legend-size-40" />40F
            </span>
          </div>
        </div>

        {/* 軸 / 種別 */}
        <div className="legend-group legend-group-axle">
          <div className="legend-row">
            <span className="legend-item">
              <span className="legend-color legend-axle-1" />1軸
            </span>
            <span className="legend-item">
              <span className="legend-color legend-axle-2" />2軸
            </span>
            <span className="legend-item">
              <span className="legend-color legend-axle-3" />3軸
            </span>
            <span className="legend-item">
              <span className="legend-color legend-axle-MG" />MG
            </span>
            <span className="legend-item">
              <span className="legend-color legend-axle-2stack" />2個積
            </span>
            <span className="legend-item">
              <span className="legend-color legend-axle-both" />兼用
            </span>
          </div>
        </div>

        {/* 状態 */}
        <div className="legend-group legend-group-load">
          <div className="legend-row">
            <span className="legend-item">
              <span className="legend-color legend-load-empty" />空
            </span>
            <span className="legend-item">
              <span className="legend-color legend-load-loaded" />積載
            </span>
          </div>
        </div>
      </div>
    </div>
     <button
     className="settings-button btn-primary"
     onClick={() => setIsSettingsOpen(true)}
    >
      設定
    </button>
    </div>
  </header>
    

      <DndContext onDragEnd={handleDragEnd}>
        <div className="main">
          {/* 左：シャーシプール＋予備車 */}
          <div
            className="left-panel"
            style={{ width: leftWidth, flex: "0 0 auto" }}
          >
            <h2>シャーシプール</h2>


            {yards.map((yard) => {
              // ★ slotMode と ラベルを毎ヤードごとに決定
              const slotMode: SlotMode =
                yard.slotMode ??
                (yard.id === "kawaguchi" || yard.id === "custom" ? "single" : "three");

              const labels = yard.positionLabels ?? DEFAULT_POSITION_LABELS;

              // このヤードで使う「マス（前/中/奥）」を決定
              const yardPositions =
                slotMode === "single"
                  ? [] // 1マスフリーなので列は使わない
                  : slotMode === "two"
                  ? [
                      { id: "front" as const, label: labels.front || "前" },
                      { id: "back" as const, label: labels.back || "奥" },
                    ]
                  : [
                      { id: "front" as const, label: labels.front || "前" },
                      { id: "middle" as const, label: labels.middle || "中" },
                      { id: "back" as const, label: labels.back || "奥" },
                    ];

              return (
                <div key={yard.id} className="yard-section">
                  <div className="yard-title">{yard.name}</div>

                  {/* ★ 1マス（フリー）モード：川口車庫と同じ横並び */}
                  {slotMode === "single" ? (
                    <DroppableArea
                      id={`yard-${yard.id}-single`}
                      className="slot-pool-single"
                      placeholder="シャーシをドロップ"
                    >
                      {groups
                        .filter(
                          (g) =>
                            g.location.type === "pool" &&
                            g.location.yardId === yard.id
                        )
                        .map((g) => (
                          <DraggableGroupCard key={g.id} group={g} />
                        ))}
                    </DroppableArea>
                  ) : (
                    // ★ 2マス/3マスモード：前/中/奥のテーブル
                    <div className="yard-table">
                      <div className="yard-header-row">
                        <div className="yard-header-cell" />
                        {yardPositions.map((pos) => (
                          <div
                            key={pos.id}
                            className="yard-header-cell yard-header-pos"
                          >
                            {pos.label}
                          </div>
                        ))}
                      </div>

                      {yard.lanes.map((lane) => (
                        <div key={lane.id} className="yard-lane-row">
                          <div className="yard-lane-name">{lane.label}</div>

                          {yardPositions.map((pos) => {
                            const group = getSlotGroup(
                              yard.id,
                              lane.id,
                              pos.id
                            );
                            const droppableId = `yard-${yard.id}-${lane.id}-${pos.id}`;

                            return (
                              <DroppableArea
                                key={droppableId}
                                id={droppableId}
                                className="slot-pool"
                                placeholder={group ? "" : " "}
                              >
                                {group && <DraggableGroupCard group={group} />}
                              </DroppableArea>
                            );
                          })}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}


            <h3 style={{ marginTop: 12, marginBottom: 4 }}>予備車（B）</h3>
            <DroppableArea
              id="zone-spare-trucks"
              placeholder="ここに予備車Bをドロップ"
              className="slot-row-wrap"
            >
              {spareTrucks.map((t) => (
                <DraggableTruckCard key={t.id} truck={t} />
              ))}
            </DroppableArea>
          </div>
          <div
            className="resizer"
            onMouseDown={startResize("left")}
          />

          {/* 中央：ドライバー */}
          <div
  className="driver-panel"
  style={{ width: middleWidth, flex: "0 0 auto" }}
>
  <h2>ドライバー</h2>

  <div className="driver-groups-grid">
    {/* 左：自車 */}
    <section className="driver-group-column">
      <h3 className="driver-group-column-title">自車</h3>

      {OWNED_GROUP_ORDER.map(({ key, label }) => {
      const groupDrivers = ownedDrivers.filter(
        (d) => (d.groupName || "") === key
      );
      if (groupDrivers.length === 0) return null;

      return (
        <div key={key} className="driver-group">
          <div className="driver-group-name">・{label}</div>
          <div className="driver-list">
            {groupDrivers.map((d) => {
              const truck = getTruckForDriver(d.id);
              const group = getGroupForDriver(d.id);

              return (
                <section key={d.id} className="driver-row">
                  <div className="driver-col">
                    <div className="driver-name">{d.name}</div>
                    <DroppableArea
                      id={`driver-${d.id}-truck`}
                      className="slot-driver-truck"
                      placeholder=" "
                    >
                      {truck && <DraggableTruckCard truck={truck} />}
                    </DroppableArea>
                  </div>

                  <div className="driver-slot-col">
                    <DroppableArea
                      id={`driver-${d.id}-group`}
                      className="slot-driver-group"
                      placeholder=" "
                    >
                      {group && <DraggableGroupCard 
                      group={group}
                      onContextMenuGroup={(e, g) => openMailMenu(e, g, d)}
                      />}
                    </DroppableArea>
                  </div>
                </section>
              );
            })}
          </div>
        </div>
      );
    })}
  </section>

  {/* 右：傭車 */}
  <section className="driver-group-column">
    <h3 className="driver-group-column-title">傭車</h3>

    {OUTSOURCED_GROUP_ORDER.map(({ key, label }) => {
      const groupDrivers = outsourcedDrivers.filter(
        (d) => (d.groupName || "") === key
      );
      if (groupDrivers.length === 0) return null;

      return (
        <div key={key} className="driver-group">
          <div className="driver-group-name">・{label}</div>
          <div className="driver-list">
            {groupDrivers.map((d) => {
              const truck = getTruckForDriver(d.id);
              const group = getGroupForDriver(d.id);

              return (
                <section key={d.id} className="driver-row">
                  <div className="driver-col">
                    <div className="driver-name">{d.name}</div>
                    <DroppableArea
                      id={`driver-${d.id}-truck`}
                      className="slot-driver-truck"
                      placeholder=" "
                    >
                      {truck && <DraggableTruckCard truck={truck} />}
                    </DroppableArea>
                  </div>

                  <div className="driver-slot-col">
                    <DroppableArea
                      id={`driver-${d.id}-group`}
                      className="slot-driver-group"
                      placeholder=" "
                    >
                      {group && <DraggableGroupCard 
                      group={group}
                      onContextMenuGroup={(e, g) => openMailMenu(e, g, d)}
                      />}
                    </DroppableArea>
                  </div>
                </section>
              );
            })}
          </div>
        </div>
      );
    })}
  </section>
</div>
</div>

          <div
            className="resizer"
            onMouseDown={startResize("middle")}
          />

          {/* 右：配送分＋一時保管＋配送完了 */}
          <div
            className="delivery-panel"
            style={{ width: deliveryWidth, flex: "0 0 auto" }}
          >
            <h2>配送分</h2>

            {/* ▼ 追加：この箱の中だけ横スクロール */}
          <div className="delivery-scroll">
            <div className="days-scroll">
              {dayKeys.map((dayKey) => (
                <section key={dayKey} className="day-column">
                  <h3>{dayKey}</h3>

                  {yardGroups.map((yardName) => (
                    <div
                      key={`${dayKey}-${yardName}`}
                      className="delivery-yard-row"
                    >
                      <div className="delivery-yard-name">{yardName}</div>
                      <DroppableArea
                        id={`delivery-${dayKey}-${yardName}`}
                        className="slot-auto"
                        placeholder="ここにコンテナAをドロップ"
                      >
                        {containers
                          .filter(
                            (c) =>
                              c.date === dayKey &&
                              c.pickupYardGroup === yardName
                          )
                          .map((c) => (
                            <DraggableContainerCard
                              key={c.id}
                              container={c}
                            />
                          ))}
                      </DroppableArea>
                    </div>
                  ))}
                </section>
              ))}
            </div>
          </div>

            {/* ▼ 日付自動振分枠（コンテナが持っている日付で列を作る／戻す） */}
            <div className="delivery-auto">
            <h3>日付自動振分</h3>
            <DroppableArea
              id="zone-delivery-own-date"
              placeholder="コンテナが持っている配送日で配送分に戻す"
              className="slot-row-wrap"
            />
          </div>

            <div className="delivery-temp">
            <h3>一時保管</h3>
            <DroppableArea
              id="zone-temp"
              placeholder="A+C をここにドロップするとコンテナだけ一時保管"
              className="slot-row-wrap"
            >
              {tempContainers.map((c) => (
                <DraggableContainerCard key={c.id} container={c} />
              ))}
            </DroppableArea>
          </div>

            <div className="delivery-completed">
  <h3>
    配送完了{" "}
    {completedContainers.length > 0 && (
      <button
        className="clear-completed-btn"
        onClick={() => setCompletedContainers([])}
      >
        全削除
      </button>
    )}
  </h3>
  <DroppableArea
    id="zone-delivered"
    placeholder="A+C や A をここにドロップで完了（あとから戻すことも可）"
    className="slot-row-wrap"
  >
    {completedContainers.map((c) => (
      <DraggableContainerCard
        key={`done-${c.id}`}
        container={c}
        isCompleted
      />
    ))}
  </DroppableArea>
</div>

          </div>
          {/* ★ 右パネル用の仕切り線（必ず main の中の最後の子に） */}
    <div
      className="resizer"
      onMouseDown={startResize("right")}
    />

        </div>

      </DndContext>

      

      {isSettingsOpen && (
        <div
          className="modal-backdrop"
        >
          <div
            className="modal"
            onClick={(e) => e.stopPropagation()}
          >
            <h2>設定</h2>

            {/* シャーシプール設定セクション */}
            <section className="modal-section">
              <h3>シャーシプール設定</h3>

              {yards.map((yard, yIndex) => {
                const slotMode: SlotMode =
                  yard.slotMode ??
                  (yard.id === "kawaguchi" || yard.id === "custom" ? "single" : "three");

                const labels = yard.positionLabels ?? DEFAULT_POSITION_LABELS;

                return (
                  <div key={yard.id} className="modal-yard-row">
                    {/* ヤード名 */}
                    <input
                      className="modal-yard-name-input"
                      value={yard.name}
                      onChange={(e) => {
                        const value = e.target.value;
                        setYards((prev) => {
                          const copy = [...prev];
                          copy[yIndex] = { ...copy[yIndex], name: value };
                          return copy;
                        });
                      }}
                    />

                    {/* ★ マス数の設定 */}
                    <div className="modal-yard-slot-config">
                      <label>
                        マス数：
                        <select
                          value={slotMode}
                          onChange={(e) => {
                            const value = e.target.value as SlotMode;
                            setYards((prev) => {
                              const copy = [...prev];
                              copy[yIndex] = {
                                ...copy[yIndex],
                                slotMode: value,
                              };
                              return copy;
                            });
                          }}
                        >
                          <option value="single">1マス（フリー／川口車庫仕様）</option>
                          <option value="two">2マス（前／奥）</option>
                          <option value="three">3マス（前／中／奥）</option>
                        </select>
                      </label>
                    </div>

                    {/* ★ 前・中・奥の名称（single のときは非表示） */}
                    {slotMode !== "single" && (
                      <div className="modal-pos-labels">
                        <span>マス名：</span>

                        {/* front */}
                        <input
                          className="modal-pos-input"
                          value={labels.front}
                          placeholder="前"
                          onChange={(e) => {
                            const value = e.target.value;
                            setYards((prev) => {
                              const copy = [...prev];
                              const current = copy[yIndex];
                              copy[yIndex] = {
                                ...current,
                                positionLabels: {
                                  ...(current.positionLabels ?? DEFAULT_POSITION_LABELS),
                                  front: value,
                                },
                              };
                              return copy;
                            });
                          }}
                        />

                        {/* middle（3マスのときだけ） */}
                        {slotMode === "three" && (
                          <input
                            className="modal-pos-input"
                            value={labels.middle}
                            placeholder="中"
                            onChange={(e) => {
                              const value = e.target.value;
                              setYards((prev) => {
                                const copy = [...prev];
                                const current = copy[yIndex];
                                copy[yIndex] = {
                                  ...current,
                                  positionLabels: {
                                    ...(current.positionLabels ?? DEFAULT_POSITION_LABELS),
                                    middle: value,
                                  },
                                };
                                return copy;
                              });
                            }}
                          />
                        )}

                        {/* back */}
                        <input
                          className="modal-pos-input"
                          value={labels.back}
                          placeholder="奥"
                          onChange={(e) => {
                            const value = e.target.value;
                            setYards((prev) => {
                              const copy = [...prev];
                              const current = copy[yIndex];
                              copy[yIndex] = {
                                ...current,
                                positionLabels: {
                                  ...(current.positionLabels ?? DEFAULT_POSITION_LABELS),
                                  back: value,
                                },
                              };
                              return copy;
                            });
                          }}
                        />
                      </div>
                    )}

                    {/* レーン一覧 */}
                    <div className="modal-lanes">
                      {yard.lanes.map((lane, lIndex) => (
                        <div key={lane.id} className="modal-lane-row">
                          <input
                            className="modal-lane-input"
                            value={lane.label}
                            onChange={(e) => {
                              const value = e.target.value;
                              setYards((prev) => {
                                const copy = [...prev];
                                const lanesCopy = [...copy[yIndex].lanes];
                                lanesCopy[lIndex] = {
                                  ...lanesCopy[lIndex],
                                  label: value,
                                };
                                copy[yIndex] = {
                                  ...copy[yIndex],
                                  lanes: lanesCopy,
                                };
                                return copy;
                              });
                            }}
                          />
                          <button
                            className="btn-small btn-delete"
                            onClick={() => removeLane(yIndex, lIndex)}
                          >
                            レーン削除
                          </button>
                        </div>
                      ))}

                      <button
                        className="btn-small btn-add"
                        onClick={() => addLane(yIndex)}
                      >
                        レーン追加
                      </button>
                    </div>

                    {/* ヤード削除ボタン */}
                    <div className="modal-yard-actions">
                      <button
                        className="btn-small btn-delete"
                        onClick={() => removeYard(yIndex)}
                        disabled={yards.length <= 1}
                      >
                        置き場削除
                      </button>
                    </div>
                  </div>
                );
              })}

              {/* 一番下に「ヤード追加」 */}
              <button className="btn-small btn-add" onClick={addYard}>
                置き場追加
              </button>


              {/* ここからドライバーグループ設定 */}

              <h3>自車グループ設定</h3>
              <div className="driver-group-list">
                {driverGroups.owned.map((g, index) => (
                  <div key={`owned-${index}`} className="driver-group-row">
                    {/* kintone の「ドライバー_グループ」に入っている値 */}
                    <input
                      className="driver-group-key-input"
                      value={g.key}
                      placeholder="kintone の値（例: ドレー, ポジション）"
                      onChange={(e) =>
                        updateOwnedGroup(index, { key: e.target.value })
                      }
                    />
                    {/* 画面上の表示名 */}
                    <input
                      className="driver-group-name-input"
                      value={g.label}
                      placeholder="表示名（例: ポジ）"
                      onChange={(e) =>
                        updateOwnedGroup(index, { label: e.target.value })
                      }
                    />
                    <button className="btn-small btn-delete" onClick={() => removeOwnedGroup(index)}>
                      削除
                    </button>
                  </div>
                ))}
                <button className="btn-small btn-add" onClick={addOwnedGroup}>
                    グループ追加
                </button>
              </div>

              <h3>傭車グループ設定</h3>
              <div className="driver-group-list">
                {driverGroups.outsourced.map((g, index) => (
                  <div key={`outsourced-${index}`} className="driver-group-row">
                    <input
                      className="driver-group-key-input"
                      value={g.key}
                      placeholder="kintone の値（例: ガレージ, 山翔）"
                      onChange={(e) =>
                        updateOutsourcedGroup(index, { key: e.target.value })
                      }
                    />
                    <input
                      className="driver-group-name-input"
                      value={g.label}
                      placeholder="表示名"
                      onChange={(e) =>
                        updateOutsourcedGroup(index, { label: e.target.value })
                      }
                    />
                    <button className="btn-small btn-delete" onClick={() => removeOutsourcedGroup(index)}>
                      削除
                    </button>
                  </div>
                ))}
                <button className="btn-small btn-add" onClick={addOutsourcedGroup}>
                  グループ追加
                </button>
              </div>
            </section>

            <div className="modal-footer">
              <button 
                className="btn-primary"
                onClick={() => setIsSettingsOpen(false)}
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}

      {mailMenu.visible && mailMenu.group && mailMenu.driver && (
        <div
          className="mail-context-menu"
          style={{ top: mailMenu.y, left: mailMenu.x }}
        >
          <button onClick={() => handleSendMail("pickup")}>
            取りの送信
          </button>
          <button onClick={() => handleSendMail("delivery")}>
            配送の送信
          </button>
        </div>
      )}
    </div>
  </>
  );
}

export default App;
