// src/components/LIM/FT.tsx
import FTScrolling from "./FTScrolling"; // Ajouter cette ligne juste après les autres imports
import React, { useState, useEffect, useMemo } from "react";
import {
  FT_LIGNE_PAIR,
  FT_LIGNE_IMPAIR,
  CSV_ZONES,
  type FTEntry,
  type CsvSens,
} from "../../data/ligneFT";
import { logTestEvent } from "../../lib/testLogger";

type GpsPosition = {
  lat: number;
  lon: number;
  accuracy?: number;
  pk?: number | null;
  s_km?: number | null;
  distance_m?: number | null;
  onLine?: boolean;
  timestamp?: number;
};

type ReferenceMode = "HORAIRE" | "GPS";

type FTProps = {
  variant?: "classic" | "modern";
};

export default function FT({ variant = "classic" }: FTProps) {
  const [visibleRows, setVisibleRows] = React.useState<{ first: number; last: number }>({
    first: 0,
    last: 0,
  });
  // ligne "active" quand on est en mode horaire (play)
  const [activeRowIndex, setActiveRowIndex] = useState<number>(0);

  // source de référence pour la ligne active : horaire ou GPS
  const [referenceMode, setReferenceMode] = useState<ReferenceMode>("HORAIRE");

  // ligne actuellement sélectionnée pour le recalage manuel
  const [selectedRowIndex, setSelectedRowIndex] = useState<number | null>(null);

  // mode test (active les overlays de debug FT)
  const [testModeEnabled, setTestModeEnabled] = useState(false);


  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    scrollContainerRef.current = el;

    const scrollTop = el.scrollTop;

    const clientHeight = el.clientHeight;

    // --- Gestion scroll manuel vs scroll automatique ---
    if (autoScrollEnabled) {
      if (isProgrammaticScrollRef.current) {
        // Scroll provoqué par notre code (auto-scroll) → on ne déclenche pas le mode manuel
        isProgrammaticScrollRef.current = false;
        // On met à jour la position "officielle" de l'auto-scroll
        lastAutoScrollTopRef.current = scrollTop;
      } else {
        // Scroll manuel utilisateur pendant que le mode horaire est actif
        isManualScrollRef.current = true;

        // On relance un timer de 5s à chaque nouveau mouvement manuel
        if (manualScrollTimeoutRef.current !== null) {
          window.clearTimeout(manualScrollTimeoutRef.current);
        }

        manualScrollTimeoutRef.current = window.setTimeout(() => {
          manualScrollTimeoutRef.current = null;
          isManualScrollRef.current = false;

          const container = scrollContainerRef.current;
          if (!container) return;
          if (!autoScrollEnabledRef.current) return;

          const target = lastAutoScrollTopRef.current;
          if (target == null) return;

          // On revient à la position auto d'avant le scroll manuel
          isProgrammaticScrollRef.current = true;
          container.scrollTo({
            top: target,
            behavior: "auto",
          });
        }, 5000);
      }
    } else {
      // Mode horaire coupé → on désactive toute logique de retour auto
      isManualScrollRef.current = false;
      if (manualScrollTimeoutRef.current !== null) {
        window.clearTimeout(manualScrollTimeoutRef.current);
        manualScrollTimeoutRef.current = null;
      }
    }

    // 1) on récupère les lignes principales
    const rowEls = el.querySelectorAll<HTMLTableRowElement>("tr.ft-row-main");
    if (!rowEls.length) return;

    // 2) première ligne dont le bas est sous le haut du viewport
    let firstVisible = 0;
    for (let i = 0; i < rowEls.length; i++) {
      const r = rowEls[i];
      const top = r.offsetTop;
      const bottom = top + r.offsetHeight;
      if (bottom >= scrollTop) {
        firstVisible = i;
        break;
      }
    }

    // 3) dernière ligne dont le haut est encore dans le viewport
    const viewportBottom = scrollTop + clientHeight;
    let lastVisible = firstVisible;
    for (let i = firstVisible; i < rowEls.length; i++) {
      const r = rowEls[i];
      const top = r.offsetTop;
      if (top <= viewportBottom) {
        lastVisible = i;
      } else {
        break;
      }
    }

    console.log(
      "[FT][scroll] scrollTop=",
      scrollTop,
      " / clientHeight=",
      clientHeight,
      " / rows=",
      rowEls.length
    );
    console.log("[FT][visible-rows] first=", firstVisible, "last=", lastVisible);

    // log labo
    logTestEvent("ft:scroll:viewport", {
      scrollTop,
      clientHeight,
      rowCount: rowEls.length,
      firstVisible,
      lastVisible,
      autoScrollEnabled,
      referenceMode: referenceModeRef.current,
      isManualScroll: isManualScrollRef.current,
      isProgrammaticScroll: isProgrammaticScrollRef.current,
    });

    // on met à jour le state
    setVisibleRows({ first: firstVisible, last: lastVisible });
  };

  //
  // ===== 1. NUMÉRO DE TRAIN ET PORTION DE PARCOURS ===================
  //
  // trainNumber = numéro du train (sans les zéros initiaux), reçu via lim:train / lim:train-change
  // routeStart / routeEnd = gares extrémités du parcours réel (ex "Barcelona Sants" → "Can Tunis AV")
  //
  const [trainNumber, setTrainNumber] = useState<number | null>(null);

  const [routeStart, setRouteStart] = useState<string>("");
  const [routeEnd, setRouteEnd] = useState<string>("");

  // 🕐 Heures détectées (reçues via ft:heures)
  const [heuresDetectees, setHeuresDetectees] = useState<string[]>([]);

  // 🅲 Codes "Com" détectés (reçus via ft:codesC)
  const [codesCFlat, setCodesCFlat] = useState<string[]>([]);

  // 🅲 Codes "Com" résolus par heure (via ft:codesC:resolved)
  const [codesCParHeure, setCodesCParHeure] = useState<Record<string, string[]>>(
    {}
  );

  // 🔁 Valeurs CONC résolues par heure (via ft:conc:resolved)
  const [concParHeure, setConcParHeure] = useState<Record<string, string[]>>({});
  const rcPrintedSegmentsRef = React.useRef<Set<number>>(new Set());
  const vPrintedSegmentsRef = React.useRef<Set<number>>(new Set());
  const arrivalEventsRef = React.useRef<
    { arrivalMin: number; rowIndex: number }[]
  >([]);

  // -- écoute du numéro de train
  useEffect(() => {
    function handleIncomingTrain(e: any, sourceName: string) {
      if (!e?.detail) return;
      const raw = e.detail.trainNumber;
      const n = typeof raw === "number" ? raw : parseInt(raw, 10);
      if (!isNaN(n)) {
        console.log("[FT] Reçu event " + sourceName + ", trainNumber=", n);
        setTrainNumber(n);
      } else {
        console.warn(
          "[FT] Event " + sourceName + " reçu mais trainNumber illisible:",
          e.detail
        );
      }
    }

    function handlerTrainChange(e: any) {
      handleIncomingTrain(e, "lim:train-change");
    }

    function handlerTrain(e: any) {
      handleIncomingTrain(e, "lim:train");
    }

    window.addEventListener(
      "lim:train-change",
      handlerTrainChange as EventListener
    );
    window.addEventListener("lim:train", handlerTrain as EventListener);

    return () => {
      window.removeEventListener(
        "lim:train-change",
        handlerTrainChange as EventListener
      );
      window.removeEventListener("lim:train", handlerTrain as EventListener);
    };
  }, []);

  // -- écoute des infos LIM complètes pour récupérer origenDestino (origine → destination)
  useEffect(() => {
    function handlerLimParsed(e: any) {
      const d = e?.detail || {};
      const odRaw = d.origenDestino ?? d.relation ?? "";
      if (typeof odRaw === "string" && odRaw.trim().length > 0) {
        // ex: "Barcelona Sants - Can Tunis AV"
        // ex: "Figueres-Vilafant - Limite ADIF - LFPSA"
        //
        // stratégie : split sur tirets " - " et on prend [0] comme origine et [last] comme destination.
        const parts = odRaw
          .split(/\s*[-–]\s*/)
          .map((s: string) => s.trim())
          .filter(Boolean);

        if (parts.length >= 2) {
          const start = parts[0];
          const end = parts[parts.length - 1];
          console.log(
            "[FT] lim:parsed origenDestino=",
            odRaw,
            "=>",
            start,
            "→",
            end
          );
          setRouteStart(start);
          setRouteEnd(end);
        } else {
          console.warn("[FT] origenDestino non découpable:", odRaw);
        }
      }
    }

    window.addEventListener("lim:parsed", handlerLimParsed as EventListener);
    return () => {
      window.removeEventListener(
        "lim:parsed",
        handlerLimParsed as EventListener
      );
    };
  }, []);

  // -- écoute des heures détectées par ftParser (ft:heures)
  useEffect(() => {
    function handlerFtHeures(e: any) {
      const d = e?.detail || {};
      const byPage = Array.isArray(d.byPage) ? d.byPage : [];
      const heures: string[] = byPage.flatMap((p: any) =>
        Array.isArray(p?.heures) ? p.heures : []
      );

      setHeuresDetectees(heures);

      // Log simple pour validation (aucune modif du tableau à ce stade)
      console.log("[FT] Reçu ft:heures — total=", heures.length, heures);
    }

    window.addEventListener("ft:heures", handlerFtHeures as EventListener);
    return () => {
      window.removeEventListener("ft:heures", handlerFtHeures as EventListener);
    };
  }, []);

  // -- écoute des codes C (ft:codesC) — MAJ d'état + logs
  useEffect(() => {
    function handlerFtCodesC(e: any) {
      const detail = e?.detail ?? {};
      const flat: string[] = Array.isArray((detail as any).flat)
        ? (detail as any).flat
        : [];
      const byPage: any[] = Array.isArray((detail as any).byPage)
        ? (detail as any).byPage
        : [];

      // ➜ Met à jour l'état centralisé pour un usage futur (mapping, affichage)
      setCodesCFlat(flat);

      // Logs de contrôle (on garde un aperçu par page)
      const perPageCounts = byPage.map((p: any) => ({
        page: p?.page,
        count: Array.isArray(p?.values) ? p.values.length : 0,
        sample: Array.isArray(p?.values) ? p.values.slice(0, 6) : [],
      }));
      console.log("[FT] Reçu ft:codesC — total=", flat.length, {
        perPage: perPageCounts,
        flatSample: flat.slice(0, 20),
      });
    }

    window.addEventListener("ft:codesC", handlerFtCodesC as EventListener);
    return () => {
      window.removeEventListener("ft:codesC", handlerFtCodesC as EventListener);
    };
  }, []);

  // -- écoute des codes C résolus avec leur heure (ft:codesC:resolved)
  useEffect(() => {
    function handlerFtCodesCResolved(e: any) {
      const d = e?.detail ?? {};
      const items = Array.isArray(d.items) ? d.items : [];
      const map: Record<string, string[]> = {};

      for (const it of items) {
        const heure = (it.heure ?? "").trim();
        const com = (it.com ?? "").trim();
        if (!heure || !com) continue;
        if (!map[heure]) map[heure] = [];
        map[heure].push(com);
      }

      setCodesCParHeure(map);
      console.log("[FT] Reçu ft:codesC:resolved => codesCParHeure =", map);
    }

    window.addEventListener(
      "ft:codesC:resolved",
      handlerFtCodesCResolved as EventListener
    );
    return () => {
      window.removeEventListener(
        "ft:codesC:resolved",
        handlerFtCodesCResolved as EventListener
      );
    };
  }, []);

  // -- écoute des valeurs CONC résolues avec leur heure (ft:conc:resolved)
  useEffect(() => {
    function handlerFtConcResolved(e: any) {
      const d = e?.detail ?? {};
      const items = Array.isArray(d.items) ? d.items : [];
      const map: Record<string, string[]> = {};

      for (const it of items) {
        const heure = (it.heure ?? "").trim();
        const conc = (it.conc ?? "").trim();
        if (!heure || !conc) continue;
        if (!map[heure]) map[heure] = [];
        map[heure].push(conc);
      }

      setConcParHeure(map);
      console.log("[FT] Reçu ft:conc:resolved => concParHeure =", map);
    }

    window.addEventListener(
      "ft:conc:resolved",
      handlerFtConcResolved as EventListener
    );
    return () => {
      window.removeEventListener(
        "ft:conc:resolved",
        handlerFtConcResolved as EventListener
      );
    };
  }, []);

  // -- écoute du bouton play/pause (auto-scroll) venant du TitleBar
  const [autoScrollEnabled, setAutoScrollEnabled] = useState(false);
  const autoScrollEnabledRef = React.useRef(false);
  const referenceModeRef = React.useRef<ReferenceMode>("HORAIRE");

  useEffect(() => {
    referenceModeRef.current = referenceMode;
  }, [referenceMode]);

  useEffect(() => {
    autoScrollEnabledRef.current = autoScrollEnabled;
  }, [autoScrollEnabled]);

  useEffect(() => {
    console.log("[FT][mode] referenceMode changé =>", referenceMode);

    logTestEvent("ft:reference-mode", {
      mode: referenceMode,
    });

    window.dispatchEvent(
      new CustomEvent("lim:reference-mode", {
        detail: { mode: referenceMode },
      })
    );
  }, [referenceMode]);

  // écoute du mode test (ON/OFF)
  useEffect(() => {
    function handleTestMode(e: any) {
      const enabled = !!e?.detail?.enabled;
      setTestModeEnabled(enabled);
    }

    window.addEventListener("lim:test-mode", handleTestMode as EventListener);
    return () => {
      window.removeEventListener("lim:test-mode", handleTestMode as EventListener);
    };
  }, []);

  const autoScrollBaseRef =
    React.useRef<{ realMin: number; firstHoraMin: number; fixedDelay: number } | null>(null);

  // Ligne cible pour un recalage manuel (mode Standby)
  const recalibrateFromRowRef = React.useRef<number | null>(null);
  // Dernière ligne FT utilisée comme “point d’ancrage” GPS
  const lastAnchoredRowRef = React.useRef<number | null>(null);
  // Premier démarrage déjà “consommé” ?
  const initialStandbyDoneRef = React.useRef(false);
  // Index de la première ligne principale non-noteOnly (tenu à jour plus bas)
  const firstNonNoteIndexRef = React.useRef<number | null>(null);

  // Lorsque le mode de référence repasse en GPS, on nettoie toute sélection Standby / recalage manuel
  useEffect(() => {
    if (referenceMode !== "GPS") return;

    if (selectedRowIndex !== null) {
      setSelectedRowIndex(null);
    }
    recalibrateFromRowRef.current = null;
  }, [referenceMode, selectedRowIndex]);

  // Référence vers le conteneur scrollable de FTScrolling
  const scrollContainerRef = React.useRef<HTMLDivElement | null>(null);

  // Dernière position GPS reçue (mémorisée pour les futurs calculs)
  const lastGpsPositionRef = React.useRef<GpsPosition | null>(null);

  // ===== GPS quality (fresh + freeze) =====
  type GpsState = "RED" | "ORANGE" | "GREEN";

  const gpsStateRef = React.useRef<GpsState>("RED");

  // Pour détecter une position "fraîche"
  const lastGpsSampleAtRef = React.useRef<number>(0);

  // Pour détecter un PK figé
  const lastPkRef = React.useRef<number | null>(null);
  const lastPkChangeAtRef = React.useRef<number>(0);

  // Réglages (ajustables)
  const GPS_FRESH_SEC = 8; // si l'échantillon est plus vieux -> pas "green"
  const GPS_FREEZE_WINDOW_MS = 10_000; // PK inchangé trop longtemps -> orange
  const GPS_FREEZE_PK_DELTA_KM = 0.02; // 0.02 km = 20 m

  const ORANGE_TIMEOUT_MS = 30_000;

  // État "GPS OK" (fix + sur la ligne) pour l'hystérésis
  const gpsHealthyRef = React.useRef<boolean>(false);


  // Timer en cours pour le passage différé en mode HORAIRE
  const orangeTimeoutRef = React.useRef<number | null>(null);

    // Timestamp de démarrage de l’hystérésis ORANGE (pour calcul remaining/elapsed)
  const orangeTimeoutStartedAtRef = React.useRef<number | null>(null);

  // Suivi du scroll manuel pendant que le mode horaire est actif
  const isManualScrollRef = React.useRef(false);
  const manualScrollTimeoutRef = React.useRef<number | null>(null);
  const lastAutoScrollTopRef = React.useRef<number | null>(null);
  const isProgrammaticScrollRef = React.useRef(false);

  useEffect(() => {
    function handlerAutoScroll(e: any) {
      const detail = e?.detail ?? {};
      const enabled = !!detail.enabled;
      const standby = !!detail.standby;

      // 🎯 Cas spécial : 1er clic sur Play -> Standby initial + sélection 1ʳᵉ ligne
      if (enabled && !initialStandbyDoneRef.current) {
        const idx = firstNonNoteIndexRef.current;
        if (typeof idx === "number" && idx >= 0) {
          initialStandbyDoneRef.current = true;

          console.log(
            "[FT] Premier Play reçu, passage en Standby initial sur la ligne",
            idx
          );

          // Sélection visuelle (cadre rouge)
          setSelectedRowIndex(idx);
          // Base de recalage pour le futur démarrage réel
          recalibrateFromRowRef.current = idx;

          // On NE démarre PAS l'auto-scroll : autoScrollEnabled reste false
          setAutoScrollEnabled(false);

          // On signale à la TitleBar qu'on est en mode horaire Standby (🕑 orange)
          window.dispatchEvent(
            new CustomEvent("lim:hourly-mode", {
              detail: { enabled: false, standby: true },
            })
          );

          return;
        }
      }

      console.log(
        "[FT] ft:auto-scroll-change reçu, enabled =",
        enabled,
        "/ standby =",
        standby
      );

      // 👉 Le bouton Play/Pause ne pilote QUE l'auto-scroll, pas le mode de référence
      setAutoScrollEnabled(enabled);

      // On informe la TitleBar de l'état horaire / standby
      window.dispatchEvent(
        new CustomEvent("lim:hourly-mode", {
          detail: { enabled, standby },
        })
      );
    }

    window.addEventListener(
      "ft:auto-scroll-change",
      handlerAutoScroll as EventListener
    );

    return () => {
      window.removeEventListener(
        "ft:auto-scroll-change",
        handlerAutoScroll as EventListener
      );
    };
  }, []);

  // quand le mode auto-scroll (play) s'allume/s'éteint
  useEffect(() => {
    if (!autoScrollEnabled) {
      // on NE TOUCHE PLUS au delta horaire :
      // - on garde la dernière valeur affichée dans la TitleBar
      // - la base interne est simplement réinitialisée
      autoScrollBaseRef.current = null;

      // On désactive tout éventuel scroll manuel en cours
      isManualScrollRef.current = false;
      if (manualScrollTimeoutRef.current !== null) {
        window.clearTimeout(manualScrollTimeoutRef.current);
        manualScrollTimeoutRef.current = null;
      }
      return;
    }

    // helpers
    const toMinutes = (s: string) => {
      const m = /^(\d{1,2}):(\d{2})$/.exec(s);
      if (!m) return NaN;
      return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
    };
    const minutesToHHMM = (mins: number) => {
      // on replie sur 24h si besoin
      const total = ((mins % (24 * 60)) + (24 * 60)) % (24 * 60);
      const hh = Math.floor(total / 60)
        .toString()
        .padStart(2, "0");
      const mm = (total % 60).toString().padStart(2, "0");
      return `${hh}:${mm}`;
    };

    // ➜ nouvel helper : delta arrondi à la minute la plus proche
    const computeFixedDelayMinutes = (now: Date, ftMinutes: number) => {
      const nowTotalSec =
        now.getHours() * 3600 +
        now.getMinutes() * 60 +
        now.getSeconds();
      const ftTotalSec = ftMinutes * 60;
      const deltaSec = nowTotalSec - ftTotalSec;
      // arrondi à la minute entière la plus proche
      return Math.round(deltaSec / 60);
    };

    // Base "classique" : à partir de la première heure FT dispo
    const captureBaseFromFirstRow = () => {
      const now = new Date();
      const nowMin = now.getHours() * 60 + now.getMinutes();

      const mainRows = document.querySelectorAll<HTMLTableRowElement>(
        "table.ft-table tbody tr.ft-row-main"
      );
      if (!mainRows.length) return null;

      let firstHoraMin: number | null = null;
      for (let i = 0; i < mainRows.length; i++) {
        const tr = mainRows[i];
        const horaSpan = tr.querySelector<HTMLSpanElement>(
          "td:nth-child(6) .ft-hora-depart"
        );
        if (!horaSpan) continue;
        const horaText = horaSpan.textContent?.trim() || "";
        if (!horaText) continue;
        const rowMin = toMinutes(horaText);
        if (!Number.isNaN(rowMin)) {
          firstHoraMin = rowMin;
          break;
        }
      }

      if (firstHoraMin == null) return null;

      // 🔒 on fige l’avance/retard de départ (arrondi)
      const fixedDelay = computeFixedDelayMinutes(now, firstHoraMin);

      return { realMin: nowMin, firstHoraMin, fixedDelay };
    };

    // Base "mode Standby" : à partir de la ligne sélectionnée
    const captureBaseFromRowIndex = (rowIndex: number) => {
      const now = new Date();
      const nowMin = now.getHours() * 60 + now.getMinutes();

      const mainRows = document.querySelectorAll<HTMLTableRowElement>(
        "table.ft-table tbody tr.ft-row-main"
      );
      if (!mainRows.length) return null;

      let targetRow: HTMLTableRowElement | null = null;
      for (let i = 0; i < mainRows.length; i++) {
        const tr = mainRows[i];
        const attr = tr.getAttribute("data-ft-row");
        const idx = attr ? parseInt(attr, 10) : i;
        if (idx === rowIndex) {
          targetRow = tr;
          break;
        }
      }
      if (!targetRow) return null;

      const horaSpan = targetRow.querySelector<HTMLSpanElement>(
        "td:nth-child(6) .ft-hora-depart"
      );
      const horaText = horaSpan?.textContent?.trim() || "";
      if (!horaText) return null;

      const rowMin = toMinutes(horaText);
      if (Number.isNaN(rowMin)) return null;

      // 🔒 avance/retard arrondi sur la ligne choisie
      const fixedDelay = computeFixedDelayMinutes(now, rowMin);
      return { realMin: nowMin, firstHoraMin: rowMin, fixedDelay };
    };

    // ✅ Choix de la base : soit ligne sélectionnée (Standby), soit première ligne
    const forcedIndex = recalibrateFromRowRef.current;
    if (forcedIndex != null) {
      autoScrollBaseRef.current = captureBaseFromRowIndex(forcedIndex);
      recalibrateFromRowRef.current = null;
    } else {
      autoScrollBaseRef.current = captureBaseFromFirstRow();
    }

    // On mémorise la position de scroll actuelle comme "base"
    if (scrollContainerRef.current) {
      lastAutoScrollTopRef.current = scrollContainerRef.current.scrollTop;
    }

    if (autoScrollBaseRef.current) {
      const fixed = autoScrollBaseRef.current.fixedDelay;
      const text =
        fixed === 0 ? "0 min" : fixed > 0 ? `+ ${fixed} min` : `- ${-fixed} min`;
      window.dispatchEvent(
        new CustomEvent("lim:schedule-delta", {
          detail: {
            text,
            isLargeDelay: Math.abs(fixed) >= 5,
          },
        })
      );
    }

    const updateFromClock = (forcedHHMM?: string) => {
      // si heure forcée (console), on garde l'ancien comportement
      if (forcedHHMM && /^\d{1,2}:\d{2}$/.test(forcedHHMM)) {
        const mainRows = document.querySelectorAll<HTMLTableRowElement>(
          "table.ft-table tbody tr.ft-row-main"
        );
        if (!mainRows.length) return;

        const targetMin = toMinutes(forcedHHMM);
        if (Number.isNaN(targetMin)) return;

        let exactMatchDomIndex = -1;
        let lastPastDomIndex = -1;

        for (let i = 0; i < mainRows.length; i++) {
          const tr = mainRows[i];
          const horaSpan = tr.querySelector<HTMLSpanElement>(
            "td:nth-child(6) .ft-hora-depart"
          );
          if (!horaSpan) continue;
          const horaText = horaSpan.textContent?.trim() || "";
          if (!horaText) continue;
          const rowMin = toMinutes(horaText);
          if (Number.isNaN(rowMin)) continue;

          if (rowMin === targetMin && exactMatchDomIndex === -1) {
            exactMatchDomIndex = i;
          }
          if (rowMin <= targetMin) {
            lastPastDomIndex = i;
          }
        }

        const domIndex =
          exactMatchDomIndex !== -1
            ? exactMatchDomIndex
            : lastPastDomIndex !== -1
            ? lastPastDomIndex
            : 0;

        const tr = mainRows[domIndex];
        const dataIndexAttr = tr.getAttribute("data-ft-row");
        const dataIndex = dataIndexAttr ? parseInt(dataIndexAttr, 10) : domIndex;
        setActiveRowIndex(dataIndex);
        return;
      }

      const base = autoScrollBaseRef.current;
      if (!base) return;

      // heure réelle actuelle
      const now = new Date();
      const nowMin = now.getHours() * 60 + now.getMinutes();

      // minutes écoulées depuis l’activation
      const elapsed = nowMin - base.realMin;

      // heure FT qu’on veut suivre
      const effectiveMin = base.firstHoraMin + elapsed;
      const effectiveHHMM = minutesToHHMM(effectiveMin);

      // on met dans la console exactement ce que tu veux regarder
      console.log(
        `[FT][auto] heure réelle = ${minutesToHHMM(
          nowMin
        )} | première heure FT = ${minutesToHHMM(
          base.firstHoraMin
        )} | diff (minutes depuis activation) = ${elapsed} | heure EFFECTIVE utilisée pour le '>' = ${effectiveHHMM}`
      );

      logTestEvent("ft:delta:tick", {
        nowHHMM: minutesToHHMM(nowMin),
        baseFirstHoraHHMM: minutesToHHMM(base.firstHoraMin),
        elapsedMinutes: elapsed,
        effectiveHHMM,
        fixedDelay: base.fixedDelay ?? null,
      });

      // 🔁 PAUSE AUTOMATIQUE SUR HEURE D’ARRIVÉE
      if (referenceModeRef.current === "HORAIRE") {
        const arrivalList = arrivalEventsRef.current || [];
        if (Array.isArray(arrivalList) && arrivalList.length > 0) {
          const matchingArrival = arrivalList.find(
            (ev) => ev.arrivalMin === effectiveMin
          );

          if (matchingArrival) {
            console.log(
              "[FT][auto] Arrêt automatique sur arrivée calculée, rowIndex =",
              matchingArrival.rowIndex,
              "arrivalMin =",
              matchingArrival.arrivalMin
            );

            logTestEvent("ft:auto:arrival-stop", {
              rowIndex: matchingArrival.rowIndex,
              arrivalMin: matchingArrival.arrivalMin,
              effectiveHHMM,
            });

            // On place la ligne active et la sélection sur cette arrivée
            setActiveRowIndex(matchingArrival.rowIndex);

            setSelectedRowIndex(matchingArrival.rowIndex);
            recalibrateFromRowRef.current = matchingArrival.rowIndex;

            // 👉 NOUVEAU : on recale immédiatement la FT sur cette ligne
            const container = scrollContainerRef.current;
            if (container) {
              const activeRow = document.querySelector<HTMLTableRowElement>(
                `tr.ft-row-main[data-ft-row="${matchingArrival.rowIndex}"]`
              );
              const refLine = document.querySelector<HTMLDivElement>(".ft-active-line");

              if (activeRow && refLine) {
                const rowRect = activeRow.getBoundingClientRect();
                const refRect = refLine.getBoundingClientRect();

                const rowCenterY = rowRect.top + rowRect.height / 2;
                const refCenterY = refRect.top + refRect.height / 2;
                const delta = rowCenterY - refCenterY;

                if (delta !== 0) {
                  const currentScrollTop = container.scrollTop;
                  let targetScrollTop = currentScrollTop + delta;

                  const maxScrollTop = container.scrollHeight - container.clientHeight;
                  if (maxScrollTop >= 0) {
                    if (targetScrollTop < 0) targetScrollTop = 0;
                    if (targetScrollTop > maxScrollTop) targetScrollTop = maxScrollTop;

                    isProgrammaticScrollRef.current = true;
                    container.scrollTo({
                      top: targetScrollTop,
                      behavior: "auto",
                    });
                    lastAutoScrollTopRef.current = targetScrollTop;
                  }
                }
              }
            }

            // On coupe l’auto-scroll et on passe en Standby (même logique que clic)
            window.dispatchEvent(
              new CustomEvent("ft:auto-scroll-change", {
                detail: { enabled: false },
              })
            );

            window.dispatchEvent(
              new CustomEvent("lim:hourly-mode", {
                detail: { enabled: false, standby: true },
              })
            );

            // On s’arrête là pour cette minute : plus de recalage auto
            return;
          }
        }
      }

      // on cherche la ligne FT la plus proche de cette heure effective
      const mainRows = document.querySelectorAll<HTMLTableRowElement>(
        "table.ft-table tbody tr.ft-row-main"
      );
      if (!mainRows.length) return;

      let exactMatchDomIndex = -1;
      let lastPastDomIndex = -1;

      for (let i = 0; i < mainRows.length; i++) {
        const tr = mainRows[i];
        const horaSpan = tr.querySelector<HTMLSpanElement>(
          "td:nth-child(6) .ft-hora-depart"
        );
        if (!horaSpan) continue;
        const horaText = horaSpan.textContent?.trim() || "";
        if (!horaText) continue;
        const rowMin = toMinutes(horaText);
        if (Number.isNaN(rowMin)) continue;

        if (rowMin === effectiveMin && exactMatchDomIndex === -1) {
          exactMatchDomIndex = i;
        }
        if (rowMin <= effectiveMin) {
          lastPastDomIndex = i;
        }
      }

      const domIndex =
        exactMatchDomIndex !== -1
          ? exactMatchDomIndex
          : lastPastDomIndex !== -1
          ? lastPastDomIndex
          : 0;

      const tr = mainRows[domIndex];
      const dataIndexAttr = tr.getAttribute("data-ft-row");
      const dataIndex = dataIndexAttr ? parseInt(dataIndexAttr, 10) : domIndex;

      // 👉 Le moteur horaire ne pilote la ligne active que si on est en mode HORAIRE
      if (referenceModeRef.current === "HORAIRE") {
        setActiveRowIndex(dataIndex);
      }

      // pour la TitleBar : on renvoie le décalage figé au moment du play
      const fixed = base.fixedDelay ?? 0;
      const text =
        fixed === 0 ? "0 min" : fixed > 0 ? `+ ${fixed} min` : `- ${-fixed} min`;
      window.dispatchEvent(
        new CustomEvent("lim:schedule-delta", {
          detail: {
            text,
            isLargeDelay: Math.abs(fixed) >= 5,
          },
        })
      );
    };

    // premier calage immédiat
    updateFromClock();

    // recalcule chaque minute (heure réelle)
    const timer = setInterval(() => {
      updateFromClock();
    }, 60_000);

    const handleForceTime = (e: Event) => {
      const ce = e as CustomEvent;
      const time = ce?.detail?.time as string | undefined;
      if (time) {
        console.log("[FT] heure forcée =", time);
        updateFromClock(time);
      }
    };
    window.addEventListener("ft:force-time", handleForceTime as EventListener);

    return () => {
      clearInterval(timer);
      window.removeEventListener(
        "ft:force-time",
        handleForceTime as EventListener
      );
    };
  }, [autoScrollEnabled]);

  // avance auto de la ligne active tant qu'on est en play :
  // on ajuste le scroll pour rapprocher la ligne active de la ligne rouge
  // (on autorise désormais le scroll à monter OU descendre),
  // quel que soit le mode de référence (HORAIRE ou GPS).
  useEffect(() => {
    if (!autoScrollEnabled) return;
    if (activeRowIndex == null) return;

    const container = scrollContainerRef.current;
    if (!container) return;

    const activeRow = document.querySelector<HTMLTableRowElement>(
      `tr.ft-row-main[data-ft-row="${activeRowIndex}"]`
    );
    const refLine = document.querySelector<HTMLDivElement>(".ft-active-line");

    if (!activeRow || !refLine) return;

    const containerRect = container.getBoundingClientRect();
    const rowRect = activeRow.getBoundingClientRect();
    const refRect = refLine.getBoundingClientRect();

    // Centre vertical de la ligne active (en coordonnées écran)
    const rowCenterY = rowRect.top + rowRect.height / 2;
    // Position verticale de la ligne rouge (milieu)
    const refCenterY = refRect.top + refRect.height / 2;

    // delta > 0 : la ligne est sous la ligne rouge → on monte le tableau
    // delta < 0 : la ligne est au-dessus de la ligne rouge → on descend le tableau
    const delta = rowCenterY - refCenterY;

    // Si la ligne est déjà parfaitement alignée, on ne fait rien
    if (delta === 0) return;

    // Si l'utilisateur est en train de scroller manuellement, on ne touche pas au scroll
    if (isManualScrollRef.current) {
      return;
    }

    const currentScrollTop = container.scrollTop;
    let targetScrollTop = currentScrollTop + delta;

    // On borne proprement dans [0 ; maxScrollTop]
    const maxScrollTop = container.scrollHeight - container.clientHeight;
    if (maxScrollTop < 0) return;

    if (targetScrollTop < 0) targetScrollTop = 0;
    if (targetScrollTop > maxScrollTop) targetScrollTop = maxScrollTop;

    // Si après bornage la valeur n'a pas changé, inutile de scroller
    if (targetScrollTop === currentScrollTop) return;

    isProgrammaticScrollRef.current = true;
    container.scrollTo({
      top: targetScrollTop,
      behavior: "auto",
    });
    lastAutoScrollTopRef.current = targetScrollTop;
  }, [autoScrollEnabled, activeRowIndex, referenceMode]);

  //
  // ===== 2. LOGIQUE MÉTIER DE SENS ===================================
  //

  const isOdd = useMemo(() => {
    if (trainNumber === null) return null;
    return trainNumber % 2 !== 0;
  }, [trainNumber]);
  const currentCsvSens: CsvSens | null = useMemo(() => {
    if (isOdd === null) return null;
    return isOdd ? "IMPAIR" : "PAIR";
  }, [isOdd]);

  //
  // ===== 3. SÉLECTION + ORIENTATION + TRONQUAGE DU PARCOURS ===========
  //
  const rawEntries = useMemo(() => {
    if (isOdd === null) {
      console.log("[FT] Pas encore de trainNumber -> aucune ligne affichée");
      return [];
    }

    let picked: FTEntry[];
    let oriented: FTEntry[];

    if (isOdd) {
      picked = FT_LIGNE_PAIR;
      oriented = picked;
      console.log(
        "[FT] Sens choisi: IMPAIR (Espagne→France, PK croissants) / Jeu de données = FT_LIGNE_PAIR"
      );
    } else {
      picked = FT_LIGNE_IMPAIR;
      oriented = [...picked].reverse();
      console.log(
        "[FT] Sens choisi: PAIR (France→Espagne, PK décroissants) / Jeu de données = FT_LIGNE_IMPAIR inversé"
      );
    }

    function normName(s: string) {
      return s
        .toLowerCase()
        .replace(/\u00a0/g, " ")
        .replace(/[-–]/g, " ")
        .replace(/[^a-z0-9\s]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    }

    function fuzzyMatch(aNorm: string, bNorm: string) {
      if (!aNorm || !bNorm) return false;
      return (
        aNorm === bNorm ||
        aNorm.startsWith(bNorm) ||
        bNorm.startsWith(aNorm) ||
        aNorm.includes(bNorm) ||
        bNorm.includes(aNorm)
      );
    }

    let firstIdx = 0;
    let lastIdx = oriented.length - 1;

    if (routeStart && routeEnd) {
      const nStartWanted = normName(routeStart);
      const nEndWanted = normName(routeEnd);

      const startCandidates: number[] = [];
      const endCandidates: number[] = [];

      for (let i = 0; i < oriented.length; i++) {
        const e = oriented[i];
        if (e.isNoteOnly) continue;

        const depRaw = e.dependencia || "";
        if (!depRaw.trim()) {
          continue;
        }

        const nDep = normName(depRaw);

        if (fuzzyMatch(nDep, nStartWanted)) {
          startCandidates.push(i);
        }
        if (fuzzyMatch(nDep, nEndWanted)) {
          endCandidates.push(i);
        }
      }

      if (startCandidates.length > 0 && endCandidates.length > 0) {
        const sIdx = Math.min(...startCandidates);
        const eIdx = Math.max(...endCandidates);

        firstIdx = Math.min(sIdx, eIdx);
        lastIdx = Math.max(sIdx, eIdx);
      } else {
        console.warn(
          "[FT] Impossible de caler exactement la portion demandée.",
          "routeStart=",
          routeStart,
          "routeEnd=",
          routeEnd,
          "=> fallback: affichage de la totalité"
        );
      }
    }

    const visibleEntries = oriented.slice(firstIdx, lastIdx + 1);

    const snapshot = visibleEntries
      .filter((e) => !e.isNoteOnly)
      .slice(0, 5)
      .map((e) => ({
        pk: e.pk,
        dependencia: e.dependencia,
        vmax: e.vmax,
      }));

    const firstEntry = visibleEntries[0] || {};
    const lastEntry = visibleEntries[visibleEntries.length - 1] || {};

    console.log(
      "[FT] Portion affichée:",
      routeStart,
      "→",
      routeEnd,
      "| index",
      firstIdx,
      "→",
      lastIdx,
      "| lignes visibles:",
      visibleEntries.length
    );

    console.log("[FT] Début portion:", {
      dependencia: (firstEntry as any).dependencia,
      pk: (firstEntry as any).pk,
      vmax: (firstEntry as any).vmax,
      isNoteOnly: (firstEntry as any).isNoteOnly,
    });

    console.log("[FT] Fin portion:", {
      dependencia: (lastEntry as any).dependencia,
      pk: (lastEntry as any).pk,
      vmax: (lastEntry as any).vmax,
      isNoteOnly: (lastEntry as any).isNoteOnly,
    });

    // Vérification si la destination est "Barcelona Sants"
    if (routeEnd === "Barcelona Sants") {
      // Vérifier si la dernière ligne est bien 621.0
      const lastLineIs621_0 = (lastEntry as any).pk === "621.0";

      // Affichage dans la console pour le débogage
      console.log(`Dernière ligne détectée, 621.0 : ${lastLineIs621_0 ? "Oui" : "Non"}`);
    }

    console.log(
      "[FT] Aperçu (5 premières lignes après tronquage):",
      snapshot
    );

    return visibleEntries;
  }, [isOdd, trainNumber, routeStart, routeEnd]);

  // Trouve l'index de la ligne FT correspondant au PK GPS,
  // en prenant la dernière ligne "atteinte" (en amont) dans le sens du parcours.
  function findRowIndexFromPk(targetPk: number | null): number | null {
    if (targetPk == null || !Number.isFinite(targetPk)) return null;

    // Déterminer le sens PK croissant / décroissant sur la portion affichée
    let firstPkNum: number | null = null;
    let lastPkNum: number | null = null;

    for (let i = 0; i < rawEntries.length; i++) {
      const e = rawEntries[i];
      if (e.isNoteOnly || !e.pk) continue;
      const pkNum = Number(e.pk);
      if (!Number.isFinite(pkNum)) continue;
      firstPkNum = pkNum;
      break;
    }

    for (let i = rawEntries.length - 1; i >= 0; i--) {
      const e = rawEntries[i];
      if (e.isNoteOnly || !e.pk) continue;
      const pkNum = Number(e.pk);
      if (!Number.isFinite(pkNum)) continue;
      lastPkNum = pkNum;
      break;
    }

    const ascending =
      firstPkNum != null && lastPkNum != null
        ? firstPkNum <= lastPkNum
        : true;

    let candidateIndex: number | null = null;

    if (ascending) {
      // PK croissants : on prend la DERNIÈRE ligne avec PK <= PK GPS (déjà atteinte)
      for (let i = 0; i < rawEntries.length; i++) {
        const e = rawEntries[i];
        if (e.isNoteOnly || !e.pk) continue;
        const pkNum = Number(e.pk);
        if (!Number.isFinite(pkNum)) continue;
        if (pkNum <= targetPk) {
          candidateIndex = i; // on garde la plus récente "en amont"
        }
      }
    } else {
      // PK décroissants : on prend la DERNIÈRE ligne avec PK >= PK GPS (déjà atteinte)
      for (let i = 0; i < rawEntries.length; i++) {
        const e = rawEntries[i];
        if (e.isNoteOnly || !e.pk) continue;
        const pkNum = Number(e.pk);
        if (!Number.isFinite(pkNum)) continue;
        if (pkNum >= targetPk) {
          candidateIndex = i; // idem, la plus récente "en amont"
        }
      }
    }

    // Si on n'a rien trouvé "en amont" (PK GPS avant le début ou après la fin),
    // on retombe sur la ligne la plus proche.
    if (candidateIndex == null) {
      let bestIndex: number | null = null;
      let bestDelta = Number.POSITIVE_INFINITY;

      for (let i = 0; i < rawEntries.length; i++) {
        const e = rawEntries[i];
        if (e.isNoteOnly || !e.pk) continue;

        const pkNum = Number(e.pk);
        if (!Number.isFinite(pkNum)) continue;

        const delta = Math.abs(pkNum - targetPk);
        if (delta < bestDelta) {
          bestDelta = delta;
          bestIndex = i;
        }
      }

      candidateIndex = bestIndex;
    }

    return candidateIndex;
  }

  function resolveHoraForRowIndex(rowIndex: number): string {
    const entry = rawEntries[rowIndex];
    if (!entry) return "";

    // 1) Hora directe issue de la FT, si présente
    const directHora = (entry as any).hora ?? "";
    if (typeof directHora === "string" && directHora.trim().length > 0) {
      return directHora.trim();
    }

    // 2) Sinon, on reconstruit le mapping "ligne éligible" ↔ heuresDetectees
    const eligibleIndices: number[] = [];

    for (let i = 0; i < rawEntries.length; i++) {
      const e = rawEntries[i];
      if (e.isNoteOnly) continue;

      const s = (e.pk ?? "").toString().trim();
      const d = (e.dependencia ?? "").toString().trim();

      if (s.length > 0 && d.length > 0) {
        eligibleIndices.push(i);
      }
    }

    const pos = eligibleIndices.indexOf(rowIndex);
    if (pos === -1) return "";
    if (pos >= heuresDetectees.length) return "";

    const mappedHora = heuresDetectees[pos];
    return typeof mappedHora === "string" ? mappedHora.trim() : "";
  }

  // -- écoute des positions GPS projetées (évènement gps:position)
  useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent<any>;
      const detail = ce.detail || {};

      // On mémorise brut pour l'instant (lat, lon, pk, etc.)
      lastGpsPositionRef.current = detail as GpsPosition;

      console.log("[FT][gps] position reçue =", detail);
      console.log("[FT][gps] rawEntries.length =", rawEntries.length);

      const pk = (detail as any).pk as number | null | undefined;

      // --- Qualité GPS + machine d'états (RED / ORANGE / GREEN) + hystérésis ---
      const nowTs = Date.now();

      const hasGpsFix =
        typeof (detail as any).lat === "number" &&
        typeof (detail as any).lon === "number";

      const onLine = !!(detail as any).onLine;

      // Fraîcheur : on prend le timestamp fourni si dispo, sinon "maintenant"
      const sampleTs =
        typeof (detail as any).timestamp === "number"
          ? (detail as any).timestamp
          : nowTs;

      lastGpsSampleAtRef.current = sampleTs;

      const ageSec = Math.max(0, (nowTs - sampleTs) / 1000);

      const distRibbonM =
        typeof (detail as any).distance_m === "number"
          ? (detail as any).distance_m
          : null;

      const accuracyM =
        typeof (detail as any).accuracy === "number"
          ? (detail as any).accuracy
          : null;

      // --- Détection "PK figé" ---
      if (typeof pk === "number" && Number.isFinite(pk)) {
        const prevPk = lastPkRef.current;
        if (typeof prevPk === "number" && Number.isFinite(prevPk)) {
          const dPk = Math.abs(pk - prevPk);
          if (dPk >= GPS_FREEZE_PK_DELTA_KM) {
            lastPkChangeAtRef.current = nowTs;
            lastPkRef.current = pk;
          }
        } else {
          lastPkRef.current = pk;
          lastPkChangeAtRef.current = nowTs;
        }
      }

      const pkFrozen =
        hasGpsFix &&
        onLine &&
        typeof pk === "number" &&
        Number.isFinite(pk) &&
        lastPkChangeAtRef.current > 0 &&
        nowTs - lastPkChangeAtRef.current >= GPS_FREEZE_WINDOW_MS;

      const isStale = ageSec > GPS_FRESH_SEC;

      const reasonCodes: string[] = [];
      if (!hasGpsFix) reasonCodes.push("no_fix");
      if (hasGpsFix && !onLine) reasonCodes.push("off_line");
      if (hasGpsFix && onLine && isStale) reasonCodes.push("stale_fix");
      if (pkFrozen) reasonCodes.push("pk_frozen");

      let nextState: "RED" | "ORANGE" | "GREEN" = "RED";
      if (!hasGpsFix) {
        nextState = "RED";
      } else if (!onLine || isStale || pkFrozen) {
        nextState = "ORANGE";
      } else {
        nextState = "GREEN";
      }

      if (gpsStateRef.current !== nextState) {
        const prevState = gpsStateRef.current;
        gpsStateRef.current = nextState;

        logTestEvent("gps:state-change", {
          prevState,
          nextState,
          reasonCodes,
          ageSec,
          distRibbonM,
          accuracyM,
          pk: typeof pk === "number" && Number.isFinite(pk) ? pk : null,
          onLine,

          // ✅ paramètres utiles pour interpréter le state
          gpsFreshSec: GPS_FRESH_SEC,
          gpsFreezeWindowMs: GPS_FREEZE_WINDOW_MS,
          gpsFreezePkDeltaKm: GPS_FREEZE_PK_DELTA_KM,
          orangeTimeoutMs: ORANGE_TIMEOUT_MS,
        });
      }

      const isHealthy = nextState === "GREEN";

      // On met à jour l'état "GPS OK" pour les callbacks différés
      gpsHealthyRef.current = isHealthy;

      // --- Hystérésis sur le mode de référence (HORAIRE / GPS) ---
      // Règle spéciale : si GPS = RED (pas de fix), on bascule IMMÉDIATEMENT en HORAIRE.
      // Sinon (ORANGE), on garde l’hystérésis.
      if (isHealthy) {
        if (orangeTimeoutRef.current !== null) {
          const startedAt = orangeTimeoutStartedAtRef.current;
          const now = Date.now();

          const elapsedMs =
            typeof startedAt === "number" ? Math.max(0, now - startedAt) : null;

          const remainingMs =
            typeof elapsedMs === "number"
              ? Math.max(0, ORANGE_TIMEOUT_MS - elapsedMs)
              : null;

          window.clearTimeout(orangeTimeoutRef.current);
          orangeTimeoutRef.current = null;
          orangeTimeoutStartedAtRef.current = null;

          console.log(
            "[FT][gps] Signal revenu avant 30 s -> annulation du passage en mode HORAIRE",
            { elapsedMs, remainingMs }
          );

          logTestEvent("gps:orange-hysteresis-cancel", {
            reason: "gps_green_recovered",
            state: gpsStateRef.current,
            elapsedMs,
            remainingMs,
            orangeTimeoutMs: ORANGE_TIMEOUT_MS,
          });
        }


        if (referenceModeRef.current !== "GPS") {
          console.log("[FT][gps] Passage en mode GPS (signal OK + fresh)");
          logTestEvent("gps:mode-change", {
            prevMode: referenceModeRef.current,
            nextMode: "GPS",
            reason: "gps_green",
            state: gpsStateRef.current,

            gpsFreshSec: GPS_FRESH_SEC,
            gpsFreezeWindowMs: GPS_FREEZE_WINDOW_MS,
            gpsFreezePkDeltaKm: GPS_FREEZE_PK_DELTA_KM,
            orangeTimeoutMs: ORANGE_TIMEOUT_MS,
          });
          setReferenceMode("GPS");
        }
      } else {
        const isRed = gpsStateRef.current === "RED";

        if (isRed) {
          // ✅ RED = bascule immédiate en HORAIRE
          if (orangeTimeoutRef.current !== null) {
            const startedAt = orangeTimeoutStartedAtRef.current;
            const now = Date.now();

            const elapsedMs =
              typeof startedAt === "number" ? Math.max(0, now - startedAt) : null;

            const remainingMs =
              typeof elapsedMs === "number"
                ? Math.max(0, ORANGE_TIMEOUT_MS - elapsedMs)
                : null;

            window.clearTimeout(orangeTimeoutRef.current);
            orangeTimeoutRef.current = null;
            orangeTimeoutStartedAtRef.current = null;

            console.log("[FT][gps] Hystérésis ORANGE annulée car GPS RED", {
              elapsedMs,
              remainingMs,
            });

            logTestEvent("gps:orange-hysteresis-abort", {
              reason: "gps_red_no_fix",
              state: gpsStateRef.current,
              elapsedMs,
              remainingMs,
              orangeTimeoutMs: ORANGE_TIMEOUT_MS,
            });
          }


          if (referenceModeRef.current !== "HORAIRE") {
            console.log(
              "[FT][gps] GPS RED (pas de fix) -> bascule immédiate en mode HORAIRE"
            );
            logTestEvent("gps:mode-change", {
              prevMode: referenceModeRef.current,
              nextMode: "HORAIRE",
              reason: "gps_red_no_fix",
              state: gpsStateRef.current,

              gpsFreshSec: GPS_FRESH_SEC,
              gpsFreezeWindowMs: GPS_FREEZE_WINDOW_MS,
              gpsFreezePkDeltaKm: GPS_FREEZE_PK_DELTA_KM,
              orangeTimeoutMs: ORANGE_TIMEOUT_MS,
            });
            setReferenceMode("HORAIRE");
          }
        } else {
          // ORANGE = on garde l’hystérésis avant bascule en HORAIRE
          if (referenceModeRef.current === "GPS") {
            if (orangeTimeoutRef.current === null) {
              const startedAt = Date.now();
              const deadlineAt = startedAt + ORANGE_TIMEOUT_MS;

              orangeTimeoutStartedAtRef.current = startedAt;

              console.log(
                "[FT][gps] Signal dégradé -> démarrage de l'hystérésis (30 s avant mode HORAIRE)",
                { startedAt, deadlineAt, orangeTimeoutMs: ORANGE_TIMEOUT_MS }
              );

              logTestEvent("gps:orange-hysteresis-start", {
                state: gpsStateRef.current,
                startedAt,
                deadlineAt,
                orangeTimeoutMs: ORANGE_TIMEOUT_MS,
              });

              const timeoutId = window.setTimeout(() => {
                const now = Date.now();
                const s = orangeTimeoutStartedAtRef.current;

                const elapsedMs =
                  typeof s === "number" ? Math.max(0, now - s) : null;

                if (!gpsHealthyRef.current && referenceModeRef.current === "GPS") {
                  console.log(
                    "[FT][gps] Hystérésis écoulée (>= 30 s en signal dégradé) -> passage en mode HORAIRE",
                    { elapsedMs }
                  );

                  logTestEvent("gps:mode-change", {
                    prevMode: "GPS",
                    nextMode: "HORAIRE",
                    reason: "orange_hysteresis_timeout",
                    state: gpsStateRef.current,

                    gpsFreshSec: GPS_FRESH_SEC,
                    gpsFreezeWindowMs: GPS_FREEZE_WINDOW_MS,
                    gpsFreezePkDeltaKm: GPS_FREEZE_PK_DELTA_KM,
                    orangeTimeoutMs: ORANGE_TIMEOUT_MS,

                    // ✅ bonus timing
                    startedAt: s,
                    deadlineAt,
                    elapsedMs,
                  });

                  setReferenceMode("HORAIRE");
                } else {
                  console.log(
                    "[FT][gps] Hystérésis expirée mais signal redevenu OK ou mode déjà changé -> pas de bascule",
                    { elapsedMs }
                  );

                  logTestEvent("gps:orange-hysteresis-expired-no-switch", {
                    state: gpsStateRef.current,
                    orangeTimeoutMs: ORANGE_TIMEOUT_MS,
                    startedAt: s,
                    deadlineAt,
                    elapsedMs,
                    mode: referenceModeRef.current,
                    gpsHealthy: gpsHealthyRef.current,
                  });
                }

                orangeTimeoutRef.current = null;
                orangeTimeoutStartedAtRef.current = null;
              }, ORANGE_TIMEOUT_MS);

              orangeTimeoutRef.current = timeoutId;
            }
          } else {
            if (orangeTimeoutRef.current !== null) {
              const startedAt = orangeTimeoutStartedAtRef.current;
              const now = Date.now();

              const elapsedMs =
                typeof startedAt === "number" ? Math.max(0, now - startedAt) : null;

              const remainingMs =
                typeof elapsedMs === "number"
                  ? Math.max(0, ORANGE_TIMEOUT_MS - elapsedMs)
                  : null;

              window.clearTimeout(orangeTimeoutRef.current);
              orangeTimeoutRef.current = null;
              orangeTimeoutStartedAtRef.current = null;

              console.log(
                "[FT][gps] Hystérésis ORANGE annulée car mode déjà HORAIRE / pas en GPS",
                { elapsedMs, remainingMs }
              );

              logTestEvent("gps:orange-hysteresis-cancel", {
                reason: "not_in_gps_mode_anymore",
                state: gpsStateRef.current,
                elapsedMs,
                remainingMs,
                orangeTimeoutMs: ORANGE_TIMEOUT_MS,
                mode: referenceModeRef.current,
              });
            }
          }

        }
      }

      // --- Suite : projection PK -> ligne FT + recalage horaire (inchangé dans l'esprit) ---
      if (pk != null) {
        const idx = findRowIndexFromPk(pk);
        if (idx != null) {
          const entry = rawEntries[idx];
          console.log(
            "[FT][gps] pk≈",
            pk,
            " → ligne FT index=",
            idx,
            " pk=",
            entry?.pk,
            " dependencia=",
            entry?.dependencia
          );

          // 🧭 En mode GPS calé sur la ligne → la ligne active est pilotée par le PK
          const currentRefMode = referenceModeRef.current;

          if (hasGpsFix && onLine && currentRefMode === "GPS") {
            // Ligne active = ligne GPS (PK projeté)
            setActiveRowIndex(idx);

            // 📌 On ne recalcule le delta qu'au passage à un *nouveau* point d'ancrage
            const lastIdx = lastAnchoredRowRef.current;
            const isNewAnchor = lastIdx == null || lastIdx !== idx;

            if (!isNewAnchor) {
              // même ligne FT que la dernière ancre GPS → pas de recalage horaire
              return;
            }

            // On mémorise cette ligne comme nouveau point d'ancrage GPS
            lastAnchoredRowRef.current = idx;

            // Heure de départ (FT brute ou mapping S&D)
            const departHoraText = resolveHoraForRowIndex(idx);
            const departMinutes = parseHoraToMinutes(departHoraText);

            // En mode GPS : si une heure d'arrivée a été calculée pour cette ligne,
            // on l'utilise pour le calcul du delta (objectif "à l'heure à l'arrivée").
            let usedMinutes: number | null = departMinutes;
            let usedHoraText: string = departHoraText;
            let usedSource: "DEPART" | "ARRIVEE" = "DEPART";

            let arrivalMinutes: number | null = null;
            const arrivalList = arrivalEventsRef.current || [];
            const arrivalMatch = arrivalList.find((ev) => ev.rowIndex === idx);
            if (arrivalMatch && Number.isFinite(arrivalMatch.arrivalMin)) {
              arrivalMinutes = arrivalMatch.arrivalMin;
            }

            if (referenceModeRef.current === "GPS" && arrivalMinutes != null) {
              usedMinutes = arrivalMinutes;
              usedHoraText = formatMinutesToHora(arrivalMinutes);
              usedSource = "ARRIVEE";
            }

            // Si on a une heure utilisable, on recale le delta
            if (usedMinutes != null) {
              // 1) On note la ligne pour les futurs démarrages du mode horaire
              recalibrateFromRowRef.current = idx;

              // 2) On recalcule le delta réel (maintenant - heure utilisée)
              const now = new Date();
              const nowMinutes = now.getHours() * 60 + now.getMinutes();

              const fixedDelay = nowMinutes - usedMinutes;

              // 3) On recale la base interne du mode horaire sur cette ligne
              autoScrollBaseRef.current = {
                realMin: nowMinutes,
                firstHoraMin: usedMinutes,
                fixedDelay,
              };

              // 4) On met à jour immédiatement le delta affiché dans la TitleBar
              const text =
                fixedDelay === 0
                  ? "0 min"
                  : fixedDelay > 0
                    ? `+ ${fixedDelay} min`
                    : `- ${-fixedDelay} min`;

              window.dispatchEvent(
                new CustomEvent("lim:schedule-delta", {
                  detail: {
                    text,
                    isLargeDelay: Math.abs(fixedDelay) >= 5,
                  },
                })
              );

              const nowHHMM =
                now.getHours().toString().padStart(2, "0") +
                ":" +
                now.getMinutes().toString().padStart(2, "0");

              console.log(
                "[FT][gps] Recalage horaire via GPS — source=",
                usedSource,
                "| used=",
                usedHoraText,
                "(",
                usedMinutes,
                "min ) / now=",
                nowHHMM,
                " => delta=",
                fixedDelay,
                "min (ligne index=",
                idx,
                ")"
              );

              logTestEvent("ft:delta:gps-recalage", {
                rowIndex: idx,
                nowHHMM,
                fixedDelay,
                pk: entry?.pk ?? null,
                dependencia: entry?.dependencia ?? null,

                // ✅ détails recalage
                usedSource,
                usedHora: usedHoraText,
                usedMinutes,

                // ✅ debug
                departHora: departHoraText || null,
                departMinutes: departMinutes ?? null,
                arrivalMinutes,
              });
            } else {
              console.log(
                "[FT][gps] Ligne GPS sans heure utilisable (départ/arrivée) -> pas de recalage",
                { idx, departHoraText, arrivalMinutes }
              );
            }
          }

        } else {
          console.log(
            "[FT][gps] pk≈",
            pk,
            " → aucune ligne FT correspondante trouvée"
          );
        }
      }
    };

    window.addEventListener("gps:position", handler as EventListener);
    return () => {
      window.removeEventListener("gps:position", handler as EventListener);
      // On nettoie aussi le timer d'hystérésis au démontage
      if (orangeTimeoutRef.current !== null) {
        window.clearTimeout(orangeTimeoutRef.current);
        orangeTimeoutRef.current = null;
      }
      orangeTimeoutStartedAtRef.current = null;

    };
  }, [rawEntries, referenceMode, heuresDetectees]);

  //
  // ===== 4. HELPERS REMARQUES ROUGES =================================
  //
  function renderRedNoteLine(line: string) {
    const firstSpace = line.indexOf(" ");
    const firstToken = firstSpace === -1 ? line : line.slice(0, firstSpace);
    const rest = firstSpace === -1 ? "" : line.slice(firstSpace + 1);

    return (
      <div className="ft-rednote-line">
        <span className="ft-rednote-strong">{firstToken}</span>
        {rest ? " " + rest : ""}
      </div>
    );
  }

  function renderDependenciaCell(entry: FTEntry) {
    const hasNotesArray =
      Array.isArray(entry.notes) && entry.notes.length > 0;
    const hasSingleNote = entry.note && entry.note.trim() !== "";

    if (entry.isNoteOnly) {
      return (
        <div className="ft-dependencia-cell">
          {hasNotesArray
            ? entry.notes!.map((line, idx) => (
                <div key={idx}>{renderRedNoteLine(line)}</div>
              ))
            : hasSingleNote
            ? renderRedNoteLine(entry.note!)
            : null}
        </div>
      );
    }

    return (
      <div className="ft-dependencia-cell">
        <div>{entry.dependencia ?? ""}</div>

        {hasNotesArray
          ? entry.notes!.map((line, idx) => (
              <div key={idx}>{renderRedNoteLine(line)}</div>
            ))
          : hasSingleNote
          ? renderRedNoteLine(entry.note!)
          : null}
      </div>
    );
  }

  //
  // ===== 5. TIMELINE VITESSE / POINTS DE RUPTURE ======================
  //
  type SpeedInfo = { v: number; highlight: boolean };

  function extractSpeedTimeline(
    entries: FTEntry[],
    seed: SpeedInfo | null
  ): {
    speedMap: Record<string, SpeedInfo>;
    breakpointsArr: string[];
  } {
    const speedMap: Record<string, SpeedInfo> = {};
    const breakpointsArr: string[] = [];

    let currentSpeed: number | null = seed ? seed.v : null;
    let currentHighlight = seed ? seed.highlight : false;

    for (const e of entries) {
      if (e.isNoteOnly) continue;

      const pk = e.pk;

      if ((e as any).vmax_bar && pk) {
        breakpointsArr.push(pk);
      }

      if (typeof e.vmax === "number" && !isNaN(e.vmax)) {
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

    return {
      speedMap,
      breakpointsArr,
    };
  }

  const firstVisiblePk = useMemo(() => {
    const e = rawEntries.find((e) => !e.isNoteOnly && e.pk);
    return e?.pk ?? null;
  }, [rawEntries]);

  function computeSeedSpeed(
    pkStart: string | null,
    isOddFlag: boolean | null
  ): SpeedInfo | null {
    if (!pkStart || isOddFlag === null) return null;

    let baseOriented: FTEntry[];
    if (isOddFlag) {
      baseOriented = FT_LIGNE_PAIR;
    } else {
      baseOriented = [...FT_LIGNE_IMPAIR].reverse();
    }

    const idxStart = baseOriented.findIndex(
      (e) => !e.isNoteOnly && e.pk === pkStart
    );
    if (idxStart <= 0) {
      return null;
    }

    let currentSpeed: number | null = null;
    let currentHighlight = false;

    for (let i = 0; i < idxStart; i++) {
      const e = baseOriented[i];
      if (typeof e.vmax === "number" && !isNaN(e.vmax)) {
        currentSpeed = e.vmax;
        currentHighlight = !!(e as any).vmax_highlight;
      }
    }

    if (currentSpeed === null) return null;
    return { v: currentSpeed, highlight: currentHighlight };
  }

  const seedSpeed = useMemo(
    () => computeSeedSpeed(firstVisiblePk, isOdd),
    [firstVisiblePk, isOdd]
  );

  const { speedMap, breakpointsArr } = useMemo(
    () => extractSpeedTimeline(rawEntries, seedSpeed),
    [rawEntries, seedSpeed]
  );

  const breakpointsSet = useMemo(
    () => new Set<string>(breakpointsArr),
    [breakpointsArr]
  );

  const firstPk = useMemo(() => {
    const e = rawEntries.find((e) => !e.isNoteOnly && e.pk);
    return e?.pk ?? null;
  }, [rawEntries]);

  const lastPk = useMemo(() => {
    for (let i = rawEntries.length - 1; i >= 0; i--) {
      const e = rawEntries[i];
      if (!e.isNoteOnly && e.pk) {
        return e.pk;
      }
    }
    return null;
  }, [rawEntries]);

  //
  // ===== 6. CONSTRUCTION DU TBODY ====================================
  //
  const rows: JSX.Element[] = [];

  function isEligible(e: FTEntry): boolean {
    if ((e as any).isNoteOnly) return false;
    const s = (e.pk ?? "").toString().trim();
    const d = (e.dependencia ?? "").toString().trim();
    return s.length > 0 && d.length > 0;
  }

  const eligibleIndices: number[] = [];

  // --- Pré-calcul des segments de vitesse ---
  const speedSegmentIndex: number[] = [];
  const segmentPkLists = new Map<number, string[]>();

  let currentSegmentId = 0;

  for (let i = 0; i < rawEntries.length; i++) {
    const e = rawEntries[i];

    if (!e.isNoteOnly && e.pk) {
      const pk = e.pk;
      const isBreakpoint =
        breakpointsSet.has(pk) && pk !== firstPk && pk !== lastPk;

      if (currentSegmentId === 0) {
        currentSegmentId = 1;
      }

      if (isBreakpoint && i !== 0) {
        currentSegmentId++;
      }

      speedSegmentIndex[i] = currentSegmentId;

      if (!segmentPkLists.has(currentSegmentId)) {
        segmentPkLists.set(currentSegmentId, []);
      }
      segmentPkLists.get(currentSegmentId)!.push(pk);
    } else {
      speedSegmentIndex[i] = currentSegmentId;
    }
  }

  const segmentLabelRowIndex = new Map<number, number>();
  const segmentSpeed = new Map<number, SpeedInfo>();

  {
    for (let i = 0; i < rawEntries.length; i++) {
      const segId = speedSegmentIndex[i] ?? 0;
      if (segId <= 0) continue;

      if (segmentLabelRowIndex.has(segId)) continue;

      const e = rawEntries[i];
      if (e.isNoteOnly || !e.pk) continue;

      segmentLabelRowIndex.set(segId, i);
    }

    for (const [segId, pkList] of segmentPkLists.entries()) {
      let info: SpeedInfo | null = null;
      for (const pk of pkList) {
        const s = speedMap[pk];
        if (s) {
          info = s;
          break;
        }
      }
      if (info) {
        segmentSpeed.set(segId, info);
      }
    }
  }

  // --- Pré-calcul du type de surlignage CSV (zones par PK) ---
  const csvHighlightByIndex: ("none" | "full" | "top" | "bottom")[] = [];

  // Par défaut : aucun surlignage
  for (let i = 0; i < rawEntries.length; i++) {
    csvHighlightByIndex[i] = "none";
  }

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
    for (const zone of CSV_ZONES) {
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

  for (let i = 0; i < rawEntries.length; i++) {
    const e = rawEntries[i];
    if (isEligible(e)) eligibleIndices.push(i);
  }

  const totalEligible = eligibleIndices.length;
  const assignedCount = Math.min(heuresDetectees.length, totalEligible);
  console.log(
    "[FT] Mapping heures -> lignes éligibles (S&D):",
    `${assignedCount}/${totalEligible}`,
    {
      eligibleIndices: eligibleIndices.slice(0, 30),
      heures: heuresDetectees.slice(0, assignedCount),
    }
  );

  let heuresDetecteesCursor = 0;
  let previousHoraForConc: string | null = null;

  const firstNonNoteIndex = (() => {
    for (let i = 0; i < rawEntries.length; i++) {
      if (!rawEntries[i].isNoteOnly) return i;
    }
    return -1;
  })();

  useEffect(() => {
    firstNonNoteIndexRef.current = firstNonNoteIndex;
  }, [firstNonNoteIndex]);

  const lastNonNoteIndex = (() => {
    for (let i = rawEntries.length - 1; i >= 0; i--) {
      if (!rawEntries[i].isNoteOnly) return i;
    }
    return -1;
  })();

  function parseHoraToMinutes(h?: string | null): number | null {
    if (!h) return null;
    const m = /^(\d{1,2}):(\d{2})$/.exec(h.trim());
    if (!m) return null;
    const hh = Number(m[1]);
    const mm = Number(m[2]);
    if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
    return hh * 60 + mm;
  }

  function formatMinutesToHora(totalMinutes: number): string {
    const minutesInDay = 24 * 60;
    let t = totalMinutes % minutesInDay;
    if (t < 0) t += minutesInDay;
    const hh = Math.floor(t / 60);
    const mm = t % 60;
    const pad = (n: number) => n.toString().padStart(2, "0");
    return `${pad(hh)}:${pad(mm)}`;
  }

  // Gestion RC
  let rcCurrentSegmentId = 0;
  const rcPrintedSegments = new Set<number>();

  // Gestion VMax (scroll intelligent)
  const vPrintedSegments = new Set<number>();

  // Debug : index de ligne visuelle (toutes les <tr> rendues)
  let renderedRowIndex = 0;

  // CSV : état "zone ouverte" entre un bottom et un top
  let csvZoneOpen = false;
  // compteur des VRAIES lignes principales (<tr className="ft-row-main">)
  let mainRowCounter = 0;
  // radio : on veut l'afficher une seule fois dans le viewport
  let radioPrintedInThisRender = false;
  // bloqueo : on veut l'afficher une seule fois dans le viewport
  let bloqueoPrintedInThisRender = false;

  const arrivalEvents: { arrivalMin: number; rowIndex: number }[] = [];

  // Gestion des clics sur le corps de la FT :
  // - 1er clic en mode horaire : sélection de la ligne la plus proche => Standby
  // - 2ᵉ clic en Standby : relance du mode horaire
  const handleBodyClick = (e: React.MouseEvent<HTMLDivElement>) => {
    // En mode GPS, le clic sur la fiche train ne doit jamais déclencher Standby / recalage
    if (referenceModeRef.current === "GPS") {
      return;
    }

    const container = e.currentTarget;
    const clickY = e.clientY;

    const isStandby =
      !autoScrollEnabled &&
      recalibrateFromRowRef.current !== null &&
      selectedRowIndex !== null;

    // 2ᵉ clic : on est en Standby -> on relance le mode horaire
    if (isStandby) {
      // on enlève la sélection visuelle (stop clignotement)
      setSelectedRowIndex(null);

      // on relance le mode horaire
      window.dispatchEvent(
        new CustomEvent("ft:auto-scroll-change", {
          detail: { enabled: true },
        })
      );
      return;
    }

    // Si on n'est pas en auto-scroll (avant Play ou en pause "normale"),
    // on ne déclenche pas le Standby / la sélection.
    if (!autoScrollEnabled) {
      return;
    }

    const mainRows =
      container.querySelectorAll<HTMLTableRowElement>("tr.ft-row-main");
    if (!mainRows.length) return;

    let bestRow: HTMLTableRowElement | null = null;
    let bestIndex = -1;
    let bestDist = Number.POSITIVE_INFINITY;

    for (let idx = 0; idx < mainRows.length; idx++) {
      const tr = mainRows[idx];

      // On ne considère que les lignes "calibrables" : horaire + dependencia présents
      const horaSpan = tr.querySelector<HTMLSpanElement>(
        "td:nth-child(6) .ft-hora-depart"
      );
      const horaText = horaSpan?.textContent?.trim() || "";

      const depCell =
        tr.querySelector<HTMLDivElement>(".ft-dependencia-cell");
      const depText = depCell?.textContent?.trim() || "";

      const hasHoraAndDep = !!horaText && !!depText;
      if (!hasHoraAndDep) {
        continue;
      }

      const rect = tr.getBoundingClientRect();
      const centerY = rect.top + rect.height / 2;
      const dist = Math.abs(clickY - centerY);
      if (dist < bestDist) {
        bestDist = dist;
        bestRow = tr;
        bestIndex = idx;
      }
    }

    // Aucune ligne "valide" (avec horaire + dependencia) trouvée à proximité
    if (!bestRow) {
      return;
    }

    const dataIndexAttr = bestRow.getAttribute("data-ft-row");
    const rowIndex = dataIndexAttr ? parseInt(dataIndexAttr, 10) : bestIndex;

    // Visuel : ligne sélectionnée (cadre rouge clignotant)
    setSelectedRowIndex(rowIndex);
    // Fonctionnel : base de recalage horaire à partir de cette ligne
    recalibrateFromRowRef.current = rowIndex;

    // On coupe l'auto-scroll (équivalent d'un clic sur Pause)
    window.dispatchEvent(
      new CustomEvent("ft:auto-scroll-change", {
        detail: { enabled: false },
      })
    );

    // On signale le mode Standby à la TitleBar (🕑 orange)
    window.dispatchEvent(
      new CustomEvent("lim:hourly-mode", {
        detail: { enabled: false, standby: true },
      })
    );
  };

  for (let i = 0; i < rawEntries.length; i++) {
    const entry = rawEntries[i];

    const isSelected = selectedRowIndex === i;

    if (entry.isNoteOnly) {
      continue;
    }

    const nextEntry = rawEntries[i + 1];
    const hasNoteAfter = nextEntry && nextEntry.isNoteOnly === true;

    const sitKm = entry.isNoteOnly ? "" : entry.pk ?? "";

    const eligible = isEligible(entry);
    const horaAssigned =
      eligible && heuresDetecteesCursor < heuresDetectees.length
        ? heuresDetectees[heuresDetecteesCursor]
        : entry.hora ?? "";
    const hora = horaAssigned;

    const depNorm = (entry.dependencia ?? "")
      .toUpperCase()
      .replace(/\s+/g, " ")
      .trim();

    const isVoyageursStop =
      depNorm === "BARCELONA SANTS" ||
      depNorm === "LA SAGRERA AV" ||
      depNorm === "GIRONA" ||
      depNorm === "FIGUERES-VILAFANT";

    let com = "";
    let comMinutes: number | null = null;

    const isOriginOrTerminus =
      !entry.isNoteOnly &&
      (i === firstNonNoteIndex || i === lastNonNoteIndex);

    // Origine / destination utilisée pour le surlignage
    const isLimiteAdifLfspa = depNorm === "LIMITE ADIF - LFPSA";
    const isOriginOrDestinationForHighlight =
      isOriginOrTerminus && !isLimiteAdifLfspa;

    if (hora && isVoyageursStop && !isOriginOrTerminus) {
      const codesPourHeure = codesCParHeure[hora] ?? [];
      if (codesPourHeure.length > 0) {
        com = codesPourHeure.join(" ");

        const firstCode = codesPourHeure[0];
        const n = Number(firstCode);
        if (Number.isFinite(n)) {
          comMinutes = n;
        } else {
          console.warn(
            "[FT] Impossible de parser COM en minutes pour l'heure",
            hora,
            "code=",
            firstCode
          );
        }

        if (codesPourHeure.length > 1) {
          console.warn(
            "[FT] Plusieurs codes C détectés pour la même heure",
            hora,
            codesPourHeure
          );
        }
      }
    }

    if (eligible && heuresDetecteesCursor < heuresDetectees.length) {
      heuresDetecteesCursor++;
    }

    const tecnico = entry.tecnico ?? "";

    let conc = entry.conc ?? "";

    // Heure d'arrivée calculée
    let horaArrivee: string | null = null;
    if (hora && comMinutes != null && comMinutes > 0) {
      const depMinutes = parseHoraToMinutes(hora);
      if (depMinutes != null) {
        const arrMinutes = depMinutes - comMinutes;
        horaArrivee = formatMinutesToHora(arrMinutes);

        // On mémorise cet événement d'arrivée pour l'auto-scroll horaire
        arrivalEvents.push({
          arrivalMin: arrMinutes,
          rowIndex: i,
        });
      }
    }

    const prevHoraStr = previousHoraForConc;
    const currentHoraStr = hora;

    const prevMinutes = parseHoraToMinutes(prevHoraStr);
    const currentMinutes = parseHoraToMinutes(currentHoraStr);

    if (prevMinutes != null && currentMinutes != null) {
      const comForThisRow = comMinutes ?? 0;
      const diff = currentMinutes - prevMinutes - comForThisRow;

      if (diff >= 0 && diff < 6 * 60) {
        conc = String(diff);
      } else {
        console.warn(
          "[FT] CONC calculé aberrant pour la ligne",
          i,
          "prevHora=",
          prevHoraStr,
          "hora=",
          currentHoraStr,
          "com=",
          comForThisRow,
          "diff=",
          diff
        );
      }
    }

    const radio = entry.radio ?? "";
    const bloqueo = (entry as any).bloqueo ?? "";

    // Arrêt : ligne principale avec COM ou TECN non vide
    const hasComOrTecnico =
      (com && com.trim() !== "") || (tecnico && tecnico.trim() !== "");
    const isStopMainForHighlight = !!(hora && hasComOrTecnico);

    // Flag final pour le surlignage (origine/destination ou arrêt)
    const shouldHighlightRow =
      isOriginOrDestinationForHighlight || isStopMainForHighlight;

    if (hora) {
      previousHoraForConc = hora;
    }

    // visibilité de la ligne principale dans le viewport
    const isCurrentlyVisible =
      i >= visibleRows.first && i <= visibleRows.last;

    // RC
    const isRcBreakpointHere =
      !!(entry as any).rc_bar && i !== firstNonNoteIndex;

    // avance dans les segments RC
    if (rcCurrentSegmentId === 0) {
      rcCurrentSegmentId = 1;
    } else if (isRcBreakpointHere) {
      rcCurrentSegmentId++;
    }

    const rawRamp =
      typeof (entry as any).rc === "number"
        ? (entry as any).rc.toString()
        : "";

    let ramp = "";

    // lignes principales visibles
    const visibleStart = visibleRows.first;
    const visibleEnd = visibleRows.last;
    const targetVisible = visibleStart + 1; // on vise la 2e ligne principale visible

    const isTargetVisibleRow =
      mainRowCounter >= targetVisible && mainRowCounter <= visibleEnd;

    if (
      !isRcBreakpointHere &&
      rawRamp !== "" &&
      rcCurrentSegmentId > 0 &&
      !rcPrintedSegments.has(rcCurrentSegmentId) &&
      isTargetVisibleRow
    ) {
      ramp = rawRamp;
      rcPrintedSegments.add(rcCurrentSegmentId);
    }

    const showRcBar = isRcBreakpointHere && i !== rawEntries.length - 1;

    // (on remet la ligne qui manquait)
    const nivel = (entry as any).etcs ?? "①";

    // --- Vitesse par segment ---
    const segId = speedSegmentIndex[i] ?? 0;
    const labelRowIndex =
      segId > 0 ? segmentLabelRowIndex.get(segId) ?? null : null;
    const speedInfo =
      segId > 0 ? segmentSpeed.get(segId) ?? null : null;

    const currentSpeedText =
      speedInfo && typeof speedInfo.v === "number"
        ? String(speedInfo.v)
        : "";

    const isLabelRow = labelRowIndex === i;

    // diagnostic VMAX (comme avant)
    if (isLabelRow && segId > 0) {
      const segIsVisible =
        i >= visibleRows.first && i <= visibleRows.last;

      console.log(
        "[SCROLL INTELLIGENT VMAX]",
        "segment",
        segId,
        "| ligne principale =",
        i,
        "| visibleRows =",
        visibleRows.first, "→", visibleRows.last,
        "| segmentVisible =",
        segIsVisible,
        "| v =",
        currentSpeedText || "(aucune)"
      );
    }

    // est-ce qu'il y a une barre de V sur CETTE ligne principale ?
    const isBreakpointRow =
      entry.pk &&
      breakpointsSet.has(entry.pk) &&
      entry.pk !== firstPk &&
      entry.pk !== lastPk;

    const showVBar = !!isBreakpointRow;

    // Contenu qui sera vraiment rendu plus bas
    let mainRowSpeedContent = "";
    let speedSpacerContent = "";

    // 1) CAS NORMAL : on est sur la ligne-label du segment
    if (isLabelRow && currentSpeedText) {
      if (showVBar) {
        // ligne label + barre → on met la Vmax dans la petite ligne
        speedSpacerContent = currentSpeedText;
      } else {
        // ligne label sans barre → on peut la mettre dans la cellule
        mainRowSpeedContent = currentSpeedText;
      }
    }
    // 2) CAS "SCROLL INTELLIGENT" : la vraie ligne du segment est sortie de l’écran
    else if (
      segId > 0 &&
      currentSpeedText &&
      !vPrintedSegments.has(segId)
    ) {
      // zone visible actuelle (sur les lignes PRINCIPALES)
      const visibleStart2 = visibleRows.first;
      const visibleEnd2 = visibleRows.last;

      // est-ce que la ligne-label de ce segment est visible ?
      const labelIsVisible =
        labelRowIndex !== null &&
        labelRowIndex >= visibleStart2 &&
        labelRowIndex <= visibleEnd2;

      // on ne réaffiche que si la ligne-label n'est plus visible
      if (!labelIsVisible) {
        // est-ce que cette ligne principale est dans le viewport ?
        const segStillVisible = i >= visibleStart2 && i <= visibleEnd2;

        // comme pour RC : on évite de coller la valeur sur la première ligne visible
        const targetVisible2 = visibleStart2 + 1;
        const isGoodSpot =
          mainRowCounter >= targetVisible2 && mainRowCounter <= visibleEnd2;

        if (segStillVisible && isGoodSpot) {
          speedSpacerContent = currentSpeedText;
          vPrintedSegments.add(segId);

          console.log(
            "[SCROLL INTELLIGENT VMAX] réaffiché sur ligne",
            i,
            "(mainRowCounter =",
            mainRowCounter,
            ") pour segment",
            segId,
            "valeur",
            currentSpeedText
          );
        }
      }
    }

    const showSpeedSpacer =
      speedSpacerContent && speedSpacerContent.trim() !== "";
    const showArrivalSpacer =
      horaArrivee && horaArrivee.trim() !== "";

    // CSV : surlignage de la cellule V Max selon la classification calculée plus haut
    const highlightKind = csvHighlightByIndex[i];
    const isCsvStart = highlightKind === "bottom";
    const isCsvEnd = highlightKind === "top";

    let vmaxHighlightClass = "";
    if (highlightKind === "full") {
      vmaxHighlightClass = " ft-v-csv-full";
    } else if (highlightKind === "top") {
      vmaxHighlightClass = " ft-v-csv-top";
    } else if (highlightKind === "bottom") {
      vmaxHighlightClass = " ft-v-csv-bottom";
    }

    // Debug CSV : vérifier le mapping index -> kind -> PK / dependencia
    const pkForLog = entry.pk ?? "";
    const dependenciaForLog = entry.dependencia ?? "";
    console.log(
      "[CSV HIGHLIGHT]",
      "i=",
      i,
      "kind=",
      highlightKind,
      "pk=",
      pkForLog,
      "dependencia=",
      dependenciaForLog
    );

    // 1) INTERLIGNES (remarque rouge + heure d'arrivée) AVANT la ligne principale
    //    - Trains PAIRS : remarque rouge + heure d'arrivée sur la même ligne, puis heure de départ (ligne principale)
    //    - Autres cas   : heure d'arrivée seule au-dessus de la ligne principale (comportement inchangé)
    const shouldRenderArrivalSpacer =
      showArrivalSpacer &&
      !(hasNoteAfter && i < rawEntries.length - 1);


    if (!isOdd && hasNoteAfter && i < rawEntries.length - 1) {
      // 👇 Remarque rouge (ligne noteOnly) en premier pour les trains PAIRS
      const vmaxClassForNote = csvZoneOpen ? " ft-v-csv-full" : "";

      rows.push(
        <tr className="ft-row-inter" key={`note-before-${i}`}>
          {(() => {
            renderedRowIndex++;
            return <td className="ft-td"></td>;
          })()}

          <td className={"ft-td ft-v-cell" + vmaxClassForNote}>
            <div className="ft-v-inner text-center"></div>
          </td>

          <td className="ft-td" />

          <td className="ft-td">
            {renderDependenciaCell(nextEntry as FTEntry)}
          </td>

          {/* Com vide */}
          <td className="ft-td" />

          {/* Hora d'arrivée sur la même ligne que les remarques rouges,
              alignée en bas de la cellule */}
          <td className="ft-td ft-hora-cell">
            {showArrivalSpacer && horaArrivee && (
              <span className="ft-hora-arrivee">{horaArrivee}</span>
            )}
          </td>

          {/* Técn / Conc / Radio vides */}
          <td className="ft-td" />
          <td className="ft-td" />
          <td className="ft-td" />
          <td className="ft-td ft-rc-cell" />
          <td className="ft-td ft-td-nivel" />
        </tr>
      );
    } else if (shouldRenderArrivalSpacer) {
      // Cas général (IMPAIR ou sans remarque rouge) : heure d'arrivée seule au-dessus de la ligne principale
      const vmaxClassForArrival = csvZoneOpen ? " ft-v-csv-full" : "";

      rows.push(
        <tr className="ft-row-spacer" key={`arrival-${i}`}>
          <td className="ft-td"></td>

          <td className={"ft-td ft-v-cell" + vmaxClassForArrival}>
            <div className="ft-v-inner text-center"></div>
          </td>

          <td className="ft-td" />
          <td className="ft-td" />
          <td className="ft-td" />

          <td className="ft-td ft-hora-cell">
            <span className="ft-hora-arrivee">{horaArrivee}</span>
          </td>

          <td className="ft-td" />
          <td className="ft-td" />
          <td className="ft-td" />
          <td className="ft-td ft-rc-cell" />
          <td className="ft-td ft-td-nivel" />
        </tr>
      );

      renderedRowIndex++;
    }


    // 2) LIGNE PRINCIPALE (toujours)
    rows.push(
      <tr
        className={
          "ft-row-main" +
          (isCurrentlyVisible ? " ft-row-visible" : "") +
          (isSelected ? " ft-row-selected" : "")
        }
        key={`main-${i}`}
        data-ft-row={i}
        onClick={() => {
          // En mode GPS, le clic sur une ligne est inopérant (pas de Standby / recalage)
          if (referenceModeRef.current === "GPS") {
            return;
          }

          // on ne sélectionne que les lignes qui ont bien une dependencia et une heure
          if (!hora || !depNorm) return;

          const isAlreadySelected = selectedRowIndex === i;

          // 🟢 Cas 1 : on est à l'arrêt (autoScrollEnabled === false)
          // ET on reclique sur LA MÊME ligne déjà sélectionnée => on relance le mode horaire
          if (!autoScrollEnabled && isAlreadySelected) {
            // on recale explicitement la base sur cette ligne
            recalibrateFromRowRef.current = i;

            // équivalent d’un clic sur Play : on (re)met ft:auto-scroll à true
            window.dispatchEvent(
              new CustomEvent("ft:auto-scroll-change", {
                detail: { enabled: true },
              })
            );

            return;
          }

          // 🟠 Cas 2 : première sélection de la ligne (ou changement de ligne)
          // -> sélection visuelle + préparation du recalage manuel
          setSelectedRowIndex(i);
          recalibrateFromRowRef.current = i;

          // 🔴 Si le mode horaire était en cours, on le coupe et on bascule en standby (icône 🕑 orange)
          if (autoScrollEnabled) {
            window.dispatchEvent(
              new CustomEvent("ft:auto-scroll-change", {
                detail: { enabled: false },
              })
            );

            window.dispatchEvent(
              new CustomEvent("lim:hourly-mode", {
                detail: { enabled: false, standby: true },
              })
            );
          }
        }}
      >
        {(() => {
          renderedRowIndex++;

          // 1) cas normal : la toute première vraie ligne est visible
          const isFirstRow = i === firstNonNoteIndex;
          const isFirstRowVisible =
            i >= visibleRows.first && i <= visibleRows.last;

          if (isFirstRow && isFirstRowVisible) {
            bloqueoPrintedInThisRender = true;
            return <td className="ft-td">{bloqueo}</td>;
          }

          // 2) sinon, on le repose sur la 2e ligne principale visible
          const visibleStart3 = visibleRows.first;
          const visibleEnd3 = visibleRows.last;
          const targetVisible3 = visibleStart3 + 1; // même logique que Radio / VMax
          const isGoodSpot =
            mainRowCounter >= targetVisible3 && mainRowCounter <= visibleEnd3;

          if (!bloqueoPrintedInThisRender && isGoodSpot) {
            bloqueoPrintedInThisRender = true;
            return <td className="ft-td">{bloqueo}</td>;
          }

          // 3) sinon, rien
          return <td className="ft-td"></td>;
        })()}

        <td className={"ft-td ft-v-cell" + vmaxHighlightClass}>
          <div className="ft-v-inner">{mainRowSpeedContent}</div>
          {showVBar && <div className="ft-v-bar" />}
        </td>

        {/* Sit Km (surlignable) */}
        <td
          className={
            "ft-td" + (shouldHighlightRow ? " ft-highlight-cell" : "")
          }
        >
          {sitKm}
        </td>


        {/* Dependencia (surlignable) */}
        <td
          className={
            "ft-td" + (shouldHighlightRow ? " ft-highlight-cell" : "")
          }
        >
          {renderDependenciaCell(entry)}
        </td>

        {/* Com (surlignable) */}
        <td
          className={
            "ft-td" + (shouldHighlightRow ? " ft-highlight-cell" : "")
          }
        >
          {com}
        </td>

        {/* Hora */}
        <td
          className={
            "ft-td ft-hora-main" +
            (shouldHighlightRow ? " ft-highlight-cell" : "")
          }
        >
          {hora && <span className="ft-hora-depart">{hora}</span>}
        </td>

        <td className="ft-td">{tecnico}</td>
        <td className="ft-td">{conc}</td>
        <td className="ft-td">
          {(() => {
            // 1) cas normal : la toute première vraie ligne est visible
            const isFirstRow = i === firstNonNoteIndex;
            const isFirstRowVisible =
              i >= visibleRows.first && i <= visibleRows.last;

            if (isFirstRow && isFirstRowVisible) {
              // on affiche là, et on note qu'on l'a fait
              radioPrintedInThisRender = true;
              return radio;
            }

            // 2) sinon, on la repose sur la 2e ligne principale visible
            const visibleStart4 = visibleRows.first;
            const visibleEnd4 = visibleRows.last;
            const targetVisible4 = visibleStart4 + 1; // comme VMax
            const isGoodSpot =
              mainRowCounter >= targetVisible4 && mainRowCounter <= visibleEnd4;

            if (!radioPrintedInThisRender && isGoodSpot) {
              radioPrintedInThisRender = true;
              return radio;
            }

            // 3) sinon, rien
            return "";
          })()}
        </td>

        <td className="ft-td ft-rc-cell" id={`rc-cell-${i}`}>
          {showRcBar ? (
            <div className="ft-rc-bar" />
          ) : (
            <div className="ft-rc-value">{ramp}</div>
          )}
        </td>

        <td className="ft-td ft-td-nivel">{nivel}</td>
      </tr>
    );

    // ✅ IMPORTANT : on compte cette vraie ligne principale
    mainRowCounter++;

    // Mise à jour de l'état de zone CSV après la ligne principale :
    // - bottom  => on ouvre la zone (les lignes suivantes seront "full")
    // - top     => on ferme la zone (les lignes suivantes sont hors zone)
    if (isCsvStart) {
      csvZoneOpen = true;
    } else if (isCsvEnd) {
      csvZoneOpen = false;
    }

    // Vérifier si c'est la dernière ligne d'une zone CSV
    if (isCsvEnd) {
      // Si c'est la dernière ligne à surligner, on étend le surlignage à toute la ligne
      csvHighlightByIndex[i] = "full";
    }

    // 3) LIGNE INTERMÉDIAIRE POUR LA VITESSE (sous la ligne principale)
    if (showSpeedSpacer) {
      // Si la zone CSV est ouverte, cette ligne est "entre deux barres" => full
      const vmaxClassForSpeed = csvZoneOpen ? " ft-v-csv-full" : "";

      rows.push(
        <tr className="ft-row-spacer" key={`speed-${i}`}>
          {(() => {
            renderedRowIndex++;
            return <td className="ft-td"></td>;
          })()}

          <td className={"ft-td ft-v-cell" + vmaxClassForSpeed}>
            <div className="ft-v-inner text-center">{speedSpacerContent}</div>
          </td>

          <td className="ft-td" />
          <td className="ft-td" />
          <td className="ft-td" />

          {/* Pas d'heure ici, on laisse la cellule vide */}
          <td className="ft-td ft-hora-cell" />

          <td className="ft-td" />
          <td className="ft-td" />
          <td className="ft-td" />
          <td className="ft-td ft-rc-cell" />
          <td className="ft-td ft-td-nivel" />
        </tr>
      );
    }

    // 4) LIGNE INTERMÉDIAIRE POUR LES REMARQUES ROUGES (noteOnly) SOUS la ligne principale
    // ➜ désormais seulement pour les trains IMPAIR (isOdd === true)
    if (isOdd && hasNoteAfter && i < rawEntries.length - 1) {
      // Si on est dans une zone CSV, la ligne de note est aussi "dans la zone" => full
      const vmaxClassForNote = csvZoneOpen ? " ft-v-csv-full" : "";

      rows.push(
        <tr className="ft-row-inter" key={`note-${i}`}>
          {(() => {
            renderedRowIndex++;
            return <td className="ft-td"></td>;
          })()}

          <td className={"ft-td ft-v-cell" + vmaxClassForNote}>
            <div className="ft-v-inner text-center"></div>
          </td>

          <td className="ft-td" />

          <td className="ft-td">
            {renderDependenciaCell(nextEntry as FTEntry)}
          </td>

          {/* Com vide */}
          <td className="ft-td" />

          {/* Hora d'arrivée sur la même ligne que les remarques rouges */}
          <td className="ft-td ft-hora-cell">
            {showArrivalSpacer && horaArrivee && (
              <span className="ft-hora-arrivee">{horaArrivee}</span>
            )}
          </td>

          {/* Técn / Conc / Radio vides */}
          <td className="ft-td" />
          <td className="ft-td" />
          <td className="ft-td" />
          <td className="ft-td ft-rc-cell" />
          <td className="ft-td ft-td-nivel" />
        </tr>
      );

      // on consomme la ligne noteOnly
      i++;
    }
  }

  // On expose la liste des heures d'arrivée calculées pour le moteur d'auto-scroll
  arrivalEventsRef.current = arrivalEvents;

  //
  // ===== 7. RENDU FINAL ==============================================
  //

  return (
    <section className="ft-wrap h-full">
      <style>{`
        /* ===================== FT (Feuille de Train) ===================== */

        .ft-wrap {
          background: transparent;
          height: 100%;
          display: flex;
          flex-direction: column;
          min-height: 0;

        }

        .ft-scroll-x {
          width: 100%;
          height: 100%;
          max-height: 100%;
          display: flex;
          flex-direction: column;
          overflow-x: auto;
          overflow-y: hidden;
          -webkit-overflow-scrolling: touch;
        }

        .ft-body-scroll {
          flex: 1;
          min-height: 0;
          overflow-y: auto;
          -webkit-overflow-scrolling: touch;
        }

        .ft-table {
          border-collapse: separate;
          border-spacing: 0;
          width: 100%;
          min-width: 700px;
          table-layout: fixed;
          border: 2px solid #000;
          background: #fff;
          color: #000;
          font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
        }

        .ft-table th:nth-child(1),
        .ft-table td:nth-child(1) { width: 13%; }

        .ft-table th:nth-child(2),
        .ft-table td:nth-child(2) { width: 5%; }

        .ft-table th:nth-child(3),
        .ft-table td:nth-child(3) { width: 9%; }

        .ft-table th:nth-child(4),
        .ft-table td:nth-child(4) { width: 35%; }

        .ft-table th:nth-child(5),
        .ft-table td:nth-child(5) { width: 5%; }

        .ft-table th:nth-child(6),
        .ft-table td:nth-child(6) { width: 7%; }

        .ft-table th:nth-child(7),
        .ft-table td:nth-child(7) { width: 5%; }

        .ft-table th:nth-child(8),
        .ft-table td:nth-child(8) { width: 5%; }

        .ft-table th:nth-child(9),
        .ft-table td:nth-child(9) { width: 6%; }

        .ft-table th:nth-child(10),
        .ft-table td:nth-child(10) { width: 6%; }

        .ft-table th:nth-child(11),
        .ft-table td:nth-child(11) { width: 4%; }

        .dark .ft-table {
          border: 2px solid #fff;
          background: #000;
          color: #fff;
        }

        .ft-th {
          position: sticky;
          top: 0;
          z-index: 10;
          border: 2px solid #000;
          background: linear-gradient(180deg, #ffff00 0%, #fffda6 100%);
          color: #000;
          font-size: 0.8rem;
          line-height: 1.2;
          font-weight: 600;
          text-align: center;
          padding: 4px 6px;
          vertical-align: middle;
          white-space: nowrap;
        }

        .dark .ft-th {
          border: 2px solid #fff;
          background: rgba(234,179,8,0.4);
          color: #fff;
        }

        .ft-th-n {
          background: transparent !important;
          color: transparent !important;
          border-top: none !important;
          border-right: none !important;
          border-bottom: none !important;
          border-left: none !important;
        }
        .dark .ft-th-n {
          background: transparent !important;
          color: transparent !important;
          border-top: none !important;
          border-right: none !important;
          border-bottom: none !important;
          border-left: none !important;
        }

        .ft-table thead .ft-th {
          border-left: 2px solid #000;
          border-right: 2px solid #000;
        }

        .dark .ft-table thead .ft-th {
          border-left: 2px solid #fff;
          border-right: 2px solid #fff;
        }

        .ft-td {
          border-left: 1px solid #000;
          border-right: 1px solid #000;
          /* pointillés de débug retirés temporairement */
          background: #fff;
          color: #000;
          font-size: 16px;
          line-height: 1.2;
          font-weight: 600;
          text-align: center;
          padding: 4px 6px;
          vertical-align: middle;
        }
        .dark .ft-td {
          background: #000;
          color: #fff;
          border-left: 1px solid #fff;
          border-right: 1px solid #fff;
          /* pointillés de débug retirés temporairement */
        }

        .dark .ft-row-spacer .ft-td,
        .dark .ft-row-inter .ft-td {
          background: #000;
          color: #fff;
        }
        .dark .ft-highlight-cell {
          background: linear-gradient(180deg, #ffff00 0%, #fffda6 100%);
          color: #000;
        }

        /* Surlignage jaune (même esprit que InfoPanel) */
        .ft-highlight-cell {
          background: linear-gradient(180deg, #ffff00 0%, #fffda6 100%);
        }

        /* Surlignage spécifique V max (ancienne version, conservée au cas où) */
        .ft-v-highlight {
          background: #ffc000;
        }
        .dark .ft-v-highlight {
          background: #ffc000;
        }

        /* Préparation CSV : surlignage V max par demi-cellule */
        .ft-v-cell.ft-v-csv-full {
          background: #ffc000;
        }

        .ft-v-cell.ft-v-csv-top {
          background: linear-gradient(
            to bottom,
            #ffc000 0,
            #ffc000 50%,
            transparent 50%,
            transparent 100%
          );
        }

        .ft-v-cell.ft-v-csv-bottom {
          background: linear-gradient(
            to bottom,
            transparent 0,
            transparent 50%,
            #ffc000 50%,
            #ffc000 100%
          );
        }

        .dark .ft-v-cell.ft-v-csv-full {
          background: #ffc000;
        }
        .dark .ft-v-cell.ft-v-csv-top {
          background: linear-gradient(
            to bottom,
            #ffc000 0,
            #ffc000 50%,
            transparent 50%,
            transparent 100%
          );
        }
        .dark .ft-v-cell.ft-v-csv-bottom {
          background: linear-gradient(
            to bottom,
            transparent 0,
            transparent 50%,
            #ffc000 50%,
            #ffc000 100%
          );
        }

        /* Dark mode : garder le texte noir dans les Vmax surlignées */
        .dark .ft-v-cell.ft-v-csv-full,
        .dark .ft-v-cell.ft-v-csv-top,
        .dark .ft-v-cell.ft-v-csv-bottom {
          color: #000;
        }

        /* Surlignage jaune type InfoPanel */
        .ft-hl {
          background: linear-gradient(180deg,#ffff00 0%,#fffda6 100%);
        }

        .dark .ft-hl {
          background: linear-gradient(180deg,#ffff00 0%,#fffda6 100%);
        }

        .ft-table tbody tr:first-child .ft-td {
          border-top: 2px solid #000;
        }

        .dark .ft-table tbody tr:first-child .ft-td {
          border-top: 2px solid #fff;
        }

        .ft-table td:nth-child(4) {
          text-align: left;
        }
        .ft-table th:nth-child(4) {
          text-align: center;
        }

        .ft-table td:nth-child(6):not(.ft-hora-cell) {
          vertical-align: middle;
        }

        .ft-table td:nth-child(9) {
          font-size: 10px;
        }

        .ft-td-nivel {
          text-align: center;
        }

        .ft-v-cell {
          position: relative;
        }
        .ft-v-inner {
          position: relative;
          z-index: 1;
        }
        .ft-v-bar {
          position: absolute;
          left: 0;
          right: 0;
          top: 50%;
          transform: translateY(-50%);
          height: 2px;
          background: #000;
        }
        .dark .ft-v-bar {
          background: #fff;
        }

        .ft-rc-cell {
          position: relative;
        }
        .ft-rc-bar {
          position: absolute;
          left: 0;
          right: 0;
          top: 50%;
          transform: translateY(-50%);
          height: 2px;
          background: #000;
        }
        .dark .ft-rc-bar {
          background: #fff;
        }
        .ft-rc-value {
          position: relative;
          z-index: 1;
          text-align: center;
        }

        .ft-dependencia-cell {
          line-height: 1.2;
          font-weight: 600;
          font-size: 16px;
        }

        .ft-hora-cell {
          position: relative;
          display: flex;
          align-items: flex-end;
          justify-content: center;
          height: 1.2em;
          line-height: 1.1;
          font-size: 0.75rem;
          padding: 0 4px 2px;
        }
        .ft-hora-arrivee {
          font-style: italic;
          opacity: 0.6;
        }
        .ft-hora-depart {
          font-weight: 600;
        }

        .ft-rednote-line {
          font-size: 0.7rem;
          line-height: 1.2;
          font-style: italic;
          font-weight: 400;
          color: #dc2626;
        }
        .dark .ft-rednote-line {
          color: #f87171;
        }
        .ft-rednote-strong {
          font-weight: 700;
          font-style: normal;
        }

        .ft-row-spacer .ft-td {
          line-height: 0.4;
          font-weight: 400;
          height: 4px;
          padding: 2px 4px;
        }

        .ft-row-spacer .ft-td:not(.ft-hora-cell):not(:first-child) {
          font-size: 0;
        }

        .ft-row-spacer .ft-hora-cell {
          display: table-cell;
          text-align: center;
          vertical-align: bottom;
          font-size: 0.75rem;
          line-height: 1.1;
          height: 1.2em;
          padding: 0 4px 2px;
        }

        /* Lignes de remarques rouges : on veut la même logique que pour les spacers,
           mais sur toute la hauteur de la ligne (même bas que le texte rouge) */
        .ft-row-inter .ft-hora-cell {
          display: table-cell;
          text-align: center;
          vertical-align: bottom;
          font-size: 0.75rem;
          line-height: 1.1;
          padding: 0 4px 2px;
        }


        .ft-row-spacer .ft-rc-bar,
        .ft-row-spacer .ft-rc-value,
        .ft-row-spacer .ft-v-bar {
          display: none;
        }
        .ft-row-spacer .ft-v-inner {
          font-size: 16px;
          line-height: 1.1;
          font-weight: 600;
          text-align: center;
          color: inherit;
        }

        .ft-row-inter .ft-rc-bar,
        .ft-row-inter .ft-rc-value,
        .ft-row-inter .ft-v-bar {
          display: none;
        }
        .ft-row-inter .ft-v-inner {
          text-align: center;
        }

        @media print {
          .ft-th {
            font-size: 0.75rem;
            line-height: 1.1;
            padding: 3px 4px;
          }
          .ft-td {
            font-size: 0.8rem;
            line-height: 1.15;
            padding: 3px 4px;
          }
          .ft-rednote-line {
            font-size: 0.6rem;
          }
          .ft-row-spacer .ft-td {
            height: 3px;
            padding: 2px 3px;
          }
        }

        .ft-wrap {
          position: relative;
        }

        .ft-bloqueo-overlay {
          position: absolute;
          left: 0;
          top: 50%;
          width: 13%;
          transform: translateY(-50%);
          display: flex;
          align-items: center;
          justify-content: center;
          font-weight: 700;
          font-size: 1rem;
          color: #000;
          pointer-events: none;
          z-index: 5;
        }

        .ft-radio-overlay {
          position: absolute;
          left: 84%;
          top: 50%;
          width: 6%;
          transform: translateY(-50%);
          display: flex;
          align-items: center;
          justify-content: center;
          font-weight: 600;
          font-size: 0.75rem;
          letter-spacing: 0.03em;
          color: #000;
          pointer-events: none;
          z-index: 5;
        }

        .dark .ft-bloqueo-overlay {
          color: #fff;
        }

        .dark .ft-radio-overlay {
          color: #fff;
        }

.ft-active-line {
  position: absolute;
  left: 0;
  right: 0;
  top: 40%;
  height: 2px;
  background: transparent; /* invisible mais garde la boîte */
  pointer-events: none;
  z-index: 6;
}

        /* Couleur du '>' de la ligne active (debug) */
        .ft-active-marker-gps {
          color: #16a34a; /* vert GPS */
        }

        .ft-active-marker-horaire {
          color: #2563eb; /* bleu HORAIRE */
        }

        .dark .ft-active-marker-gps {
          color: #4ade80;
        }

        .dark .ft-active-marker-horaire {
          color: #60a5fa;
        }

        /* Ligne sélectionnée pour recalage manuel : cadre rouge clignotant S + D + C + H */
        .ft-row-main.ft-row-selected td:nth-child(3),
        .ft-row-main.ft-row-selected td:nth-child(4),
        .ft-row-main.ft-row-selected td:nth-child(5),
        .ft-row-main.ft-row-selected td:nth-child(6) {
          border-top: 2px solid red;
          border-bottom: 2px solid red;
          animation: ft-selection-blink 1s step-start infinite;
        }

        .ft-row-main.ft-row-selected td:nth-child(3) {
          border-left: 2px solid red;
        }

        .ft-row-main.ft-row-selected td:nth-child(6) {
          border-right: 2px solid red;
        }

        @keyframes ft-selection-blink {
          0%, 50% {
            border-color: red;
          }
          50.01%, 100% {
            border-color: transparent;
          }
        }

      `}</style>

      <div className="ft-active-line" aria-hidden="true" />

      <div
        className={
          "ft-scroll-x " +
          (variant === "modern" ? "ft-modern-wrap" : "ft-classic-wrap")
        }
      >
        {/* En-tête fixe */}
        <table className="ft-table">
          <thead>
            <tr className="whitespace-nowrap">
              <th className="ft-th">Bloqueo</th>
              <th className="ft-th">V Max</th>
              <th className="ft-th">Sit Km</th>
              <th className="ft-th">Dependencia</th>
              <th className="ft-th">Com</th>
              <th className="ft-th">Hora</th>
              <th className="ft-th">Técn</th>
              <th className="ft-th">Conc</th>
              <th className="ft-th">Radio</th>
              <th className="ft-th">
                Ramp<br />Caract
              </th>
              <th className="ft-th ft-th-n"></th>
            </tr>
          </thead>
        </table>

        {/* Corps scrollable */}
        <FTScrolling
          onScroll={handleScroll}
          onContainerRef={(el) => {
            scrollContainerRef.current = el;
          }}
        >
          <div className="ft-body-scroll" onClick={handleBodyClick}>
            <table className="ft-table">
              <tbody>{rows}</tbody>
            </table>

          </div>
        </FTScrolling>
      </div>
    </section>
  );
}