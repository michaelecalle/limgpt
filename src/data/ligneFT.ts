// src/data/ligneFT.ts
// Source de vérité pour la feuille de train (FT)
//
// On gère deux sens : PAIR et IMPAIR.
// IMPORTANT : L'ordre des entrées reste en PK croissant (615.9 → 752.4).
// Même pour le sens PAIR (qui roule en PK décroissant en réel), on garde le même ordre croissant ici,
// et on encode les vitesses/vmax selon le sens PAIR ou IMPAIR directement dans FT_LIGNE_PAIR / FT_LIGNE_IMPAIR.
//
// Champs principaux utilisés par l'affichage :
// - pk: affichage Sit Km (colonne S)
// - dependencia: nom (colonne D)
//
// Remarques rouges :
// - note?: string (ancienne forme, une seule ligne rouge)
// - notes?: string[] (plusieurs lignes rouges)
// - isNoteOnly?: true si la ligne ne représente pas une dependencia classique,
//   mais uniquement des remarques rouges. (Elle est affichée AVANT la gare correspondante)
//
//
// Colonnes techniques :
// - bloqueo: "↓ BCA ↓" etc. (colonne B / Bloqueo)
// - radio: "◯ GSMR" etc. (colonne R / Radio)
//
//
// Profil de ligne (RC / Ramp Caract) :
// - rc: valeur numérique de rampe/pente en ‰ (ex: 25 / 28 / 18)
// - rc_bar: true si ce PK est une limite de changement de rampe, donc on affiche une barre horizontale
//   dans la colonne RC à cet endroit. Pas de barre aux extrémités de la fiche.
//
// Vitesse maximale (V Max) :
// - vmax: vitesse maximale en km/h à partir de ce PK (dans le sens considéré)
// - vmax_bar: true si on veut une barre horizontale dans la colonne V Max à ce PK
//   (la barre est purement graphique depuis la simplification de FT.tsx).
// - vmax_highlight: true si la vitesse était marquée avec un astérisque (*) dans la source.
//   (pour l’instant, on laisse ça de côté ; on pourra le réactiver plus tard)
//
// Autres colonnes possibles (pas encore exploitées mais réservées) :
// - etcs: niveau ETCS (colonne N). Par défaut on affichera "①" si absent.
// - hora, tecnico, conc: colonnes H / Técn / Conc
//
// NOTE IMPORTANTE :
// - Les lignes isNoteOnly reçoivent aussi rc et vmax cohérents avec leur zone,
//   mais elles sont ignorées pour les calculs de timeline.

export interface FTEntry {
  pk: string;
  dependencia: string;

  // Remarques rouges
  note?: string;
  notes?: string[];
  isNoteOnly?: boolean;

  // Colonnes constantes
  bloqueo?: string;
  radio?: string;

  // Vitesse maximale (colonne V)
  vmax?: number;
  vmax_bar?: boolean;
  vmax_highlight?: boolean;

  // Profil de ligne (colonne RC)
  rc?: number;
  rc_bar?: boolean;

  // Autres colonnes à venir
  etcs?: string;
  hora?: string;
  tecnico?: string;
  conc?: string;
}
// -----------------------------------------------------------------------------
// CSV_ZONES : zones de baisse significative de vitesse (CSV)
// -----------------------------------------------------------------------------
//
// Une CSV est définie par :
// - un sens (PAIR / IMPAIR)
// - une plage kilométrique [pkFrom ; pkTo] dans le repère croissant du fichier
//   (615.9 → 752.4)
// - éventuellement un flag ignoreIfFirst pour les zones qu'on ne surligne pas
//   si elles sont la première portion affichée sur la FT.
//
// Pour l'instant, on ne déclare qu'une seule zone, pour tester le principe :
// - sens PAIR
// - entre PK 715.5 et 714.7 (zone autour de GIRONA)

export type CsvSens = "PAIR" | "IMPAIR";

export interface CsvZone {
  sens: CsvSens;
  pkFrom: number;
  pkTo: number;
  ignoreIfFirst?: boolean;
}

export const CSV_ZONES: CsvZone[] = [
  {
    sens: "PAIR",
    pkFrom: 715.5,
    pkTo: 714.7,
    // ignoreIfFirst: false par défaut
  },
  {
    // Zone 2 : même sens que la zone GIRONA
    // CSV entre PK 632.4 et 630.7 (PK croissants dans le fichier)
    sens: "PAIR",
    pkFrom: 632.4,
    pkTo: 630.7,
  },
  {
    // Zone 3 : CSV entre PK 629.4 et 627.7
    // Toujours pour les trains dans le même sens (PAIR)
    sens: "PAIR",
    pkFrom: 629.4,
    pkTo: 627.7,
  },
  {
    // Zone 4 : CSV entre PK 624.3 et 623.8
    // Même sens de marche (PAIR)
    sens: "PAIR",
    pkFrom: 624.3,
    pkTo: 623.8,
  },
    {
    // Zone 5 : CSV 30 entre PK 620.2 et 621.0 (PK croissants, sens PAIR)
    sens: "PAIR",
    pkFrom: 620.2,
    pkTo: 621.0,
  },

  {
    // Zone 5 : CSV pour le sens opposé (IMPAIR)
    // entre PK 626.7 et 627.7
    sens: "IMPAIR",
    pkFrom: 626.7,
    pkTo: 627.7,
  },
  {
    // Zone 6 : CSV pour le sens opposé (IMPAIR)
    // entre PK 709.9 et 710.7
    sens: "IMPAIR",
    pkFrom: 709.9,
    pkTo: 710.7,
  },
    {
    // Zone 7 : portion 30 km/h 620.2 → 621.0
    // sens des PK croissants (FT_LIGNE_PAIR) => sens "IMPAIR" dans notre code
    sens: "IMPAIR",
    pkFrom: 620.2,
    pkTo: 621.0,
  },
  {
    // Zone 8 : portion 30 km/h 621.7 → 621.0
    // sens des PK décroissants (FT_LIGNE_IMPAIR inversé) => sens "PAIR" dans notre code
    sens: "PAIR",
    pkFrom: 621.7,
    pkTo: 621.0,
  },
];






// -----------------------------------------------------------------------------
// FT_LIGNE_PAIR : sens PAIR
// -----------------------------------------------------------------------------
//
// Partitionnement (PK croissant, vitesses après chaque PK) :
// 615.9→616.0 : 30
// 616.0→618.1 : 95
// 618.1→619.9 : 85
// 619.9→620.2 : 60
// 620.2→621.7 : 30
// 621.7→623.8 : 140
// 623.8→624.3 : 80
// 624.3→626.7 : 140
// 626.7→627.7 : 45
// 627.7→629.4 : 45
// 629.4→630.7 : 110
// 630.7→632.4 : 130
// 632.4→639.8 : 200
// 639.8→641.9 : 185
// 641.9→643.6 : 195
// 643.6→709.9 : 200
// 709.9→710.7 : 125
// 710.7→713.2 : 125
// 713.2→715.5 : 120
// 715.5→716.8 : 165
// 716.8→752.4 : 200
//
// Règle :
// - vmax sur le PK = vitesse de la portion qui suit ce PK (avec le sens choisi).
// - vmax_bar = true sur tous ces PK intermédiaires (sauf 615.9 et 752.4) pour dessiner la barre.

export const FT_LIGNE_PAIR: FTEntry[] = [
  {
    pk: "615.9",
    dependencia: "CAN TUNIS AV",
    bloqueo: "↓ BCA ↓",
    radio: "◯ GSMR",
    rc: 25,
    rc_bar: false,
    vmax: 30,
    vmax_bar: false, // pas de barre au tout début
  },
  {
    pk: "616.0",
    dependencia: "BIF CAN TUNIS AV",
    bloqueo: "↓ BCA ↓",
    radio: "◯ GSMR",
    rc: 25,
    rc_bar: false,
    vmax: 95,
    vmax_bar: true,
  },
  {
    pk: "618.1",
    dependencia: "",
    bloqueo: "↓ BCA ↓",
    radio: "◯ GSMR",
    rc: 25,
    rc_bar: false,
    vmax: 85,
    vmax_bar: true,
  },
  {
    pk: "619.9",
    dependencia: "",
    bloqueo: "↓ BCA ↓",
    radio: "◯ GSMR",
    rc: 25,
    rc_bar: false,
    vmax: 60,
    vmax_bar: true,
  },
  {
    pk: "620.2",
    dependencia: "",
    bloqueo: "↓ BCA ↓",
    radio: "◯ GSMR",
    rc: 25,
    rc_bar: false,
    vmax: 30,
    vmax_bar: true,
  },
  {
    pk: "621.0",
    dependencia: "BARCELONA SANTS",
    bloqueo: "↓ BCA ↓",
    radio: "◯ GSMR",
    rc: 28,
    rc_bar: true, // changement 25→28
    // 620.2→621.0 et 621.0→621.7 restent à 30
    vmax: 30,
    // pas de barre Vmax ici, on conserve la barre sur 620.2 / 621.7
  },
  {
    pk: "621.7",
    dependencia: "",
    bloqueo: "↓ BCA ↓",
    radio: "◯ GSMR",
    rc: 28,
    rc_bar: false,
    vmax: 140,
    vmax_bar: true,
  },
  {
    pk: "623.8",
    dependencia: "",
    bloqueo: "↓ BCA ↓",
    radio: "◯ GSMR",
    rc: 28,
    rc_bar: false,
    vmax: 80,
    vmax_bar: true,
  },
  {
    pk: "624.3",
    dependencia: "",
    bloqueo: "↓ BCA ↓",
    radio: "◯ GSMR",
    rc: 28,
    rc_bar: false,
    vmax: 140,
    vmax_bar: true,
  },
  {
    pk: "626.7",
    dependencia: "",
    bloqueo: "↓ BCA ↓",
    radio: "◯ GSMR",
    rc: 28,
    rc_bar: false,
    vmax: 45,
    vmax_bar: true,
  },

  // Remarques rouges AVANT LA SAGRERA AV
  {
    pk: "",
    dependencia: "",
    isNoteOnly: true,
    notes: ["35 VIAS ESTACIONAM. V11, V19 Y V10, V18"],
    bloqueo: "↓ BCA ↓",
    radio: "◯ GSMR",
    rc: 28,
    rc_bar: false,
    // vmax implicite : 45 dans la zone
  },

  {
    pk: "627.7",
    dependencia: "LA SAGRERA AV",
    bloqueo: "↓ BCA ↓",
    radio: "◯ GSMR",
    rc: 28,
    rc_bar: false,
    vmax: 45,
    vmax_bar: true,
  },
  {
    pk: "629.4",
    dependencia: "",
    bloqueo: "↓ BCA ↓",
    radio: "◯ GSMR",
    rc: 28,
    rc_bar: false,
    vmax: 110,
    vmax_bar: true,
  },
  {
    pk: "630.7",
    dependencia: "",
    bloqueo: "↓ BCA ↓",
    radio: "◯ GSMR",
    rc: 28,
    rc_bar: false,
    vmax: 130,
    vmax_bar: true,
  },
  {
    pk: "632.4",
    dependencia: "",
    bloqueo: "↓ BCA ↓",
    radio: "◯ GSMR",
    rc: 28,
    rc_bar: false,
    vmax: 200,
    vmax_bar: true,
  },
  {
    pk: "634.5",
    dependencia: "",
    bloqueo: "↓ BCA ↓",
    radio: "◯ GSMR",
    rc: 28,
    rc_bar: false,
    // hérite 200
  },
  {
    pk: "636.6",
    dependencia: "",
    bloqueo: "↓ BCA ↓",
    radio: "◯ GSMR",
    rc: 28,
    rc_bar: false,
    // hérite 200
  },
  {
    pk: "639.8",
    dependencia: "",
    bloqueo: "↓ BCA ↓",
    radio: "◯ GSMR",
    rc: 28,
    rc_bar: false,
    vmax: 185,
    vmax_bar: true,
  },
  {
    pk: "640.5",
    dependencia: "BIF. MOLLET",
    bloqueo: "↓ BCA ↓",
    radio: "◯ GSMR",
    rc: 28,
    rc_bar: false,
    // hérite 185
  },
  {
    pk: "641.3",
    dependencia: "BIF. MOLLET-AGUJA KM. 641,3",
    bloqueo: "↓ BCA ↓",
    radio: "◯ GSMR",
    rc: 18,
    rc_bar: true, // 28→18
    // hérite 185
  },
  {
    pk: "641.9",
    dependencia: "",
    bloqueo: "↓ BCA ↓",
    radio: "◯ GSMR",
    rc: 18,
    rc_bar: false,
    vmax: 195,
    vmax_bar: true,
  },
  {
    pk: "643.6",
    dependencia: "",
    bloqueo: "↓ BCA ↓",
    radio: "◯ GSMR",
    rc: 18,
    rc_bar: false,
    vmax: 200,
    vmax_bar: true,
  },
  {
    pk: "644.3",
    dependencia: "BIF. MOLLET-AG.KM. 644.3",
    bloqueo: "↓ BCA ↓",
    radio: "◯ GSMR",
    rc: 18,
    rc_bar: false,
    // hérite 200
  },

  {
    pk: "654.4",
    dependencia: "",
    bloqueo: "↓ BCA ↓",
    radio: "◯ GSMR",
    rc: 18,
    rc_bar: false,
    // hérite 200
  },
  {
    pk: "655.6",
    dependencia: "",
    bloqueo: "↓ BCA ↓",
    radio: "◯ GSMR",
    rc: 18,
    rc_bar: false,
    // hérite 200
  },
  {
    pk: "655.8",
    dependencia: "",
    bloqueo: "↓ BCA ↓",
    radio: "◯ GSMR",
    rc: 18,
    rc_bar: false,
    // hérite 200
  },
  {
    pk: "660.8",
    dependencia: "",
    bloqueo: "↓ BCA ↓",
    radio: "◯ GSMR",
    rc: 18,
    rc_bar: false,
    // hérite 200
  },
  {
    pk: "661.5",
    dependencia: "",
    bloqueo: "↓ BCA ↓",
    radio: "◯ GSMR",
    rc: 18,
    rc_bar: false,
    // hérite 200
  },
  {
    pk: "662.0",
    dependencia: "",
    bloqueo: "↓ BCA ↓",
    radio: "◯ GSMR",
    rc: 18,
    rc_bar: false,
    // hérite 200
  },

  {
    pk: "662.1",
    dependencia: "LLINARS-A. V",
    bloqueo: "↓ BCA ↓",
    radio: "◯ GSMR",
    rc: 18,
    rc_bar: false,
    // hérite 200
  },

  {
    pk: "673.5",
    dependencia: "",
    bloqueo: "↓ BCA ↓",
    radio: "◯ GSMR",
    rc: 18,
    rc_bar: false,
    // hérite 200
  },

  {
    pk: "678.1",
    dependencia: "RIELLS-A. V",
    bloqueo: "↓ BCA ↓",
    radio: "◯ GSMR",
    rc: 18,
    rc_bar: false,
    // hérite 200
  },

  {
    pk: "680.2",
    dependencia: "",
    bloqueo: "↓ BCA ↓",
    radio: "◯ GSMR",
    rc: 18,
    rc_bar: false,
    // hérite 200
  },

  {
    pk: "682.0",
    dependencia: "BASE MTO. RIELLS",
    bloqueo: "↓ BCA ↓",
    radio: "◯ GSMR",
    rc: 18,
    rc_bar: false,
    // hérite 200
  },

  {
    pk: "684.0",
    dependencia: "",
    bloqueo: "↓ BCA ↓",
    radio: "◯ GSMR",
    rc: 18,
    rc_bar: false,
    // hérite 200
  },

  {
    pk: "703.5",
    dependencia: "VILOBI D'ONYAR",
    bloqueo: "↓ BCA ↓",
    radio: "◯ GSMR",
    rc: 18,
    rc_bar: false,
    // hérite 200
  },

  {
    pk: "707.1",
    dependencia: "",
    bloqueo: "↓ BCA ↓",
    radio: "◯ GSMR",
    rc: 18,
    rc_bar: false,
    // hérite 200
  },

  {
    pk: "709.9",
    dependencia: "",
    bloqueo: "↓ BCA ↓",
    radio: "◯ GSMR",
    rc: 18,
    rc_bar: false,
    vmax: 125,
    vmax_bar: true,
  },

  {
    pk: "710.7",
    dependencia: "BIF. GIRONA-MERCADERIES",
    bloqueo: "↓ BCA ↓",
    radio: "◯ GSMR",
    rc: 18,
    rc_bar: false,
    vmax: 125,
    vmax_bar: true, // barre "cosmétique" entre deux zones à 125
  },

  {
    pk: "713.2",
    dependencia: "",
    bloqueo: "↓ BCA ↓",
    radio: "◯ GSMR",
    rc: 18,
    rc_bar: false,
    vmax: 120,
    vmax_bar: true,
  },

  {
    pk: "714.7",
    dependencia: "GIRONA",
    bloqueo: "↓ BCA ↓",
    radio: "◯ GSMR",
    rc: 18,
    rc_bar: false,
    // hérite 120
  },

  {
    pk: "715.5",
    dependencia: "",
    bloqueo: "↓ BCA ↓",
    radio: "◯ GSMR",
    rc: 18,
    rc_bar: false,
    vmax: 165,
    vmax_bar: true,
  },

  {
    pk: "716.8",
    dependencia: "",
    bloqueo: "↓ BCA ↓",
    radio: "◯ GSMR",
    rc: 18,
    rc_bar: false,
    vmax: 200,
    vmax_bar: true,
  },

  {
    pk: "720.0",
    dependencia: "",
    bloqueo: "↓ BCA ↓",
    radio: "◯ GSMR",
    rc: 18,
    rc_bar: false,
    // hérite 200
  },
  {
    pk: "723.7",
    dependencia: "",
    bloqueo: "↓ BCA ↓",
    radio: "◯ GSMR",
    rc: 18,
    rc_bar: false,
    // hérite 200
  },

  // Remarques rouges AVANT FIGUERES-VILAFANT
  {
    pk: "",
    dependencia: "",
    isNoteOnly: true,
    notes: ["80 AL PASO VIAS 3, 4 Y 6", "50 AL PASO VIA 7"],
    bloqueo: "↓ BCA ↓",
    radio: "◯ GSMR",
    rc: 18,
    rc_bar: false,
    // hérite 200
  },

  {
    pk: "748.9",
    dependencia: "FIGUERES-VILAFANT",
    bloqueo: "↓ BCA ↓",
    radio: "◯ GSMR",
    rc: 18,
    rc_bar: false,
    // hérite 200
  },

  {
    pk: "752.4",
    dependencia: "LIMITE ADIF - LFPSA",
    bloqueo: "↓ BCA ↓",
    radio: "◯ GSMR",
    rc: 18,
    rc_bar: false,
    vmax: 200,
    vmax_bar: false, // pas de barre en toute fin
  },
];

// -----------------------------------------------------------------------------
// FT_LIGNE_IMPAIR : sens IMPAIR
// -----------------------------------------------------------------------------
//
// Même grille de paliers que ci-dessus, mais tableau séparé pour pouvoir diverger plus tard.

export const FT_LIGNE_IMPAIR: FTEntry[] = [
  {
    pk: "615.9",
    dependencia: "CAN TUNIS AV",
    bloqueo: "↓ BCA ↓",
    radio: "◯ GSMR",
    rc: 25,
    rc_bar: false,
    vmax: 30,
    vmax_bar: false, // pas de barre à l'extrémité
  },
  {
    pk: "616.0",
    dependencia: "BIF CAN TUNIS AV",
    bloqueo: "↓ BCA ↓",
    radio: "◯ GSMR",
    rc: 25,
    rc_bar: false,
    // sens IMPAIR (PK décroissants): 616.0→615.9 = 30
    vmax: 30,
    vmax_bar: true,
  },
  {
    pk: "618.1",
    dependencia: "",
    bloqueo: "↓ BCA ↓",
    radio: "◯ GSMR",
    rc: 25,
    rc_bar: false,
    // 618.1→616.0 = 95
    vmax: 95,
    vmax_bar: true,
  },
  {
    pk: "619.9",
    dependencia: "",
    bloqueo: "↓ BCA ↓",
    radio: "◯ GSMR",
    rc: 25,
    rc_bar: false,
    // 619.9→618.1 = 85
    vmax: 85,
    vmax_bar: true,
  },
  {
    pk: "620.2",
    dependencia: "",
    bloqueo: "↓ BCA ↓",
    radio: "◯ GSMR",
    rc: 25,
    rc_bar: false,
    // 620.2→619.9 = 60
    vmax: 60,
    vmax_bar: true,
  },
  {
    pk: "621.0",
    dependencia: "BARCELONA SANTS",
    bloqueo: "↓ BCA ↓",
    radio: "◯ GSMR",
    rc: 28,
    rc_bar: true,
    // 621.7→621.0 = 30
    vmax: 30,
    // pas de barre ici, on garde la barre sur 621.7
  },
  {
    pk: "621.7",
    dependencia: "",
    bloqueo: "↓ BCA ↓",
    radio: "◯ GSMR",
    rc: 28,
    rc_bar: false,
    // 621.7→620.2 = 30
    vmax: 30,
    vmax_bar: true,
  },
  {
    pk: "623.8",
    dependencia: "",
    bloqueo: "↓ BCA ↓",
    radio: "◯ GSMR",
    rc: 28,
    rc_bar: false,
    // 623.8→621.7 = 140
    vmax: 140,
    vmax_bar: true,
  },
  {
    pk: "624.3",
    dependencia: "",
    bloqueo: "↓ BCA ↓",
    radio: "◯ GSMR",
    rc: 28,
    rc_bar: false,
    // 624.3→623.8 = 80
    vmax: 80,
    vmax_bar: true,
  },
  {
    pk: "626.7",
    dependencia: "",
    bloqueo: "↓ BCA ↓",
    radio: "◯ GSMR",
    rc: 28,
    rc_bar: false,
    // 626.7→624.3 = 140
    vmax: 140,
    vmax_bar: true,
  },

  // Remarque rouge AVANT LA SAGRERA AV (texte légèrement différent côté IMPAIR)
  {
    pk: "",
    dependencia: "",
    isNoteOnly: true,
    notes: ["35 VIAS ESTACINAMM. V11, V19 Y V10, V18"],
    bloqueo: "↓ BCA ↓",
    radio: "◯ GSMR",
    rc: 28,
    rc_bar: false,
    // dans cette zone : 627.7→626.7 = 45
  },

  {
    pk: "627.7",
    dependencia: "LA SAGRERA AV",
    bloqueo: "↓ BCA ↓",
    radio: "◯ GSMR",
    rc: 28,
    rc_bar: false,
    // 627.7→626.7 = 45
    vmax: 45,
    vmax_bar: true,
  },

  {
    pk: "629.4",
    dependencia: "",
    bloqueo: "↓ BCA ↓",
    radio: "◯ GSMR",
    rc: 28,
    rc_bar: false,
    // 629.4→627.7 = 45
    vmax: 45,
    vmax_bar: true,
  },
  {
    pk: "630.7",
    dependencia: "",
    bloqueo: "↓ BCA ↓",
    radio: "◯ GSMR",
    rc: 28,
    rc_bar: false,
    // 630.7→629.4 = 110
    vmax: 110,
    vmax_bar: true,
  },
  {
    pk: "632.4",
    dependencia: "",
    bloqueo: "↓ BCA ↓",
    radio: "◯ GSMR",
    rc: 28,
    rc_bar: false,
    // 632.4→630.7 = 130
    vmax: 130,
    vmax_bar: true,
  },
  {
    pk: "634.5",
    dependencia: "",
    bloqueo: "↓ BCA ↓",
    radio: "◯ GSMR",
    rc: 28,
    rc_bar: false,
    // dans la portion 639.8→632.4
    // hérite 200 (sens décroissant)
  },
  {
    pk: "636.6",
    dependencia: "",
    bloqueo: "↓ BCA ↓",
    radio: "◯ GSMR",
    rc: 28,
    rc_bar: false,
    // idem, hérite 200
  },
  {
    pk: "639.8",
    dependencia: "",
    bloqueo: "↓ BCA ↓",
    radio: "◯ GSMR",
    rc: 28,
    rc_bar: false,
    // 639.8→632.4 = 200
    vmax: 200,
    vmax_bar: true,
  },

  {
    pk: "640.5",
    dependencia: "BIF. MOLLET",
    bloqueo: "↓ BCA ↓",
    radio: "◯ GSMR",
    rc: 28,
    rc_bar: false,
    // dans la portion 643.6→639.8
  },
  {
    pk: "641.3",
    dependencia: "BIF. MOLLET-AGUJA KM. 641,3",
    bloqueo: "↓ BCA ↓",
    radio: "◯ GSMR",
    rc: 18,
    rc_bar: true,
    // toujours dans la portion 643.6→639.8
  },
  {
    pk: "641.9",
    dependencia: "",
    bloqueo: "↓ BCA ↓",
    radio: "◯ GSMR",
    rc: 18,
    rc_bar: false,
    // 641.9→639.8 = 185
    vmax: 185,
    vmax_bar: true,
  },
  {
    pk: "643.6",
    dependencia: "",
    bloqueo: "↓ BCA ↓",
    radio: "◯ GSMR",
    rc: 18,
    rc_bar: false,
    // 643.6→641.9 = 195
    vmax: 195,
    vmax_bar: true,
  },
  {
    pk: "644.3",
    dependencia: "BIF. MOLLET-AG.KM. 644.3",
    bloqueo: "↓ BCA ↓",
    radio: "◯ GSMR",
    rc: 18,
    rc_bar: false,
    // dans la portion 709.9→643.6 (200), puis 643.6→641.9 (195) selon le sens
  },

  {
    pk: "654.4",
    dependencia: "",
    bloqueo: "↓ BCA ↓",
    radio: "◯ GSMR",
    rc: 18,
    rc_bar: false,
    // hérite 200
  },
  {
    pk: "655.6",
    dependencia: "",
    bloqueo: "↓ BCA ↓",
    radio: "◯ GSMR",
    rc: 18,
    rc_bar: false,
    // hérite 200
  },
  {
    pk: "655.8",
    dependencia: "",
    bloqueo: "↓ BCA ↓",
    radio: "◯ GSMR",
    rc: 18,
    rc_bar: false,
    // hérite 200
  },
  {
    pk: "660.8",
    dependencia: "",
    bloqueo: "↓ BCA ↓",
    radio: "◯ GSMR",
    rc: 18,
    rc_bar: false,
    // hérite 200
  },
  {
    pk: "661.5",
    dependencia: "",
    bloqueo: "↓ BCA ↓",
    radio: "◯ GSMR",
    rc: 18,
    rc_bar: false,
    // hérite 200
  },
  {
    pk: "662.0",
    dependencia: "",
    bloqueo: "↓ BCA ↓",
    radio: "◯ GSMR",
    rc: 18,
    rc_bar: false,
    // hérite 200
  },

  {
    pk: "662.1",
    dependencia: "LLINARS-A. V",
    bloqueo: "↓ BCA ↓",
    radio: "◯ GSMR",
    rc: 18,
    rc_bar: false,
    // hérite 200
  },

  {
    pk: "673.5",
    dependencia: "",
    bloqueo: "↓ BCA ↓",
    radio: "◯ GSMR",
    rc: 18,
    rc_bar: false,
    // hérite 200
  },

  {
    pk: "678.1",
    dependencia: "RIELLS-A. V",
    bloqueo: "↓ BCA ↓",
    radio: "◯ GSMR",
    rc: 18,
    rc_bar: false,
    // hérite 200
  },

  {
    pk: "680.2",
    dependencia: "",
    bloqueo: "↓ BCA ↓",
    radio: "◯ GSMR",
    rc: 18,
    rc_bar: false,
    // hérite 200
  },

  {
    pk: "682.0",
    dependencia: "BASE MTO. RIELLS",
    bloqueo: "↓ BCA ↓",
    radio: "◯ GSMR",
    rc: 18,
    rc_bar: false,
    // hérite 200
  },

  {
    pk: "684.0",
    dependencia: "",
    bloqueo: "↓ BCA ↓",
    radio: "◯ GSMR",
    rc: 18,
    rc_bar: false,
    // hérite 200
  },

  {
    pk: "703.5",
    dependencia: "VILOBI D'ONYAR",
    bloqueo: "↓ BCA ↓",
    radio: "◯ GSMR",
    rc: 18,
    rc_bar: false,
    // hérite 200
  },

  {
    pk: "707.1",
    dependencia: "",
    bloqueo: "↓ BCA ↓",
    radio: "◯ GSMR",
    rc: 18,
    rc_bar: false,
    // dans la portion 709.9→703.5 = 200
  },

  {
    pk: "709.9",
    dependencia: "",
    bloqueo: "↓ BCA ↓",
    radio: "◯ GSMR",
    rc: 18,
    rc_bar: false,
    // 709.9→643.6 = 200
    vmax: 200,
    vmax_bar: true,
  },

  {
    pk: "710.7",
    dependencia: "BIF. GIRONA-MERCADERIES",
    bloqueo: "↓ BCA ↓",
    radio: "◯ GSMR",
    rc: 18,
    rc_bar: false,
    // dans la portion 713.2→709.9 = 125
    // -> pas de vmax ni de barre cosmétique dans ce sens
  },

  {
    pk: "713.2",
    dependencia: "",
    bloqueo: "↓ BCA ↓",
    radio: "◯ GSMR",
    rc: 18,
    rc_bar: false,
    // 713.2→709.9 = 125
    vmax: 125,
    vmax_bar: true,
  },

  {
    pk: "714.7",
    dependencia: "GIRONA",
    bloqueo: "↓ BCA ↓",
    radio: "◯ GSMR",
    rc: 18,
    rc_bar: false,
    // 714.7→713.2 = 120
    vmax: 120,
    vmax_highlight: true,
    vmax_bar: true,
  },

  {
    pk: "715.5",
    dependencia: "",
    bloqueo: "↓ BCA ↓",
    radio: "◯ GSMR",
    rc: 18,
    rc_bar: false,
    // 715.5→714.7 = 120
    vmax: 120,
    vmax_highlight: true,
    vmax_bar: true,
  },

  {
    pk: "716.8",
    dependencia: "",
    bloqueo: "↓ BCA ↓",
    radio: "◯ GSMR",
    rc: 18,
    rc_bar: false,
    // 716.8→715.5 = 165
    vmax: 165,
    vmax_bar: true,
  },

  {
    pk: "720.0",
    dependencia: "",
    bloqueo: "↓ BCA ↓",
    radio: "◯ GSMR",
    rc: 18,
    rc_bar: false,
    // dans la portion 752.4→716.8 = 200
  },
  {
    pk: "723.7",
    dependencia: "",
    bloqueo: "↓ BCA ↓",
    radio: "◯ GSMR",
    rc: 18,
    rc_bar: false,
    // idem, hérite 200
  },

  // Remarque rouge AVANT FIGUERES-VILAFANT (IMPAIR)
  {
    pk: "",
    dependencia: "",
    isNoteOnly: true,
    notes: ["80 AL PASO VIAS 3, 4 Y 6"],
    bloqueo: "↓ BCA ↓",
    radio: "◯ GSMR",
    rc: 18,
    rc_bar: false,
  },

  {
    pk: "748.9",
    dependencia: "FIGUERES-VILAFANT",
    bloqueo: "↓ BCA ↓",
    radio: "◯ GSMR",
    rc: 18,
    rc_bar: false,
    // dans la portion 752.4→716.8 = 200
  },

  {
    pk: "752.4",
    dependencia: "LIMITE ADIF - LFPSA",
    bloqueo: "↓ BCA ↓",
    radio: "◯ GSMR",
    rc: 18,
    rc_bar: false,
    // 752.4→716.8 = 200, extrémité : pas de barre
    vmax: 200,
    vmax_bar: false,
  },
];
