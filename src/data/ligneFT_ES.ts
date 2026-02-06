// src/data/ligneFT_ES.ts
// Bloc ESPAGNE : correspond à la FT actuelle (Limite LFP/ADIF ↔ Barcelone)
// On dérive depuis ligneFT.ts, mais on coupe AVANT les ajouts "bloc France".

import { FT_LIGNE_PAIR, FT_LIGNE_IMPAIR, type FTEntry } from "./ligneFT";

function normName(s: string) {
  return (s || "")
    .toLowerCase()
    .replace(/\u00a0/g, " ")
    .replace(/[-–]/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Repère stable du bloc Espagne (présent dans tes données)
function isLimiteAdifLfpsa(e: FTEntry) {
  const d = normName(e.dependencia || "");
  return d.includes("limite") && d.includes("adif") && d.includes("lfpsa");
}

function cutEspagneBlock(arr: FTEntry[]): FTEntry[] {
  const idx = arr.findIndex(isLimiteAdifLfpsa);
  if (idx === -1) {
    // Sécurité : si jamais le repère n'existe pas, on ne coupe pas
    return arr;
  }
  // On garde le bloc Espagne jusqu'à la limite incluse
  return arr.slice(0, idx + 1);
}

export const FT_ES_LIGNE_PAIR: FTEntry[] = cutEspagneBlock(FT_LIGNE_PAIR);
export const FT_ES_LIGNE_IMPAIR: FTEntry[] = cutEspagneBlock(FT_LIGNE_IMPAIR);
