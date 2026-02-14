import type { FTEntry, CsvSens } from "../../data/ligneFT";

export type CsvHighlightKind = "none" | "full" | "top" | "bottom";

type CsvZoneLike = {
  sens: CsvSens;
  pkFrom: number;
  pkTo: number;
};

/**
 * Reproduit STRICTEMENT la logique CSV actuelle de FT.tsx :
 * - calcule csvHighlightByIndex
 * - logique "première zone affichée" non surlignée (first === 0)
 * - règle spéciale 621.0 si dernière ligne affichée
 * - post-traitement "bottom -> top" : remplir les lignes entre les barres
 */
export function computeCsvHighlightByIndex(
  rawEntries: FTEntry[],
  currentCsvSens: CsvSens | null,
  zones: readonly CsvZoneLike[] = []
): CsvHighlightKind[] {
  const csvHighlightByIndex: CsvHighlightKind[] = [];

  // Par défaut : aucun surlignage

  for (let i = 0; i < rawEntries.length; i++) {
    csvHighlightByIndex[i] = "none";
  }

  // (Bloc conservé tel quel : actuellement il ne fait rien de plus)
  for (let i = 0; i < rawEntries.length; i++) {
    const e = rawEntries[i];
    if (!e.pk || e.isNoteOnly) continue;

    const pkNum = Number(e.pk);
    if (Number.isNaN(pkNum)) continue;

    // Ici, ajoute ta logique pour les autres zones CSV comme avant
    // ...
  }

  if (currentCsvSens) {
    // On traite chaque zone CSV correspondant au sens courant
    for (const zone of zones) {
      if (zone.sens !== currentCsvSens) continue;

      const a = Math.min(zone.pkFrom, zone.pkTo);
      const b = Math.max(zone.pkFrom, zone.pkTo);

      const indicesDansZone: number[] = [];

      for (let i = 0; i < rawEntries.length; i++) {
        const e = rawEntries[i];
        if (!e.pk || e.isNoteOnly) continue;

        const pkNum = Number(e.pk);
        if (Number.isNaN(pkNum)) continue;

        if (pkNum >= a && pkNum <= b) {
          indicesDansZone.push(i);
        }
      }

      if (indicesDansZone.length === 0) continue;

      const first = indicesDansZone[0];
      const last = indicesDansZone[indicesDansZone.length - 1];

      // Nouvelle logique : vérifier si la première zone affichée
      const isFirstZone = first === 0; // Vérification si c'est la première ligne affichée

      for (const idx of indicesDansZone) {
        if (isFirstZone) {
          // Ne pas surligner la première zone
          csvHighlightByIndex[idx] = "none";
        } else if (first === last) {
          csvHighlightByIndex[idx] = "full";
        } else if (idx === first) {
          csvHighlightByIndex[idx] = "bottom";
        } else if (idx === last) {
          csvHighlightByIndex[idx] = "top";
        } else {
          csvHighlightByIndex[idx] = "full";
        }
      }
    }

    // Logique conditionnelle : si on est sur la ligne 621.0 et qu'elle est la dernière ligne affichée
    for (let i = 0; i < rawEntries.length; i++) {
      const e = rawEntries[i];
      if (!e.pk || e.isNoteOnly) continue;

      const pkNum = Number(e.pk);
      if (Number.isNaN(pkNum)) continue;

      // Appliquer le surlignage complet à la ligne 621.0 si c'est la dernière ligne affichée
      if (e.pk === "621.0" && i === rawEntries.length - 1) {
        csvHighlightByIndex[i] = "full"; // Surbrillance complète pour la dernière ligne
      }
    }

    // 🔁 Post-traitement : remplir les cases ENTRE les barres
    // On cherche chaque paire "bottom" -> "top" et on met "full"
    // sur toutes les lignes intermédiaires.
    let zoneStartIndex: number | null = null;

    for (let i = 0; i < csvHighlightByIndex.length; i++) {
      const kind = csvHighlightByIndex[i];

      if (kind === "bottom") {
        // début de zone : on mémorise l'index de la ligne contenant la barre du haut
        zoneStartIndex = i;
      } else if (kind === "top" && zoneStartIndex !== null) {
        // fin de zone : on remplit tout ce qu’il y a entre les deux
        for (let j = zoneStartIndex + 1; j < i; j++) {
          if (csvHighlightByIndex[j] === "none") {
            csvHighlightByIndex[j] = "full";
          }
        }
        zoneStartIndex = null;
      }
    }
  }

  return csvHighlightByIndex;
}
