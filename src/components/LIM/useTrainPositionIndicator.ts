import * as React from "react";

type ReferenceMode = "HORAIRE" | "GPS";
type GpsStateUi = "RED" | "ORANGE" | "GREEN";

type GpsPositionLike = { pk?: number | null } | null;

type UseTrainPositionIndicatorArgs = {
  // DOM
  scrollContainerRef: React.RefObject<HTMLElement>;

  // état "ligne active" (fallback)
  activeRowIndex: number;

  // mode / état
  gpsStateUi: GpsStateUi;
  referenceModeRef: React.MutableRefObject<ReferenceMode>;
  autoScrollEnabledRef: React.MutableRefObject<boolean>;

  // base horaire (si auto scroll)
  autoScrollBaseRef: React.MutableRefObject<{
    realMinInt: number;
    realMinFloat: number;
    firstHoraMin: number;
    fixedDelay: number;
    deltaSec: number;
  } | null>;

  // dernière position GPS (pour pk)
  lastGpsPositionRef: React.MutableRefObject<GpsPositionLike>;

  // extraction des infos depuis une ligne DOM (pour être réutilisable ES/FR)
  getPkFromRow?: (tr: HTMLTableRowElement) => number | null;
  getMinutesFromRow?: (tr: HTMLTableRowElement) => number | null;

  tickMs?: number;
};

export function useTrainPositionIndicator({
  scrollContainerRef,
  activeRowIndex,
  gpsStateUi,
  referenceModeRef,
  autoScrollEnabledRef,
  autoScrollBaseRef,
  lastGpsPositionRef,
  getPkFromRow,
  getMinutesFromRow,
  tickMs = 250,
}: UseTrainPositionIndicatorArgs) {
  const [trainPosYpx, setTrainPosYpx] = React.useState<number | null>(null);

  // --- Continuité ORANGE -> RED (ancrage visuel) + anti-retour arrière en RED ---
  const lastTrainPosYpxRef = React.useRef<number | null>(null);
  const prevGpsStateUiRef = React.useRef<GpsStateUi>("RED");

  // Pendant RED : offset pour partir exactement du Y courant
  const redHoraireAnchorRef = React.useRef<{
    anchorY: number;
    baseHoraireY: number;
    offsetY: number;
  } | null>(null);

  const defaultGetPkFromRow = React.useCallback((tr: HTMLTableRowElement) => {
    // FT Espagne : PK en 3e colonne
    const td = tr.querySelector<HTMLTableCellElement>("td:nth-child(3)");
    const txt = td?.textContent?.trim() ?? "";
    const pk = Number(txt.replace(",", "."));
    return Number.isFinite(pk) ? pk : null;
  }, []);

  const defaultGetMinutesFromRow = React.useCallback((tr: HTMLTableRowElement) => {
    // FT Espagne : heure en 6e colonne (depart sinon theo)
    const dep = tr.querySelector<HTMLSpanElement>("td:nth-child(6) .ft-hora-depart");
    const theo = tr.querySelector<HTMLSpanElement>("td:nth-child(6) .ft-hora-theo");
    const txt = ((dep?.textContent ?? theo?.textContent) ?? "").trim();

    const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(txt);
    if (!m) return null;

    const hh = Number(m[1]);
    const mm = Number(m[2]);
    const ss = m[3] != null ? Number(m[3]) : 0;

    if (!Number.isFinite(hh) || !Number.isFinite(mm) || !Number.isFinite(ss)) return null;
    return hh * 60 + mm + ss / 60;
  }, []);

  const getPk = getPkFromRow ?? defaultGetPkFromRow;
  const getMin = getMinutesFromRow ?? defaultGetMinutesFromRow;

  React.useEffect(() => {
    const VISUAL_OFFSET_PX = -2;

    const commitTrainPos = (yCandidate: number | null) => {
      if (yCandidate == null) return;

      const yRounded = Math.round(yCandidate);
      const gpsStateNow = gpsStateUi;

      setTrainPosYpx((prev) => {
        let next = yRounded;

        // ✅ En RED : jamais de retour arrière (monotone)
        if (gpsStateNow === "RED" && prev != null) {
          next = Math.max(prev, next);
        }

        lastTrainPosYpxRef.current = next;
        return next;
      });
    };

    const tick = () => {
      const container = scrollContainerRef.current;
      if (!container) return;

      const h = (container as any).clientHeight as number;

      // Détection entrée/sortie RED (ancrage)
      const gpsStateNow = gpsStateUi;
      const prevGpsState = prevGpsStateUiRef.current;

      if (prevGpsState !== gpsStateNow) {
        if (gpsStateNow === "RED") {
          const anchorY = lastTrainPosYpxRef.current;
          if (anchorY != null) {
            redHoraireAnchorRef.current = {
              anchorY,
              baseHoraireY: anchorY,
              offsetY: 0,
            };
          } else {
            redHoraireAnchorRef.current = null;
          }
        } else {
          redHoraireAnchorRef.current = null;
        }

        prevGpsStateUiRef.current = gpsStateNow;
      }

      // =========================
      // 1) GPS : interpolation PK (DOM)
      // =========================
      if (referenceModeRef.current === "GPS") {
        const pkRaw = (lastGpsPositionRef.current as any)?.pk;
        const pkTrain = typeof pkRaw === "number" && Number.isFinite(pkRaw) ? pkRaw : null;

        if (pkTrain != null) {
          const rows = Array.from(
            container.querySelectorAll<HTMLTableRowElement>("tr.ft-row-main")
          );

          const pts: { pk: number; y: number }[] = [];
          for (const tr of rows) {
            const pk = getPk(tr);
            if (pk == null) continue;

            const y =
              tr.offsetTop +
              tr.offsetHeight / 2 -
              (container as any).scrollTop +
              VISUAL_OFFSET_PX;

            if (y < 0 || y > h) continue;
            pts.push({ pk, y });
          }

          if (pts.length >= 2) {
            pts.sort((a, b) => a.pk - b.pk);

            let a = pts[0];
            let b = pts[pts.length - 1];

            for (let i = 0; i < pts.length - 1; i++) {
              const p0 = pts[i];
              const p1 = pts[i + 1];
              if (pkTrain >= p0.pk && pkTrain <= p1.pk) {
                a = p0;
                b = p1;
                break;
              }
            }

            if (b.pk !== a.pk) {
              let t = (pkTrain - a.pk) / (b.pk - a.pk);
              if (t < 0) t = 0;
              if (t > 1) t = 1;
              commitTrainPos(a.y + t * (b.y - a.y));
              return;
            } else {
              commitTrainPos(a.y);
              return;
            }
          }
        }
      }

      // =========================================
      // 2) HORAIRE : interpolation temps (DOM)
      // =========================================
      if (referenceModeRef.current === "HORAIRE" && autoScrollEnabledRef.current) {
        const base = autoScrollBaseRef.current;
        if (base) {
          const now = new Date();
          const nowMinFloat =
            now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60;

          const effectiveMinFloat =
            base.firstHoraMin + (nowMinFloat - (base.realMinFloat ?? base.realMinInt));

          const rows = Array.from(
            container.querySelectorAll<HTMLTableRowElement>("tr.ft-row-main")
          );

          const pts: { m: number; y: number }[] = [];
          for (const tr of rows) {
            const m = getMin(tr);
            if (m == null) continue;

            const y =
              tr.offsetTop +
              tr.offsetHeight / 2 -
              (container as any).scrollTop +
              VISUAL_OFFSET_PX;

            if (y < 0 || y > h) continue;
            pts.push({ m, y });
          }

          if (pts.length >= 2) {
            pts.sort((a, b) => a.m - b.m);

            let a = pts[0];
            let b = pts[pts.length - 1];

            for (let i = 0; i < pts.length - 1; i++) {
              const p0 = pts[i];
              const p1 = pts[i + 1];
              if (effectiveMinFloat >= p0.m && effectiveMinFloat <= p1.m) {
                a = p0;
                b = p1;
                break;
              }
            }

            const yHoraireRaw =
              b.m !== a.m
                ? a.y +
                  Math.min(1, Math.max(0, (effectiveMinFloat - a.m) / (b.m - a.m))) *
                    (b.y - a.y)
                : a.y;

            let yFinal = yHoraireRaw;

            // ancrage en RED
            if (gpsStateUi === "RED") {
              const lastY = lastTrainPosYpxRef.current;

              if (redHoraireAnchorRef.current == null && lastY != null) {
                redHoraireAnchorRef.current = {
                  anchorY: lastY,
                  baseHoraireY: yHoraireRaw,
                  offsetY: lastY - yHoraireRaw,
                };
              }

              if (redHoraireAnchorRef.current != null) {
                if (redHoraireAnchorRef.current.offsetY === 0 && lastY != null) {
                  redHoraireAnchorRef.current.baseHoraireY = yHoraireRaw;
                  redHoraireAnchorRef.current.offsetY =
                    redHoraireAnchorRef.current.anchorY - yHoraireRaw;
                }

                yFinal = yHoraireRaw + redHoraireAnchorRef.current.offsetY;
              }
            }

            commitTrainPos(yFinal);
            return;
          }
        }
      }

      // =========================
      // 3) fallback : ligne active
      // =========================
      const tr = container.querySelector<HTMLTableRowElement>(
        `tr.ft-row-main[data-ft-row="${activeRowIndex}"]`
      );
      if (!tr) return;

      const y =
        tr.offsetTop +
        tr.offsetHeight / 2 -
        (container as any).scrollTop +
        VISUAL_OFFSET_PX;

      const clamped = Math.max(0, Math.min(y, h));
      commitTrainPos(clamped);
    };

    tick();
    const id = window.setInterval(tick, tickMs);
    return () => window.clearInterval(id);
  }, [
    activeRowIndex,
    gpsStateUi,
    referenceModeRef,
    autoScrollEnabledRef,
    autoScrollBaseRef,
    lastGpsPositionRef,
    scrollContainerRef,
    getPk,
    getMin,
    tickMs,
  ]);

  const getFallbackTrainTopPx = React.useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return "40vh";

    const row = container.querySelector<HTMLTableRowElement>(
      `tr.ft-row-main[data-ft-row="${activeRowIndex}"]`
    );
    if (!row) return "40vh";

    const VISUAL_OFFSET_PX = -2;
    const y =
      row.offsetTop +
      row.offsetHeight / 2 -
      (container as any).scrollTop +
      VISUAL_OFFSET_PX;

    const h = (container as any).clientHeight as number;
    const clamped = Math.max(0, Math.min(y, h));
    return `${Math.round(clamped)}px`;
  }, [scrollContainerRef, activeRowIndex]);

  return { trainPosYpx, getFallbackTrainTopPx };
}
