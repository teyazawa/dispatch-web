import React, { useCallback, useEffect, useRef, useState } from "react";
import "./App.css";
import {
  DndContext,
  useDraggable,
  useDroppable,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { supabase } from "./lib/supabase";
import AuthBar from "./components/AuthBar";
import { DragOverlay } from "@dnd-kit/core";
import { createPortal } from "react-dom";
import tezukaLogo from "./assets/tezuka-logo.png";
import {
  addVoiceLog as sendVoiceLogToWindow,
  openVoiceWindow,
} from "./utils/voiceWindow";
import { openDispatchTable } from "./utils/dispatchTableWindow";
// PRACTICE MODE (temporary) — 削除時はこの2行と関連呼び出しも消す
import { usePracticeMode } from "./lib/practiceMode";
import {
  PracticeSettingsButton,
  PracticeColorPickerModal,
} from "./components/PracticeModeButton";
// ドライバー並び順 (常設)
import { useDriverOrder, sortDriversByOrder } from "./lib/driverOrder";
import { DriverOrderSettings } from "./components/DriverOrderSettings";

/** 表示モード */
type DisplayMode = "pc" | "tablet" | "phone";

const DisplayModeContext = React.createContext<DisplayMode>("pc");

/** デバイス自動判定 */
function detectDisplayMode(): DisplayMode {
  const isTouch = "ontouchstart" in window || navigator.maxTouchPoints > 0;
  if (isTouch && window.innerWidth <= 768) return "phone";
  if (isTouch) return "tablet";
  return "pc";
}

/** サイズ種別 */
type Size = "20" | "40";

/** 型定義 */

type DriverKind = "owned" | "outsourced" | "unknown";

type Driver = {
  id: string;
  name: string;
  email?: string; // 表示はしないけど保持
  baseTruckNo?: string; // 基本車両
  kind: DriverKind;
  groupName?: string;
};

type TruckLocation =
  | { type: "spare"; zoneId: string } // ← zoneId を追加
  | { type: "driver"; driverId: string };

type Truck = {
  id: string;
  label: string; // ← 車両_番号
  carNo?: string; // ← 車両_車番（ツールチップ用）
  location: TruckLocation;
};

/** どこまで進んでいるか（将来用） */
type ContainerStep = 0 | 1 | 2 | 3 | 4; // 0=未着手, 1〜4=①〜④

type KintoneFileLink = {
  name: string;
  fileKey: string;
  contentType?: string;
  size?: string;
  url: string; // /api/kintone/file?...（相対）
};

function fileLinksText(
  label: string,
  files: Array<{ fileKey: string; name?: string }> | undefined,
  apiBase?: string,
  emptyText: string = "", // ✅ 追加：未指定なら今まで通り「空文字」
) {
  const list = (files ?? []).filter((f) => f?.fileKey);

  // ✅ 変更：空のときは emptyText があれば返す
  if (list.length === 0) return emptyText ? `${label}：${emptyText}` : "";

  const base = (apiBase ?? "").replace(/\/$/, "");
  if (!base) {
    // apiBase が無いとURLが作れないので、ラベルだけ返す（デバッグしやすい）
    return `${label}：ファイルあり（apiBase未設定）`;
  }

  const urls = list.map((f) => {
    const name = (f.name ?? "file").toString();
    return `${base}/api/kintone/file?fileKey=${encodeURIComponent(
      f.fileKey,
    )}&name=${encodeURIComponent(name)}`;
  });

  return `${label}：\n${urls.map((u) => `- ${u}`).join("\n")}`;
}

/** コンテナ（A） */
type Container = {
  id: string;
  size: Size; // 20F / 40F 用
  date: string; // 表示・グルーピング用の日付キー（例: "11/28"）
  eta: string; // 着時間 例: "9:00"
  pickupYardGroup: string; // 搬出ヤードグループ 例: "青海"（列の縦軸用）
  pickupYard: string; // 搬出ヤード詳細 例: "青海A-1"
  no: string; // コンテナ番号 例: "ABCD1234567"
  ship: string; // 本船名
  booking: string; // booking
  destadd: string; // 配送先住所
  desttel: string; // 配送先電話番号
  kindCode: string; // D, R など略称
  destination: string; // 配送先名 例: "千葉RDC"
  dropoffYard: string; // 搬入ヤード 例: "青海EIR"
  yardIn2?: string;   // 搬入ヤード(2)
  handoverNo?: string; // 引渡番号
  receiptFiles?: KintoneFileLink[]; //受領書link
  dispatchFiles?: KintoneFileLink[]; //ディスパッチlink
  /** 工程ステップ（サーバーから渡してもらう想定） */
  step?: ContainerStep;
  worker4?: string;
};

type BoardState = {
  groups: ChassisGroup[];
  trucks: Truck[];
  containers: Container[];
  tempContainers: Container[];
  completedContainers: Container[];
  driverGroups: DriverGroupConfig;
  yards: YardConfig[];
  spareZones: SpareZone[]; // ← 追加
  axleColors?: Record<string, string>;
  kindColors?: Record<string, string>;
  sizeColors?: Record<string, string>;

  theme?: ThemeSettings;
  extraMailRecipients?: Record<string, string>;
  version: number;
  updatedAt: string;
  updatedBy: string;
};

type ThemeSettings = {
  appBg?: string;
  headerBg?: string;
  bgImageUrl?: string; // Storage の公開URL（+ cache bust）
  bgSize?: "cover" | "contain" | "auto";
  bgPosition?: "center" | "top" | "bottom" | "left" | "right";
  bgRepeat?: "no-repeat" | "repeat" | "repeat-x" | "repeat-y";
  bgOpacity?: number; // 0〜1
};

const DEFAULT_THEME: ThemeSettings = {
  appBg: "#f3f4f6",
  headerBg: "#ffffff",
  bgImageUrl: "",
  bgSize: "cover",
  bgPosition: "center",
  bgRepeat: "no-repeat",
  bgOpacity: 0.18,
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
  owned: DriverGroup[]; // 自車側のグループ
  outsourced: DriverGroup[]; // 傭車側のグループ
};

const DEFAULT_DRIVER_GROUPS: DriverGroupConfig = {
  owned: [
    { key: "ドレー", label: "ドレー" },
    { key: "ポジション", label: "ポジ" },
  ],
  outsourced: [
    { key: "ガレージ", label: "ガレージ" },
    { key: "山翔", label: "山翔" },
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
  sizeLabel: string; // "20F" / "40F"
  axle: AxleKind;
  kindLabel: string; // "3軸" など
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
    carNo?: string; // シャーシ_車番
    sizeLabel?: string; // "20F" / "40F"
    kindLabel?: string; // "3軸" など
    note?: string; // シャーシ_備考
  };
};

type MailMenuState = {
  visible: boolean;
  x: number;
  y: number;
  group: ChassisGroup | null;
  driver: Driver | null;
  // PRACTICE MODE — 色メニュー対象のコンテナ (group から派生 or 単体コンテナから直接指定)
  containerForColor: { id: string; label: string } | null;
};

/** シャーシプール定義 */
type SlotMode = "single" | "one" | "two" | "three";

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

type SpareZone = {
  id: string;
  name: string;
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

const defaultSpareZones: SpareZone[] = [{ id: "spare-trucks", name: "予備車" }];

/** コンテナ表示用のまとめ文字列 */

function formatContainerSummary(c: Container): string {
  // 日付の前ゼロを削除
  const formattedDate = c.date
    .split("/")
    .map((n) => parseInt(n, 10))
    .join("/");
  return `${formattedDate} ${c.eta} ${c.pickupYard} ${c.no} ${c.size}F ${c.kindCode} ${c.destination} ${c.dropoffYard}`;
}

/** "11/28" → "28日" */
function buildDayLabel(date: string): string {
  if (!date) return "";
  const parts = date.split("/");
  const day = parts[1] || parts[0];
  return `${parseInt(day, 10)}日`; // ← parseInt で前ゼロを削除
}

function splitLast(s: string, sep: string): [string, string] {
  const i = s.lastIndexOf(sep);
  if (i === -1) return [s, ""];
  return [s.slice(0, i), s.slice(i + 1)];
}

function parseYardDropId(overId: string):
  | { mode: "single"; yardId: string }
  | {
      mode: "grid";
      yardId: string;
      laneId: string;
      pos: "front" | "middle" | "back";
    }
  | null {
  if (!overId.startsWith("yard-")) return null;

  const raw = overId.slice("yard-".length);

  // 末尾が "-single" の場合：yardId はそれ以外全部（yardIdに"-"が含まれてもOK）
  if (raw.endsWith("-single")) {
    const yardId = raw.slice(0, -"-single".length);
    if (!yardId) return null;
    return { mode: "single", yardId };
  }

  // grid: "yard-{yardId}-{laneId}-{pos}" を右から2回 split して yardId を残す
  const [rest1, posStr] = splitLast(raw, "-");
  const [yardId, laneId] = splitLast(rest1, "-");

  if (!yardId || !laneId) return null;
  if (posStr !== "front" && posStr !== "middle" && posStr !== "back")
    return null;

  return { mode: "grid", yardId, laneId, pos: posStr };
}

function normalizeSizeRaw(sizeRaw?: string): string {
  const s = (sizeRaw ?? "").toString().trim();
  if (!s) return "";
  return s.replace(/’/g, "'").replace(/\s+/g, " ");
}

function mailBodySizeLabel(container: Container, sizeRaw?: string): string {
  const raw = normalizeSizeRaw(sizeRaw);

  const heightMatch = raw.match(/\b(8'6|9'6)\b/);
  const height = heightMatch?.[1];

  const base = container.size === "40" ? "40" : "20";

  if (height) return `${base} ${height}`;
  if (raw) return raw;

  return container.size === "40" ? "40F" : "20F";
}

/** 取り用の件名＋本文 */
function buildPickupMail(
  container: Container,
  apiBase: string,
  sizeRaw?: string,
): { subject: string; body: string } {
  const subjectSize = container.size === "40" ? "40F" : "20F"; // 件名用
  const bodySize = mailBodySizeLabel(container, sizeRaw); // 本文用（フル）

  const handoverLine = container.handoverNo
    ? `引渡番号：${container.handoverNo}`
    : "";

  const dispatchBlock = fileLinksText(
    "ディスパッチ",
    container.dispatchFiles,
    apiBase,
  );

  const subject = `【${container.pickupYard}取り】 ${subjectSize} ${container.no}`;

  const bodyLines = [
    "",
    container.ship ? `本船名：${container.ship}` : "",
    container.booking ? `BL/BK：${container.booking}` : "",
    `搬出：${container.pickupYard}`,
    `コンテナ：${container.no}`,
    `サイズ：${bodySize}／${container.kindCode}`,
    handoverLine,
    dispatchBlock,
    "備考：",
    "",
    "よろしくお願いします。",
  ].filter(Boolean);

  return { subject, body: bodyLines.join("\n") };
}

/** 配送用の件名＋本文 */
function buildDeliveryMail(
  container: Container,
  apiBase: string,
  sizeRaw?: string,
): { subject: string; body: string } {
  const dayLabel = buildDayLabel(container.date);
  const subjectSize = container.size === "40" ? "40F" : "20F"; // 件名用
  const bodySize = mailBodySizeLabel(container, sizeRaw); // 本文用（フル）

  const receiptBlock = fileLinksText(
    "受領書",
    container.receiptFiles,
    apiBase,
    "あり",
  );

  const subject = `【${dayLabel}配送分】 ${container.eta} ${container.destination} ${subjectSize} ${container.no}`;

  const bodyLines = [
    "",
    `時間：${container.eta}`,
    `コンテナ：${container.no}`,
    `サイズ：${bodySize}／${container.kindCode}`,
    `配送先：${container.destination}`,
    container.destadd ? `住所：${container.destadd}` : "",
    container.desttel ? `TEL：${container.desttel}` : "",
    receiptBlock,
    "備考：",
    "",
    "よろしくお願いします。",
  ].filter(Boolean);

  return { subject, body: bodyLines.join("\n") };
}

/** DnD コンポーネント */
type DraggableGroupCardProps = {
  group: ChassisGroup;
  onContextMenuGroup?: (
    e: React.MouseEvent<HTMLDivElement>,
    group: ChassisGroup,
  ) => void;

  axleColors?: Record<string, string>;
  kindColors?: Record<string, string>;
  sizeColors?: Record<string, string>; // 追加（size-20 / size-40 など）
  onTap?: (group: ChassisGroup) => void;
  // PRACTICE MODE (temporary) — containerId -> "#rrggbb"
  practiceColorMap?: Record<string, string>;
};

function DraggableGroupCard({
  group,
  onContextMenuGroup,
  axleColors,
  kindColors,
  sizeColors,
  onTap,
  practiceColorMap, // PRACTICE MODE
}: DraggableGroupCardProps & { onTap?: (group: ChassisGroup) => void }) {
  const displayMode = React.useContext(DisplayModeContext);
  // ✅ isDragging を追加で取得
  const { attributes, listeners, setNodeRef, isDragging } =
    useDraggable({
      id: `group-${group.id}`,
    });

  // ✅ ここから追加：長押し検出用
  const longPressTimerRef = useRef<number | null>(null);
  const touchStartPosRef = useRef<{ x: number; y: number } | null>(null);
  const [isLongPressing, setIsLongPressing] = useState(false); // ✅ 追加

  const handleTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    // A+Cでない、またはメニュー関数がない場合は何もしない
    if (!group.container || !onContextMenuGroup) return;

    const touch = e.touches[0];
    touchStartPosRef.current = { x: touch.clientX, y: touch.clientY };

    // 500ms後にメニューを開く
    longPressTimerRef.current = window.setTimeout(() => {
      if (touchStartPosRef.current) {
        setIsLongPressing(true); // ✅ 長押し状態をON

        const syntheticEvent = {
          preventDefault: () => {},
          clientX: touchStartPosRef.current.x,
          clientY: touchStartPosRef.current.y,
        } as React.MouseEvent<HTMLDivElement>;

        onContextMenuGroup(syntheticEvent, group);

        // 触覚フィードバック（対応デバイスのみ）
        if (navigator.vibrate) {
          navigator.vibrate([50, 30, 50]); // ✅ パターンを追加
        }
      }
    }, 400);
  };

  const handleTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    // 指が8px以上動いたらタイマーをキャンセル
    if (longPressTimerRef.current && touchStartPosRef.current) {
      const touch = e.touches[0];
      const moved =
        Math.abs(touch.clientX - touchStartPosRef.current.x) > 10 ||
        Math.abs(touch.clientY - touchStartPosRef.current.y) > 10;

      if (moved) {
        window.clearTimeout(longPressTimerRef.current);
        longPressTimerRef.current = null;
        setIsLongPressing(false); // ✅ リセット
      }
    }
  };

  const handleTouchEnd = () => {
    if (longPressTimerRef.current) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    setIsLongPressing(false); // ✅ リセット
    touchStartPosRef.current = null;
  };

  // クリーンアップ
  useEffect(() => {
    return () => {
      if (longPressTimerRef.current) {
        window.clearTimeout(longPressTimerRef.current);
      }
    };
  }, []);

  const axleKey = `axle-${group.axle}`; // axle-1 / axle-2 ...
  const axleColor = axleColors?.[axleKey]; // 未設定なら undefined

  const sizeKey = `size-${group.size}`; // size-20 / size-40
  const sizeColor = sizeColors?.[sizeKey]; // 未設定なら undefined

  const kindLabel = group.extra?.kindLabel ?? "";
  const kindColor = kindLabel ? kindColors?.[kindLabel] : undefined;

  // PRACTICE MODE (temporary) — コンテナ手動色 override
  const practiceOverrideColor =
    group.container && practiceColorMap
      ? practiceColorMap[group.container.id]
      : undefined;

  const style: React.CSSProperties = {
    // DragOverlay使用時は元カードを動かさず非表示にする
    opacity: isDragging ? 0 : undefined,
    pointerEvents: isDragging ? "none" : undefined,

    ...(axleColor ? { borderTop: `6px solid ${axleColor}` } : {}),
    ...(sizeColor ? { borderLeft: `5px solid ${sizeColor}` } : {}),
    // PRACTICE MODE — chassis-step-N の !important を上書きするため
    //   CSS変数 + data属性でCSS側のセレクタと合わせる
    ...(practiceOverrideColor
      ? ({ ["--practice-color" as any]: practiceOverrideColor } as React.CSSProperties)
      : {}),
  };

  const isAC = !!group.container;
  const statusClass = isAC ? "chassis-loaded" : "chassis-empty";
  const axleClass = `axle-${group.axle}`;

  // === kintone 由来のシャーシ情報 ===
  const carNo = group.extra?.carNo ?? "";
  const sizeLabel = group.extra?.sizeLabel ?? `${group.size}F`;
  const note = group.extra?.note?.trim();

  // ===============================
  //  ホバー時のツールチップ文字列
  // ===============================
  let tooltip: string;

  if (isAC && group.container) {
    const c = group.container;

    // 11/28 → 28日、01/08 → 8日
    const [, d] = c.date.split("/");
    const dayLabel = d ? `${parseInt(d, 10)}日` : c.date;

    // ▼ 1行目：28日 9:00 千葉RDC 青海A-1 ABCD1234567 青海EIR（大井B-3）
    const dropoffDisplay = c.yardIn2
      ? `${c.dropoffYard}（${c.yardIn2}）`
      : c.dropoffYard;
    const line1 = `${dayLabel} ${c.eta} ${c.destination} ${c.pickupYard} ${c.no} ${dropoffDisplay}`;

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
  //  カード上の表示（A+C）
  // ===============================
  let acLine1 = ""; // 1行目：日付 時間 配送先
  let acLine2 = ""; // 2行目：コンテナ番号
  let acLine3 = ""; // 3行目：ヤード / シャーシ番号

  if (isAC && group.container) {
    const c = group.container;
    const [, d] = c.date.split("/");
    const dayLabel = d ? `${parseInt(d, 10)}日` : c.date;

    // 1行目：28日 9:00 千葉RDC
    acLine1 = `${dayLabel} ${c.eta} ${c.destination}`;

    // 2行目：コンテナ番号（青文字で表示するため別変数に）
    acLine2 = c.no;

    // 3行目：stepに応じてヤード表示を切り替え
    if (c.step && c.step >= 1) {
      // ✅ step1送信済み：搬入ヤード / シャーシ番号
      acLine3 = `${c.dropoffYard || "未定"}`;
    } else {
      // ✅ step1未送信：搬出ヤード / シャーシ番号
      acLine3 = `${c.pickupYard}`;
    }
  }

  const handleContextMenu = (e: React.MouseEvent<HTMLDivElement>) => {
    // A+C だけ右クリックメニューを出す
    if (!group.container) return;
    if (!onContextMenuGroup) return;

    e.preventDefault(); // ブラウザ標準のメニューを出さない
    onContextMenuGroup(e, group);
  };

  // ステップに応じたクラス名を決定（A+Cの時のみ）
  let stepClass = "";
  if (isAC && group.container) {
    const step = group.container.step;
    if (step === 1) {
      stepClass = "chassis-step-1";
    } else if (step === 2) {
      stepClass = "chassis-step-2";
    } else if (step === 3) {
      stepClass = "chassis-step-3";
    } else if (step === 4) {
      stepClass = "chassis-step-4";
    }
  }

  const cardClassName = `obj-card chassis-card ${
    isAC ? "group-loaded" : "group-empty"
  } size-${group.size} ${statusClass} ${axleClass} ${stepClass} ${
    isLongPressing ? "long-pressing" : ""
  } ${isDragging ? "is-dragging" : ""}`;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cardClassName} // ✅ 変更
      {...(displayMode !== "phone" ? listeners : {})}
      {...attributes}
      title={tooltip}
      onContextMenu={handleContextMenu}
      onTouchStart={handleTouchStart} // ✅ 追加
      onTouchMove={handleTouchMove} // ✅ 追加
      onTouchEnd={handleTouchEnd} // ✅ 追加
      onTouchCancel={handleTouchEnd}
      onClick={() => onTap?.(group)}
      // PRACTICE MODE — CSS `.chassis-card[data-practice-color]` と一致させる
      data-practice-color={practiceOverrideColor ? "1" : undefined}
    >
      {displayMode === "phone" && (
        <div className="drag-handle" {...listeners}>{"\u2630"}</div>
      )}
      {/* ✅ 追加：上部の色帯（色が設定されている時だけ表示） */}
      {kindColor ? (
        <div
          className="chassis-kind-strip"
          style={{ backgroundColor: kindColor }}
        />
      ) : null}

      <div className="card-body">
        {isAC && group.container ? (
          <>
            {/* 1行目：28日 9:00 千葉RDC */}
            <div className="card-title card-title-container">{acLine1}</div>

            {/* 2行目：コンテナ番号（青文字） */}
            <div className="card-sub">
              <span className="card-sub-text container-no-highlight">
                {acLine2}
              </span>
            </div>

            {/* 3行目：ヤード / シャーシ番号 */}
            <div className="card-sub card-sub-chassis">
              <span className="card-sub-text ac-loaded">
                {acLine3} <span className="ac-slash">/</span>{" "}
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

function getOrCreateClientId() {
  const key = "dispatch-client-id";
  const existing = localStorage.getItem(key);
  if (existing) return existing;

  const id =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `client-${Math.random().toString(16).slice(2)}-${Date.now()}`;

  localStorage.setItem(key, id);
  return id;
}

function DraggableTruckCard({ truck }: { truck: Truck }) {
  const displayMode = React.useContext(DisplayModeContext);
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `truck-${truck.id}`,
  });

  const style: React.CSSProperties = {
    // DragOverlay使用時は元カードを動かさず非表示にする
    opacity: isDragging ? 0 : undefined,
    pointerEvents: isDragging ? "none" : undefined,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="obj-card truck-card"
      {...(displayMode !== "phone" ? listeners : {})}
      {...attributes}
      title={truck.carNo || truck.label}
    >
      {displayMode === "phone" && (
        <div className="drag-handle" {...listeners}>{"\u2630"}</div>
      )}
      <div className="card-body">
        <div className="card-title"> {truck.label}</div>
      </div>
    </div>
  );
}

function DraggableContainerCard({
  container,
  isCompleted,
  sizeColors,
  onTap,
  practiceColorMap, // PRACTICE MODE
  onContextMenuContainer, // PRACTICE MODE
}: {
  container: Container;
  isCompleted?: boolean;
  sizeColors?: Record<string, string>;
  onTap?: (container: Container) => void;
  practiceColorMap?: Record<string, string>;
  onContextMenuContainer?: (
    e: React.MouseEvent<HTMLDivElement>,
    container: Container,
  ) => void;
}) {
  const displayMode = React.useContext(DisplayModeContext);
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `cont-${container.id}`,
  });

  const sizeKey = `size-${container.size}`;
  const sizeColor = sizeColors?.[sizeKey];

  // PRACTICE MODE — 手動色 override
  const practiceOverrideColor = practiceColorMap
    ? practiceColorMap[container.id]
    : undefined;

  const style: React.CSSProperties = {
    // DragOverlay使用時は元カードを動かさず非表示にする
    opacity: isDragging ? 0 : undefined,
    pointerEvents: isDragging ? "none" : undefined,
    ...(sizeColor ? { borderLeft: `5px solid ${sizeColor}` } : {}),
    ...(practiceOverrideColor
      ? ({ ["--practice-color" as any]: practiceOverrideColor } as React.CSSProperties)
      : {}),
  };

  const full = formatContainerSummary(container);

  // 日付ラベル作成
  // 日付ラベル作成（前ゼロ削除）
  const dateParts = container.date.split("/");
  const day = dateParts[1] || container.date;
  const dayLabel = `${parseInt(day, 10)}日`;

  // 搬出ヤードの短縮表示
  const pickupShort =
    container.pickupYard.length > 8
      ? container.pickupYard.slice(0, 8) + "…"
      : container.pickupYard;

  // 配送先の短縮表示
  const destShort =
    container.destination.length > 8
      ? container.destination.slice(0, 8) + "…"
      : container.destination;

  // 1行目：日付 時間 搬出ヤード
  const line1 = `${dayLabel} ${container.eta} ${pickupShort}`;

  // 2行目：配送先 コンテナ番号
  const line2Dest = destShort;
  const line2ContNo = container.no;

  // ステップに応じたクラス名を決定
  let stepClass = "";
  if (isCompleted) {
    stepClass = "container-completed";
  } else if (container.step === 1) {
    stepClass = "container-step-1";
  } else if (container.step === 2) {
    stepClass = "container-step-2";
  } else if (container.step === 3) {
    stepClass = "container-step-3";
  } else if (container.step === 4) {
    stepClass = "container-step-4";
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`obj-card container-card size-${container.size} ${stepClass}`} // ← ここに ${stepClass} が入っていることを確認
      {...(displayMode !== "phone" ? listeners : {})}
      {...attributes}
      title={full}
      onClick={() => onTap?.(container)}
      // PRACTICE MODE
      data-practice-color={practiceOverrideColor ? "1" : undefined}
      onContextMenu={(e) => {
        if (!onContextMenuContainer) return;
        e.preventDefault();
        onContextMenuContainer(e, container);
      }}
    >
      {displayMode === "phone" && (
        <div className="drag-handle" {...listeners}>{"\u2630"}</div>
      )}
      <div className="card-body" style={{ width: "100%" }}>
        {/* 1行目 */}
        <div
          className="card-title"
          style={{ width: "100%", textAlign: "left" }}
        >
          {line1}
        </div>

        {/* 2行目：配送先は左、コンテナ番号は右 */}
        <div
          className="card-sub"
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginTop: "2px",
            width: "100%",
            gap: "4px" /* ← 追加：配送先とコンテナ番号の間に最小限の隙間 */,
          }}
        >
          <span
            className="card-sub-text"
            style={{
              textAlign: "left",
              overflow: "hidden" /* ← 追加 */,
              textOverflow: "ellipsis" /* ← 追加 */,
              whiteSpace: "nowrap" /* ← 追加 */,
              flex: 1,
            }}
          >
            {line2Dest}
          </span>
          <span
            className="card-sub-text container-no-highlight"
            style={{
              textAlign: "right",
              flexShrink: 0,
              whiteSpace: "nowrap",
            }}
          >
            {line2ContNo}
          </span>
        </div>
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

async function uploadThemeBgToStorage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      const dataUrl = event.target?.result as string;
      resolve(dataUrl);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/** メイン */

function App() {
  // ── 表示モード（sensors より先に定義） ──
  const [displayMode, setDisplayMode] = useState<DisplayMode>(() => {
    const saved = localStorage.getItem("dispatch-display-mode");
    if (saved === "pc" || saved === "tablet" || saved === "phone") return saved;
    return detectDisplayMode();
  });

  // センサー設定（スマホではドラッグハンドル経由なので共通設定でOK）
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
    }),
    useSensor(TouchSensor, {
      activationConstraint: { distance: 10 },
    }),
  );

  // ✅ ここに追加：詳細モーダル用の state
  const [detailModal, setDetailModal] = useState<{
    visible: boolean;
    group?: ChassisGroup;
    container?: Container;
  }>({ visible: false });

  // ✅ ここに追加：カードタップ時の処理
  const handleCardTap = (group: ChassisGroup) => {
    // タッチデバイスの場合のみモーダル表示
    if ("ontouchstart" in window) {
      setDetailModal({ visible: true, group });
    }
  };

  const [activeDragId, setActiveDragId] = useState<string | null>(null);

  const [boardId, setBoardId] = useState<string>("");

  const [userId, setUserId] = useState<string>("");

  // ★ 自動/手動ポーリング切替
  const [autoSync, setAutoSync] = useState<boolean>(() => {
    return localStorage.getItem("dispatch-sync-mode") !== "manual";
  });
  const autoSyncRef = useRef(autoSync);
  useEffect(() => {
    autoSyncRef.current = autoSync;
    localStorage.setItem("dispatch-sync-mode", autoSync ? "auto" : "manual");
  }, [autoSync]);

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
  const containerMetaRef = useRef<Map<string, { sizeRaw?: string }>>(new Map());

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

  const [theme, setTheme] = useState<ThemeSettings>(DEFAULT_THEME);

  useEffect(() => {
    const root = document.documentElement;

    root.style.setProperty("--app-bg", theme.appBg || DEFAULT_THEME.appBg!);
    root.style.setProperty(
      "--header-bg",
      theme.headerBg || DEFAULT_THEME.headerBg!,
    );

    const img = theme.bgImageUrl ? `url("${theme.bgImageUrl}")` : "none";
    root.style.setProperty("--bg-image", img);

    root.style.setProperty("--bg-size", theme.bgSize || "cover");
    root.style.setProperty("--bg-position", theme.bgPosition || "center");
    root.style.setProperty("--bg-repeat", theme.bgRepeat || "no-repeat");
    root.style.setProperty("--bg-opacity", String(theme.bgOpacity ?? 0.18));
  }, [theme]);

  const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3001";

  // ★ 地域 → ヤード[] マップ (GAS「ヤード」シート由来)
  const [yardMap, setYardMap] = useState<Record<string, string[]>>(() => {
    try {
      const cached = localStorage.getItem("dispatch-yard-map");
      return cached ? JSON.parse(cached) : {};
    } catch {
      return {};
    }
  });

  // ★ シャーシプール ヤード別 折りたたみ状態 (yardId → true = 隠す)
  const [hiddenPoolYards, setHiddenPoolYards] = useState<
    Record<string, boolean>
  >(() => {
    try {
      const cached = localStorage.getItem("dispatch-hidden-pool-yards");
      return cached ? JSON.parse(cached) : {};
    } catch {
      return {};
    }
  });

  // ★ 一斉配信 除外ドライバー (driverId → true = 除外)
  const [excludedDrivers, setExcludedDrivers] = useState<
    Record<string, boolean>
  >(() => {
    try {
      const cached = localStorage.getItem("dispatch-mail-excluded-drivers");
      return cached ? JSON.parse(cached) : {};
    } catch {
      return {};
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(
        "dispatch-mail-excluded-drivers",
        JSON.stringify(excludedDrivers),
      );
    } catch {}
  }, [excludedDrivers]);
  const toggleExcludedDriver = useCallback((driverId: string) => {
    setExcludedDrivers((prev) => ({ ...prev, [driverId]: !prev[driverId] }));
  }, []);

  // ★ 一斉配信 グループ別 追加宛先 (groupKey → "a@x.com, b@y.com" のカンマ区切り文字列)
  const [extraMailRecipients, setExtraMailRecipients] = useState<
    Record<string, string>
  >(() => {
    try {
      const cached = localStorage.getItem("dispatch-mail-extra-recipients");
      return cached ? JSON.parse(cached) : {};
    } catch {
      return {};
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(
        "dispatch-mail-extra-recipients",
        JSON.stringify(extraMailRecipients),
      );
    } catch {}
  }, [extraMailRecipients]);
  useEffect(() => {
    try {
      localStorage.setItem(
        "dispatch-hidden-pool-yards",
        JSON.stringify(hiddenPoolYards),
      );
    } catch {}
  }, [hiddenPoolYards]);
  const togglePoolYard = useCallback((yardId: string) => {
    setHiddenPoolYards((prev) => ({ ...prev, [yardId]: !prev[yardId] }));
  }, []);

  const [groups, setGroups] = useState<ChassisGroup[]>([]);
  // 一時保管枠
  const [tempContainers, setTempContainers] = useState<Container[]>([]);
  // 完了一覧
  const [completedContainers, setCompletedContainers] = useState<Container[]>(
    [],
  );
  const [containers, setContainers] = useState<Container[]>([]);

  // --- 最新 state を interval 内から参照するための Ref ---
  const containersRef = useRef<Container[]>([]);
  const tempRef = useRef<Container[]>([]);
  const doneRef = useRef<Container[]>([]);
  const groupsRef = useRef<ChassisGroup[]>([]);

  // ★ 追加：この端末が ACK 済みにしたコンテナID（再送防止）
  const ackedContainerIdsRef = useRef<Set<string>>(new Set());
  // nextDay: パッチをセッション内で一度だけ処理するためのRef
  const processedNextDayRef = useRef<Set<string>>(new Set());

  // ✅ DB復元が完了したか（fetchChassisの初期配置を走らせる/止める判定に使う）
  const [hydrationDone, setHydrationDone] = useState(false);

  // ✅ シャーシ種別（kindLabel）→ 色（#RRGGBB）
  const [kindColors, setKindColors] = useState<Record<string, string>>({});
  const [axleColors, setAxleColors] = useState<Record<string, string>>({});
  const [sizeColors, setSizeColors] = useState<Record<string, string>>({});

  // 設定モーダルを開く
  const openSettings = () => {
    // 現在の設定を退避
    setSettingsSnapshot({
      theme,
      sizeColors,
      axleColors,
      yards,
      driverGroups,
      spareZones,
    });
    setIsSettingsOpen(true);
  };

  // 保存せずに閉じる（設定を元に戻す）
  const closeSettingsWithoutSave = () => {
    if (settingsSnapshot) {
      setTheme(settingsSnapshot.theme ?? DEFAULT_THEME);
      setSizeColors(settingsSnapshot.sizeColors ?? {});
      setAxleColors(settingsSnapshot.axleColors ?? {});
      setYards(settingsSnapshot.yards ?? []);
      setDriverGroups(settingsSnapshot.driverGroups ?? DEFAULT_DRIVER_GROUPS);
      setSpareZones(settingsSnapshot.spareZones ?? []);
    }
    setIsSettingsOpen(false);
    setSettingsSnapshot(null);
  };

  // 保存して閉じる
  const closeSettingsWithSave = () => {
    setIsSettingsOpen(false);
    setSettingsSnapshot(null);
    // TODO: 必要ならここでlocalStorageやDBに保存
  };

  // ✅ 保存済みstateがあるか（trucksの「基本車両の自動割当」を抑止する用）
  const hasSavedStateRef = useRef(false);
  const hasStoredGroupsRef = useRef(false);

  // state が変わったら ref へ反映
  useEffect(() => {
    containersRef.current = containers;
  }, [containers]);
  useEffect(() => {
    tempRef.current = tempContainers;
  }, [tempContainers]);
  useEffect(() => {
    doneRef.current = completedContainers;
  }, [completedContainers]);
  useEffect(() => {
    groupsRef.current = groups;
  }, [groups]);

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

  // PRACTICE MODE (temporary) — 練習用: 手動色設定 + グループ非表示
  const {
    state: practiceState,
    setContainerColor: setPracticeContainerColor,
    setHiddenGroups: setPracticeHiddenGroups,
    resetAll: resetPracticeAll,
  } = usePracticeMode();
  const [practiceColorPicker, setPracticeColorPicker] = useState<{
    visible: boolean;
    containerId: string;
    containerLabel: string;
  }>({ visible: false, containerId: "", containerLabel: "" });
  const VISIBLE_OWNED_GROUP_ORDER = OWNED_GROUP_ORDER.filter(
    (g) => !practiceState.hiddenGroups.owned.includes(g.key),
  );
  const VISIBLE_OUTSOURCED_GROUP_ORDER = OUTSOURCED_GROUP_ORDER.filter(
    (g) => !practiceState.hiddenGroups.outsourced.includes(g.key),
  );

  // ドライバー並び順 (常設)
  const { state: driverOrderState, setGroupOrder: setDriverGroupOrder } =
    useDriverOrder();
  const [driverOrderModalOpen, setDriverOrderModalOpen] = useState(false);

  // 設定が変わったときに保存
  useEffect(() => {
    localStorage.setItem(
      "dispatch-driver-groups",
      JSON.stringify(driverGroups),
    );
  }, [driverGroups]);

  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  const [settingsSnapshot, setSettingsSnapshot] = useState<any | null>(null);

  // ★ 搬入ヤード書込みモーダル (右クリック → 搬入ヤード)
  const [dropoffYardEditor, setDropoffYardEditor] = useState<{
    visible: boolean;
    containerId: string | null;
    region: string;
    yard: string;
  }>({ visible: false, containerId: null, region: "", yard: "" });

  // ★ 新規コンテナ作成モーダル (ヘッダーボタン)
  const [newContainerModal, setNewContainerModal] = useState<{
    visible: boolean;
    no: string;
    size: Size;
    pickupRegion: string;
    pickupYard: string;
    dropoffRegion: string;
    dropoffYard: string;
    destination: string;
    eta: string;
    booking: string;
    date: string;
  }>({
    visible: false,
    no: "",
    size: "20",
    pickupRegion: "",
    pickupYard: "",
    dropoffRegion: "",
    dropoffYard: "",
    destination: "",
    eta: "",
    booking: "",
    date: "",
  });

  const [yards, setYards] = useState<YardConfig[]>(() => {
    const applyDefaults = (list: any[]): YardConfig[] =>
      list.map((raw) => {
        const y = raw as YardConfig;

        const slotMode: SlotMode =
          y.slotMode ??
          (y.id === "kawaguchi" || y.id === "custom" ? "single" : "three");

        const positionLabels = y.positionLabels ?? {
          ...DEFAULT_POSITION_LABELS,
        };

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

  const [spareZones, setSpareZones] = useState<SpareZone[]>(() => {
    const saved = localStorage.getItem("dispatch-spare-zones");
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          return parsed;
        }
      } catch {
        // 壊れてたら defaultSpareZones にフォールバック
      }
    }
    return defaultSpareZones;
  });

  useEffect(() => {
    localStorage.setItem("dispatch-spare-zones", JSON.stringify(spareZones));
  }, [spareZones]);

  const [mailMenu, setMailMenu] = useState<MailMenuState>({
    visible: false,
    x: 0,
    y: 0,
    group: null,
    driver: null,
    containerForColor: null,
  });

  // どこかクリックしたらメニューを閉じる
  useEffect(() => {
    const close = () => setMailMenu((s) => ({ ...s, visible: false }));
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, []);

  const openMailMenu = (
    e: React.MouseEvent<HTMLDivElement>,
    group: ChassisGroup,
    driver: Driver | null,
  ) => {
    const c = group.container;
    setMailMenu({
      visible: true,
      x: e.clientX,
      y: e.clientY,
      group,
      driver,
      containerForColor: c
        ? {
            id: c.id,
            label: `${c.no || "(no番号)"} ${c.destination || ""}`.trim(),
          }
        : null,
    });
  };

  // PRACTICE MODE — 単体コンテナ (配送分/一時保管/配送完了 等) 用の右クリックメニュー
  const openContainerContextMenu = (
    e: React.MouseEvent<HTMLDivElement>,
    container: Container,
  ) => {
    e.preventDefault();
    setMailMenu({
      visible: true,
      x: e.clientX,
      y: e.clientY,
      group: null,
      driver: null,
      containerForColor: {
        id: container.id,
        label: `${container.no || "(no番号)"} ${container.destination || ""}`.trim(),
      },
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

    const sizeRaw = containerMetaRef.current.get(c.id)?.sizeRaw;

    const { subject, body } =
      mode === "pickup"
        ? buildPickupMail(c, API_BASE, sizeRaw)
        : buildDeliveryMail(c, API_BASE, sizeRaw);

    const mailto = `mailto:${encodeURIComponent(
      d.email,
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
          const rawType = (d.driverType ?? "").toString().trim(); // 自車 / 傭車
          const rawGroup = (d.driverGroup ?? "").toString().trim(); // ドレー / ポジ / ガレージ など

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

  // ★ 初回マウント時に GAS(手塚) から 地域→ヤード マップを取得(server proxy 経由)
  useEffect(() => {
    async function fetchYardMap() {
      try {
        const res = await fetch(`${API_BASE}/api/yard-map`);
        if (!res.ok) {
          console.error("yard-map API エラー", await res.text());
          return;
        }
        const data = await res.json();
        if (!data.yards) return;
        setYardMap(data.yards);
        try {
          localStorage.setItem(
            "dispatch-yard-map",
            JSON.stringify(data.yards),
          );
        } catch {}
      } catch (err) {
        console.error("yard-map 取得に失敗", err);
      }
    }
    fetchYardMap();
  }, [API_BASE]);

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

        // 1) APIの車両をまず素直に作る（初期はspare）
        const apiTrucks: Truck[] = (data.trucks ?? []).map((t: any) => ({
          id: String(t.id),
          label: t.number,
          carNo: t.carNo,
          location: { type: "spare" as const, zoneId: "spare-trucks" }, // ← zoneId を追加
        }));

        // 2) 保存済みstateが無いときだけ「基本車両」自動割当を適用
        let apiTrucksWithDefaultLocation = apiTrucks;

        if (!hasSavedStateRef.current) {
          const trucksWithLocation = [...apiTrucks];
          const usedIndex = new Set<number>();

          drivers.forEach((d) => {
            const num = d.baseTruckNo?.trim();
            if (!num) return;

            const idx = trucksWithLocation.findIndex(
              (t, i) => t.label === num && !usedIndex.has(i),
            );
            if (idx === -1) return;

            trucksWithLocation[idx] = {
              ...trucksWithLocation[idx],
              location: { type: "driver", driverId: d.id },
            };
            usedIndex.add(idx);
          });

          apiTrucksWithDefaultLocation = trucksWithLocation;
        }

        // 3) ✅ ここが重要：保存済みstateがあるなら「locationは維持」してlabel/carNoだけ更新
        setTrucks((prev) => {
          // 保存済みがある ＆ prevがある → 既存配置を守る
          if (hasSavedStateRef.current && prev.length > 0) {
            const apiMap = new Map(apiTrucks.map((t) => [t.id, t]));
            const merged: Truck[] = [];

            // 既存トラックは location を維持しつつ、表示情報だけ最新化
            for (const p of prev) {
              const fresh = apiMap.get(p.id);
              if (!fresh) {
                // APIに無い（廃車など）場合は残す/消すは好み
                // 残したいなら `merged.push(p);`
                // 現実に合わせて消すならスキップ（ここでは消す）
                continue;
              }
              merged.push({
                ...p,
                label: fresh.label,
                carNo: fresh.carNo,
                // location は p.location を維持
              });
            }

            // APIに新規追加された車両があれば追加（初期は spare）
            const prevIds = new Set(prev.map((t) => t.id));
            for (const t of apiTrucks) {
              if (!prevIds.has(t.id)) {
                merged.push(t);
              }
            }

            return merged;
          }

          // 保存済みが無いなら「自動割当込み」の結果を採用
          return apiTrucksWithDefaultLocation;
        });
      } catch (err) {
        console.error("車両取得に失敗", err);
      }
    }

    fetchTrucks();
  }, [API_BASE, drivers]);

  // ★ シャーシ一覧を取得（ただし保存済みboardでは初期配置で上書きしない）
  useEffect(() => {
    console.log("[fetchChassis guard]", {
      boardId,
      hydrationDone,
      hasStoredGroupsRef: hasStoredGroupsRef.current,
      hasSavedState: hasSavedStateRef.current,
    });
    // boardIdが確定して、DB復元が終わるまで待つ
    if (!boardId) return;
    if (!hydrationDone) return;

    // ✅ すでにDBにgroupsがあるなら、川口車庫初期配置の setGroups をしない
    if (hasStoredGroupsRef.current) return;

    let cancelled = false;

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
              yardId: "kawaguchi",
              laneId: "single",
              pos: "front",
            },
            extra: {
              carNo: c.carNo,
              sizeLabel: c.sizeLabel,
              kindLabel: c.kindLabel,
              note: c.note,
            },
          }),
        );

        if (cancelled) return;
        setGroups(apiGroups);
      } catch (err) {
        console.error("シャーシ取得に失敗", err);
      }
    }

    fetchChassis();

    return () => {
      cancelled = true;
    };
  }, [boardId, hydrationDone, API_BASE]);

  // ★ kintoneシャーシを手動で差分同期（追加のみ・川口車庫 single/front へ）
  const syncChassisFromKintone = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/chassis`);
      if (!res.ok) {
        console.error("シャーシAPIエラー", await res.text());
        alert("kintoneからのシャーシ取得に失敗しました");
        return;
      }
      const data = await res.json();
      const apiChassis: ApiChassis[] = data.chassis ?? [];

      const existingIds = new Set(groupsRef.current.map((g) => g.id));
      const newGroups: ChassisGroup[] = apiChassis
        .filter((c) => !existingIds.has(c.id))
        .map((c) => ({
          id: c.id,
          chassisLabel: c.displayNo,
          size: c.size,
          axle: c.axle,
          container: undefined,
          location: {
            type: "pool",
            yardId: "kawaguchi",
            laneId: "single",
            pos: "front",
          },
          extra: {
            carNo: c.carNo,
            sizeLabel: c.sizeLabel,
            kindLabel: c.kindLabel,
            note: c.note,
          },
        }));

      if (newGroups.length === 0) {
        alert("追加されたシャーシはありませんでした");
        return;
      }

      setGroups((prev) => [...prev, ...newGroups]);
      const labels = newGroups.map((g) => g.chassisLabel).join(", ");
      alert(
        `${newGroups.length}台のシャーシを追加しました（川口車庫）\n${labels}`,
      );
    } catch (err) {
      console.error("シャーシ同期に失敗", err);
      alert("シャーシ同期に失敗しました");
    }
  }, [API_BASE]);

  // ★ 指定したシャーシ番号を川口車庫プール(single/front)へ強制救済
  //    - chassisLabel 一致で検索（$id ずれにも耐性）
  //    - 見つかれば location だけをリセット（container/id/extra は保持）
  //    - 見つからなければ新規追加
  const rescueChassisByNumber = useCallback(async () => {
    const input = window.prompt(
      "復旧するシャーシ番号を入力してください（例: 675）",
    );
    if (!input) return;
    const targetLabel = input.trim();
    if (!targetLabel) return;

    try {
      const res = await fetch(`${API_BASE}/api/chassis`);
      if (!res.ok) {
        console.error("シャーシAPIエラー", await res.text());
        alert("kintoneからのシャーシ取得に失敗しました");
        return;
      }
      const data = await res.json();
      const apiChassis: ApiChassis[] = data.chassis ?? [];
      const target = apiChassis.find((c) => c.displayNo === targetLabel);
      if (!target) {
        alert(
          `kintoneに「${targetLabel}」というシャーシが見つかりません。\nシャーシ_状態が「稼働」または「修理」になっているか確認してください。`,
        );
        return;
      }

      const kawaguchiLoc: PoolLocation = {
        type: "pool",
        yardId: "kawaguchi",
        laneId: "single",
        pos: "front",
      };

      const existing = groupsRef.current.find(
        (g) => g.chassisLabel === targetLabel,
      );

      if (existing) {
        setGroups((prev) =>
          prev.map((g) =>
            g.chassisLabel === targetLabel
              ? { ...g, location: kawaguchiLoc }
              : g,
          ),
        );
        alert(`シャーシ ${targetLabel} を川口車庫に復旧しました`);
      } else {
        const newGroup: ChassisGroup = {
          id: target.id,
          chassisLabel: target.displayNo,
          size: target.size,
          axle: target.axle,
          container: undefined,
          location: kawaguchiLoc,
          extra: {
            carNo: target.carNo,
            sizeLabel: target.sizeLabel,
            kindLabel: target.kindLabel,
            note: target.note,
          },
        };
        setGroups((prev) => [...prev, newGroup]);
        alert(`シャーシ ${targetLabel} を川口車庫に追加しました`);
      }
    } catch (err) {
      console.error("シャーシ復旧に失敗", err);
      alert("シャーシ復旧に失敗しました");
    }
  }, [API_BASE]);

  // ★ 搬入ヤード書込みモーダルを開く
  const openDropoffYardEditor = useCallback(
    (containerId: string) => {
      // 現在の値からデフォルト地域/ヤードを推定
      const findCurrent = (): {
        dropoffYard: string;
      } | null => {
        const fromGroup = groupsRef.current.find(
          (g) => g.container?.id === containerId,
        )?.container;
        if (fromGroup) return { dropoffYard: fromGroup.dropoffYard ?? "" };
        const fromC = containersRef.current.find((c) => c.id === containerId);
        if (fromC) return { dropoffYard: fromC.dropoffYard ?? "" };
        const fromT = tempRef.current.find((c) => c.id === containerId);
        if (fromT) return { dropoffYard: fromT.dropoffYard ?? "" };
        const fromD = doneRef.current.find((c) => c.id === containerId);
        if (fromD) return { dropoffYard: fromD.dropoffYard ?? "" };
        return null;
      };
      const cur = findCurrent();
      let initRegion = "";
      let initYard = cur?.dropoffYard ?? "";
      if (initYard) {
        for (const [reg, list] of Object.entries(yardMap)) {
          if (list.includes(initYard)) {
            initRegion = reg;
            break;
          }
        }
      }
      setDropoffYardEditor({
        visible: true,
        containerId,
        region: initRegion,
        yard: initYard,
      });
    },
    [yardMap],
  );

  // ★ 搬入ヤードの変更を保存 (container が居るすべての箇所に反映)
  const saveDropoffYard = useCallback(() => {
    const { containerId, yard } = dropoffYardEditor;
    if (!containerId) return;
    const newYard = yard.trim();

    setGroups((prev) =>
      prev.map((g) =>
        g.container?.id === containerId
          ? { ...g, container: { ...g.container, dropoffYard: newYard } }
          : g,
      ),
    );
    setContainers((prev) =>
      prev.map((c) =>
        c.id === containerId ? { ...c, dropoffYard: newYard } : c,
      ),
    );
    setTempContainers((prev) =>
      prev.map((c) =>
        c.id === containerId ? { ...c, dropoffYard: newYard } : c,
      ),
    );
    setCompletedContainers((prev) =>
      prev.map((c) =>
        c.id === containerId ? { ...c, dropoffYard: newYard } : c,
      ),
    );

    setDropoffYardEditor((s) => ({ ...s, visible: false }));
  }, [dropoffYardEditor]);

  // ★ 新規コンテナ作成モーダルを開く
  const openNewContainerModal = useCallback(() => {
    // 日付は今日 (MM/DD)
    const d = new Date();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    setNewContainerModal({
      visible: true,
      no: "",
      size: "20",
      pickupRegion: "",
      pickupYard: "",
      dropoffRegion: "",
      dropoffYard: "",
      destination: "",
      eta: "",
      booking: "",
      date: `${mm}/${dd}`,
    });
  }, []);

  // ★ 新規コンテナを保存 (配送分レーンに追加)
  const saveNewContainer = useCallback(() => {
    const m = newContainerModal;
    if (!m.no.trim()) {
      alert("コンテナ番号を入力してください");
      return;
    }
    const localId = `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const newC: Container = {
      id: localId,
      size: m.size,
      date: m.date || "",
      eta: m.eta.trim(),
      pickupYardGroup: m.pickupRegion,
      pickupYard: m.pickupYard,
      no: m.no.trim().toUpperCase(),
      ship: "",
      booking: m.booking.trim(),
      destadd: "",
      desttel: "",
      kindCode: "",
      destination: m.destination.trim(),
      dropoffYard: m.dropoffYard,
      step: 0,
    };
    setContainers((prev) => [...prev, newC]);
    setNewContainerModal((s) => ({ ...s, visible: false }));
  }, [newContainerModal]);

  // ★ ドライバーグループ一斉メール配信
  //   groupKey: driverGroup の key ("ドレー" 等)
  //   対象: そのグループ内でシャーシ+コンテナが載っているドライバー全員
  //   subject: 【N日配送分】 (先頭コンテナの date から)
  //   body:  ドライバーごとに 時間/コンテナ/サイズ/配送先/住所/受領書/備考 のブロック
  const sendGroupBatchMail = useCallback(
    (groupKey: string, groupLabel: string) => {
      // グループ内ドライバーを画面表示順(driverOrderState.order[key]) に並び替え
      // → 除外ドライバーをフィルタ
      const orderedInGroup = sortDriversByOrder(
        drivers.filter((d) => (d.groupName || "") === groupKey),
        driverOrderState.order[groupKey],
      );
      const groupDrivers = orderedInGroup.filter(
        (d) => !excludedDrivers[d.id],
      );
      if (groupDrivers.length === 0) {
        alert(`${groupLabel}: 対象ドライバーがいません(全員除外中の可能性)`);
        return;
      }

      // 各ドライバーの container (無い場合は undefined のまま本文に空欄で入れる)
      const rows = groupDrivers.map((d) => {
        const g = groupsRef.current.find(
          (gg) =>
            gg.location.type === "driver" && gg.location.driverId === d.id,
        );
        return { driver: d, container: g?.container };
      });

      const driverEmails = groupDrivers
        .filter((d) => d.email)
        .map((d) => d.email!);
      const extraStr = extraMailRecipients[groupKey] ?? "";
      const extraList = extraStr
        .split(/[,、\s]+/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0 && /@/.test(s));
      // 重複除去(順序保持)
      const seen = new Set<string>();
      const allEmails: string[] = [];
      for (const e of [...driverEmails, ...extraList]) {
        const k = e.toLowerCase();
        if (!seen.has(k)) {
          seen.add(k);
          allEmails.push(e);
        }
      }
      if (allEmails.length === 0) {
        alert(
          `${groupLabel}: メールアドレスが設定されているドライバー・追加宛先がいません`,
        );
        return;
      }
      const emails = allEmails.join(",");

      // 件名の日付: コンテナがあるドライバーの先頭 date
      const firstWithContainer = rows.find((r) => r.container);
      const firstDate = firstWithContainer?.container?.date ?? "";
      const dayLabel = buildDayLabel(firstDate) || "本日";
      const subject = `【${dayLabel}配送分】`;

      const blocks = rows.map(({ driver, container }) => {
        if (!container) {
          // A+C なしのドライバーは項目だけ空欄で並べる
          return [
            `${driver.name}さん`,
            "時間：",
            "コンテナ：",
            "サイズ：",
            "配送先：",
            "住所：",
            "受領書：",
            "備考：",
          ].join("\n");
        }
        const c = container;
        const sizeRaw = containerMetaRef.current.get(c.id)?.sizeRaw;
        const bodySize = mailBodySizeLabel(c, sizeRaw);
        const receiptBlock = fileLinksText(
          "受領書",
          c.receiptFiles,
          API_BASE,
          "あり",
        );
        return [
          `${driver.name}さん`,
          `時間：${c.eta}`,
          `コンテナ：${c.no}`,
          `サイズ：${bodySize}／${c.kindCode}`,
          `配送先：${c.destination}`,
          `住所：${c.destadd ?? ""}`,
          receiptBlock || "受領書：",
          "備考：",
        ].join("\n");
      });

      const body = blocks.join("\n\n") + "\n\nよろしくお願いします。\n";

      const mailto = `mailto:${encodeURIComponent(
        emails,
      )}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

      window.location.href = mailto;
    },
    [
      drivers,
      excludedDrivers,
      driverOrderState,
      extraMailRecipients,
      API_BASE,
    ],
  );

  const moveContainerToDelivered = (id: string, patch?: Partial<Container>) => {
    const findBase = (): Container | null => {
      const gid = String(id);

      // まず ID で直接検索
      const fromAC = groupsRef.current.find((g) => g.container?.id === gid)?.container;
      if (fromAC) return fromAC;
      const fromA = containersRef.current.find((c) => c.id === gid);
      if (fromA) return fromA;
      const fromT = tempRef.current.find((c) => c.id === gid);
      if (fromT) return fromT;
      const fromD = doneRef.current.find((c) => c.id === gid);
      if (fromD) return fromD;

      // "no:CONTNO" 形式 or patch.no でコンテナ番号フォールバック検索
      const noKey = gid.startsWith("no:")
        ? gid.slice(3).toUpperCase()
        : (patch?.no ? String(patch.no).toUpperCase() : null);
      if (noKey) {
        const byNo =
          groupsRef.current.find((g) => g.container?.no.toUpperCase() === noKey)?.container ??
          containersRef.current.find((c) => c.no.toUpperCase() === noKey) ??
          tempRef.current.find((c) => c.no.toUpperCase() === noKey) ??
          doneRef.current.find((c) => c.no.toUpperCase() === noKey);
        if (byNo) return byNo;
      }

      return null;
    };

    const base = findBase();
    if (!base) return;

    const realId = base.id; // "no:CONTNO" ではなく実際のコンテナID
    const merged: Container = {
      ...base,
      ...(patch ?? {}),
      id: realId,
      no: patch?.no ?? base.no,
      dropoffYard: patch?.dropoffYard ?? base.dropoffYard,
      worker4: (patch?.worker4 ?? base.worker4 ?? "").toString().trim(),
    };

    // ① シャーシ上にあれば「コンテナだけ外す」
    setGroups((prev) =>
      prev.map((g) =>
        g.container?.id === realId ? { ...g, container: undefined } : g,
      ),
    );

    // ② リストから消す
    setContainers((prev) => prev.filter((c) => c.id !== realId));
    setTempContainers((prev) => prev.filter((c) => c.id !== realId));

    // ③ 完了へ upsert
    setCompletedContainers((prev) => {
      const exists = prev.find((c) => c.id === realId);
      if (exists) {
        return prev.map((c) => (c.id === realId ? { ...c, ...merged } : c));
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

        // fetched はここで作っている前提
        const fetched: Container[] = (data.containers ?? []).map((c: any) => {
          const id = String(c.id);

          // ★ sizeRaw は state に入れず Ref に保存（メール本文用）
          const sizeRaw = (c.sizeRaw ?? "").toString().trim();
          if (sizeRaw) {
            containerMetaRef.current.set(id, {
              sizeRaw: sizeRaw.replace(/’/g, "'").replace(/\s+/g, " "),
            });
          } else {
            // APIがsizeRawを返さない/空のときは一応消しておく（任意）
            containerMetaRef.current.delete(id);
          }

          return {
            id,

            // stateは軽く：サイズは従来通り 20/40 のみ
            size: c.size as Size,
            date: c.date,
            eta: c.eta,
            pickupYardGroup: c.pickupYardGroup,
            pickupYard: c.pickupYard,
            no: c.no,
            kindCode: c.kindCode,
            destination: c.destination,
            dropoffYard: c.dropoffYard,
            yardIn2: (c.yardIn2 ?? "").toString().trim() || undefined,
            ship: c.ship,
            booking: c.booking,
            destadd: c.destadd,
            desttel: c.desttel,

            handoverNo: (c.handoverNo ?? "").toString().trim(),
            receiptFiles: Array.isArray(c.receiptFiles) ? c.receiptFiles : [],
            dispatchFiles: Array.isArray(c.dispatchFiles)
              ? c.dispatchFiles
              : [],

            worker4: (c.worker4 ?? "").toString().trim(),
            step: c.step ?? undefined,
          };
        });

        if (isCancelled) return;

        // ★ 1) 既存IDをRefから取って「新規だけ」を判定（setStateの外でやる）
        const newIdsToAck = fetched
          .map((c) => c.id)
          .filter((id) => !ackedContainerIdsRef.current.has(id));

        // ★ 2) 画面更新（マージ）は今まで通り
        setContainers((prev) => {
          const map = new Map<string, Container>();
          prev.forEach((p) => map.set(p.id, p));

          for (const nc of fetched) {
            const existing = map.get(nc.id);
            map.set(nc.id, existing ? { ...existing, ...nc } : nc);
          }
          return Array.from(map.values());
        });

        // ★ 3) 新規分だけ ACK（配車_連携2 を済にする）
        if (newIdsToAck.length > 0) {
          // 先に登録して二重送信防止
          newIdsToAck.forEach((id) => ackedContainerIdsRef.current.add(id));

          try {
            const ackRes = await fetch(
              `${API_BASE}/api/containers/mark-board-done`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ ids: newIdsToAck }),
              },
            );

            if (!ackRes.ok) {
              console.warn(
                "mark-board-done failed:",
                ackRes.status,
                await ackRes.text(),
              );
              // 失敗時は再送できるように戻す
              newIdsToAck.forEach((id) =>
                ackedContainerIdsRef.current.delete(id),
              );
            }
          } catch (e) {
            console.warn("mark-board-done error:", e);
            newIdsToAck.forEach((id) =>
              ackedContainerIdsRef.current.delete(id),
            );
          }
        }
      } catch (err) {
        if (!isCancelled) {
          console.error("コンテナ同期に失敗", err);
        }
      }
    }

    // 初回は常に実行（モード切替時にも最新データを取得）
    syncContainersOnce();

    // 自動モードの場合のみインターバル設定
    let timer: ReturnType<typeof setInterval> | null = null;
    if (autoSync) {
      timer = setInterval(syncContainersOnce, 30000);
    }

    return () => {
      isCancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [autoSync]);

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
          yardIn2?: string;
          pickupYard?: string;
          step?: any;
          worker4?: string;
        }> = data.containers ?? [];

        if (isCancelled) return;
        if (patches.length === 0) return;

        // id -> patch のMap（no:XXXXX キーも登録してシートコンテナに対応）
        const patchMap = new Map<string, any>();
        for (const p of patches) {
          patchMap.set(String(p.id), p);
          // "no:CONTNO" キーはコンテナ番号でマッチング
          if (String(p.id).startsWith("no:") && p.id.length > 3) {
            patchMap.set(`no:${String(p.id).slice(3).toUpperCase()}`, p);
          }
        }

        // nextDay: パッチがある場合は対応する no: パッチを常に除外
        // activation後のstep②③はserver側でsheet_XXXキーを使うためno:CONTNO不要
        for (const p of patches) {
          if (String(p.id).startsWith("nextDay:")) {
            patchMap.delete(`no:${String(p.id).slice(8).toUpperCase()}`);
          }
        }

        const applyPatch = (c: Container): Container => {
          let p = patchMap.get(String(c.id));
          // no:CONTNO フォールバック: 同一CONTNOで最も早い日付のカードのみ適用（翌日カード汚染防止）
          // sheetコンテナ・kintoneカード両方に適用（空日付は"99/99"扱いで末尾）
          if (!p) {
            const noPatch = patchMap.get(`no:${String(c.no).toUpperCase()}`);
            if (noPatch) {
              const cDate = String(c.date || '99/99');
              const allContainers = [
                ...containersRef.current,
                ...groupsRef.current.map((g) => g.container).filter((x): x is Container => x != null),
                ...tempRef.current,
              ];
              const sameNoOthers = allContainers.filter(
                (k) => k.id !== c.id && String(k.no).toUpperCase() === String(c.no).toUpperCase()
              );
              if (sameNoOthers.length === 0) {
                p = noPatch; // 同一CONTNOが1枚のみ → 適用
              } else {
                const hasEarlier = sameNoOthers.some(
                  (k) => String(k.date || '99/99') < cDate
                );
                if (!hasEarlier) p = noPatch; // 最も早い日付のカードにのみ適用
              }
            }
          }
          if (!p) return c;

          return {
            ...c,
            no: p.no ?? c.no,
            dropoffYard: p.dropoffYard ?? c.dropoffYard,
            yardIn2: p.yardIn2 ?? c.yardIn2,
            step: p.step ?? c.step,
            worker4: (p.worker4 ?? c.worker4 ?? "").toString().trim(),
            handoverNo: p.handoverNo ?? c.handoverNo,
            receiptFiles: p.receiptFiles ?? c.receiptFiles,
            dispatchFiles: p.dispatchFiles ?? c.dispatchFiles,
          };
        };

        // ① まず全リストへ patch を反映（表示の追随）
        setContainers((prev) => prev.map(applyPatch));
        setTempContainers((prev) => prev.map(applyPatch));
        setCompletedContainers((prev) => prev.map(applyPatch));
        setGroups((prev) =>
          prev.map((g) =>
            g.container ? { ...g, container: applyPatch(g.container) } : g,
          ),
        );

        // ② step=4 を配送完了へ移動。X線完了時は通常ドレーを元のシャーシへ入れ替え
        // kintoneId エントリ用フォールバック: pId(kintoneId) -> { chassisId, containerNo, xrayId }
        const xrayChassisMap = new Map<string, { chassisId: string; containerNo: string; xrayId: string }>();
        for (const p of patches) {
          if (Number(p.step) !== 4) continue;
          const pId = String(p.id);
          if (pId.startsWith("no:") || pId.startsWith("xray:") || pId.startsWith("nextDay:")) continue;
          const xrayGroup = groupsRef.current.find((g) => g.container?.id === pId);
          const containerNo = xrayGroup?.container?.no?.toUpperCase();
          if (xrayGroup && containerNo) {
            xrayChassisMap.set(pId, { chassisId: xrayGroup.id, containerNo, xrayId: pId });
          }
        }

        for (const p of patches) {
          const stepNum = Number(p.step);
          if (stepNum !== 4) continue;
          const pId = String(p.id);

          if (pId.startsWith("nextDay:")) {
            // フォールバック（server側でfirstSheetMatchId未取得時のみ到達）
            // セッション内で一度だけ処理（processedNextDayRefで再処理防止）
            const noKey = pId.slice(8).toUpperCase();
            if (processedNextDayRef.current.has(noKey)) continue; // 既にこのセッションで処理済み
            const allSameNo = [
              ...groupsRef.current.filter((g) => g.container?.no?.toUpperCase() === noKey).map((g) => g.container!),
              ...containersRef.current.filter((c) => c.no?.toUpperCase() === noKey),
              ...tempRef.current.filter((c) => c.no?.toUpperCase() === noKey),
            ].filter((c, i, arr) => arr.findIndex((x) => x.id === c.id) === i);
            if (allSameNo.length < 2) {
              processedNextDayRef.current.add(noKey); // 再試行しない（activation済みまたは当日カードなし）
              continue;
            }
            allSameNo.sort((a, b) => String(a.date || '99/99').localeCompare(String(b.date || '99/99')));
            const currentDayCard = allSameNo[0];
            const nextDayCard = allSameNo[1];
            processedNextDayRef.current.add(noKey);
            console.log(`[nextDay] moving to delivered: ${currentDayCard.id} (date=${currentDayCard.date}), activating: ${nextDayCard.id} (date=${nextDayCard.date})`);
            // 当日カードが乗っているシャーシを特定
            const nextDayChassis = groupsRef.current.find((g) => g.container?.id === currentDayCard.id);
            const nextDayChassisId = nextDayChassis?.id;
            // 当日カードを配送完了へ移動
            moveContainerToDelivered(currentDayCard.id, { step: 4 });
            // 翌日カードをシャーシに乗せて step=1 でアクティブ化
            const ndId = nextDayCard.id;
            setContainers((prev) => prev.filter((c) => c.id !== ndId));
            setTempContainers((prev) => prev.filter((c) => c.id !== ndId));
            setGroups((prev) =>
              prev.map((g) => (g.container?.id === ndId ? { ...g, container: undefined } : g)),
            );
            // パッチにyardIn2/dropoffYardがあれば翌日カードに適用（GASがsourceYardIn2/yardInAfterを送信した場合）
            const ndYardIn2 = p.yardIn2 ? String(p.yardIn2).trim() : undefined;
            const ndDropoffYard = p.dropoffYard ? String(p.dropoffYard).trim() : undefined;
            const activatedCard: Container = {
              ...nextDayCard,
              step: 1 as ContainerStep,
              ...(ndYardIn2 ? { yardIn2: ndYardIn2 } : {}),
              ...(ndDropoffYard ? { dropoffYard: ndDropoffYard } : {}),
            };
            if (nextDayChassisId) {
              // シャーシに乗せる（moveContainerToDeliveredがシャーシを空にした後に配置）
              setGroups((prev) =>
                prev.map((g) =>
                  g.id === nextDayChassisId && !g.container
                    ? { ...g, container: activatedCard }
                    : g,
                ),
              );
            } else {
              // シャーシなし: containersのstep/yardIn2を更新
              setContainers((prev) =>
                prev.map((c) => (c.id === ndId ? activatedCard : c)),
              );
              setTempContainers((prev) =>
                prev.map((c) => (c.id === ndId ? activatedCard : c)),
              );
            }
            continue;
          }

          if (pId.startsWith("xray:")) {
            // X線専用処理: destinationでX線カードを識別してdoneへ移動し通常ドレーをswap
            const noKey = pId.slice(5).toUpperCase();
            const xrayGroup = groupsRef.current.find(
              (g) =>
                g.container?.no?.toUpperCase() === noKey &&
                /(X線|税関)/i.test(g.container?.destination ?? ""),
            );
            if (!xrayGroup?.container) continue;

            const xrayId = xrayGroup.container.id;
            const chassisId = xrayGroup.id;

            moveContainerToDelivered(xrayId, {
              dropoffYard: p.dropoffYard,
              step: 4,
              worker4: (p.worker4 ?? "").toString().trim(),
            });

            const rawNormalCard =
              containersRef.current.find(
                (c) => c.no?.toUpperCase() === noKey && c.id !== xrayId,
              ) ??
              tempRef.current.find(
                (c) => c.no?.toUpperCase() === noKey && c.id !== xrayId,
              ) ??
              groupsRef.current.find(
                (g) =>
                  g.container?.no?.toUpperCase() === noKey && g.container?.id !== xrayId,
              )?.container;
            if (!rawNormalCard) continue;
            // *Ref.current は useEffect 経由で更新されるため、同期 callback 内では
            // applyPatch 後の最新 state を反映していない。最新パッチを通して
            // dropoffYard/yardIn2 を取り直す（GAS が normal step=1 で送信した値）。
            const normalCard = applyPatch(rawNormalCard);

            const normalId = normalCard.id;
            setContainers((prev) => prev.filter((c) => c.id !== normalId));
            setTempContainers((prev) => prev.filter((c) => c.id !== normalId));
            setGroups((prev) =>
              prev.map((g) => (g.container?.id === normalId ? { ...g, container: undefined } : g)),
            );
            setGroups((prev) =>
              prev.map((g) =>
                g.id === chassisId && !g.container
                  ? { ...g, container: { ...normalCard, step: 1 } }
                  : g,
              ),
            );
            continue;
          }

          // 通常の step=4 処理（kintoneId または no: エントリ）
          moveContainerToDelivered(pId, {
            no: pId.startsWith("no:") ? (p.no ?? pId.slice(3)) : undefined,
            dropoffYard: p.dropoffYard,
            step: stepNum,
            worker4: (p.worker4 ?? "").toString().trim(),
          });

          // X線完了後の入れ替わり（kintoneId エントリ: フォールバック用）
          const xrayInfo = xrayChassisMap.get(pId);
          if (!xrayInfo) continue;
          const { chassisId, containerNo, xrayId } = xrayInfo;

          const rawNormalCard =
            containersRef.current.find(
              (c) => c.no?.toUpperCase() === containerNo && c.id !== xrayId,
            ) ??
            tempRef.current.find(
              (c) => c.no?.toUpperCase() === containerNo && c.id !== xrayId,
            ) ??
            groupsRef.current.find(
              (g) =>
                g.container?.no?.toUpperCase() === containerNo && g.container?.id !== xrayId,
            )?.container;
          if (!rawNormalCard) continue;
          // 上記 xray: 分岐と同様、stale な ref を最新パッチで更新する
          const normalCard = applyPatch(rawNormalCard);

          const normalId = normalCard.id;
          setContainers((prev) => prev.filter((c) => c.id !== normalId));
          setTempContainers((prev) => prev.filter((c) => c.id !== normalId));
          setGroups((prev) =>
            prev.map((g) => (g.container?.id === normalId ? { ...g, container: undefined } : g)),
          );
          setGroups((prev) =>
            prev.map((g) =>
              g.id === chassisId && !g.container
                ? { ...g, container: { ...normalCard, step: 1 } }
                : g,
            ),
          );
        }
      } catch (err) {
        if (!isCancelled) console.error("updates同期に失敗", err);
      }
    }

    // 初回は常に実行
    syncContainerUpdatesOnce();

    // 自動モードの場合のみインターバル設定
    let timer: ReturnType<typeof setInterval> | null = null;
    if (autoSync) {
      timer = setInterval(syncContainerUpdatesOnce, 10000);
    }

    return () => {
      isCancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [autoSync]);

  // ★ 手動更新（両APIを呼ぶ）
  const [isManualRefreshing, setIsManualRefreshing] = useState(false);
  const manualRefresh = useCallback(async () => {
    setIsManualRefreshing(true);
    try {
      // autoSyncを一瞬trueにしてuseEffectを再実行させるより、直接APIを叩く
      const [containersRes, updatesRes] = await Promise.allSettled([
        fetch(`${API_BASE}/api/containers`),
        fetch(`${API_BASE}/api/containers/updates`),
      ]);
      // containers の処理
      if (containersRes.status === "fulfilled" && containersRes.value.ok) {
        const data = await containersRes.value.json();
        const fetched: Container[] = (data.containers ?? []).map((c: any) => {
          const id = String(c.id);
          const sizeRaw = (c.sizeRaw ?? "").toString().trim();
          if (sizeRaw) {
            containerMetaRef.current.set(id, {
              sizeRaw: sizeRaw.replace(/'/g, "\u2019").replace(/\s+/g, " "),
            });
          } else {
            containerMetaRef.current.delete(id);
          }
          return {
            id,
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
            handoverNo: (c.handoverNo ?? "").toString().trim(),
            receiptFiles: Array.isArray(c.receiptFiles) ? c.receiptFiles : [],
            dispatchFiles: Array.isArray(c.dispatchFiles) ? c.dispatchFiles : [],
            worker4: (c.worker4 ?? "").toString().trim(),
            step: c.step ?? undefined,
          };
        });

        const newIdsToAck = fetched
          .map((c) => c.id)
          .filter((id) => !ackedContainerIdsRef.current.has(id));

        setContainers((prev) => {
          const map = new Map<string, Container>();
          prev.forEach((p) => map.set(p.id, p));
          for (const nc of fetched) {
            const existing = map.get(nc.id);
            map.set(nc.id, existing ? { ...existing, ...nc } : nc);
          }
          return Array.from(map.values());
        });

        if (newIdsToAck.length > 0) {
          newIdsToAck.forEach((id) => ackedContainerIdsRef.current.add(id));
          try {
            const ackRes = await fetch(
              `${API_BASE}/api/containers/mark-board-done`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ ids: newIdsToAck }),
              },
            );
            if (!ackRes.ok) {
              newIdsToAck.forEach((id) => ackedContainerIdsRef.current.delete(id));
            }
          } catch {
            newIdsToAck.forEach((id) => ackedContainerIdsRef.current.delete(id));
          }
        }
      }
      // updates の処理
      if (updatesRes.status === "fulfilled" && updatesRes.value.ok) {
        const data = await updatesRes.value.json();
        const patches: Array<{
          id: string; no?: string; dropoffYard?: string; step?: any; worker4?: string;
          handoverNo?: string; receiptFiles?: any; dispatchFiles?: any;
        }> = data.containers ?? [];
        if (patches.length > 0) {
          const patchMap = new Map<string, any>();
          for (const p of patches) {
            patchMap.set(String(p.id), p);
            if (String(p.id).startsWith("no:") && p.id.length > 3) {
              patchMap.set(`no:${String(p.id).slice(3).toUpperCase()}`, p);
            }
          }
          // nextDay: パッチがある場合は対応する no: パッチを除外（翌日配送カードへの色変化汚染を防ぐ）
          for (const p of patches) {
            if (String(p.id).startsWith("nextDay:")) {
              patchMap.delete(`no:${String(p.id).slice(8).toUpperCase()}`);
            }
          }

          const applyPatch = (c: Container): Container => {
            let p = patchMap.get(String(c.id));
            // no:CONTNO フォールバック: 同一CONTNOで最も早い日付のカードのみ適用（翌日カード汚染防止）
            // sheetコンテナ・kintoneカード両方に適用（空日付は"99/99"扱いで末尾）
            if (!p) {
              const noPatch = patchMap.get(`no:${String(c.no).toUpperCase()}`);
              if (noPatch) {
                const cDate = String(c.date || '99/99');
                const allContainers = [
                  ...containersRef.current,
                  ...groupsRef.current.map((g) => g.container).filter((x): x is Container => x != null),
                  ...tempRef.current,
                ];
                const sameNoOthers = allContainers.filter(
                  (k) => k.id !== c.id && String(k.no).toUpperCase() === String(c.no).toUpperCase()
                );
                if (sameNoOthers.length === 0) {
                  p = noPatch; // 同一CONTNOが1枚のみ → 適用
                } else {
                  const hasEarlier = sameNoOthers.some(
                    (k) => String(k.date || '99/99') < cDate
                  );
                  if (!hasEarlier) p = noPatch; // 最も早い日付のカードにのみ適用
                }
              }
            }
            if (!p) return c;
            return {
              ...c,
              no: p.no ?? c.no,
              dropoffYard: p.dropoffYard ?? c.dropoffYard,
              step: p.step ?? c.step,
              worker4: (p.worker4 ?? c.worker4 ?? "").toString().trim(),
              handoverNo: p.handoverNo ?? c.handoverNo,
              receiptFiles: p.receiptFiles ?? c.receiptFiles,
              dispatchFiles: p.dispatchFiles ?? c.dispatchFiles,
            };
          };
          setContainers((prev) => prev.map(applyPatch));
          setTempContainers((prev) => prev.map(applyPatch));
          setCompletedContainers((prev) => prev.map(applyPatch));
          setGroups((prev) =>
            prev.map((g) =>
              g.container ? { ...g, container: applyPatch(g.container) } : g,
            ),
          );
          for (const p of patches) {
            const stepNum = Number(p.step);
            if (stepNum !== 4) continue;
            moveContainerToDelivered(String(p.id), {
              no: p.no,
              dropoffYard: p.dropoffYard,
              step: stepNum,
              worker4: (p.worker4 ?? "").toString().trim(),
            });
          }
        }
      }
    } catch (err) {
      console.error("手動更新に失敗", err);
    } finally {
      setIsManualRefreshing(false);
    }
  }, []);

  const [leftWidth, setLeftWidth] = useState<number>(700); // シャーシプール
  const [middleWidth, setMiddleWidth] = useState<number>(610); // ドライバー
  const [deliveryWidth, setDeliveryWidth] = useState<number>(500); // 配送分

  const deliveryScrollRef = useRef<HTMLDivElement>(null);

  // ヤードグループ（大井・青海・品川・本牧）
  const yardGroups = ["大井", "青海", "中防", "品川", "本牧", "その他"];

  // 仕切り線ドラッグでリサイズ
  const startResize =
    (target: "left" | "middle" | "right") =>
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
      (t) => t.location.type === "driver" && t.location.driverId === driverId,
    );
  }

  function getGroupForDriver(driverId: string) {
    return groups.find(
      (g) => g.location.type === "driver" && g.location.driverId === driverId,
    );
  }

  function getSlotGroup(
    yardId: string,
    laneId: string,
    pos: "front" | "middle" | "back",
  ) {
    return groups.find(
      (g) =>
        g.location.type === "pool" &&
        g.location.yardId === yardId &&
        g.location.laneId === laneId &&
        g.location.pos === pos,
    );
  }

  // コンテナIDからどこにいるかを探す（配送枠 / 一時保管 / 完了）
  function findContainerById(
    id: string,
  ): { container: Container; source: "containers" | "temp" | "done" } | null {
    let c = containers.find((x) => x.id === id);
    if (c) return { container: c, source: "containers" };
    c = tempContainers.find((x) => x.id === id);
    if (c) return { container: c, source: "temp" };
    c = completedContainers.find((x) => x.id === id);
    if (c) return { container: c, source: "done" };
    return null;
  }

  // 音声ログを追加する関数
  // addVoiceLog関数の中身を修正
  const addVoiceLog = (message: string) => {
    // 独立ウィンドウにメッセージ送信（名前を変更した関数を使用）
    sendVoiceLogToWindow(message);
  };

  function handleDragEnd(event: any) {
    const { active, over } = event;

    // ドロップ不可エリアに A+C をドロップ → C だけ配送分へ（日付・ヤード変更なし）
    if (!over) {
      const activeId = String(active.id);
      if (activeId.startsWith("group-")) {
        const groupId = activeId.replace("group-", "");
        const currentGroup = groups.find((g) => g.id === groupId);
        if (currentGroup?.container) {
          const released = currentGroup.container;
          setGroups((prev) =>
            prev.map((g) =>
              g.id === groupId ? { ...g, container: undefined } : g,
            ),
          );
          setContainers((prev) => [...prev, released]);
        }
      }
      return;
    }

    const activeId = String(active.id);
    const overId = String(over.id);

    // ---- C / A+C ----
    if (activeId.startsWith("group-")) {
      const groupId = activeId.replace("group-", "");
      const currentGroup = groups.find((g) => g.id === groupId);
      if (!currentGroup) return;

      // プールのマス
      if (overId.startsWith("yard-")) {
        const parsed = parseYardDropId(overId);
        if (!parsed) return;

        // ✅ 音声化処理を追加（ドライバーから移動する場合）
        if (currentGroup.location.type === "driver") {
          const driverLoc = currentGroup.location; // ← ここで取得
          const driver = drivers.find((d) => d.id === driverLoc.driverId);

          if (parsed.mode === "single") {
            const yard = yards.find((y) => y.id === parsed.yardId);
            const message = `${driver?.name}さん、${yard?.name}へ台切ってください`;
            console.log("🔊 [台切りsingle]", message);
            addVoiceLog(message);
          } else {
            // parsed.mode === "grid"
            const yard = yards.find((y) => y.id === parsed.yardId);
            const lane = yard?.lanes.find((l) => l.id === parsed.laneId);
            const message = `${driver?.name}さん、${yard?.name}${lane?.label}へ台切ってください`;
            console.log("🔊 [台切りgrid]", message);
            addVoiceLog(message);
          }
        }

        // ★ 川口車庫・現場など「1スロットで横並び」
        if (parsed.mode === "single") {
          const yardId = parsed.yardId; // ← ここは既存コード通り

          setGroups((prev) =>
            prev.map((g) =>
              g.id === groupId
                ? {
                    ...g,
                    location: {
                      type: "pool",
                      yardId,
                      laneId: "single",
                      pos: "front",
                    },
                  }
                : g,
            ),
          );
          return;
        }

        // ★ 通常ヤード（レーン×前中奥）
        const { yardId, laneId, pos } = parsed; // ← ここは既存コード通り

        const occupied = getSlotGroup(yardId, laneId, pos);
        if (occupied && occupied.id !== groupId) return;

        setGroups((prev) =>
          prev.map((g) =>
            g.id === groupId
              ? { ...g, location: { type: "pool", yardId, laneId, pos } }
              : g,
          ),
        );
        return;
      }

      // ドライバー枠（排他：既に居たら弾く）
      if (overId.startsWith("driver-") && overId.endsWith("-group")) {
        const driverId = overId.replace("driver-", "").replace("-group", "");

        const hasTruck = trucks.some(
          (t) =>
            t.location.type === "driver" && t.location.driverId === driverId,
        );
        if (!hasTruck) return;

        const occupied = groups.find(
          (g) =>
            g.location.type === "driver" && g.location.driverId === driverId,
        );
        if (occupied && occupied.id !== groupId) return;

        // ✅ 音声化処理を追加
        const driver = drivers.find((d) => d.id === driverId);

        // プールからの移動の場合
        if (currentGroup.location.type === "pool") {
          const poolLoc = currentGroup.location; // ← ここで取得
          const yard = yards.find((y) => y.id === poolLoc.yardId);
          const lane = yard?.lanes.find((l) => l.id === poolLoc.laneId);

          const yardName = yard?.name || "";
          const laneName = lane?.label || "";
          const chassisInfo = `${currentGroup.chassisLabel}(${currentGroup.size}ft)`;

          const message = `${driver?.name}さん、${yardName}${laneName}から${chassisInfo}を繋いでください`;
          console.log("🔊 [シャーシ繋ぐ]", message);
          addVoiceLog(message);
        }

        setGroups((prev) =>
          prev.map((g) =>
            g.id === groupId
              ? { ...g, location: { type: "driver", driverId } }
              : g,
          ),
        );
        return;
      }
      // 一時保管枠へ：A+C → Cだけにしてコンテナは tempContainers へ
      if (overId === "zone-temp") {
        if (!currentGroup.container) return;
        const released = currentGroup.container;

        setGroups((prev) =>
          prev.map((g) =>
            g.id === currentGroup.id ? { ...g, container: undefined } : g,
          ),
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
            g.id === currentGroup.id ? { ...g, container: undefined } : g,
          ),
        );
        setCompletedContainers((prev) => [...prev, released]);
        return;
      }

      // 配送分枠へ：A+C → CをC自身の日付で配送分へ、Aはコンテナ解除
      // delivery-DATE-YARD ゾーン上 or そこにある既存コンテナ上にドロップ
      const deliveryOverId = overId.startsWith("delivery-")
        ? overId
        : overId.startsWith("cont-")
          ? (() => {
              const contId = overId.replace("cont-", "");
              const hit = containers.find((c) => c.id === contId);
              return hit ? `delivery-${hit.date}-${hit.pickupYardGroup}` : null;
            })()
          : null;

      if (deliveryOverId) {
        if (!currentGroup.container) return;
        const released = currentGroup.container;

        setGroups((prev) =>
          prev.map((g) =>
            g.id === currentGroup.id ? { ...g, container: undefined } : g,
          ),
        );
        setContainers((prev) => [...prev, released]);
        return;
      }

      return;
    }

    // ---- 車両 B ----
    if (activeId.startsWith("truck-")) {
      const truckId = activeId.replace("truck-", "");

      if (overId.startsWith("driver-") && overId.endsWith("-truck")) {
        const driverId = overId.replace("driver-", "").replace("-truck", "");

        // ✅ すでに車両が置かれていたら弾く（何もしない）
        const occupied = trucks.some(
          (t) =>
            t.location.type === "driver" &&
            t.location.driverId === driverId &&
            t.id !== truckId,
        );
        if (occupied) return;

        setTrucks((prev) =>
          prev.map((t) =>
            t.id === truckId
              ? { ...t, location: { type: "driver", driverId } }
              : t,
          ),
        );
        return;
      }

      // 予備車エリアへのドロップ（複数対応）
      if (overId.startsWith("zone-spare-")) {
        const zoneId = overId.replace("zone-", "");
        setTrucks((prev) =>
          prev.map((t) =>
            t.id === truckId
              ? { ...t, location: { type: "spare", zoneId } }
              : t,
          ),
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
        const dateKey = parts[1]; // "11/28"
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
            g.location.type === "driver" && g.location.driverId === driverId,
        );
        if (!group) return;
        if (group.container) return;
        if (group.size !== container.size) return;

        // ✅ 音声化処理を追加
        const driver = drivers.find((d) => d.id === driverId);
        const message = `${driver?.name}さん、${container.pickupYard}からコンテナ番号${container.no}を取ります`;
        console.log("🔊 メインアプリ: 音声ログ送信", message);
        addVoiceLog(message);

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
          prev.map((g) => (g.id === group.id ? { ...g, container } : g)),
        );
        return;
      }

      return;
    }
  }

  function renderDragOverlay(id: string) {
    // シャーシグループ(A or A+C)
    if (id.startsWith("group-")) {
      const gid = id.replace("group-", "");
      const g = groupsRef.current.find((x) => x.id === gid);
      if (!g) return null;
      return (
        <DraggableGroupCard
          group={g}
          kindColors={kindColors}
          axleColors={axleColors}
          sizeColors={sizeColors}
          onTap={handleCardTap}
          practiceColorMap={practiceState.colors}
        />
      );
    }

    // 車両(B)
    if (id.startsWith("truck-")) {
      const tid = id.replace("truck-", "");
      const t = trucks.find((x) => x.id === tid);
      if (!t) return null;
      return <DraggableTruckCard truck={t} />;
    }

    // コンテナ(A)
    if (id.startsWith("cont-")) {
      const cid = id.replace("cont-", "");
      const found = findContainerById(cid);
      if (!found) return null;
      return (
        <DraggableContainerCard
          container={found.container}
          sizeColors={sizeColors}
          practiceColorMap={practiceState.colors}
        />
      );
    }

    return null;
  }

  // kind が入っていないドライバーは除外
  const effectiveDrivers = drivers.filter((d) => d.kind !== "unknown");

  const ownedDrivers = effectiveDrivers.filter((d) => d.kind === "owned");
  const outsourcedDrivers = effectiveDrivers.filter(
    (d) => d.kind === "outsourced",
  );

  // ===== シャーシプール（ヤード／レーン）操作ヘルパー =====
  const addYard = () => {
    setYards((prev) => [
      ...prev,
      {
        id: `yard-${Date.now()}`, // 新しいID
        name: "新しいヤード",
        slotMode: "single", // ★ 追加: 最初は1マスフリー
        positionLabels: {
          // ★ 追加: ラベル（とりあえず空）
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

  const moveYardUp = (yardIndex: number) => {
    if (yardIndex === 0) return;
    setYards((prev) => {
      const copy = [...prev];
      [copy[yardIndex - 1], copy[yardIndex]] = [
        copy[yardIndex],
        copy[yardIndex - 1],
      ];
      return copy;
    });
  };

  const moveYardDown = (yardIndex: number) => {
    setYards((prev) => {
      if (yardIndex >= prev.length - 1) return prev;
      const copy = [...prev];
      [copy[yardIndex], copy[yardIndex + 1]] = [
        copy[yardIndex + 1],
        copy[yardIndex],
      ];
      return copy;
    });
  };

  const insertYardAfter = (yardIndex: number) => {
    setYards((prev) => {
      const newYard: YardConfig = {
        id: `yard-${Date.now()}`,
        name: "新しいヤード",
        slotMode: "single",
        positionLabels: {
          front: "",
          middle: "",
          back: "",
        },
        lanes: [{ id: "lane1", label: "レーン1" }],
      };

      const copy = [...prev];
      copy.splice(yardIndex + 1, 0, newYard);
      return copy;
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

  // ===== 予備車エリア操作ヘルパー =====  ← ここから追加
  const addSpareZone = () => {
    setSpareZones((prev) => [
      ...prev,
      {
        id: `spare-${Date.now()}`,
        name: "新しい予備エリア",
      },
    ]);
  };

  const removeSpareZone = (index: number) => {
    setSpareZones((prev) => {
      // 最低1つは残す
      if (prev.length <= 1) return prev;
      return prev.filter((_, i) => i !== index);
    });
  };

  const updateSpareZone = (index: number, name: string) => {
    setSpareZones((prev) => {
      const copy = [...prev];
      copy[index] = { ...copy[index], name };
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

  const updateOutsourcedGroup = (
    index: number,
    patch: Partial<DriverGroup>,
  ) => {
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

  // ✅ 初回ロード中フラグ（ロード完了まで save しない）
  const hydratingRef = useRef(true);

  const clientIdRef = useRef<string>(getOrCreateClientId());

  // ✅ Realtimeの古い更新を捨てる用（あなたのversion方式を使うなら）
  const versionRef = useRef<number>(0);

  // ✅ boardId が確定したら DB から復元
  useEffect(() => {
    if (!boardId) return;

    let cancelled = false;
    hydratingRef.current = true;

    // いったん初期化
    setHydrationDone(false);
    hasSavedStateRef.current = false;

    (async () => {
      const { data, error } = await supabase
        .from("dispatch_board_state")
        .select("state")
        .eq("board_id", boardId)
        .maybeSingle();

      if (cancelled) return;

      if (error) {
        console.error("load board state error", error);
        hydratingRef.current = false;
        setHydrationDone(true); // 失敗でも初期配置へ進める
        return;
      }

      const s = (data?.state ?? {}) as any;

      // 保存が無い場合：初期配置へ進める
      if (!s || Object.keys(s).length === 0) {
        hydratingRef.current = false;
        setHydrationDone(true);
        return;
      }

      // ✅ 保存済みstateあり
      hasSavedStateRef.current = true;

      // ✅ groups が保存されていたら true（fetchChassisの初期配置を止める）
      const storedGroups = Array.isArray(s.groups) && s.groups.length > 0;
      hasStoredGroupsRef.current = storedGroups;

      // state反映
      if (s.groups) setGroups(s.groups);
      if (s.trucks) setTrucks(s.trucks);
      if (s.containers) setContainers(s.containers);
      if (s.tempContainers) setTempContainers(s.tempContainers);
      if (s.completedContainers) setCompletedContainers(s.completedContainers);
      if (s.driverGroups) setDriverGroups(s.driverGroups);
      if (s.yards) setYards(s.yards);
      if (s.spareZones) setSpareZones(s.spareZones); // ← 追加
      if (s.kindColors) setKindColors(s.kindColors);
      if (s.axleColors) setAxleColors(s.axleColors);
      if (s.sizeColors) setSizeColors(s.sizeColors);
      if (s.theme) setTheme({ ...DEFAULT_THEME, ...s.theme });
      if (s.extraMailRecipients)
        setExtraMailRecipients(s.extraMailRecipients);

      // ✅ version も合わせる（Realtimeの古い更新を弾くため）
      if (typeof s.version === "number") {
        versionRef.current = s.version;
      }

      hydratingRef.current = false;
      setHydrationDone(true);
    })();

    return () => {
      cancelled = true;
    };
  }, [boardId]);

  // ✅ 他PCの変更を Realtime で反映
  useEffect(() => {
    if (!boardId) return;

    const channel = supabase
      .channel(`dispatch-board-state:${boardId}`)
      .on(
        "postgres_changes",
        {
          event: "*", // INSERT/UPDATE両方拾う（upsert対策）
          schema: "public",
          table: "dispatch_board_state",
          filter: `board_id=eq.${boardId}`,
        },
        (payload) => {
          const next = ((payload.new as any)?.state ??
            null) as Partial<BoardState> | null;
          if (!next) return;

          // ① 自分の更新は無視
          if (next.updatedBy && next.updatedBy === clientIdRef.current) return;

          // ② 古い更新は無視
          const incomingVersion =
            typeof next.version === "number" ? next.version : 0;
          if (incomingVersion <= versionRef.current) return;

          // ③ 反映中は保存を止める（ループ防止）
          hydratingRef.current = true;

          try {
            if (next.groups) setGroups(next.groups);
            if (next.trucks) setTrucks(next.trucks);
            if (next.containers) setContainers(next.containers);
            if (next.tempContainers) setTempContainers(next.tempContainers);
            if (next.completedContainers)
              setCompletedContainers(next.completedContainers);
            if (next.driverGroups) setDriverGroups(next.driverGroups);
            if (next.yards) setYards(next.yards);
            if (next.spareZones) setSpareZones(next.spareZones); // ← 追加
            if (next.kindColors) setKindColors(next.kindColors);
            if (next.axleColors) setAxleColors(next.axleColors);
            if (next.sizeColors) setSizeColors(next.sizeColors);
            if (next.theme) setTheme({ ...DEFAULT_THEME, ...next.theme });
            if (next.extraMailRecipients)
              setExtraMailRecipients(next.extraMailRecipients);

            versionRef.current = incomingVersion;
          } finally {
            // state反映後のuseEffect暴発を避けて少し遅延解除
            setTimeout(() => {
              hydratingRef.current = false;
            }, 50);
          }
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [boardId]);

  // ✅ state が変わったら DB に保存（デバウンス）
  // ※ロード中は保存しない
  useEffect(() => {
    if (!boardId) return;
    if (!hydrationDone) return;
    if (hydratingRef.current) return;

    const timer = window.setTimeout(async () => {
      const nextVersion = versionRef.current + 1;

      const state = {
        groups,
        trucks,
        containers,
        tempContainers,
        completedContainers,
        driverGroups,
        yards,
        spareZones, // ← 追加
        kindColors,
        axleColors,
        sizeColors,
        theme,
        extraMailRecipients,

        version: nextVersion,
        updatedAt: new Date().toISOString(),
        updatedBy: clientIdRef.current,
      };

      const { error } = await supabase
        .from("dispatch_board_state")
        .upsert({ board_id: boardId, state }, { onConflict: "board_id" });

      if (error) {
        console.error("save board state error", error);
        return;
      }

      // ✅ 保存成功したら version を進める
      versionRef.current = nextVersion;
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
    spareZones,
    kindColors,
    axleColors,
    sizeColors,
    theme,
    extraMailRecipients,
    hydrationDone,
  ]);

  // ✅ 救済（任意）：存在しない yardId のものを川口車庫に戻す
  // ※ 1回直ったら消してOK（常時入れても動くけど、毎回チェックが走る）
  useEffect(() => {
    if (!hydrationDone) return;

    setGroups((prev) =>
      prev.map((g) => {
        const loc = g.location as any;

        // pool 以外は無視
        if (!loc || loc.type !== "pool") return g;

        // ✅ yardId が無い型の可能性をここで潰す（TS対策）
        if (!("yardId" in loc)) return g;

        const exists = yards.some((y) => y.id === loc.yardId);
        if (exists) return g;

        return {
          ...g,
          location: {
            type: "pool",
            yardId: "kawaguchi",
            laneId: "single",
            pos: "front",
          },
        };
      }),
    );
  }, [hydrationDone, yards]);

  // 配送レーンに表示すべき日付一覧（containers から動的に）
  const dayKeys = Array.from(new Set(containers.map((c) => c.date))).sort();
  const legend20 = sizeColors?.["size-20"];
  const legend40 = sizeColors?.["size-40"];

  const [themeUploading, setThemeUploading] = useState(false);

  // localStorage に保存
  useEffect(() => {
    localStorage.setItem("dispatch-display-mode", displayMode);
  }, [displayMode]);

  // viewport meta タグ切替
  useEffect(() => {
    const meta = document.querySelector('meta[name="viewport"]');
    if (!meta) return;
    if (displayMode === "pc") {
      meta.setAttribute("content", "width=1400, initial-scale=0.3, minimum-scale=0.1, maximum-scale=5.0, user-scalable=yes");
    } else if (displayMode === "phone") {
      // 480px幅でレイアウト → iPhone(390px)では約80%縮小で表示
      meta.setAttribute("content", "width=480, initial-scale=1.0, minimum-scale=0.1, maximum-scale=5.0, user-scalable=yes");
    } else {
      // タブレット
      meta.setAttribute("content", "width=device-width, initial-scale=1.0, minimum-scale=0.1, maximum-scale=5.0, user-scalable=yes");
    }
  }, [displayMode]);

  return (
    <DisplayModeContext.Provider value={displayMode}>
      <div className={`app-scroll-x mode-${displayMode}`}>
        <div className="app-root">
          <header className="header">
            {/* 左側：タイトル＋サブタイトル */}
            <div className="header-main">
              <h1 className="title">
                <img
                  className="title-logo"
                  src={tezukaLogo}
                  alt="TEZUKA express"
                />
                配車表
              </h1>
            </div>

            <div className="header-right">
              {/* ★ 同期モード切替 */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginRight: displayMode === "phone" ? 0 : 8 }}>
                <button
                  className="sync-toggle-btn"
                  onClick={() => setAutoSync((p) => !p)}
                  style={{
                    padding: displayMode === "phone" ? '2px 6px' : '4px 10px',
                    fontSize: displayMode === "phone" ? 11 : 13,
                    border: '1px solid #aaa',
                    borderRadius: 4,
                    background: autoSync ? '#e8f5e9' : '#fff3e0',
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                  }}
                  title={autoSync ? '自動ポーリング中（10秒/30秒）' : '手動モード：更新ボタンで同期'}
                >
                  {autoSync ? '🔄 自動' : '⏸ 手動'}
                </button>
                {!autoSync && (
                  <button
                    className="sync-toggle-btn"
                    onClick={manualRefresh}
                    disabled={isManualRefreshing}
                    style={{
                      padding: displayMode === "phone" ? '2px 6px' : '4px 10px',
                      fontSize: displayMode === "phone" ? 11 : 13,
                      border: '1px solid #aaa',
                      borderRadius: 4,
                      background: '#e3f2fd',
                      cursor: isManualRefreshing ? 'wait' : 'pointer',
                      whiteSpace: 'nowrap',
                    }}
                    title="今すぐサーバーと同期"
                  >
                    {isManualRefreshing ? '⏳…' : '🔃 更新'}
                  </button>
                )}
              </div>

              {/* ★ 表示モード切替 */}
              <div className="mode-toggle-group">
                {([
                  ["pc", "\u{1F5A5}", "PC"],
                  ["tablet", "\u{1F4CB}", "タブレット"],
                  ["phone", "\u{1F4F1}", "スマホ"],
                ] as [DisplayMode, string, string][]).map(([mode, icon, label]) => (
                  <button
                    key={mode}
                    className={`mode-toggle-btn${displayMode === mode ? " active" : ""}`}
                    onClick={() => setDisplayMode(mode)}
                  >
                    {displayMode === "phone" ? icon : `${icon} ${label}`}
                  </button>
                ))}
              </div>

              <AuthBar />

              {/* ★ ここがヘッダー右側の凡例 */}
              <div className="header-legend">
                {/* アイコン群を 3ブロックで横並び */}
                <div className="legend-icons-row">
                  {/* サイズ */}
                  <div className="legend-group legend-group-size">
                    <div className="legend-row">
                      <span className="legend-item">
                        <span
                          className="legend-color"
                          style={{ background: legend20 ?? "transparent" }}
                        />
                        20F
                      </span>

                      <span className="legend-item">
                        <span
                          className="legend-color"
                          style={{ background: legend40 ?? "transparent" }}
                        />
                        40F
                      </span>
                    </div>
                  </div>

                  {/* 軸 / 種別 */}
                  <div className="legend-group legend-group-axle">
                    <div className="legend-row">
                      <span className="legend-item">
                        <span
                          className="legend-color"
                          style={{
                            backgroundColor:
                              axleColors["axle-1"] ?? "transparent",
                          }}
                        />
                        1軸
                      </span>

                      <span className="legend-item">
                        <span
                          className="legend-color"
                          style={{
                            backgroundColor:
                              axleColors["axle-2"] ?? "transparent",
                          }}
                        />
                        2軸
                      </span>

                      <span className="legend-item">
                        <span
                          className="legend-color"
                          style={{
                            backgroundColor:
                              axleColors["axle-3"] ?? "transparent",
                          }}
                        />
                        3軸
                      </span>

                      <span className="legend-item">
                        <span
                          className="legend-color"
                          style={{
                            backgroundColor:
                              axleColors["axle-MG"] ?? "transparent",
                          }}
                        />
                        MG
                      </span>

                      <span className="legend-item">
                        <span
                          className="legend-color"
                          style={{
                            backgroundColor:
                              axleColors["axle-2stack"] ?? "transparent",
                          }}
                        />
                        2個積
                      </span>

                      <span className="legend-item">
                        <span
                          className="legend-color"
                          style={{
                            backgroundColor:
                              axleColors["axle-both"] ?? "transparent",
                          }}
                        />
                        兼用
                      </span>
                    </div>
                  </div>
                </div>
              </div>
              {/* TEST FEATURE (temporary) — 新規コンテナ作成 */}
              <button
                className="settings-button btn-primary"
                style={{ marginRight: 8 }}
                onClick={openNewContainerModal}
              >
                ＋新規コンテナ
              </button>
              <button
                className="settings-button btn-primary"
                onClick={openSettings}
              >
                設定
              </button>
            </div>
          </header>

          {/* ========================================
  設定モーダル JSX（ヘルパー関数使用版）
  設定ボタンの後ろ（ヘッダー終わり付近）に追加
======================================== */}

          {/* 設定モーダル */}
          {isSettingsOpen && (
            <div className="modal-backdrop">
              <div className="modal" onClick={(e) => e.stopPropagation()}>
                <h2>設定</h2>

                <h3>表示テーマ</h3>

                <div style={{ display: "grid", gap: 10, marginBottom: 16 }}>
                  {/* 全体背景色 */}
                  <div
                    style={{ display: "flex", gap: 8, alignItems: "center" }}
                  >
                    <div style={{ width: 120 }}>全体背景色</div>
                    <input
                      type="color"
                      value={theme.appBg ?? DEFAULT_THEME.appBg!}
                      onChange={(e) =>
                        setTheme((p) => ({ ...p, appBg: e.target.value }))
                      }
                    />
                    <button
                      className="btn-small btn-delete"
                      onClick={() =>
                        setTheme((p) => ({ ...p, appBg: DEFAULT_THEME.appBg }))
                      }
                    >
                      戻す
                    </button>
                  </div>

                  {/* ヘッダー背景色 */}
                  <div
                    style={{ display: "flex", gap: 8, alignItems: "center" }}
                  >
                    <div style={{ width: 120 }}>ヘッダー背景色</div>
                    <input
                      type="color"
                      value={theme.headerBg ?? DEFAULT_THEME.headerBg!}
                      onChange={(e) =>
                        setTheme((p) => ({ ...p, headerBg: e.target.value }))
                      }
                    />
                    <button
                      className="btn-small btn-delete"
                      onClick={() =>
                        setTheme((p) => ({
                          ...p,
                          headerBg: DEFAULT_THEME.headerBg,
                        }))
                      }
                    >
                      戻す
                    </button>
                  </div>

                  {/* 背景画像アップロード（Storage） */}
                  <div
                    style={{ display: "flex", gap: 8, alignItems: "center" }}
                  >
                    <div style={{ width: 120 }}>背景画像</div>

                    <input
                      type="file"
                      accept="image/*"
                      disabled={themeUploading}
                      onChange={async (e) => {
                        const inputEl = e.currentTarget;
                        const file = e.target.files?.[0];
                        if (!file) return;

                        try {
                          setThemeUploading(true);
                          const url = await uploadThemeBgToStorage(file);
                          setTheme((p) => ({ ...p, bgImageUrl: url }));
                        } catch (err) {
                          console.error("bg upload failed:", err);
                          alert("背景画像のアップロードに失敗しました。");
                        } finally {
                          setThemeUploading(false);
                          inputEl.value = "";
                        }
                      }}
                    />

                    <button
                      className="btn-small btn-delete"
                      disabled={themeUploading}
                      onClick={() =>
                        setTheme((p) => ({ ...p, bgImageUrl: "" }))
                      }
                    >
                      なし
                    </button>

                    <div style={{ fontSize: 12, color: "#6b7280" }}>
                      {themeUploading
                        ? "アップロード中…"
                        : theme.bgImageUrl
                          ? "設定済み"
                          : "未設定"}
                    </div>
                  </div>

                  {/* 背景画像の調整 */}
                  <div
                    style={{ display: "flex", gap: 8, alignItems: "center" }}
                  >
                    <div style={{ width: 120 }}>表示サイズ</div>
                    <select
                      value={theme.bgSize ?? "cover"}
                      onChange={(e) =>
                        setTheme((p) => ({
                          ...p,
                          bgSize: e.target.value as any,
                        }))
                      }
                    >
                      <option value="cover">cover（全体にフィット）</option>
                      <option value="contain">contain（全体が入る）</option>
                      <option value="auto">auto（原寸）</option>
                    </select>

                    <div style={{ width: 70 }}>透明度</div>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.01}
                      value={theme.bgOpacity ?? 0.18}
                      onChange={(e) =>
                        setTheme((p) => ({
                          ...p,
                          bgOpacity: Number(e.target.value),
                        }))
                      }
                    />
                    <div style={{ width: 48 }}>
                      {(theme.bgOpacity ?? 0.18).toFixed(2)}
                    </div>
                  </div>

                  <div
                    style={{ display: "flex", gap: 8, alignItems: "center" }}
                  >
                    <div style={{ width: 120 }}>繰り返し</div>
                    <select
                      value={theme.bgRepeat ?? "no-repeat"}
                      onChange={(e) =>
                        setTheme((p) => ({
                          ...p,
                          bgRepeat: e.target.value as any,
                        }))
                      }
                    >
                      <option value="no-repeat">なし</option>
                      <option value="repeat">繰り返し</option>
                      <option value="repeat-x">横だけ</option>
                      <option value="repeat-y">縦だけ</option>
                    </select>

                    <div style={{ width: 70 }}>位置</div>
                    <select
                      value={theme.bgPosition ?? "center"}
                      onChange={(e) =>
                        setTheme((p) => ({
                          ...p,
                          bgPosition: e.target.value as any,
                        }))
                      }
                    >
                      <option value="center">中央</option>
                      <option value="top">上</option>
                      <option value="bottom">下</option>
                      <option value="left">左</option>
                      <option value="right">右</option>
                    </select>
                  </div>

                  <button
                    className="btn-small btn-delete"
                    onClick={() => setTheme(DEFAULT_THEME)}
                    disabled={themeUploading}
                  >
                    テーマを初期化
                  </button>
                </div>

                <h3>サイズ色（左端）</h3>

                {[
                  { key: "size-20", label: "20F" },
                  { key: "size-40", label: "40F" },
                ].map((x) => {
                  const current = sizeColors[x.key];
                  return (
                    <div
                      key={x.key}
                      style={{
                        display: "flex",
                        gap: 8,
                        alignItems: "center",
                        marginBottom: 6,
                      }}
                    >
                      <div style={{ width: 60 }}>{x.label}</div>

                      <input
                        type="color"
                        value={current ?? "#000000"}
                        onChange={(e) => {
                          const v = e.target.value;
                          setSizeColors((prev) => ({ ...prev, [x.key]: v }));
                        }}
                      />

                      <button
                        className="btn-small btn-delete"
                        onClick={() => {
                          setSizeColors((prev) => {
                            const copy = { ...prev };
                            delete copy[x.key];
                            return copy;
                          });
                        }}
                      >
                        なし
                      </button>

                      <div style={{ fontSize: 12, color: "#6b7280" }}>
                        {current ? current : "未設定（色なし）"}
                      </div>
                    </div>
                  );
                })}

                <h3>シャーシ上部色（軸種別）</h3>

                {[
                  { key: "axle-1", label: "1軸" },
                  { key: "axle-2", label: "2軸" },
                  { key: "axle-3", label: "3軸" },
                  { key: "axle-MG", label: "MG" },
                  { key: "axle-2stack", label: "2個積" },
                  { key: "axle-both", label: "兼用" },
                ].map((x) => {
                  const current = axleColors[x.key];
                  return (
                    <div
                      key={x.key}
                      style={{
                        display: "flex",
                        gap: 8,
                        alignItems: "center",
                        marginBottom: 6,
                      }}
                    >
                      <div style={{ width: 60 }}>{x.label}</div>

                      {/* 未設定でもinputは値が必要なのでダミー色 */}
                      <input
                        type="color"
                        value={current ?? "#000000"}
                        onChange={(e) => {
                          const v = e.target.value;
                          setAxleColors((prev) => ({ ...prev, [x.key]: v }));
                        }}
                      />

                      <button
                        className="btn-small btn-delete"
                        onClick={() => {
                          setAxleColors((prev) => {
                            const copy = { ...prev };
                            delete copy[x.key]; // ✅ 色なしに戻す
                            return copy;
                          });
                        }}
                      >
                        なし
                      </button>

                      <div style={{ fontSize: 12, color: "#6b7280" }}>
                        {current ? current : "未設定（色なし）"}
                      </div>
                    </div>
                  );
                })}

                {/* シャーシプール設定セクション */}
                <section className="modal-section">
                  <h3>シャーシプール設定</h3>

                  {yards.map((yard, yIndex) => {
                    const slotMode: SlotMode =
                      yard.slotMode ??
                      (yard.id === "kawaguchi" || yard.id === "custom"
                        ? "single"
                        : "three");

                    const labels =
                      yard.positionLabels ?? DEFAULT_POSITION_LABELS;

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
                              <option value="single">
                                1マス（フリー／川口車庫仕様）
                              </option>
                              <option value="one">1本（1マス固定）</option>{" "}
                              {/* ← 追加 */}
                              <option value="two">2本（前／奥）</option>
                              <option value="three">3本（前／中／奥）</option>
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
                                      ...(current.positionLabels ??
                                        DEFAULT_POSITION_LABELS),
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
                                        ...(current.positionLabels ??
                                          DEFAULT_POSITION_LABELS),
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
                                      ...(current.positionLabels ??
                                        DEFAULT_POSITION_LABELS),
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

                        {/* ヤード操作ボタン（削除・上下移動） */}
                        <div
                          className="modal-yard-actions"
                          style={{ display: "flex", gap: 8, marginTop: 8 }}
                        >
                          <button
                            className="btn-small btn-delete"
                            onClick={() => removeYard(yIndex)}
                            disabled={yards.length <= 1}
                          >
                            置き場削除
                          </button>

                          <button
                            className="btn-small"
                            onClick={() => moveYardUp(yIndex)}
                            disabled={yIndex === 0}
                            style={{ background: "#6b7280", color: "white" }}
                          >
                            ↑ 上へ
                          </button>

                          <button
                            className="btn-small"
                            onClick={() => moveYardDown(yIndex)}
                            disabled={yIndex === yards.length - 1}
                            style={{ background: "#6b7280", color: "white" }}
                          >
                            ↓ 下へ
                          </button>

                          <button
                            className="btn-small btn-add"
                            onClick={() => insertYardAfter(yIndex)}
                          >
                            ↓ 下に追加
                          </button>
                        </div>
                      </div>
                    );
                  })}

                  {/* 一番下に「ヤード追加」 */}
                  <button className="btn-small btn-add" onClick={addYard}>
                    置き場を末尾に追加
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
                        <button
                          className="btn-small btn-delete"
                          onClick={() => removeOwnedGroup(index)}
                        >
                          削除
                        </button>
                      </div>
                    ))}
                    <button
                      className="btn-small btn-add"
                      onClick={addOwnedGroup}
                    >
                      グループ追加
                    </button>
                  </div>

                  <h3>傭車グループ設定</h3>
                  <div className="driver-group-list">
                    {driverGroups.outsourced.map((g, index) => (
                      <div
                        key={`outsourced-${index}`}
                        className="driver-group-row"
                      >
                        <input
                          className="driver-group-key-input"
                          value={g.key}
                          placeholder="kintone の値（例: ガレージ, 山翔）"
                          onChange={(e) =>
                            updateOutsourcedGroup(index, {
                              key: e.target.value,
                            })
                          }
                        />
                        <input
                          className="driver-group-name-input"
                          value={g.label}
                          placeholder="表示名"
                          onChange={(e) =>
                            updateOutsourcedGroup(index, {
                              label: e.target.value,
                            })
                          }
                        />
                        <button
                          className="btn-small btn-delete"
                          onClick={() => removeOutsourcedGroup(index)}
                        >
                          削除
                        </button>
                      </div>
                    ))}
                    <button
                      className="btn-small btn-add"
                      onClick={addOutsourcedGroup}
                    >
                      グループ追加
                    </button>
                  </div>
                </section>

                <h3>予備車エリア設定</h3>
                <div className="spare-zones-list" style={{ marginBottom: 16 }}>
                  {spareZones.map((zone, index) => (
                    <div
                      key={zone.id}
                      style={{
                        display: "flex",
                        gap: 8,
                        alignItems: "center",
                        marginBottom: 6,
                      }}
                    >
                      <input
                        className="modal-yard-name-input"
                        value={zone.name}
                        placeholder="エリア名（例: 予備車、修理中）"
                        onChange={(e) => updateSpareZone(index, e.target.value)}
                        style={{ flex: 1 }}
                      />
                      <button
                        className="btn-small btn-delete"
                        onClick={() => removeSpareZone(index)}
                        disabled={spareZones.length <= 1}
                      >
                        削除
                      </button>
                    </div>
                  ))}
                  <button className="btn-small btn-add" onClick={addSpareZone}>
                    エリア追加
                  </button>
                </div>

                <h3>一斉メール 追加宛先(グループ別)</h3>
                <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 8 }}>
                  各グループの一斉メールに常時追加する宛先(カンマ区切り)。ドライバーの宛先に加えて to: に含まれます。
                </div>
                <div style={{ display: "grid", gap: 8, marginBottom: 16 }}>
                  {[...driverGroups.owned, ...driverGroups.outsourced].map(
                    (g) => (
                      <div
                        key={g.key}
                        style={{
                          display: "flex",
                          gap: 8,
                          alignItems: "center",
                        }}
                      >
                        <div style={{ width: 100, fontSize: 13 }}>
                          {g.label}
                        </div>
                        <input
                          type="text"
                          value={extraMailRecipients[g.key] ?? ""}
                          onChange={(e) =>
                            setExtraMailRecipients((prev) => ({
                              ...prev,
                              [g.key]: e.target.value,
                            }))
                          }
                          placeholder="a@example.com, b@example.com"
                          style={{ flex: 1, padding: "6px 8px" }}
                        />
                      </div>
                    ),
                  )}
                </div>

                <h3>kintone連携</h3>
                <div style={{ marginBottom: 16 }}>
                  <button
                    className="btn-small btn-add"
                    onClick={syncChassisFromKintone}
                  >
                    kintoneシャーシを再同期
                  </button>
                  <div style={{ fontSize: 12, color: "#6b7280", marginTop: 6 }}>
                    kintoneで追加されたシャーシを配車ボードに反映します（川口車庫に配置）。既存のシャーシ・積載状態は変更されません。
                  </div>

                  <button
                    className="btn-small btn-add"
                    style={{ marginTop: 12 }}
                    onClick={rescueChassisByNumber}
                  >
                    シャーシ番号を指定して救済
                  </button>
                  <div style={{ fontSize: 12, color: "#6b7280", marginTop: 6 }}>
                    シャーシ番号を指定して川口車庫に強制復帰させます。画面から消えてしまったシャーシの復旧用（コンテナは維持されます）。
                  </div>
                </div>

                <div className="modal-footer">
                  <button
                    className="btn-delete"
                    disabled={themeUploading} // アップロード中に戻すのは危険なので抑止推奨
                    onClick={closeSettingsWithoutSave}
                  >
                    保存しないで閉じる
                  </button>

                  <button
                    className="btn-primary"
                    onClick={closeSettingsWithSave}
                  >
                    保存
                  </button>
                </div>
              </div>
            </div>
          )}

          <DndContext
            sensors={sensors}
            autoScroll={{ enabled: true, threshold: { x: 0, y: 0.15 } }}
            onDragStart={(e) => {
              setActiveDragId(String(e.active.id));
              document.body.classList.add("dragging"); // ✅ 追加
            }}
            onDragCancel={() => {
              setActiveDragId(null);
              document.body.classList.remove("dragging"); // ✅ 追加
            }}
            onDragEnd={(e) => {
              setActiveDragId(null);
              document.body.classList.remove("dragging"); // ✅ 追加
              handleDragEnd(e);
            }}
          >
            {/* スマホ用タブバー（スクロールジャンプ方式） */}
            {displayMode === "phone" && (
              <div className="phone-tab-bar">
                {([
                  ["phone-panel-chassis", "\u{1F69B} シャーシ"],
                  ["phone-panel-driver", "\u{1F468}\u200D\u{1F4BC} ドライバー"],
                  ["phone-panel-delivery", "\u{1F4E6} 配送"],
                ] as [string, string][]).map(([panelId, label]) => (
                  <button
                    key={panelId}
                    className="phone-tab-btn"
                    onClick={() => {
                      document.getElementById(panelId)?.scrollIntoView({ behavior: "smooth" });
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
            <div className="main">
              {/* 左：シャーシプール＋予備車 */}
              <div
                id="phone-panel-chassis"
                className="left-panel"
                style={displayMode === "pc" ? { width: leftWidth, flex: "0 0 auto" } : undefined}
              >
                <h2>シャーシプール</h2>

                {yards.map((yard) => {
                  // ★ slotMode と ラベルを毎ヤードごとに決定
                  const slotMode: SlotMode =
                    yard.slotMode ??
                    (yard.id === "kawaguchi" || yard.id === "custom"
                      ? "single"
                      : "three");

                  const labels = yard.positionLabels ?? DEFAULT_POSITION_LABELS;

                  // このヤードで使う「マス（前/中/奥）」を決定
                  const yardPositions =
                    slotMode === "single"
                      ? [] // 1マスフリーなので列は使わない
                      : slotMode === "one" // ← 追加
                        ? [{ id: "front" as const, label: labels.front || "" }]
                        : slotMode === "two"
                          ? [
                              {
                                id: "front" as const,
                                label: labels.front || "前",
                              },
                              {
                                id: "back" as const,
                                label: labels.back || "奥",
                              },
                            ]
                          : [
                              {
                                id: "front" as const,
                                label: labels.front || "前",
                              },
                              {
                                id: "middle" as const,
                                label: labels.middle || "中",
                              },
                              {
                                id: "back" as const,
                                label: labels.back || "奥",
                              },
                            ];

                  const isHidden = !!hiddenPoolYards[yard.id];
                  return (
                    <div key={yard.id} className="yard-section">
                      <div
                        className="yard-title"
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                          cursor: "pointer",
                          userSelect: "none",
                        }}
                        onClick={() => togglePoolYard(yard.id)}
                        title={isHidden ? "展開" : "折りたたむ"}
                      >
                        <span
                          style={{
                            display: "inline-block",
                            width: 22,
                            height: 22,
                            lineHeight: "20px",
                            textAlign: "center",
                            border: "1px solid #9ca3af",
                            borderRadius: 4,
                            fontWeight: "bold",
                            background: "#fff",
                          }}
                        >
                          {isHidden ? "＋" : "－"}
                        </span>
                        <span>{yard.name}</span>
                      </div>

                      {isHidden ? null : (
                        <>

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
                                g.location.yardId === yard.id,
                            )
                            .map((g) => (
                              <DraggableGroupCard
                                key={g.id}
                                group={g}
                                kindColors={kindColors}
                                axleColors={axleColors}
                                sizeColors={sizeColors}
                                onTap={handleCardTap}
                                practiceColorMap={practiceState.colors}
                                onContextMenuGroup={(e, gg) =>
                                  openMailMenu(e, gg, null)
                                }
                              />
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
                                  pos.id,
                                );
                                const droppableId = `yard-${yard.id}-${lane.id}-${pos.id}`;

                                return (
                                  <DroppableArea
                                    key={droppableId}
                                    id={droppableId}
                                    className="slot-pool"
                                    placeholder={group ? "" : " "}
                                  >
                                    {group && (
                                      <DraggableGroupCard
                                        group={group}
                                        axleColors={axleColors}
                                        sizeColors={sizeColors}
                                        kindColors={kindColors}
                                        onTap={handleCardTap}
                                        practiceColorMap={practiceState.colors}
                                        onContextMenuGroup={(e, gg) =>
                                          openMailMenu(e, gg, null)
                                        }
                                      />
                                    )}
                                  </DroppableArea>
                                );
                              })}
                            </div>
                          ))}
                        </div>
                      )}
                        </>
                      )}
                    </div>
                  );
                })}

                {/* 予備車エリア（複数対応） */}
                {spareZones.map((zone) => {
                  const zoneTrucks = trucks.filter(
                    (t) =>
                      t.location.type === "spare" &&
                      t.location.zoneId === zone.id,
                  );

                  return (
                    <div key={zone.id} style={{ marginTop: 12 }}>
                      <h3 style={{ marginBottom: 4 }}>{zone.name}</h3>
                      <DroppableArea
                        id={`zone-${zone.id}`}
                        placeholder="ここに車両Bをドロップ"
                        className="slot-row-wrap"
                      >
                        {zoneTrucks.map((t) => (
                          <DraggableTruckCard key={t.id} truck={t} />
                        ))}
                      </DroppableArea>
                    </div>
                  );
                })}
              </div>
              <div className="resizer" onMouseDown={startResize("left")} />
              {/* 中央：ドライバー */}
              <div
                id="phone-panel-driver"
                className="driver-panel"
                style={displayMode === "pc" ? { width: middleWidth, flex: "0 0 auto" } : undefined}
              >
                <h2 style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span>ドライバー</span>
                  <button
                    type="button"
                    onClick={() => setDriverOrderModalOpen(true)}
                    title="ドライバー並び順を編集"
                    style={{
                      padding: "2px 8px",
                      fontSize: 11,
                      background: "#f5f5f5",
                      border: "1px solid #ccc",
                      borderRadius: 4,
                      cursor: "pointer",
                      fontWeight: "normal",
                    }}
                  >
                    ⇅ 並び順
                  </button>
                </h2>

                <div className="driver-groups-grid">
                  {/* 左：自車 */}
                  <section className="driver-group-column">
                    <h3 className="driver-group-column-title">自車</h3>

                    {VISIBLE_OWNED_GROUP_ORDER.map(({ key, label }) => {
                      const groupDrivers = sortDriversByOrder(
                        ownedDrivers.filter((d) => (d.groupName || "") === key),
                        driverOrderState.order[key],
                      );
                      if (groupDrivers.length === 0) return null;

                      return (
                        <div key={key} className="driver-group">
                          <div
                            className="driver-group-name"
                            style={{
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "space-between",
                              gap: 8,
                            }}
                          >
                            <span>・{label}</span>
                            <button
                              className="btn-small btn-primary"
                              style={{ fontSize: 11, padding: "2px 8px" }}
                              onClick={() => sendGroupBatchMail(key, label)}
                              title="このグループの全ドライバーに一斉メール"
                            >
                              📧 一斉配信
                            </button>
                          </div>
                          <div className="driver-list">
                            {groupDrivers.map((d) => {
                              const truck = getTruckForDriver(d.id);
                              const group = getGroupForDriver(d.id);

                              return (
                                <section key={d.id} className="driver-row">
                                  <div className="driver-col">
                                    <div
                                      className="driver-name"
                                      style={{
                                        display: "flex",
                                        alignItems: "center",
                                        gap: 4,
                                      }}
                                    >
                                      <input
                                        type="checkbox"
                                        checked={!excludedDrivers[d.id]}
                                        onChange={() =>
                                          toggleExcludedDriver(d.id)
                                        }
                                        title="一斉メール対象"
                                        style={{ cursor: "pointer" }}
                                      />
                                      <span
                                        style={{
                                          textDecoration: excludedDrivers[d.id]
                                            ? "line-through"
                                            : undefined,
                                          opacity: excludedDrivers[d.id]
                                            ? 0.5
                                            : 1,
                                        }}
                                      >
                                        {d.name}
                                      </span>
                                    </div>
                                    <DroppableArea
                                      id={`driver-${d.id}-truck`}
                                      className="slot-driver-truck"
                                      placeholder=" "
                                    >
                                      {truck && (
                                        <DraggableTruckCard truck={truck} />
                                      )}
                                    </DroppableArea>
                                  </div>

                                  <div className="driver-slot-col">
                                    <DroppableArea
                                      id={`driver-${d.id}-group`}
                                      className="slot-driver-group"
                                      placeholder=" "
                                    >
                                      {group && (
                                        <DraggableGroupCard
                                          group={group}
                                          kindColors={kindColors}
                                          axleColors={axleColors}
                                          sizeColors={sizeColors}
                                          onTap={handleCardTap}
                                          onContextMenuGroup={(e, g) =>
                                            openMailMenu(e, g, d)
                                          }
                                          practiceColorMap={practiceState.colors}
                                        />
                                      )}
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

                    {VISIBLE_OUTSOURCED_GROUP_ORDER.map(({ key, label }) => {
                      const groupDrivers = sortDriversByOrder(
                        outsourcedDrivers.filter(
                          (d) => (d.groupName || "") === key,
                        ),
                        driverOrderState.order[key],
                      );
                      if (groupDrivers.length === 0) return null;

                      return (
                        <div key={key} className="driver-group">
                          <div
                            className="driver-group-name"
                            style={{
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "space-between",
                              gap: 8,
                            }}
                          >
                            <span>・{label}</span>
                            <button
                              className="btn-small btn-primary"
                              style={{ fontSize: 11, padding: "2px 8px" }}
                              onClick={() => sendGroupBatchMail(key, label)}
                              title="このグループの全ドライバーに一斉メール"
                            >
                              📧 一斉配信
                            </button>
                          </div>
                          <div className="driver-list">
                            {groupDrivers.map((d) => {
                              const truck = getTruckForDriver(d.id);
                              const group = getGroupForDriver(d.id);

                              return (
                                <section key={d.id} className="driver-row">
                                  <div className="driver-col">
                                    <div
                                      className="driver-name"
                                      style={{
                                        display: "flex",
                                        alignItems: "center",
                                        gap: 4,
                                      }}
                                    >
                                      <input
                                        type="checkbox"
                                        checked={!excludedDrivers[d.id]}
                                        onChange={() =>
                                          toggleExcludedDriver(d.id)
                                        }
                                        title="一斉メール対象"
                                        style={{ cursor: "pointer" }}
                                      />
                                      <span
                                        style={{
                                          textDecoration: excludedDrivers[d.id]
                                            ? "line-through"
                                            : undefined,
                                          opacity: excludedDrivers[d.id]
                                            ? 0.5
                                            : 1,
                                        }}
                                      >
                                        {d.name}
                                      </span>
                                    </div>
                                    <DroppableArea
                                      id={`driver-${d.id}-truck`}
                                      className="slot-driver-truck"
                                      placeholder=" "
                                    >
                                      {truck && (
                                        <DraggableTruckCard truck={truck} />
                                      )}
                                    </DroppableArea>
                                  </div>

                                  <div className="driver-slot-col">
                                    <DroppableArea
                                      id={`driver-${d.id}-group`}
                                      className="slot-driver-group"
                                      placeholder=" "
                                    >
                                      {group && (
                                        <DraggableGroupCard
                                          group={group}
                                          kindColors={kindColors}
                                          axleColors={axleColors}
                                          sizeColors={sizeColors}
                                          onTap={handleCardTap}
                                          onContextMenuGroup={(e, g) =>
                                            openMailMenu(e, g, d)
                                          }
                                          practiceColorMap={practiceState.colors}
                                        />
                                      )}
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
              <div className="resizer" onMouseDown={startResize("middle")} />
              {/* 右：配送分＋一時保管＋配送完了 */}
              <div
                id="phone-panel-delivery"
                className="delivery-panel"
                style={displayMode === "pc" ? {
                  width: deliveryWidth,
                  flex: "0 0 auto",
                  display: "flex",
                  flexDirection: "column",
                  height: "100vh",
                  overflow: "hidden",
                } : {
                  display: "flex",
                  flexDirection: "column" as const,
                }}
              >
                {/* 配送分: flex column で上下2ブロック */}
                <div
                  style={{
                    flex: 1,
                    display: "flex",
                    flexDirection: "column",
                    minHeight: 0,
                    overflow: "hidden",
                    paddingRight: "8px",
                  }}
                >
                  <h2 style={{ flexShrink: 0 }}>配送分</h2>

                  {/* 配送分スクロールボックス */}
                  <div
                    ref={deliveryScrollRef}
                    className="delivery-scroll"
                    style={{ flex: "1 1 0", minHeight: 0, overflow: "auto" }}
                  >
                    <div className="days-scroll">
                      {dayKeys.map((dayKey) => {
                        return (
                          <section key={dayKey} className="day-column">
                            {yardGroups.map((yardName) => (
                              <div
                                key={`${dayKey}-${yardName}`}
                                className="delivery-yard-row"
                              >
                                <div className="delivery-yard-name">
                                  {yardName}
                                </div>
                                <DroppableArea
                                  id={`delivery-${dayKey}-${yardName}`}
                                  className="slot-auto"
                                  placeholder="ここにコンテナAをドロップ"
                                >
                                  {containers
                                    .filter(
                                      (c) =>
                                        c.date === dayKey &&
                                        c.pickupYardGroup === yardName,
                                    )
                                    .map((c) => (
                                      <DraggableContainerCard
                                        key={c.id}
                                        container={c}
                                        sizeColors={sizeColors}
                                        practiceColorMap={practiceState.colors}
                                        onContextMenuContainer={
                                          openContainerContextMenu
                                        }
                                      />
                                    ))}
                                </DroppableArea>
                              </div>
                            ))}
                          </section>
                        );
                      })}
                    </div>
                  </div>

                  <div className="delivery-completed" style={{ flexShrink: 0, maxHeight: "220px", overflowY: "auto" }}>
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
                          sizeColors={sizeColors}
                          isCompleted
                          practiceColorMap={practiceState.colors}
                          onContextMenuContainer={openContainerContextMenu}
                        />
                      ))}
                    </DroppableArea>
                  </div>
                </div>
                {/* ↑ 配送分フレックスエリアここまで */}

                {/* ✅ ボタンをスクロールエリアの外に配置（固定） */}
                <div
                  style={{
                    padding: "12px",
                    borderTop: "1px solid #ddd",
                    background: "#fff",
                    flexShrink: 0, // ← 追加：縮まないようにする
                  }}
                >
                  <button
                    onClick={() => openVoiceWindow()}
                    style={{
                      width: "100%",
                      padding: "12px",
                      fontSize: "16px",
                      fontWeight: "bold",
                      background: "#4CAF50",
                      color: "white",
                      border: "none",
                      borderRadius: "6px",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: "8px",
                    }}
                  >
                    🔊 音声送信パネルを開く
                  </button>
                  <button
                    onClick={() => openDispatchTable()}
                    style={{
                      width: "100%",
                      padding: "12px",
                      fontSize: "16px",
                      fontWeight: "bold",
                      background: "#1976d2",
                      color: "white",
                      border: "none",
                      borderRadius: "6px",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: "8px",
                      marginTop: "8px",
                    }}
                  >
                    📋 配車表を開く
                  </button>
                </div>
              </div>
              {/* ← delivery-panelの終わり */}

              {/* ★ 右パネル用の仕切り線（必ず main の中の最後の子に） */}
              <div className="resizer" onMouseDown={startResize("right")} />
            </div>

            {createPortal(
              <DragOverlay style={{ zIndex: 999999 }}>
                {activeDragId ? renderDragOverlay(activeDragId) : null}
              </DragOverlay>,
              document.body,
            )}
          </DndContext>

          {/* TEST FEATURE (temporary) — 搬入ヤード書込みモーダル */}
          {dropoffYardEditor.visible && (
            <div className="modal-backdrop">
              <div
                className="modal"
                onClick={(e) => e.stopPropagation()}
                style={{ maxWidth: 480 }}
              >
                <h2>搬入ヤード書込み</h2>
                <div style={{ display: "grid", gap: 12, marginBottom: 16 }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <div style={{ width: 100 }}>地域</div>
                    <select
                      value={dropoffYardEditor.region}
                      onChange={(e) =>
                        setDropoffYardEditor((s) => ({
                          ...s,
                          region: e.target.value,
                          yard: "",
                        }))
                      }
                      style={{ flex: 1, padding: "6px 8px" }}
                    >
                      <option value="">-- 選択 --</option>
                      {Object.keys(yardMap).map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <div style={{ width: 100 }}>ヤード</div>
                    <select
                      value={dropoffYardEditor.yard}
                      onChange={(e) =>
                        setDropoffYardEditor((s) => ({
                          ...s,
                          yard: e.target.value,
                        }))
                      }
                      disabled={!dropoffYardEditor.region}
                      style={{ flex: 1, padding: "6px 8px" }}
                    >
                      <option value="">-- 選択 --</option>
                      {(yardMap[dropoffYardEditor.region] ?? []).map((y) => (
                        <option key={y} value={y}>
                          {y}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="modal-footer">
                  <button
                    className="btn-delete"
                    onClick={() =>
                      setDropoffYardEditor((s) => ({ ...s, visible: false }))
                    }
                  >
                    キャンセル
                  </button>
                  <button
                    className="btn-primary"
                    disabled={!dropoffYardEditor.yard}
                    onClick={saveDropoffYard}
                  >
                    保存
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* TEST FEATURE (temporary) — 新規コンテナ作成モーダル */}
          {newContainerModal.visible && (
            <div className="modal-backdrop">
              <div
                className="modal"
                onClick={(e) => e.stopPropagation()}
                style={{ maxWidth: 560 }}
              >
                <h2>新規コンテナ作成</h2>
                <div style={{ display: "grid", gap: 10, marginBottom: 16 }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <div style={{ width: 110 }}>コンテナ番号 *</div>
                    <input
                      type="text"
                      value={newContainerModal.no}
                      onChange={(e) =>
                        setNewContainerModal((s) => ({
                          ...s,
                          no: e.target.value,
                        }))
                      }
                      placeholder="例: TCNU1234567"
                      style={{ flex: 1, padding: "6px 8px" }}
                    />
                  </div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <div style={{ width: 110 }}>サイズ</div>
                    <label style={{ marginRight: 12 }}>
                      <input
                        type="radio"
                        checked={newContainerModal.size === "20"}
                        onChange={() =>
                          setNewContainerModal((s) => ({ ...s, size: "20" }))
                        }
                      />
                      20F
                    </label>
                    <label>
                      <input
                        type="radio"
                        checked={newContainerModal.size === "40"}
                        onChange={() =>
                          setNewContainerModal((s) => ({ ...s, size: "40" }))
                        }
                      />
                      40F
                    </label>
                  </div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <div style={{ width: 110 }}>日付 (MM/DD)</div>
                    <input
                      type="text"
                      value={newContainerModal.date}
                      onChange={(e) =>
                        setNewContainerModal((s) => ({
                          ...s,
                          date: e.target.value,
                        }))
                      }
                      placeholder="例: 08/07"
                      style={{ width: 120, padding: "6px 8px" }}
                    />
                  </div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <div style={{ width: 110 }}>eta (着時間)</div>
                    <input
                      type="text"
                      value={newContainerModal.eta}
                      onChange={(e) =>
                        setNewContainerModal((s) => ({
                          ...s,
                          eta: e.target.value,
                        }))
                      }
                      placeholder="例: 9:00"
                      style={{ width: 120, padding: "6px 8px" }}
                    />
                  </div>

                  <hr style={{ margin: "8px 0", opacity: 0.3 }} />
                  <div style={{ fontWeight: "bold" }}>搬出ヤード</div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <div style={{ width: 110 }}>地域</div>
                    <select
                      value={newContainerModal.pickupRegion}
                      onChange={(e) =>
                        setNewContainerModal((s) => ({
                          ...s,
                          pickupRegion: e.target.value,
                          pickupYard: "",
                        }))
                      }
                      style={{ flex: 1, padding: "6px 8px" }}
                    >
                      <option value="">-- 選択 --</option>
                      {Object.keys(yardMap).map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <div style={{ width: 110 }}>ヤード</div>
                    <select
                      value={newContainerModal.pickupYard}
                      onChange={(e) =>
                        setNewContainerModal((s) => ({
                          ...s,
                          pickupYard: e.target.value,
                        }))
                      }
                      disabled={!newContainerModal.pickupRegion}
                      style={{ flex: 1, padding: "6px 8px" }}
                    >
                      <option value="">-- 選択 --</option>
                      {(yardMap[newContainerModal.pickupRegion] ?? []).map(
                        (y) => (
                          <option key={y} value={y}>
                            {y}
                          </option>
                        ),
                      )}
                    </select>
                  </div>

                  <hr style={{ margin: "8px 0", opacity: 0.3 }} />
                  <div style={{ fontWeight: "bold" }}>搬入ヤード</div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <div style={{ width: 110 }}>地域</div>
                    <select
                      value={newContainerModal.dropoffRegion}
                      onChange={(e) =>
                        setNewContainerModal((s) => ({
                          ...s,
                          dropoffRegion: e.target.value,
                          dropoffYard: "",
                        }))
                      }
                      style={{ flex: 1, padding: "6px 8px" }}
                    >
                      <option value="">-- 選択 --</option>
                      {Object.keys(yardMap).map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <div style={{ width: 110 }}>ヤード</div>
                    <select
                      value={newContainerModal.dropoffYard}
                      onChange={(e) =>
                        setNewContainerModal((s) => ({
                          ...s,
                          dropoffYard: e.target.value,
                        }))
                      }
                      disabled={!newContainerModal.dropoffRegion}
                      style={{ flex: 1, padding: "6px 8px" }}
                    >
                      <option value="">-- 選択 --</option>
                      {(yardMap[newContainerModal.dropoffRegion] ?? []).map(
                        (y) => (
                          <option key={y} value={y}>
                            {y}
                          </option>
                        ),
                      )}
                    </select>
                  </div>

                  <hr style={{ margin: "8px 0", opacity: 0.3 }} />
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <div style={{ width: 110 }}>配送先</div>
                    <input
                      type="text"
                      value={newContainerModal.destination}
                      onChange={(e) =>
                        setNewContainerModal((s) => ({
                          ...s,
                          destination: e.target.value,
                        }))
                      }
                      placeholder="例: 千葉RDC"
                      style={{ flex: 1, padding: "6px 8px" }}
                    />
                  </div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <div style={{ width: 110 }}>受注番号</div>
                    <input
                      type="text"
                      value={newContainerModal.booking}
                      onChange={(e) =>
                        setNewContainerModal((s) => ({
                          ...s,
                          booking: e.target.value,
                        }))
                      }
                      placeholder="任意"
                      style={{ flex: 1, padding: "6px 8px" }}
                    />
                  </div>
                </div>
                <div className="modal-footer">
                  <button
                    className="btn-delete"
                    onClick={() =>
                      setNewContainerModal((s) => ({ ...s, visible: false }))
                    }
                  >
                    キャンセル
                  </button>
                  <button
                    className="btn-primary"
                    disabled={!newContainerModal.no.trim()}
                    onClick={saveNewContainer}
                  >
                    作成
                  </button>
                </div>
              </div>
            </div>
          )}

          {mailMenu.visible && (mailMenu.group || mailMenu.containerForColor) && (
            <div
              className="mail-context-menu"
              style={{ top: mailMenu.y, left: mailMenu.x }}
            >
              {mailMenu.driver && mailMenu.group && (
                <>
                  <button onClick={() => handleSendMail("pickup")}>
                    取りの送信
                  </button>
                  <button onClick={() => handleSendMail("delivery")}>
                    配送の送信
                  </button>
                </>
              )}
              {/* PRACTICE MODE (temporary) */}
              {mailMenu.containerForColor && (
                <>
                  <button
                    onClick={() => {
                      const cfc = mailMenu.containerForColor;
                      if (!cfc) return;
                      setPracticeColorPicker({
                        visible: true,
                        containerId: cfc.id,
                        containerLabel: cfc.label,
                      });
                      setMailMenu((s) => ({ ...s, visible: false }));
                    }}
                  >
                    🎨 色を変更…
                  </button>
                  <button
                    onClick={() => {
                      const cfc = mailMenu.containerForColor;
                      if (!cfc) return;
                      setPracticeContainerColor(cfc.id, null);
                      setMailMenu((s) => ({ ...s, visible: false }));
                    }}
                  >
                    🚫 色をリセット
                  </button>
                  {/* TEST FEATURE (temporary) — 搬入ヤード書込み */}
                  <button
                    onClick={() => {
                      const cfc = mailMenu.containerForColor;
                      if (!cfc) return;
                      openDropoffYardEditor(cfc.id);
                      setMailMenu((s) => ({ ...s, visible: false }));
                    }}
                  >
                    🚚 搬入ヤード…
                  </button>
                </>
              )}
            </div>
          )}
          {/* PRACTICE MODE (temporary) */}
          <PracticeSettingsButton
            ownedGroups={OWNED_GROUP_ORDER}
            outsourcedGroups={OUTSOURCED_GROUP_ORDER}
            hiddenGroups={practiceState.hiddenGroups}
            onChange={(owned, outsourced) =>
              setPracticeHiddenGroups(owned, outsourced)
            }
            onResetAll={resetPracticeAll}
          />
          <PracticeColorPickerModal
            visible={practiceColorPicker.visible}
            initialColor={
              practiceState.colors[practiceColorPicker.containerId] ?? null
            }
            containerLabel={practiceColorPicker.containerLabel}
            onApply={(color) =>
              setPracticeContainerColor(practiceColorPicker.containerId, color)
            }
            onReset={() =>
              setPracticeContainerColor(practiceColorPicker.containerId, null)
            }
            onClose={() =>
              setPracticeColorPicker((s) => ({ ...s, visible: false }))
            }
          />
          {/* ドライバー並び順 (常設) */}
          <DriverOrderSettings
            visible={driverOrderModalOpen}
            onClose={() => setDriverOrderModalOpen(false)}
            ownedGroups={OWNED_GROUP_ORDER}
            outsourcedGroups={OUTSOURCED_GROUP_ORDER}
            ownedDrivers={ownedDrivers}
            outsourcedDrivers={outsourcedDrivers}
            orderMap={driverOrderState.order}
            onGroupOrderChange={setDriverGroupOrder}
          />
          {detailModal.visible && (
            <div
              className="detail-modal-backdrop"
              onClick={() => setDetailModal({ visible: false })}
            >
              <div
                className="detail-modal"
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  className="detail-modal-close"
                  onClick={() => setDetailModal({ visible: false })}
                >
                  ✕
                </button>

                <h3>詳細情報</h3>

                {detailModal.group ? (
                  // シャーシカード（C or A+C）の詳細
                  detailModal.group.container ? (
                    // A+Cの詳細
                    <div className="detail-content">
                      <div className="detail-section">
                        <h4>📦 コンテナ情報</h4>
                        <p>
                          <strong>日付:</strong>{" "}
                          {detailModal.group.container.date}
                        </p>
                        <p>
                          <strong>時間:</strong>{" "}
                          {detailModal.group.container.eta}
                        </p>
                        <p>
                          <strong>配送先:</strong>{" "}
                          {detailModal.group.container.destination}
                        </p>
                        <p>
                          <strong>搬出ヤード:</strong>{" "}
                          {detailModal.group.container.pickupYard}
                        </p>
                        <p>
                          <strong>搬入ヤード:</strong>{" "}
                          {detailModal.group.container.dropoffYard}
                        </p>
                        <p>
                          <strong>コンテナ番号:</strong>{" "}
                          {detailModal.group.container.no}
                        </p>
                        <p>
                          <strong>サイズ:</strong>{" "}
                          {detailModal.group.container.size}F
                        </p>
                        <p>
                          <strong>種別:</strong>{" "}
                          {detailModal.group.container.kindCode}
                        </p>
                        {detailModal.group.container.ship && (
                          <p>
                            <strong>本船名:</strong>{" "}
                            {detailModal.group.container.ship}
                          </p>
                        )}
                        {detailModal.group.container.booking && (
                          <p>
                            <strong>BL/BK:</strong>{" "}
                            {detailModal.group.container.booking}
                          </p>
                        )}
                        {detailModal.group.container.destadd && (
                          <p>
                            <strong>配送先住所:</strong>{" "}
                            {detailModal.group.container.destadd}
                          </p>
                        )}
                        {detailModal.group.container.desttel && (
                          <p>
                            <strong>配送先TEL:</strong>{" "}
                            {detailModal.group.container.desttel}
                          </p>
                        )}
                        {detailModal.group.container.handoverNo && (
                          <p>
                            <strong>引渡番号:</strong>{" "}
                            {detailModal.group.container.handoverNo}
                          </p>
                        )}
                      </div>

                      <hr />

                      <div className="detail-section">
                        <h4>🛞 シャーシ情報</h4>
                        <p>
                          <strong>シャーシ番号:</strong>{" "}
                          {detailModal.group.chassisLabel}
                        </p>
                        <p>
                          <strong>車番:</strong>{" "}
                          {detailModal.group.extra?.carNo || "-"}
                        </p>
                        <p>
                          <strong>サイズ:</strong>{" "}
                          {detailModal.group.extra?.sizeLabel || "-"}
                        </p>
                        <p>
                          <strong>軸種別:</strong>{" "}
                          {detailModal.group.extra?.kindLabel || "-"}
                        </p>
                        {detailModal.group.extra?.note && (
                          <p>
                            <strong>備考:</strong>{" "}
                            {detailModal.group.extra.note}
                          </p>
                        )}
                      </div>
                    </div>
                  ) : (
                    // Cだけの詳細
                    <div className="detail-content">
                      <div className="detail-section">
                        <h4>🛞 シャーシ情報</h4>
                        <p>
                          <strong>シャーシ番号:</strong>{" "}
                          {detailModal.group.chassisLabel}
                        </p>
                        <p>
                          <strong>車番:</strong>{" "}
                          {detailModal.group.extra?.carNo || "-"}
                        </p>
                        <p>
                          <strong>サイズ:</strong>{" "}
                          {detailModal.group.extra?.sizeLabel || "-"}
                        </p>
                        <p>
                          <strong>軸種別:</strong>{" "}
                          {detailModal.group.extra?.kindLabel || "-"}
                        </p>
                        {detailModal.group.extra?.note && (
                          <p>
                            <strong>備考:</strong>{" "}
                            {detailModal.group.extra.note}
                          </p>
                        )}
                      </div>
                    </div>
                  )
                ) : detailModal.container ? (
                  // コンテナ単体（A）の詳細
                  <div className="detail-content">
                    <div className="detail-section">
                      <h4>📦 コンテナ情報</h4>
                      <p>
                        <strong>日付:</strong> {detailModal.container.date}
                      </p>
                      <p>
                        <strong>時間:</strong> {detailModal.container.eta}
                      </p>
                      <p>
                        <strong>配送先:</strong>{" "}
                        {detailModal.container.destination}
                      </p>
                      <p>
                        <strong>搬出ヤード:</strong>{" "}
                        {detailModal.container.pickupYard}
                      </p>
                      <p>
                        <strong>搬入ヤード:</strong>{" "}
                        {detailModal.container.dropoffYard}
                      </p>
                      <p>
                        <strong>コンテナ番号:</strong>{" "}
                        {detailModal.container.no}
                      </p>
                      <p>
                        <strong>サイズ:</strong> {detailModal.container.size}F
                      </p>
                      <p>
                        <strong>種別:</strong> {detailModal.container.kindCode}
                      </p>
                      {detailModal.container.ship && (
                        <p>
                          <strong>本船名:</strong> {detailModal.container.ship}
                        </p>
                      )}
                      {detailModal.container.booking && (
                        <p>
                          <strong>BL/BK:</strong>{" "}
                          {detailModal.container.booking}
                        </p>
                      )}
                      {detailModal.container.destadd && (
                        <p>
                          <strong>配送先住所:</strong>{" "}
                          {detailModal.container.destadd}
                        </p>
                      )}
                      {detailModal.container.desttel && (
                        <p>
                          <strong>配送先TEL:</strong>{" "}
                          {detailModal.container.desttel}
                        </p>
                      )}
                      {detailModal.container.handoverNo && (
                        <p>
                          <strong>引渡番号:</strong>{" "}
                          {detailModal.container.handoverNo}
                        </p>
                      )}
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          )}
        </div>
      </div>
    </DisplayModeContext.Provider>
  );
}

export default App;
