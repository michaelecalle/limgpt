#!/usr/bin/env python3
"""
Import CSVs -> regenerate ligneFT.ts (Option A: notes as JSON string in CSV).
Usage:
  python import_csv_to_ligneFT.py --pair FT_LIGNE_PAIR.csv --impair FT_LIGNE_IMPAIR.csv --zones CSV_ZONES.csv --out ligneFT.ts
"""
import argparse, json, math
from pathlib import Path
import pandas as pd

ENTRY_COLS = ["pk","dependencia","network","pk_rfn","pk_lfp","pk_adif","pk_internal",
             "note","notes","isNoteOnly","bloqueo","radio","vmax","vmax_bar","vmax_highlight",
             "rc","rc_bar","etcs","hora","tecnico","conc"]

def norm(v):
    if v is None: return None
    if isinstance(v, float) and (math.isnan(v) or math.isinf(v)): return None
    if isinstance(v, str) and v.strip()=="":
        return None
    return v

def row_to_obj(row: dict):
    obj={}
    for k in ENTRY_COLS:
        v = norm(row.get(k))
        if v is None:
            continue
        if k=="notes":
            if isinstance(v, str):
                v=v.strip()
                if v=="":
                    continue
                try:
                    v=json.loads(v)
                except Exception:
                    # If user typed a plain string, keep as single-item list
                    v=[v]
        if k in ("pk","dependencia","network","pk_rfn","pk_lfp","pk_adif","note","bloqueo","radio","etcs","hora","tecnico","conc"):
            if isinstance(v, (int,float)) and k in ("pk","dependencia")==False:
                # keep numbers as-is for numeric fields
                pass
        obj[k]=v
    return obj

def format_value(v):
    if isinstance(v, str):
        return json.dumps(v, ensure_ascii=False)
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, (int, float)):
        # keep as plain number
        if isinstance(v, float) and v.is_integer():
            return str(int(v))
        return str(v)
    if isinstance(v, list):
        return json.dumps(v, ensure_ascii=False)
    return "null"

def format_entry(obj, indent="  "):
    # stable key order
    order = ENTRY_COLS
    lines=["{"]  # will indent later
    for k in order:
        if k not in obj:
            continue
        lines.append(f'{indent}{k}: {format_value(obj[k])},')
    # remove trailing comma on last line if desired? TS allows trailing comma; keep it.
    lines.append("}")
    return "\n".join(lines)

def format_zones(df):
    order=["sens","pkFrom","pkTo","ignoreIfFirst"]
    out=[]
    for _,r in df.iterrows():
        obj={}
        for k in order:
            v=norm(r.get(k))
            if v is None: continue
            obj[k]=v
        out.append(obj)
    lines=["export const CSV_ZONES: CsvZone[] = ["] 
    for obj in out:
        lines.append("  {")
        for k in order:
            if k in obj:
                lines.append(f"    {k}: {format_value(obj[k])},")
        lines.append("  },")
    lines.append("];")
    return "\n".join(lines)

HEADER = """// src/data/ligneFT.ts
// Source de vérité pour la feuille de train (FT)
//
// Fichier régénéré automatiquement à partir des CSV (Option A: notes en JSON).
// Éditer dans Excel puis régénérer via import_csv_to_ligneFT.py
"""

TYPES = r"""
export type FtNetwork = "RFN" | "LFP" | "ADIF";

export interface FTEntry {
  pk: string;
  dependencia: string;

  network?: FtNetwork;

  pk_rfn?: string;
  pk_lfp?: string;
  pk_adif?: string;

  pk_internal?: number;

  note?: string;
  notes?: string[];
  isNoteOnly?: boolean;

  bloqueo?: string;
  radio?: string;

  vmax?: number;
  vmax_bar?: boolean;
  vmax_highlight?: boolean;

  rc?: number;
  rc_bar?: boolean;

  etcs?: string;
  hora?: string;
  tecnico?: string;
  conc?: string;
}

export type CsvSens = "PAIR" | "IMPAIR";

export interface CsvZone {
  sens: CsvSens;
  pkFrom: number;
  pkTo: number;
  ignoreIfFirst?: boolean;
}
"""

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--pair", type=Path, required=True)
    ap.add_argument("--impair", type=Path, required=True)
    ap.add_argument("--zones", type=Path, required=True)
    ap.add_argument("--out", type=Path, required=True)
    args=ap.parse_args()

    df_pair=pd.read_csv(args.pair, dtype=str).fillna("")
    df_imp=pd.read_csv(args.impair, dtype=str).fillna("")
    df_z=pd.read_csv(args.zones, dtype=str).fillna("")

    # Convert numeric/bool fields from strings
    def coerce(df):
        out=[]
        for _,r in df.iterrows():
            row=dict(r)
            # normalize numeric fields
            for k in ("pk_internal","vmax","rc"):
                v=row.get(k,"").strip()
                if v=="":
                    row[k]=None
                else:
                    row[k]=float(v) if "." in v else int(v)
            for k in ("vmax_bar","vmax_highlight","rc_bar","isNoteOnly"):
                v=row.get(k,"").strip().lower()
                if v=="":
                    row[k]=None
                else:
                    row[k]=v in ("true","1","yes","y")
            # others as strings
            for k in ("pk","dependencia","network","pk_rfn","pk_lfp","pk_adif","note","notes","bloqueo","radio","etcs","hora","tecnico","conc"):
                v=row.get(k,"")
                row[k]=v if v!="" else None
            out.append(row)
        return out

    pair_objs=[row_to_obj(r) for r in coerce(df_pair)]
    imp_objs=[row_to_obj(r) for r in coerce(df_imp)]

    # zones numeric/bool coercion
    z_rows=[]
    for _,r in df_z.iterrows():
        row=dict(r)
        row["pkFrom"]=float(row["pkFrom"]) if row.get("pkFrom","").strip()!="" else None
        row["pkTo"]=float(row["pkTo"]) if row.get("pkTo","").strip()!="" else None
        ign=row.get("ignoreIfFirst","").strip().lower()
        row["ignoreIfFirst"]= None if ign=="" else ign in ("true","1","yes","y")
        z_rows.append(row)
    z_df=pd.DataFrame(z_rows)

    lines=[]
    lines.append(HEADER.rstrip())
    lines.append(TYPES.strip())
    lines.append("")
    lines.append(format_zones(z_df))
    lines.append("")
    lines.append("export const FT_LIGNE_PAIR: FTEntry[] = [")
    for obj in pair_objs:
        lines.append("  " + format_entry(obj, indent="    ").replace("\n", "\n  "))
        lines.append("  ,")
    # clean commas: replace last "  ," with "];"
    if lines[-1].strip()==",":
        pass
    # remove last comma line
    if lines[-1].strip()==",":
        lines=lines[:-1]
    if lines[-1].strip()=="  ,":
        lines=lines[:-1]
    else:
        # remove trailing "  ," from last entry
        if lines[-1].strip()=="  ,":
            lines.pop()
    # Actually easier: rebuild properly
    # We'll rebuild the pair/imp blocks cleanly:
    lines = []
    lines.append(HEADER.rstrip())
    lines.append(TYPES.strip())
    lines.append("")
    lines.append(format_zones(z_df))
    lines.append("")
    def block(name, objs):
        bl=[f"export const {name}: FTEntry[] = ["]
        for i,obj in enumerate(objs):
            bl.append("  " + format_entry(obj, indent="    ").replace("\n", "\n  ") + ("," if True else ""))
        bl.append("];")
        return "\n".join(bl)

    lines.append(block("FT_LIGNE_PAIR", pair_objs))
    lines.append("")
    lines.append(block("FT_LIGNE_IMPAIR", imp_objs))
    args.out.write_text("\n".join(lines).rstrip()+"\n", encoding="utf-8")
    print("OK: wrote", args.out)

if __name__=="__main__":
    main()
