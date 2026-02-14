import type { FTEntry } from "../../data/ligneFT";

export type SpeedInfo = { v: number; highlight: boolean };

export function extractSpeedTimeline(
  entries: FTEntry[],
  seed: SpeedInfo | null
): {
  speedMap: Record<string, SpeedInfo>;
  breakpointsArr: string[];
} {
  const speedMap: Record<string, SpeedInfo> = {};
  const breakpointsArr: string[] = [];

  let currentSpeed: number | null = seed ? seed.v : null;
  let currentHighlight: boolean = seed ? seed.highlight : false;

  for (const e of entries) {
    if (e.isNoteOnly) continue;

    const pk = e.pk;

    if ((e as any).vmax_bar && pk) {
      breakpointsArr.push(pk);
    }

    if (typeof e.vmax === "number" && Number.isFinite(e.vmax)) {
      currentSpeed = e.vmax;
      currentHighlight = !!(e as any).vmax_highlight;
    }

    if (pk && currentSpeed !== null) {
      speedMap[pk] = {
        v: currentSpeed,
        highlight: currentHighlight,
      };
    }
  }

  return { speedMap, breakpointsArr };
}

export function computeSeedSpeed(
  pkStart: string | null,
  isOddFlag: boolean | null,
  FT_LIGNE_PAIR: FTEntry[],
  FT_LIGNE_IMPAIR: FTEntry[]
): SpeedInfo | null {
  if (!pkStart || isOddFlag === null) return null;

  const baseOriented: FTEntry[] = isOddFlag
    ? FT_LIGNE_PAIR
    : [...FT_LIGNE_IMPAIR].reverse();

  const idxStart = baseOriented.findIndex(
    (e) => !e.isNoteOnly && e.pk === pkStart
  );
  if (idxStart <= 0) return null;

  let currentSpeed: number | null = null;
  let currentHighlight = false;

  for (let i = 0; i < idxStart; i++) {
    const e = baseOriented[i];
    if (typeof e.vmax === "number" && Number.isFinite(e.vmax)) {
      currentSpeed = e.vmax;
      currentHighlight = !!(e as any).vmax_highlight;
    }
  }

  if (currentSpeed === null) return null;
  return { v: currentSpeed, highlight: currentHighlight };
}
