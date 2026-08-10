import { useCallback, useEffect, useRef, useState } from "react";

export type PipSection = "chassis" | "drivers" | "delivery";

export type PipSize = { w: number; h: number };

export function isPipSupported(): boolean {
  return typeof window !== "undefined" && "documentPictureInPicture" in window;
}

// メイン document のスタイルシートを PiP window の document へコピー。
//   - <link rel="stylesheet"> はそのまま cloneNode で複製
//   - <style> は textContent を新規要素に流し込み
//   - Vite dev の HMR で追加されるスタイルも初回コピーで拾える (以後の更新は反映不可、
//     dev の話。本番 build 時は 1 個の CSS ファイルにまとまるので問題なし)
function copyStyles(srcDoc: Document, destDoc: Document): void {
  const links = Array.from(srcDoc.querySelectorAll('link[rel="stylesheet"]'));
  links.forEach((link) => {
    const clone = link.cloneNode(true) as HTMLLinkElement;
    destDoc.head.appendChild(clone);
  });
  const styles = Array.from(srcDoc.querySelectorAll("style"));
  styles.forEach((style) => {
    const clone = destDoc.createElement("style");
    clone.textContent = style.textContent || "";
    destDoc.head.appendChild(clone);
  });
  // 背景色を継承 (bodyのstyleがなくても最低限見える)
  destDoc.body.style.margin = "0";
  destDoc.body.style.background =
    getComputedStyle(srcDoc.body).background || "#f3f4f6";
}

export type PipStateInfo = {
  pipWindow: Window | null;
  pipSection: PipSection | null;
};

/**
 * Document Picture-in-Picture 用フック。
 *
 * onClose には閉じた瞬間の窓サイズが渡される。呼び出し側で board_state に保存する想定。
 * 一度に開ける PiP 窓は 1 つのみ (Document PiP 仕様の制約)。
 */
export function useDocumentPip(opts: {
  onClose?: (section: PipSection, size: PipSize) => void;
}) {
  const [pipWindow, setPipWindow] = useState<Window | null>(null);
  const [pipSection, setPipSection] = useState<PipSection | null>(null);
  const onCloseRef = useRef(opts.onClose);
  useEffect(() => {
    onCloseRef.current = opts.onClose;
  }, [opts.onClose]);

  // アンマウント時に窓を閉じる
  useEffect(() => {
    return () => {
      if (pipWindow) {
        try {
          pipWindow.close();
        } catch {
          /* ignore */
        }
      }
    };
  }, [pipWindow]);

  const openPip = useCallback(
    async (section: PipSection, initialSize?: PipSize) => {
      if (!isPipSupported()) return null;
      // 既存の窓があれば閉じてから開く (Document PiP は 1 窓仕様)
      if (pipWindow) {
        try {
          pipWindow.close();
        } catch {
          /* ignore */
        }
      }
      try {
        // width/height は数値 (Document PiP 仕様)
        const w: Window = await (
          window as unknown as {
            documentPictureInPicture: {
              requestWindow: (o: { width: number; height: number }) => Promise<Window>;
            };
          }
        ).documentPictureInPicture.requestWindow({
          width: Math.round(Math.max(320, initialSize?.w ?? 640)),
          height: Math.round(Math.max(240, initialSize?.h ?? 480)),
        });

        copyStyles(document, w.document);
        w.document.title =
          section === "chassis"
            ? "シャーシプール"
            : section === "drivers"
              ? "ドライバー"
              : "配送分";

        const handlePageHide = () => {
          const size: PipSize = { w: w.innerWidth, h: w.innerHeight };
          setPipWindow(null);
          setPipSection(null);
          try {
            onCloseRef.current?.(section, size);
          } catch (err) {
            console.error("[pip] onClose error", err);
          }
        };
        w.addEventListener("pagehide", handlePageHide, { once: true });

        setPipWindow(w);
        setPipSection(section);
        return w;
      } catch (err) {
        console.error("[pip] requestWindow failed", err);
        return null;
      }
    },
    [pipWindow],
  );

  const closePip = useCallback(() => {
    if (pipWindow) {
      try {
        pipWindow.close();
      } catch {
        /* ignore */
      }
    }
  }, [pipWindow]);

  return {
    pipWindow,
    pipSection,
    openPip,
    closePip,
    supported: isPipSupported(),
  };
}
