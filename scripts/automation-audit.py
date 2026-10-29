#!/usr/bin/env python3
"""Read-only structural audit for the 11 approved educational repositories.

This tool intentionally does not modify repository contents. Counts and markers are
triage signals; they are not proof that questions are correct or exam-faithful.
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import tempfile
from collections import Counter
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote, urlsplit

REPOS = [
    "pass-juken-academy2026/english-study",
    "pass-juken-academy2026/math-juken-saitama",
    "pass-juken-academy2026/junior-japanese",
    "pass-juken-academy2026/junior-science",
    "pass-juken-academy2026/junior-social-studies",
    "pass-juken-academy2026/highschool-japanese",
    "pass-juken-academy2026/highschool-math",
    "pass-juken-academy2026/highschool-biology",
    "pass-juken-academy2026/highschool-social-studies",
    "pass-juken-academy2026/highschool-information",
    "pass-juken-academy2026/learning-portal",
]
TERMS = {
    "common_test_mentions": r"共通テスト|大学入学共通テスト",
    "mock_exam_mentions": r"模擬テスト|模試|模擬試験",
    "print_or_pdf_mentions": r"window\.print|@media\s+print|jsPDF|html2pdf|pdf",
    "clipboard_mentions": r"navigator\.clipboard|clipboard\.writeText|execCommand.{0,20}copy",
    "subject_category_flow_markers": r"科目を選ぶ|科目選択|学習分野を選択|カテゴリを選択|単元を選ぶ",
    "category_card_layout_markers": r"subjectGrid|categoryGrid|menuGrid|class=.*(?:subjects|tracks|menus|category|unit)",
    "preservation_safeguard_markers": r"復習|学習履歴|お気に入り|question|bank-data|localStorage",
    "prefecture_selector_markers": r"北海道.*沖縄県|都道府県を選択|prefSelect|prefecture",
}

class MarkupAudit(HTMLParser):
    """Collect low-risk structural indicators from HTML without executing scripts."""
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.ids = []
        self.links = []
        self.images = []
        self.inputs = 0
        self.buttons = 0
        self.selects = 0
        self._capture = 0
        self._text = []
        self._chunks = []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if attrs.get("id"):
            self.ids.append(attrs["id"])
        if tag in {"a", "link", "script"} and attrs.get("href" if tag != "script" else "src"):
            key = "href" if tag != "script" else "src"
            self.links.append(attrs[key])
        if tag == "img" and attrs.get("src"):
            self.images.append(attrs["src"])
        self.inputs += tag == "input"
        self.buttons += tag == "button"
        self.selects += tag == "select"

    def handle_data(self, data):
        if data.strip():
            self._chunks.append(data.strip())

def self_test():
    parser = MarkupAudit()
    parser.feed('<main id="x"><a href="./asset.css">A</a><img src="pic.png"><button>Go</button><select></select></main>')
    assert parser.ids == ["x"]
    assert "./asset.css" in parser.links
    assert parser.images == ["pic.png"]
    assert parser.buttons == 1 and parser.selects == 1
    assert len(REPOS) == 11 and len(set(REPOS)) == 11
    assert len(re.findall(TERMS["common_test_mentions"], "共通テスト 模試")) == 1
    print("Self-test passed: HTML markers, asset references, and fixed 11-repository scope.")

def local_target(repo_root: Path, source: Path, raw_url: str):
    """Return an in-repo target for a relative URL; ignore external/dynamic URLs."""
    if not raw_url or raw_url.startswith(("#", "data:", "javascript:", "mailto:", "tel:")):
        return None
    parsed = urlsplit(raw_url)
    if parsed.scheme or parsed.netloc or raw_url.startswith("//"):
        return None
    path = unquote(parsed.path)
    if not path:
        return None
    target = (source.parent / path).resolve()
    root = repo_root.resolve()
    try:
        target.relative_to(root)
    except ValueError:
        return None
    return target

def audit(repo: str, root: Path) -> dict:
    target = root / repo.split("/")[-1]
    clone = subprocess.run(
        ["git", "clone", "--depth=1", f"https://github.com/{repo}.git", str(target)],
        text=True, capture_output=True, timeout=180,
    )
    if clone.returncode:
        return {"repository": repo, "status": "clone_failed", "error": clone.stderr[-700:]}
    files = [p for p in target.rglob("*") if p.is_file() and ".git" not in p.parts]
    html_files = [p for p in files if p.suffix.lower() in {".html", ".htm"}]
    all_html_parts = []
    ids_by_file = {}
    broken_local_refs = []
    structural = Counter()
    for path in html_files:
        html = path.read_text(encoding="utf-8", errors="replace")
        all_html_parts.append(html)
        parser = MarkupAudit()
        try:
            parser.feed(html)
        except Exception:
            pass
        duplicates = sorted(k for k, n in Counter(parser.ids).items() if n > 1)
        if duplicates:
            ids_by_file[str(path.relative_to(target))] = duplicates[:30]
        structural["input_count"] += parser.inputs
        structural["button_count"] += parser.buttons
        structural["select_count"] += parser.selects
        for raw in parser.links + parser.images:
            local = local_target(target, path, raw)
            if local is not None and not local.exists():
                broken_local_refs.append({"file": str(path.relative_to(target)), "reference": raw})
    all_html = "\n".join(all_html_parts)
    index = target / "index.html"
    html = index.read_text(encoding="utf-8", errors="replace") if index.exists() else all_html
    question_markers = len(re.findall(r"問題|question|設問", all_html, re.I))
    data_files = [p for p in files if p.suffix.lower() in {".json", ".csv", ".tsv"}]
    marker_counts = {key: len(re.findall(pattern, all_html, re.I)) for key, pattern in TERMS.items()}
    return {
        "repository": repo,
        "status": "ok",
        "file_count": len(files),
        "html_file_count": len(html_files),
        "data_file_count": len(data_files),
        "index_html_present": index.exists(),
        "index_bytes": len(html.encode("utf-8")),
        "viewport_meta": bool(re.search(r"<meta[^>]+name=.viewport", html, re.I)),
        "responsive_css_marker": bool(re.search(r"@media|clamp\(|minmax\(", all_html, re.I)),
        "duplicate_html_ids": ids_by_file,
        "broken_local_reference_count": len(broken_local_refs),
        "broken_local_references": broken_local_refs[:100],
        "structural_counts": dict(structural),
        "markers": marker_counts,
        "question_related_marker_count": question_markers,
        "script_tag_count": len(re.findall(r"<script\b", all_html, re.I)),
        "external_script_count": len(re.findall(r"<script[^>]+src=.https?://", all_html, re.I)),
        "note": "Static heuristics only; dynamic routes, runtime behavior, content correctness and exam fidelity need dedicated tests.",
    }

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--self-test", action="store_true", help="run offline checks without cloning repositories")
    args = parser.parse_args()
    if args.self_test:
        self_test()
        return
    out = Path("automation-reports")
    out.mkdir(exist_ok=True)
    results = []
    with tempfile.TemporaryDirectory(prefix="repo-audit-") as tmp:
        root = Path(tmp)
        for repo in REPOS:
            try:
                results.append(audit(repo, root))
            except Exception as exc:
                results.append({"repository": repo, "status": "audit_error", "error": str(exc)[:700]})
    report = {
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "scope": REPOS,
        "results": results,
        "summary": {
            "total": len(results),
            "ok": sum(x["status"] == "ok" for x in results),
            "failed": sum(x["status"] != "ok" for x in results),
        },
    }
    (out / "audit.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    lines = [
        "# Scheduled repository audit", "",
        f"Generated (UTC): {report['generated_at_utc']}", "",
        f"Result: {report['summary']['ok']}/{report['summary']['total']} repositories audited; {report['summary']['failed']} failures.", "",
        "> Read-only static audit. Marker counts are triage signals, not proof of correctness, quality, accessibility, or exam fidelity.", "",
        "| Repository | Status | HTML | Data files | Broken local refs | Duplicate IDs | Subject/category markers | Common Test markers |",
        "|---|---:|---:|---:|---:|---:|---:|---:|",
    ]
    for x in results:
        duplicate_count = sum(len(v) for v in x.get("duplicate_html_ids", {}).values())
        markers = x.get("markers", {})
        lines.append(
            f"| {x['repository']} | {x['status']} | {x.get('html_file_count','—')} | {x.get('data_file_count','—')} | "
            f"{x.get('broken_local_reference_count','—')} | {duplicate_count if x['status']=='ok' else '—'} | "
            f"{markers.get('subject_category_flow_markers','—')} | {markers.get('common_test_mentions','—')} |"
        )
    lines += [
        "", "## Safe follow-up", "",
        "- Investigate broken local references and duplicate IDs before changing code; static detection can include false positives.",
        "- Do not rewrite questions or answers based only on keyword counts.",
        "- Keep a before/after content inventory and reject unexpected decreases in question/data counts.",
        "- Cross-repository write automation and AI content generation are not enabled by this read-only audit.",
        "- Browser-level interaction, responsive layout, print/PDF, copy, answer correctness, copyright, and exam-format checks remain separate gates.",
        "",
    ]
    (out / "audit.md").write_text("\n".join(lines), encoding="utf-8")
    print((out / "audit.md").read_text(encoding="utf-8"))
    if report["summary"]["failed"]:
        raise SystemExit(f"Audit incomplete: {report['summary']['failed']} repositories failed; see audit artifact.")

if __name__ == "__main__":
    main()
