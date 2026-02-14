import React from "react";
import type { FTEntry } from "../../data/ligneFT";

export function renderRedNoteLine(line: string) {
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

export function renderDependenciaCell(entry: FTEntry) {
  const hasNotesArray = Array.isArray(entry.notes) && entry.notes.length > 0;
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
