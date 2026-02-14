import React from "react";
import FTScrolling from "./FTScrolling";

type ReferenceMode = "HORAIRE" | "GPS";
type GpsStateUi = "RED" | "ORANGE" | "GREEN";

type FTTableLayoutProps = {
  variant: "classic" | "modern";
  effectiveFtView: "ES" | "FR";

  referenceMode: ReferenceMode;
  gpsStateUi: GpsStateUi;
  trainPosYpx: number | null;

  activeRowIndex: number;
  getFallbackTrainTopPx: () => string;

  onScroll: (e: React.UIEvent<HTMLDivElement>) => void;
  onContainerRef: (el: HTMLDivElement | null) => void;
  onBodyClick: (e: React.MouseEvent<HTMLDivElement>) => void;

  rows: JSX.Element[];
};

export default function FTTableLayout({
  variant,
  effectiveFtView,
  referenceMode,
  gpsStateUi,
  trainPosYpx,
  activeRowIndex,
  getFallbackTrainTopPx,
  onScroll,
  onContainerRef,
  onBodyClick,
  rows,
}: FTTableLayoutProps) {
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
        /* Heures calculées (interpolées) : affichage gris + italique */
        .ft-hora-theo {
          font-style: italic;
          color: #6b7280;
          opacity: 0.85;

          /* ✅ iPad : hh:mm:ss -> réduction nette + prioritaire */
          font-size: 0.72em !important;
          line-height: 1.0 !important;
          white-space: nowrap;
        }
        .dark .ft-hora-theo {
          color: #9ca3af;
          opacity: 0.9;
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
          background: transparent;
          pointer-events: none;
          z-index: 6;
        }

        /* Couleur du '>' de la ligne active (debug) */
        .ft-active-marker-gps {
          color: #16a34a;
        }

        .ft-active-marker-horaire {
          color: #2563eb;
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
        style={{ display: effectiveFtView === "FR" ? "block" : "none" }}
        className="p-3"
      >
        <div className="text-sm font-semibold">FT France</div>
        <div className="text-xs opacity-70">
          Mode FR activé. (Table France Perpignan→Figueres à brancher ensuite.)
        </div>
      </div>

      <div
        style={{ display: effectiveFtView === "ES" ? "block" : "none" }}
        className={
          "ft-scroll-x " +
          (variant === "modern" ? "ft-modern-wrap" : "ft-classic-wrap")
        }
      >
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

        <FTScrolling
          onScroll={onScroll}
          onContainerRef={onContainerRef}
          overlay={
            (() => {
              const color =
                referenceMode === "HORAIRE"
                  ? "red"
                  : gpsStateUi === "GREEN"
                  ? "#16a34a"
                  : gpsStateUi === "ORANGE"
                  ? "#f97316"
                  : "red";

              const top =
                typeof trainPosYpx === "number" && Number.isFinite(trainPosYpx)
                  ? `${trainPosYpx}px`
                  : getFallbackTrainTopPx();

              return (
                <div
                  style={{
                    position: "absolute",
                    top,
                    left: "13%",
                    width: "14%",
                    display: "flex",
                    alignItems: "center",
                    pointerEvents: "none",
                    zIndex: 999,
                  }}
                >
                  <div
                    style={{
                      width: 0,
                      height: 0,
                      borderTop: "6px solid transparent",
                      borderBottom: "6px solid transparent",
                      borderLeft: `10px solid ${color}`,
                    }}
                  />
                  <div
                    style={{
                      flex: 1,
                      height: "2px",
                      background: color,
                    }}
                  />
                  <div
                    style={{
                      width: 0,
                      height: 0,
                      borderTop: "6px solid transparent",
                      borderBottom: "6px solid transparent",
                      borderRight: `10px solid ${color}`,
                    }}
                  />
                </div>
              );
            })()
          }
        >
          <div className="ft-body-scroll" onClick={onBodyClick}>
            <table className="ft-table">
              <tbody>{rows}</tbody>
            </table>
          </div>
        </FTScrolling>
      </div>
    </section>
  );
}
