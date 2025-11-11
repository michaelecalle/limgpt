import React from "react";
import "./LTV.css";

export default function LTV() {
  return (
    <div className="ltv-container">
      <table className="ltv-table">
        <colgroup>
          {/* 1. (CÓDIGO LTV) Trayecto / Estación */}
          <col className="ltv-col-trayecto" />

          {/* 2. Vía */}
          <col className="ltv-col-via" />

          {/* 3. Km. Ini */}
          <col className="ltv-col-km" />

          {/* 4. Km. Fin */}
          <col className="ltv-col-km2" />

          {/* 5. Veloc. */}
          <col className="ltv-col-vel" />

          {/* 6. Motivo */}
          <col className="ltv-col-motivo" />

          {/* 7–12. Colonnes techniques (Establecido / Fin prevista / No señalizada ...) */}
          <col className="ltv-col-small-a" />
          <col className="ltv-col-small-b" />
          <col className="ltv-col-small-c" />
          <col className="ltv-col-small-d" />
          <col className="ltv-col-small-e" />
          <col className="ltv-col-small-f" />

          {/* 13. Sólo vehic. Cabeza */}
          <col className="ltv-col-solo" />

          {/* 14. CSV */}
          <col className="ltv-col-csv-narrow" />

          {/* 15. Observaciones */}
          <col className="ltv-col-csv" />
        </colgroup>

        <thead>
          <tr>
            <th rowSpan={2} className="ltv-trayecto">
              (CÓDIGO LTV) Trayecto / Estación
            </th>
            <th rowSpan={2} className="vert">
              Vía
            </th>
            <th rowSpan={2} className="vert">
              Km. Ini
            </th>
            <th rowSpan={2} className="vert">
              Km. Fin
            </th>
            <th rowSpan={2} className="vert">
              Veloc.
            </th>
            <th rowSpan={2}>Motivo</th>
            <th colSpan={2}>Establecido</th>
            <th colSpan={2}>Fin prevista</th>
            <th colSpan={2}>No señalizada</th>
            <th rowSpan={2} className="vert">
              Sólo vehic. <br /> Cabeza
            </th>
            <th rowSpan={2} className="vert">
              CSV
            </th>
            <th rowSpan={2}>Observaciones</th>
          </tr>
          <tr>
            <th className="vert">Fecha</th>
            <th className="vert">Hora</th>
            <th className="vert">Fecha</th>
            <th className="vert">Hora</th>
            <th className="vert">Vía</th>
            <th className="vert">Sistema</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td colSpan={15} className="ltv-placeholder">
              {/* Partie image du bas (LTV réel) */}
              <img
                src="/assets/ltv_real.png"
                alt="LTV réel"
                className="ltv-reference"
              />
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
