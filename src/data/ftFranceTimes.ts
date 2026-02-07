// src/data/ftFranceTimes.ts

export type TimeCell = string | { arr?: string; dep?: string }
export type TrainTimes = Record<string, TimeCell>

// ============================================================
// Horaires FT France (data-driven par n° de train)
// - clé principale : trainNumber
// - clé secondaire : pk (string exactement comme affiché dans FTFrance.tsx)
// - valeur : "hh:mm" ou { arr/dep } pour préparer l’arrivée/départ
// ============================================================
export const FT_FR_TIMES_BY_TRAIN: Record<number, TrainTimes> = {
  // ✅ Exemple (à compléter)
  9712: {
        "467,5": "13:06",
"0,8": "13:12",
    "12,9": "13:16",
    "17,1": "13:17",
    "24,6": "13:19",
    "25,6": "13:20",
    "752,4": "13:25",
  },


  9714: {
        "467,5": "20:07",
"0,8": "20:12",
    "12,9": "20:16",
    "17,1": "20:17",
    "24,6": "20:19",
    "25,6": "20:20",
    "752,4": "20:25",
  },
  9707: {
    "752,4": "17:31",
    "25,6": "17:35",
    "24,6": "17:36",
    "17,1": "17:38",
    "12,9": "17:39",
    "1,2": "17:44",
        "467,5": "17:50",
  },
  9709: {
    "752,4": "10:33",
    "25,6": "10:37",
    "24,6": "10:38",
    "17,1": "10:40",
    "12,9": "10:41",
    "1,2": "10:46",
        "467,5": "10:52",
  },
  9705: {
    "752,4": "16:24",
    "25,6": "16:28",
    "24,6": "16:29",
    "17,1": "16:31",
    "12,9": "16:32",
    "1,2": "16:37",
  },
  9710: {
    "0,8": "12:11",
    "12,9": "12:15",
    "17,1": "12:16",
    "24,6": "12:18",
    "25,6": "12:19",
    "752,4": "12:24",
  },
}

export function formatTimeCell(t?: TimeCell): string {
  if (!t) return ""
  if (typeof t === "string") return t
  const a = t.arr ?? ""
  const d = t.dep ?? ""
  if (a && d) return `${a} / ${d}`
  return a || d || ""
}

export function getFtFranceHhmm(
  trainNumber: number | null | undefined,
  pk: string | undefined
): string {
  if (trainNumber == null) return ""
  if (!pk) return ""
    console.log("[ftFranceTimes] lookup", { trainNumber, pk, hasTrain: !!FT_FR_TIMES_BY_TRAIN[trainNumber] })
console.log("[FTFR_LOOKUP]", { trainNumber, pk })

  const times = FT_FR_TIMES_BY_TRAIN[trainNumber]
  if (!times) return ""
  return formatTimeCell(times[pk])
}
