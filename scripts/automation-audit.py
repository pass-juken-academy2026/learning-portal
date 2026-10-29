#!/usr/bin/env python3
"""Read-only baseline audit for the 11 approved repositories."""
from __future__ import annotations
import json, re, subprocess, tempfile
from datetime import datetime, timezone
from pathlib import Path

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
    "clipboard_mentions": r"navigator\.clipboard|clipboard\.writeText|execCommand\(['\"]copy",
    "subject_category_flow_markers": r"科目を選ぶ|科目選択|学習分野を選択|カテゴリを選択|単元を選ぶ",
    "category_card_layout_markers": r"subjectGrid|categoryGrid|menuGrid|class=.*(?:subjects|tracks|menus|category|unit)",
    "preservation_safeguard_markers": r"復習|学習履歴|お気に入り|question|bank-data|localStorage",
}

def audit(repo: str, root: Path) -> dict:
    target = root / repo.split("/")[-1]
    clone = subprocess.run(["git", "clone", "--depth=1", f"https://github.com/{repo}.git", str(target)],
                           text=True, capture_output=True)
    if clone.returncode:
        return {"repository": repo, "status": "clone_failed", "error": clone.stderr[-500:]}
    files = [p for p in target.rglob("*") if p.is_file() and ".git" not in p.parts]
    html_files = [p for p in files if p.suffix.lower() in {".html", ".htm"}]
    all_html = "\n".join(p.read_text(encoding="utf-8", errors="replace") for p in html_files)
    index = target / "index.html"
    html = index.read_text(encoding="utf-8", errors="replace") if index.exists() else all_html
    question_markers = len(re.findall(r"問題|question|設問", all_html, re.I))
    return {
        "repository": repo,
        "status": "ok",
        "file_count": len(files),
        "html_file_count": len(html_files),
        "index_html_present": index.exists(),
        "index_bytes": len(html.encode("utf-8")),
        "viewport_meta": bool(re.search(r'<meta[^>]+name=[\'\"]viewport', html, re.I)),
        "responsive_css_marker": bool(re.search(r"@media|clamp\(|minmax\(", all_html, re.I)),
        "common_test_mentions": len(re.findall(TERMS["common_test_mentions"], all_html, re.I)),
        "mock_exam_mentions": len(re.findall(TERMS["mock_exam_mentions"], all_html, re.I)),
        "print_or_pdf_mentions": len(re.findall(TERMS["print_or_pdf_mentions"], all_html, re.I)),
        "clipboard_mentions": len(re.findall(TERMS["clipboard_mentions"], all_html, re.I)),
        "question_related_marker_count": question_markers,
        "script_tag_count": len(re.findall(r"<script\b", all_html, re.I)),
        "external_script_count": len(re.findall(r"<script[^>]+src=[\'\"]https?://", all_html, re.I)),
        "note": "Keyword counts are triage signals, not proof of feature correctness or exam fidelity.",
    }

def main():
    out = Path("automation-reports")
    out.mkdir(exist_ok=True)
    results = []
    with tempfile.TemporaryDirectory(prefix="repo-audit-") as tmp:
        root = Path(tmp)
        for repo in REPOS:
            results.append(audit(repo, root))
    report = {"generated_at_utc": datetime.now(timezone.utc).isoformat(), "scope": REPOS, "results": results}
    (out / "audit.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    lines = ["# Scheduled repository audit", "", f"Generated (UTC): {report['generated_at_utc']}", "",
             "> Read-only baseline; keyword markers do not establish correctness, quality, or Common Test fidelity.", "",
             "| Repository | Status | HTML files | Common Test | Mock | Print/PDF | Copy |",
             "|---|---:|---:|---:|---:|---:|---:|"]
    for x in results:
        lines.append(f"| {x['repository']} | {x['status']} | {x.get('html_file_count','—')} | {x.get('common_test_mentions','—')} | {x.get('mock_exam_mentions','—')} | {x.get('print_or_pdf_mentions','—')} | {x.get('clipboard_mentions','—')} |")
    lines += ["", "## Safe follow-up", "",
              "- Do not rewrite questions or answers based only on keyword counts.",
              "- Missing markers are inspection candidates, not proof a feature is absent.",
              "- Cross-repository write automation and AI content generation require configured credentials and dedicated tests.",
              ""]
    (out / "audit.md").write_text("\n".join(lines), encoding="utf-8")
    print(f"Audited {sum(x['status']=='ok' for x in results)}/{len(results)} repositories.")
    print((out / "audit.md").read_text(encoding="utf-8"))

if __name__ == "__main__":
    main()
