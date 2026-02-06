#!/usr/bin/env python3
"""
Export src/data/ligneFT.ts -> CSVs (Option A: notes as JSON string).
Usage:
  python export_ligneFT_to_csv.py path/to/ligneFT.ts --out out_dir
"""
import argparse, re, json
from pathlib import Path
import pandas as pd

def strip_comments(s: str) -> str:
    s = re.sub(r"/\*.*?\*/", "", s, flags=re.S)
    s = re.sub(r"//.*", "", s)
    return s

def split_top_level_objects(arr_body: str):
    objs = []
    i=0; n=len(arr_body)
    while i<n:
        while i<n and arr_body[i] in " \t\r\n,":
            i+=1
        if i>=n: break
        if arr_body[i] != "{":
            i+=1; continue
        depth=0; in_str=False; esc=False
        start=i
        while i<n:
            ch=arr_body[i]
            if in_str:
                if esc: esc=False
                elif ch=="\\": esc=True
                elif ch=='"': in_str=False
            else:
                if ch=='"': in_str=True
                elif ch=='{': depth+=1
                elif ch=='}':
                    depth-=1
                    if depth==0:
                        i+=1; break
            i+=1
        objs.append(arr_body[start:i].strip())
    return objs

def split_pairs(obj_body: str):
    inner = obj_body.strip()[1:-1].strip()
    pairs=[]; token=""
    depth_br=0; depth_brace=0
    in_str=False; esc=False
    for ch in inner:
        if in_str:
            token += ch
            if esc: esc=False
            elif ch=="\\": esc=True
            elif ch=='"': in_str=False
            continue
        if ch=='"':
            in_str=True; token += ch; continue
        if ch=='[':
            depth_br +=1; token += ch; continue
        if ch==']':
            depth_br -=1; token += ch; continue
        if ch=='{':
            depth_brace +=1; token += ch; continue
        if ch=='}':
            depth_brace -=1; token += ch; continue
        if ch==',' and depth_br==0 and depth_brace==0:
            t=token.strip()
            if t: pairs.append(t)
            token=""
        else:
            token += ch
    t=token.strip()
    if t: pairs.append(t)
    return pairs

def parse_value(v: str):
    v=v.strip()
    if v=="":
        return None
    if v.startswith('"') and v.endswith('"'):
        return json.loads(v)
    if v.startswith('['):
        return json.loads(v)  # expects valid JSON arrays for strings
    if v in ("true","false"):
        return v=="true"
    if v in ("null","undefined"):
        return None
    if re.match(r"^-?\d+\.\d+$", v): return float(v)
    if re.match(r"^-?\d+$", v): return int(v)
    return v

def parse_object(obj_body: str):
    d={}
    for pair in split_pairs(obj_body):
        if ":" not in pair: continue
        k,v = pair.split(":",1)
        d[k.strip()] = parse_value(v.strip())
    return d

def extract_array(clean: str, name: str) -> str:
    m = re.search(rf"export\s+const\s+{re.escape(name)}\s*:\s*[^=]*=\s*\[(.*?)\]\s*;", clean, flags=re.S)
    if not m:
        m = re.search(rf"export\s+const\s+{re.escape(name)}\s*=\s*\[(.*?)\]\s*;", clean, flags=re.S)
    if not m:
        raise SystemExit(f"Array {name} not found")
    return m.group(1).strip()

def entries_to_df(entries):
    cols = ["pk","dependencia","network","pk_rfn","pk_lfp","pk_adif","pk_internal",
            "note","notes","isNoteOnly","bloqueo","radio","vmax","vmax_bar","vmax_highlight",
            "rc","rc_bar","etcs","hora","tecnico","conc"]
    rows=[]
    for e in entries:
        row={c: None for c in cols}
        for k,v in e.items():
            if k in row:
                row[k]=v
        if isinstance(row["notes"], list):
            row["notes"]=json.dumps(row["notes"], ensure_ascii=False)
        rows.append(row)
    return pd.DataFrame(rows, columns=cols)

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("ligneFT", type=Path)
    ap.add_argument("--out", type=Path, default=Path("."))
    args=ap.parse_args()

    raw=args.ligneFT.read_text(encoding="utf-8")
    clean=strip_comments(raw)

    pair_objs=[parse_object(o) for o in split_top_level_objects(extract_array(clean,"FT_LIGNE_PAIR"))]
    imp_objs=[parse_object(o) for o in split_top_level_objects(extract_array(clean,"FT_LIGNE_IMPAIR"))]
    zones_objs=[parse_object(o) for o in split_top_level_objects(extract_array(clean,"CSV_ZONES"))]

    args.out.mkdir(parents=True, exist_ok=True)
    entries_to_df(pair_objs).to_csv(args.out/"FT_LIGNE_PAIR.csv", index=False, encoding="utf-8-sig")
    entries_to_df(imp_objs).to_csv(args.out/"FT_LIGNE_IMPAIR.csv", index=False, encoding="utf-8-sig")

    zcols=["sens","pkFrom","pkTo","ignoreIfFirst"]
    pd.DataFrame([{c:o.get(c) for c in zcols} for o in zones_objs], columns=zcols)\
        .to_csv(args.out/"CSV_ZONES.csv", index=False, encoding="utf-8-sig")

    print("OK: CSVs written to", args.out)

if __name__=="__main__":
    main()
