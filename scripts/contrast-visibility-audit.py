#!/usr/bin/env python3
"""Read-only triage for likely low-contrast text styles; findings require browser/human confirmation."""
from __future__ import annotations
import argparse, json, re
from pathlib import Path

COLOR = re.compile(r"(?:color|background(?:-color)?)\s*:\s*([^;}{]+)", re.I)
WHITE = {"white", "#fff", "#ffffff", "rgb(255,255,255)", "rgb(255, 255, 255)"}
PALE = {"#fefefe", "#fafafa", "#f8f8f8", "#f5f5f5", "#f0f0f0", "#fff", "#ffffff", "white", "ivory"}
DARK = {"#000", "#000000", "#111", "#111111", "#222", "#222222", "#333", "#333333", "#444", "#444444", "black"}
def norm(v): return re.sub(r"\s+", "", v.strip().lower())
def inspect_text(text, path):
    out=[]
    lines=text.splitlines()
    for i,line in enumerate(lines,1):
        decls=[(m.group(0),norm(m.group(1))) for m in COLOR.finditer(line)]
        fg=[v for k,v in decls if re.match(r"color\s*:",k,re.I)]
        bg=[v for k,v in decls if re.match(r"background(?:-color)?\s*:",k,re.I)]
        if any(v in {norm(x) for x in WHITE} for v in fg) and any(v in {norm(x) for x in PALE} for v in bg):
            out.append({"path":str(path),"line":i,"severity":"high","reason":"explicit white/pale text with white/pale background in same declaration line","snippet":line.strip()[:240]})
        if re.search(r"opacity\s*:\s*0\.[0-5]\d*",line,re.I):
            out.append({"path":str(path),"line":i,"severity":"review","reason":"low opacity may reduce text contrast","snippet":line.strip()[:240]})
        if re.search(r"color\s*:\s*(?:#(?:eee|eeeeee|f{3,6})\b|white)\s*[;}].{0,160}background(?:-color)?\s*:\s*(?:#fff(?:fff)?\b|white)\b",line,re.I):
            out.append({"path":str(path),"line":i,"severity":"high","reason":"likely pale text on pale surface","snippet":line.strip()[:240]})
    # Cross-line CSS rules can put foreground and background declarations on separate lines.
    joined="\n".join(lines)
    for match in re.finditer(r"([^{}]{1,240})\{([^{}]{1,1200})\}",joined,re.S):
        selector,body=match.group(1).strip(),match.group(2)
        fgs=[norm(m.group(1)) for m in re.finditer(r"(?:^|;)\s*color\s*:\s*([^;]+)",body,re.I)]
        bgs=[norm(m.group(1)) for m in re.finditer(r"(?:^|;)\s*background(?:-color)?\s*:\s*([^;]+)",body,re.I)]
        if any(v in {norm(x) for x in WHITE} for v in fgs) and any(v in {norm(x) for x in PALE} for v in bgs):
            line=joined.count("\n",0,match.start())+1
            out.append({"path":str(path),"line":line,"severity":"high","reason":"CSS rule combines pale text and pale background","selector":selector[:180],"snippet":body.strip()[:240]})
    # De-duplicate identical findings.
    seen=set(); unique=[]
    for item in out:
        key=(item["path"],item["line"],item["reason"])
        if key not in seen: seen.add(key); unique.append(item)
    return unique
def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--root",type=Path,default=Path("."))
    ap.add_argument("--output",type=Path,default=Path("contrast-visibility-audit.json"))
    ap.add_argument("--self-test",action="store_true")
    a=ap.parse_args()
    if a.self_test:
        bad=inspect_text(".choice { color: #fff;\\n background: #fff; }","fixture.html")
        good=inspect_text(".choice { color: #fff;\\n background: #123456; }","fixture.html")
        faint=inspect_text(".hint { opacity: 0.35; }","fixture.html")
        assert any(x["severity"]=="high" for x in bad), bad
        assert not any(x["severity"]=="high" for x in good), good
        assert any("opacity" in x["reason"] for x in faint), faint
        print("contrast visibility scanner self-test passed"); return 0
    exts={".html",".css"}
    findings=[]; files=[]
    for p in a.root.rglob("*"):
        if not p.is_file() or p.suffix.lower() not in exts: continue
        if any(part in {".git","node_modules","vendor","dist"} for part in p.parts): continue
        files.append(p)
        try: findings.extend(inspect_text(p.read_text(encoding="utf-8",errors="replace"),p.relative_to(a.root)))
        except OSError: pass
    report={"scanned_file_count":len(files),"finding_count":len(findings),"findings":findings,"limitations":["heuristic only; CSS variables, cascade, computed styles, images, and runtime DOM are not fully evaluated","a finding is a review candidate, not proof of an accessibility failure","no automatic style edits are made by this scanner"]}
    a.output.write_text(json.dumps(report,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    print(json.dumps({"scanned_file_count":len(files),"finding_count":len(findings),"output":str(a.output)},ensure_ascii=False))
    return 0
if __name__=="__main__": raise SystemExit(main())
