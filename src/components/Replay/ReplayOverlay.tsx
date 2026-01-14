// src/components/Replay/ReplayOverlay.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";

type Pos = { x: number; y: number };

const POS_KEY = "limgpt:replayOverlayPos";

// OVH endpoints
const LIST_LOGS_URL = "https://radioequinoxe.com/limgpt/replay_list_logs.php";
const REPLAY_GET_URL = "https://radioequinoxe.com/limgpt/replay_get.php?f=";

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

function readPos(): Pos {
  try {
    const raw = localStorage.getItem(POS_KEY);
    if (!raw) return { x: 12, y: 72 };
    const obj = JSON.parse(raw);
    const x = Number(obj?.x);
    const y = Number(obj?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return { x: 12, y: 72 };
    return { x, y };
  } catch {
    return { x: 12, y: 72 };
  }
}

function writePos(p: Pos) {
  try {
    localStorage.setItem(POS_KEY, JSON.stringify(p));
  } catch {}
}

type RemoteLogItem = { name: string; mtime?: number; size?: number };

function fmtBytes(n?: number) {
  if (!n || !Number.isFinite(n) || n <= 0) return "—";
  const units = ["B", "KB", "MB", "GB"];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  const digits = i === 0 ? 0 : i === 1 ? 0 : 1;
  return `${v.toFixed(digits)} ${units[i]}`;
}

function fmtDate(ts?: number) {
  if (!ts || !Number.isFinite(ts) || ts <= 0) return "—";
  // ts vient de PHP filemtime() -> secondes
  const d = new Date(ts * 1000);
  // affichage compact local
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")} ${String(
    d.getHours()
  ).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export default function ReplayOverlay() {
  // visible uniquement en simulation
  const [simulationEnabled, setSimulationEnabled] = useState(false);

  useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent;
      setSimulationEnabled(!!ce?.detail?.enabled);
    };
    window.addEventListener("sim:enable", handler as EventListener);
    return () => window.removeEventListener("sim:enable", handler as EventListener);
  }, []);

  // position draggable
  const [pos, setPos] = useState<Pos>(() => readPos());
  const posRef = useRef<Pos>(pos);
  useEffect(() => {
    posRef.current = pos;
  }, [pos]);

  // status/cursor rafraîchis pendant l’affichage
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!simulationEnabled) return;
    const id = window.setInterval(() => setTick((t) => t + 1), 400);
    return () => window.clearInterval(id);
  }, [simulationEnabled]);

  const playerApi = useMemo(() => {
    // bootstrap App.tsx expose window.__limgptReplay
    return (window as any).__limgptReplay as
      | {
          loadUrl?: (u: string) => Promise<void>;
          play?: () => void;
          pause?: () => void;
          stop?: () => void;
          seek?: (tMs: number) => void;
          status?: () => string;
          cursor?: () => { idx: number; tMs: number };
          durationMs?: () => number;
          startIso?: () => string | null;
          nowIso?: () => string | null;
          error?: () => any;
        }
      | undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, simulationEnabled]);

  // drag state
  const draggingRef = useRef(false);
  const dragOffsetRef = useRef<{ dx: number; dy: number }>({ dx: 0, dy: 0 });
  const overlayRef = useRef<HTMLDivElement | null>(null);

  const activePointerIdRef = useRef<number | null>(null);

  const startDrag = (clientX: number, clientY: number) => {
    draggingRef.current = true;

    const rect = overlayRef.current?.getBoundingClientRect();
    const ox = rect ? clientX - rect.left : 0;
    const oy = rect ? clientY - rect.top : 0;
    dragOffsetRef.current = { dx: ox, dy: oy };
  };

  const moveDrag = (clientX: number, clientY: number) => {
    if (!draggingRef.current) return;

    const { dx, dy } = dragOffsetRef.current;

    let x = clientX - dx;
    let y = clientY - dy;

    const vw = window.innerWidth;
    const vh = window.innerHeight;

    const w = overlayRef.current?.offsetWidth ?? 360;
    const h = overlayRef.current?.offsetHeight ?? 140;

    x = clamp(x, 0, Math.max(0, vw - w));
    y = clamp(y, 0, Math.max(0, vh - h));

    const next = { x, y };
    setPos(next);
    posRef.current = next; // ✅ pour sauvegarde immédiate au release
  };

  const endDrag = () => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    activePointerIdRef.current = null;
    writePos(posRef.current);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    // démarrage drag uniquement sur la barre
    activePointerIdRef.current = e.pointerId;
    startDrag(e.clientX, e.clientY);

    // Capture au niveau window : on force la réception des move/up même si le pointeur sort de la barre
    window.addEventListener("pointermove", onWindowPointerMove);
    window.addEventListener("pointerup", onWindowPointerUp);
    window.addEventListener("pointercancel", onWindowPointerUp);

    // éviter la sélection de texte
    e.preventDefault();
  };

  const onWindowPointerMove = (e: PointerEvent) => {
    if (activePointerIdRef.current == null) return;
    if (e.pointerId !== activePointerIdRef.current) return;
    moveDrag(e.clientX, e.clientY);
  };

  const onWindowPointerUp = (e: PointerEvent) => {
    if (activePointerIdRef.current == null) return;
    if (e.pointerId !== activePointerIdRef.current) return;

    window.removeEventListener("pointermove", onWindowPointerMove);
    window.removeEventListener("pointerup", onWindowPointerUp);
    window.removeEventListener("pointercancel", onWindowPointerUp);

    endDrag();
  };

  // ---------------- Picker logs (modal) ----------------
  const [pickerOpen, setPickerOpen] = useState(false);
  const [logs, setLogs] = useState<RemoteLogItem[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [logsError, setLogsError] = useState<string | null>(null);
  const [selectedLog, setSelectedLog] = useState<string>("");

  const openPicker = async () => {
    setPickerOpen(true);
    setLogsError(null);
    setLogsLoading(true);

    try {
      const res = await fetch(LIST_LOGS_URL, { method: "GET" });
      const json = await res.json();

      if (!Array.isArray(json)) {
        throw new Error("Bad response (not array)");
      }

      const items: RemoteLogItem[] = json
        .map((x: any) => ({
          name: typeof x?.name === "string" ? x.name : "",
          mtime: typeof x?.mtime === "number" ? x.mtime : undefined,
          size: typeof x?.size === "number" ? x.size : undefined,
        }))
        .filter((x) => x.name.toLowerCase().endsWith(".pdf"));

      // tri sécurité (mtime desc)
      items.sort((a, b) => (Number(b.mtime || 0) - Number(a.mtime || 0)));

      setLogs(items);
      if (!selectedLog && items[0]?.name) setSelectedLog(items[0].name);
    } catch (err: any) {
      setLogs([]);
      setLogsError(err?.message ? String(err.message) : String(err));
    } finally {
      setLogsLoading(false);
    }
  };

  const confirmLoadSelected = async () => {
    const name = (selectedLog || "").trim();
    if (!name) return;

    const url = REPLAY_GET_URL + encodeURIComponent(name);

    try {
      await playerApi?.loadUrl?.(url);
      setTick((v) => v + 1);
      setPickerOpen(false);
    } catch (err) {
      console.warn("[replay-overlay] load failed", err);
      setLogsError("Load failed (voir console)");
    }
  };

  // ---------------- Timeline (verticale + horizontale) ----------------
  // Verticale (existante)
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [scrubMs, setScrubMs] = useState<number | null>(null);

  // Horizontale (précision)
  const [isHScrubbing, setIsHScrubbing] = useState(false);
  const [hScrubMs, setHScrubMs] = useState<number | null>(null);

  // Fenêtre affichée (zoom) : [viewStartMs ; viewEndMs]
  const [viewStartMs, setViewStartMs] = useState(0);
  const [viewSpanMs, setViewSpanMs] = useState<number>(0); // 0 => auto (durée totale)

  // Recalage automatique quand un log est chargé (durée connue)
  useEffect(() => {
    if (!simulationEnabled) return;

    const dur = playerApi?.durationMs?.();
    if (!dur || !Number.isFinite(dur) || dur <= 0) return;

    // si viewSpanMs est 0, on reste en "vue totale"
    if (viewSpanMs === 0) {
      setViewStartMs(0);
      return;
    }

    // si on est zoomé, on borne la fenêtre pour rester dans [0..dur]
    setViewStartMs((s) => clamp(s, 0, Math.max(0, dur - viewSpanMs)));
  }, [simulationEnabled, tick, viewSpanMs, playerApi]);

  // Si on est zoomé, la fenêtre (horizontale) suit automatiquement le curseur
  useEffect(() => {
    if (!simulationEnabled) return;

    const dur = playerApi?.durationMs?.() ?? 0;
    if (!dur || !Number.isFinite(dur) || dur <= 0) return;

    if (viewSpanMs === 0) return; // en vue totale, pas de fenêtre à recaler

    const c = playerApi?.cursor?.();
    if (!c || !Number.isFinite(c.tMs)) return;

    const span = Math.min(dur, viewSpanMs);
    const start = clamp(c.tMs - span / 2, 0, Math.max(0, dur - span));
    setViewStartMs(start);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [simulationEnabled, tick, viewSpanMs, playerApi]);

  const status = playerApi?.status?.() ?? "n/a";

  const cursor = (() => {
    try {
      const c = playerApi?.cursor?.();
      return c ? `${c.idx} @ ${Math.round(c.tMs)}ms` : "n/a";
    } catch {
      return "n/a";
    }
  })();

  if (!simulationEnabled) return null;

  return (
    <div
      ref={overlayRef}
      style={{
        position: "fixed",
        left: pos.x,
        top: pos.y,
        zIndex: 99999,
        width: "min(720px, calc(100vw - 16px))",
        pointerEvents: "auto",
      }}
    >
      <div
        style={{
          borderRadius: 14,
          border: "2px solid rgba(0,0,0,0.85)",
          background: "rgba(255,255,255,0.94)",
          boxShadow: "0 10px 22px rgba(0,0,0,0.35)",
          overflow: "hidden",
        }}
        className="dark:border-white dark:bg-black/70"
      >
        {/* barre draggable */}
        <div
          onPointerDown={onPointerDown}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 10,
            padding: "8px 10px",
            cursor: "grab",
            userSelect: "none",
            touchAction: "none", // ✅ empêche le navigateur de “voler” le drag
            borderBottom: "1px solid rgba(0,0,0,0.2)",
          }}
          className="dark:border-white/20"
          title="Glisser pour déplacer"
        >
          <div style={{ display: "flex", gap: 10, alignItems: "baseline" }}>
            <strong style={{ fontSize: 12 }}>REPLAY</strong>
            <span style={{ fontSize: 11, opacity: 0.8 }}>
              status: <b>{status}</b> · cursor: <b>{cursor}</b>
              {" · "}
              view:{" "}
              <b>
                {Math.round(viewStartMs)} →{" "}
                {Math.round(
                  viewStartMs +
                    (viewSpanMs === 0 ? playerApi?.durationMs?.() ?? 0 : viewSpanMs)
                )}
                ms
              </b>
              {" · span: "}
              <b>{viewSpanMs === 0 ? "TOTAL" : `${Math.round(viewSpanMs)}ms`}</b>
            </span>
          </div>

          <button
            type="button"
            onClick={() => {
              // reset position
              const p = { x: 12, y: 72 };
              setPos(p);
              writePos(p);
            }}
            style={{
              fontSize: 11,
              fontWeight: 800,
              borderRadius: 10,
              border: "2px solid currentColor",
              padding: "4px 8px",
              background: "transparent",
            }}
          >
            Reset pos
          </button>
        </div>

        {/* contenu */}
        <div style={{ padding: "10px" }}>
          {/* ligne principale: boutons + timeline verticale */}
          <div style={{ display: "flex", gap: 10, alignItems: "stretch" }}>
            {/* zone contrôles */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                <button
                  type="button"
                  onClick={openPicker}
                  style={{
                    fontSize: 11,
                    fontWeight: 900,
                    borderRadius: 10,
                    border: "2px solid currentColor",
                    padding: "6px 10px",
                    background: "transparent",
                  }}
                  title="Charger un log distant"
                >
                  Load
                </button>

                <button
                  type="button"
                  onClick={() => playerApi?.play?.()}
                  style={{
                    fontSize: 11,
                    fontWeight: 900,
                    borderRadius: 10,
                    border: "2px solid currentColor",
                    padding: "6px 10px",
                    background: "transparent",
                  }}
                >
                  Play
                </button>

                <button
                  type="button"
                  onClick={() => playerApi?.pause?.()}
                  style={{
                    fontSize: 11,
                    fontWeight: 900,
                    borderRadius: 10,
                    border: "2px solid currentColor",
                    padding: "6px 10px",
                    background: "transparent",
                  }}
                >
                  Pause
                </button>

                <button
                  type="button"
                  onClick={() => playerApi?.stop?.()}
                  style={{
                    fontSize: 11,
                    fontWeight: 900,
                    borderRadius: 10,
                    border: "2px solid currentColor",
                    padding: "6px 10px",
                    background: "transparent",
                  }}
                >
                  Stop
                </button>
              </div>

              {/* zoom controls */}
              <div style={{ marginTop: 8, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <span style={{ fontSize: 11, opacity: 0.85 }}>
                  Timeline:{" "}
                  <b>
                    {viewSpanMs === 0
                      ? "totale"
                      : `zoom x${Math.max(1, Math.round((playerApi?.durationMs?.() || 1) / viewSpanMs))}`}
                  </b>
                </span>

                <button
                  type="button"
                  onClick={() => {
                    const dur = playerApi?.durationMs?.() ?? 0;
                    if (!dur || !Number.isFinite(dur) || dur <= 0) return;

                    // zoom IN: on réduit la fenêtre (horizontale)
                    setViewSpanMs((prev) => {
                      const base = prev === 0 ? dur : prev;
                      const next = Math.max(5_000, Math.round(base / 2));
                      const c = playerApi?.cursor?.();
                      const center = c ? c.tMs : 0;
                      const start = clamp(center - next / 2, 0, Math.max(0, dur - next));
                      setViewStartMs(start);
                      return next;
                    });
                  }}
                  style={{
                    fontSize: 11,
                    fontWeight: 900,
                    borderRadius: 10,
                    border: "2px solid currentColor",
                    padding: "4px 10px",
                    background: "transparent",
                  }}
                  title="Zoom +"
                >
                  +
                </button>

                <button
                  type="button"
                  onClick={() => {
                    const dur = playerApi?.durationMs?.() ?? 0;
                    if (!dur || !Number.isFinite(dur) || dur <= 0) return;

                    // zoom OUT: on agrandit la fenêtre (jusqu’à totale)
                    setViewSpanMs((prev) => {
                      if (prev === 0) return 0;
                      const next = Math.min(dur, Math.round(prev * 2));
                      if (next >= dur) {
                        setViewStartMs(0);
                        return 0;
                      }
                      const c = playerApi?.cursor?.();
                      const center = c ? c.tMs : 0;
                      const start = clamp(center - next / 2, 0, Math.max(0, dur - next));
                      setViewStartMs(start);
                      return next;
                    });
                  }}
                  style={{
                    fontSize: 11,
                    fontWeight: 900,
                    borderRadius: 10,
                    border: "2px solid currentColor",
                    padding: "4px 10px",
                    background: "transparent",
                  }}
                  title="Zoom -"
                >
                  −
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setViewSpanMs(0);
                    setViewStartMs(0);
                  }}
                  style={{
                    fontSize: 11,
                    fontWeight: 900,
                    borderRadius: 10,
                    border: "2px solid currentColor",
                    padding: "4px 10px",
                    background: "transparent",
                  }}
                  title="Vue totale"
                >
                  1:1
                </button>
              </div>

              {/* timeline horizontale (précision) — bloc pleine largeur */}
              <div style={{ marginTop: 10, width: "100%" }}>
                {(() => {
                  const dur = playerApi?.durationMs?.() ?? 0;
                  const startIso = playerApi?.startIso?.() ?? null;

                  const fmtRelHMS = (ms: number) => {
                    const s = Math.max(0, Math.round(ms / 1000));
                    const hh = Math.floor(s / 3600);
                    const mm = Math.floor((s % 3600) / 60);
                    const ss = s % 60;
                    return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
                  };

                  const fmtAbs = (ms: number) => {
                    if (!startIso) return null;
                    const base = Date.parse(startIso);
                    if (!Number.isFinite(base)) return null;
                    return new Date(base + ms).toISOString().slice(11, 19);
                  };

                  // Fenêtre micro
                  const spanWin = viewSpanMs === 0 ? dur : Math.min(dur, viewSpanMs);
                  const winStart = clamp(viewStartMs, 0, Math.max(0, dur - spanWin));
                  const winEnd = winStart + spanWin;

                  const c = playerApi?.cursor?.();
                  const currentMs = c ? c.tMs : 0;
                  const currentClamped = clamp(currentMs, winStart, winEnd);
                  const ratio = spanWin > 0 ? (currentClamped - winStart) / spanWin : 0;
                  const knobLeftPct = clamp(ratio * 100, 0, 100);

                  const handleHScrub = (clientX: number, el: HTMLElement) => {
                    const rect = el.getBoundingClientRect();
                    const x = clamp(clientX - rect.left, 0, rect.width);
                    const r = rect.width > 0 ? x / rect.width : 0;
                    const tInt = Math.round(winStart + r * spanWin);

                    setIsHScrubbing(true);
                    setHScrubMs(tInt);
                    playerApi?.seek?.(tInt);
                    setTick((v) => v + 1);
                  };

                  return (
                    <div style={{ width: "100%" }}>
                      {/* repères globaux (0 — durée totale) */}
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, opacity: 0.85 }}>
                        <span>0</span>
                        <span>{dur > 0 ? fmtRelHMS(dur) : "—"}</span>
                      </div>

                      <div
                        style={{
                          height: 14,
                          width: "100%",
                          borderRadius: 999,
                          border: "2px solid currentColor",
                          position: "relative",
                          cursor: "pointer",
                          userSelect: "none",
                          touchAction: "none",
                        }}
                        title="Timeline précision (drag pour seek dans la fenêtre)"
                        onPointerDown={(e) => {
                          const el = e.currentTarget as HTMLElement;
                          el.setPointerCapture(e.pointerId);
                          handleHScrub(e.clientX, el);
                        }}
                        onPointerMove={(e) => {
                          if (!isHScrubbing) return;
                          const el = e.currentTarget as HTMLElement;
                          handleHScrub(e.clientX, el);
                        }}
                        onPointerUp={(e) => {
                          const el = e.currentTarget as HTMLElement;
                          try {
                            el.releasePointerCapture(e.pointerId);
                          } catch {}
                          setIsHScrubbing(false);
                          setHScrubMs(null);
                        }}
                        onPointerCancel={() => {
                          setIsHScrubbing(false);
                          setHScrubMs(null);
                        }}
                      >
                        <div
                          style={{
                            position: "absolute",
                            top: "50%",
                            left: `${knobLeftPct}%`,
                            transform: "translate(-50%, -50%)",
                            width: 8,
                            height: 18,
                            borderRadius: 999,
                            background: "currentColor",
                            opacity: 0.85,
                          }}
                        />

                        {isHScrubbing && hScrubMs != null && (
                          <div
                            style={{
                              position: "absolute",
                              left: `${clamp(((hScrubMs - winStart) / Math.max(1, spanWin)) * 100, 0, 100)}%`,
                              top: "-8px",
                              transform: "translate(-50%, -100%)",
                              padding: "4px 6px",
                              borderRadius: 8,
                              border: "2px solid currentColor",
                              background: "rgba(255,255,255,0.95)",
                              color: "inherit",
                              fontSize: 11,
                              fontWeight: 800,
                              whiteSpace: "nowrap",
                            }}
                            className="dark:bg-black/75"
                          >
                            {fmtAbs(hScrubMs) ? `${fmtAbs(hScrubMs)} · ` : ""}+{fmtRelHMS(hScrubMs)}
                          </div>
                        )}
                      </div>

                      {/* repères fenêtre (début — fin) */}
                      <div
                        style={{
                          marginTop: 6,
                          display: "flex",
                          justifyContent: "space-between",
                          fontSize: 11,
                          opacity: 0.85,
                        }}
                      >
                        <span>{fmtAbs(winStart) ?? `+${fmtRelHMS(winStart)}`}</span>
                        <span>{fmtAbs(winEnd) ?? `+${fmtRelHMS(winEnd)}`}</span>
                      </div>
                    </div>
                  );
                })()}
              </div>

              <div style={{ marginTop: 8, fontSize: 11, opacity: 0.85 }}>
                Astuce : Load puis Play. Tu peux scruber la timeline à droite (seek).
              </div>
            </div>

            {/* timeline verticale (macro globale : toujours 0..dur, non affectée par le zoom) */}
            <div
              style={{
                width: 54,
                display: "flex",
                justifyContent: "center",
                alignItems: "stretch",
              }}
            >
              {(() => {
                const dur = playerApi?.durationMs?.() ?? 0;
                const startIso = playerApi?.startIso?.() ?? null;

                const span = dur;
                const start = 0;
                const end = dur;

                const c = playerApi?.cursor?.();
                const currentMs = c ? c.tMs : 0;
                const currentClamped = clamp(currentMs, start, end);
                const ratio = span > 0 ? (currentClamped - start) / span : 0;
                const knobTopPct = clamp(ratio * 100, 0, 100);

                const fmtRelHMS = (ms: number) => {
                  const s = Math.max(0, Math.round(ms / 1000));
                  const hh = Math.floor(s / 3600);
                  const mm = Math.floor((s % 3600) / 60);
                  const ss = s % 60;
                  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
                };

                const fmtAbs = (ms: number) => {
                  if (!startIso) return null;
                  const base = Date.parse(startIso);
                  if (!Number.isFinite(base)) return null;
                  return new Date(base + ms).toISOString().slice(11, 19);
                };

                const handleScrub = (clientY: number, el: HTMLElement) => {
                  const rect = el.getBoundingClientRect();
                  const y = clamp(clientY - rect.top, 0, rect.height);
                  const r = rect.height > 0 ? y / rect.height : 0;
                  const tInt = Math.round(start + r * span);

                  setIsScrubbing(true);
                  setScrubMs(tInt);

                  try {
                    playerApi?.seek?.(tInt);
                  } catch (err) {
                    console.warn("[replay-overlay] seek(vertical) failed", err);
                  }
                  setTick((v) => v + 1);
                };

                return (
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: "100%" }}>
                    {/* repère haut */}
                    <div style={{ fontSize: 10, opacity: 0.85, marginBottom: 4 }}>{fmtAbs(0) ?? "0"}</div>

                    <div
                      style={{
                        height: 170,
                        width: 14,
                        borderRadius: 999,
                        border: "2px solid currentColor",
                        position: "relative",
                        cursor: "pointer",
                        userSelect: "none",
                        touchAction: "none",
                      }}
                      title="Timeline globale (drag pour seek)"
                      onPointerDown={(e) => {
                        const el = e.currentTarget as HTMLElement;
                        el.setPointerCapture(e.pointerId);
                        handleScrub(e.clientY, el);
                      }}
                      onPointerMove={(e) => {
                        if (!isScrubbing) return;
                        const el = e.currentTarget as HTMLElement;
                        handleScrub(e.clientY, el);
                      }}
                      onPointerUp={(e) => {
                        const el = e.currentTarget as HTMLElement;
                        try {
                          el.releasePointerCapture(e.pointerId);
                        } catch {}
                        setIsScrubbing(false);
                        setScrubMs(null);
                      }}
                      onPointerCancel={() => {
                        setIsScrubbing(false);
                        setScrubMs(null);
                      }}
                    >
                      {/* fenêtre visible (minimap VS Code) : portion affichée par la timeline horizontale */}
                      {(() => {
                        if (dur <= 0 || !Number.isFinite(dur)) return null;
                        if (viewSpanMs === 0) return null; // en vue totale, pas de fenêtre à surligner

                        const spanWin = Math.min(dur, viewSpanMs);
                        const winStart = clamp(viewStartMs, 0, Math.max(0, dur - spanWin));
                        const winEnd = winStart + spanWin;

                        const topPct = clamp((winStart / dur) * 100, 0, 100);
                        const heightPct = clamp(((winEnd - winStart) / dur) * 100, 0, 100);

                        return (
                          <div
                            style={{
                              position: "absolute",
                              left: 1,
                              right: 1,
                              top: `${topPct}%`,
                              height: `${Math.max(2, heightPct)}%`,
                              borderRadius: 999,
                              background: "currentColor",
                              opacity: 0.18,
                              outline: "2px solid currentColor",
                              outlineOffset: -2,
                              pointerEvents: "none",
                            }}
                          />
                        );
                      })()}

                      <div
                        style={{
                          position: "absolute",
                          left: "50%",
                          top: `${knobTopPct}%`,
                          transform: "translate(-50%, -50%)",
                          width: 18,
                          height: 6,
                          borderRadius: 999,
                          background: "currentColor",
                          opacity: 0.85,
                        }}
                      />

                      {isScrubbing && scrubMs != null && (
                        <div
                          style={{
                            position: "absolute",
                            left: "-6px",
                            top: `${clamp(((scrubMs - start) / Math.max(1, span)) * 100, 0, 100)}%`,
                            transform: "translate(-100%, -50%)",
                            padding: "4px 6px",
                            borderRadius: 8,
                            border: "2px solid currentColor",
                            background: "rgba(255,255,255,0.95)",
                            color: "inherit",
                            fontSize: 11,
                            fontWeight: 800,
                            whiteSpace: "nowrap",
                          }}
                          className="dark:bg-black/75"
                        >
                          {fmtAbs(scrubMs) ? `${fmtAbs(scrubMs)} · ` : ""}+{fmtRelHMS(scrubMs)}
                        </div>
                      )}
                    </div>

                    {/* repère bas */}
                    <div style={{ fontSize: 10, opacity: 0.85, marginTop: 4 }}>
                      {dur > 0 ? fmtAbs(dur) ?? fmtRelHMS(dur) : "—"}
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>
        </div>

        {/* Modal picker */}
        {pickerOpen && (
          <div
            style={{
              position: "fixed",
              inset: 0,
              zIndex: 100000,
              background: "rgba(0,0,0,0.35)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 12,
            }}
            onMouseDown={() => setPickerOpen(false)}
            onTouchStart={() => setPickerOpen(false)}
          >
            <div
              style={{
                width: "min(680px, calc(100vw - 24px))",
                maxHeight: "min(520px, calc(100vh - 24px))",
                overflow: "hidden",
                borderRadius: 14,
                border: "2px solid rgba(0,0,0,0.85)",
                background: "rgba(255,255,255,0.96)",
                boxShadow: "0 10px 22px rgba(0,0,0,0.35)",
              }}
              className="dark:border-white dark:bg-black/80"
              onMouseDown={(e) => e.stopPropagation()}
              onTouchStart={(e) => e.stopPropagation()}
            >
              <div
                style={{
                  padding: "10px 12px",
                  borderBottom: "1px solid rgba(0,0,0,0.2)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 10,
                }}
                className="dark:border-white/20"
              >
                <div style={{ display: "flex", gap: 10, alignItems: "baseline" }}>
                  <strong style={{ fontSize: 12 }}>Charger un log</strong>
                  <span style={{ fontSize: 11, opacity: 0.8 }}>{LIST_LOGS_URL}</span>
                </div>

                <button
                  type="button"
                  onClick={() => setPickerOpen(false)}
                  style={{
                    fontSize: 11,
                    fontWeight: 900,
                    borderRadius: 10,
                    border: "2px solid currentColor",
                    padding: "4px 10px",
                    background: "transparent",
                  }}
                >
                  Fermer
                </button>
              </div>

              <div style={{ padding: 12 }}>
                {logsLoading && <div style={{ fontSize: 12, opacity: 0.85 }}>Chargement…</div>}

                {!logsLoading && logsError && (
                  <div style={{ fontSize: 12, color: "crimson", fontWeight: 800 }}>
                    Erreur: {logsError}
                  </div>
                )}

                {!logsLoading && !logsError && logs.length === 0 && (
                  <div style={{ fontSize: 12, opacity: 0.85 }}>
                    Aucun log trouvé dans /replay/logs/.
                  </div>
                )}

                {!logsLoading && !logsError && logs.length > 0 && (
                  <div
                    style={{
                      maxHeight: 340,
                      overflow: "auto",
                      borderRadius: 12,
                      border: "1px solid rgba(0,0,0,0.2)",
                      padding: 6,
                    }}
                    className="dark:border-white/20"
                  >
                    {logs.map((it) => (
                      <label
                        key={it.name}
                        style={{
                          display: "flex",
                          gap: 10,
                          alignItems: "center",
                          padding: "6px 8px",
                          borderRadius: 10,
                          cursor: "pointer",
                          userSelect: "none",
                        }}
                      >
                        <input
                          type="radio"
                          name="limgpt-log"
                          checked={selectedLog === it.name}
                          onChange={() => setSelectedLog(it.name)}
                        />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 12, fontWeight: 900, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                            {it.name}
                          </div>
                          <div style={{ fontSize: 11, opacity: 0.75 }}>
                            {fmtDate(it.mtime)} · {fmtBytes(it.size)}
                          </div>
                        </div>
                      </label>
                    ))}
                  </div>
                )}

                <div style={{ marginTop: 10, display: "flex", gap: 8, justifyContent: "flex-end" }}>
                  <button
                    type="button"
                    onClick={() => {
                      setPickerOpen(false);
                    }}
                    style={{
                      fontSize: 11,
                      fontWeight: 900,
                      borderRadius: 10,
                      border: "2px solid currentColor",
                      padding: "6px 10px",
                      background: "transparent",
                      opacity: 0.85,
                    }}
                  >
                    Annuler
                  </button>

                  <button
                    type="button"
                    onClick={confirmLoadSelected}
                    disabled={!selectedLog || logsLoading}
                    style={{
                      fontSize: 11,
                      fontWeight: 900,
                      borderRadius: 10,
                      border: "2px solid currentColor",
                      padding: "6px 10px",
                      background: "transparent",
                      opacity: !selectedLog || logsLoading ? 0.4 : 1,
                      cursor: !selectedLog || logsLoading ? "not-allowed" : "pointer",
                    }}
                  >
                    Charger
                  </button>
                </div>

                <div style={{ marginTop: 8, fontSize: 11, opacity: 0.7 }}>
                  Sélectionne un fichier puis “Charger”. (Source: /replay/logs/)
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
