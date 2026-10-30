#!/usr/bin/env python3
"""Conservative, read-only content quality triage for one educational repository.

This scanner finds exact and near-duplicate question-like strings and obvious
missing-field patterns. It does not prove answer correctness, semantic equivalence,
copyright status, or legal compliance; findings require human review.
"""
from __future__ import annotations

import argparse
import html
import json
import re
import unicodedata
from collections import defaultdict
from html.parser import HTMLParser
from pathlib import Path

QUESTION_HINTS = re.compile(
    r"(?:[？?]|どれ|どの|何を|なぜ|正しい|誤って|選びなさい|選べ|求めよ|答えよ|"
    r"読み取|考えられる|適切な|当てはまる|Which|What|Why|Choose|Calculate|Select)",
    re.I,
)
STRING_LITERAL = re.compile(r"""(["'])(.{12,700}?)\1""", re.S)
SENSITIVE_OR_RIGHTS_HINTS = {
    "official_exam_reproduction": re.compile(r"過去問|本試験問題|大学入学共通テスト.*問題を転載"),
    "personal_data_review": re.compile(r"氏名|住所|電話番号|メールアドレス|生年月日|学籍番号"),
    "external_data_transfer_review": re.compile(r"fetch\s*\(|XMLHttpRequest|sendBeacon|localStorage|sessionStorage"),
    "rights_or_attribution_review": re.compile(r"出典|引用|転載|著作権|利用許諾|Creative Commons"),
}

def normalize(value: str) -> str:
    value = unicodedata.normalize("NFKC", html.unescape(value)).casefold()
    value = re.sub(r"<[^>]+>", " ", value)
    value = re.sub(r"[\s\u3000]+", " ", value).strip()
    value = re.sub(r"[\W_]+", "", value, flags=re.UNICODE)
    return value

def trigrams(value: str) -> set[str]:
    if len(value) < 3:
        return {value} if value else set()
    return {value[i:i + 3] for i in range(len(value) - 2)}

def similarity(left: str, right: str) -> float:
    a, b = trigrams(left), trigrams(right)
    if not a or not b:
        return 0.0
    return len(a & b) / len(a | b)

def looks_like_prompt(value: str) -> bool:
    """Reject obvious code/style/markup fragments before comparing candidate prompts."""
    code_patterns = (
        r"<\/?(?:option|script|style|div|p|section|button|input|a)\b",
        r"(?:document|window)\.(?:querySelector|getElementById|createElement)",
        r"\b(?:function|const|let|var)\s+[A-Za-z_$]",
        r"=>|\.textContent|\.append(?:Child)?\(|URLSearchParams",
        r":where\(|--[A-Za-z0-9_-]+\s*:|\{\s*(?:touch-action|display|color|margin|padding)\s*:",
        r"\b(?:questions|answers)\s*['\"]?\s*\??\s*[:+?]",
        r"(?:^|\s|['\"])\.?/?[A-Za-z0-9_./-]+\.html?(?:\?|$)",
        r"\b(?:classList|querySelector|getElementById|innerHTML|textContent|addEventListener|URLSearchParams)\b",
        r"\.(?:includes|map|filter|forEach)\s*\(",
        r"^[?&=+*/{};]|[?&](?:subject|mode|units|type)=",
    )
    return not any(re.search(pattern, value, re.I) for pattern in code_patterns)

class TextCollector(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.capture_depth = 0
        self.parts: list[str] = []
        self.candidates: list[str] = []
        self.current: list[str] = []
        self.tag_stack: list[bool] = []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        marker = " ".join([attrs.get("id", ""), attrs.get("class", ""), attrs.get("data-testid", "")]).lower()
        is_candidate = bool(re.search(r"question|prompt|設問|問題文|問題カード", marker))
        self.tag_stack.append(is_candidate)
        if is_candidate:
            self.capture_depth += 1

    def handle_data(self, data):
        if data.strip():
            self.parts.append(data.strip())
            if self.capture_depth:
                self.current.append(data.strip())

    def handle_endtag(self, tag):
        if self.tag_stack:
            was_candidate = self.tag_stack.pop()
            if was_candidate:
                self.capture_depth = max(0, self.capture_depth - 1)
                text = " ".join(self.current).strip()
                if text:
                    self.candidates.append(text)
                self.current = []

def collect_candidates(source: str, path: str) -> list[dict]:
    parser = TextCollector()
    try:
        markup_only = re.sub(r"<(?:script|style)\b[^>]*>.*?</(?:script|style)\s*>", " ", source, flags=re.I | re.S)
        parser.feed(markup_only)
    except Exception:
        pass
    candidates = []
    seen = set()
    for value in parser.candidates:
        cleaned = re.sub(r"\s+", " ", value).strip()
        key = normalize(cleaned)
        if len(key) >= 14 and QUESTION_HINTS.search(cleaned) and looks_like_prompt(cleaned) and key not in seen:
            seen.add(key)
            candidates.append({"text": cleaned, "normalized": key, "file": path, "source": "question-marked-element"})
    # Inline data banks often keep prompts as string literals rather than marked HTML.
    for match in STRING_LITERAL.finditer(source):
        raw = match.group(2)
        cleaned = re.sub(r"\\[nrt]", " ", raw)
        cleaned = html.unescape(cleaned).strip()
        key = normalize(cleaned)
        if len(key) >= 14 and len(cleaned) <= 700 and QUESTION_HINTS.search(cleaned) and looks_like_prompt(cleaned) and key not in seen:
            seen.add(key)
            candidates.append({"text": cleaned, "normalized": key, "file": path, "source": "question-like-string"})
    return candidates

def audit(root: Path) -> dict:
    scan_files = sorted(p for suffix in ("*.html", "*.js", "*.json") for p in root.rglob(suffix) if ".git" not in p.parts)
    candidates = []
    missing_fields = []
    rights_flags = []
    for path in scan_files:
        source = path.read_text(encoding="utf-8", errors="replace")
        rel = str(path.relative_to(root))
        candidates.extend(collect_candidates(source, rel))
        for field, pattern in SENSITIVE_OR_RIGHTS_HINTS.items():
            hits = len(pattern.findall(source))
            if hits:
                rights_flags.append({"file": rel, "review_flag": field, "marker_count": hits})
        # Heuristic only: flag question-like records with prompt but no nearby answer/explanation.
        for match in re.finditer(r"(?:question|設問|問題文)\s*[:=]\s*['\"][^'\"]{8,500}['\"]", source, re.I):
            window = source[match.start():match.start() + 1800]
            if not re.search(r"(?:answer|correct|answerIndex|正答|解答|explanation|解説)\s*[:=]", window, re.I):
                missing_fields.append({"file": rel, "offset": match.start(), "finding": "question-like field without nearby answer/explanation marker"})
    exact = defaultdict(list)
    for item in candidates:
        exact[item["normalized"]].append(item)
    exact_duplicates = [
        {"normalized_prompt": key, "occurrences": [{"file": x["file"], "text": x["text"][:240]} for x in values]}
        for key, values in exact.items() if len(values) > 1
    ]
    # Limit fuzzy comparisons to question-like candidates, normalized text length >= 28.
    fuzzy_candidates = [x for x in candidates if len(x["normalized"]) >= 28]
    near_duplicates = []
    seen_pairs = set()
    for i, left in enumerate(fuzzy_candidates):
        for right in fuzzy_candidates[i + 1:]:
            if left["file"] == right["file"] and left["normalized"] == right["normalized"]:
                continue
            pair = tuple(sorted((left["normalized"], right["normalized"])))
            if pair in seen_pairs:
                continue
            score = similarity(left["normalized"], right["normalized"])
            if score >= 0.88 and left["normalized"] != right["normalized"]:
                seen_pairs.add(pair)
                near_duplicates.append({
                    "similarity": round(score, 3),
                    "left": {"file": left["file"], "text": left["text"][:240]},
                    "right": {"file": right["file"], "text": right["text"][:240]},
                })
    return {
        "scope": str(root),
        "scanned_file_count": len(scan_files),
        "html_file_count": sum(1 for p in scan_files if p.suffix.lower() == ".html"),
        "js_file_count": sum(1 for p in scan_files if p.suffix.lower() == ".js"),
        "json_file_count": sum(1 for p in scan_files if p.suffix.lower() == ".json"),
        "question_like_candidate_count": len(candidates),
        "exact_duplicate_groups": exact_duplicates,
        "near_duplicate_candidates": near_duplicates,
        "possible_missing_answer_or_explanation": missing_fields,
        "legal_privacy_rights_review_flags": rights_flags,
        "limitations": [
            "String and markup heuristics can miss questions or produce false positives.",
            "Near-duplicate scores are triage signals, not a semantic-equivalence verdict.",
            "No answer key is independently solved by this script.",
            "Rights/privacy flags identify areas for review; they do not establish a violation or compliance.",
        ],
    }

def self_test() -> None:
    source = """
    <section class="question-card"><p>次の資料から、正しい説明を一つ選びなさい。</p></section>
    const q = "次の資料から、正しい説明を一つ選びなさい。";
    const q2 = "次の資料から正しい説明を一つ選びなさい。";
    """
    items = collect_candidates(source, "fixture.html")
    assert len(items) >= 1, f"expected a question-like candidate, got {len(items)}"
    assert normalize("ＡＢＣ　テスト！") == normalize("abc テスト")
    assert similarity("abcdefghi", "abcdefghj") > 0.5
    assert not looks_like_prompt('button{min-height:42px}:where(button,a,input,select,textarea,[role=button])')
    assert not looks_like_prompt(');function render(){const s=document.querySelector("x")')
    assert looks_like_prompt('次の資料から、正しい説明を一つ選びなさい。')
    print("Content quality audit self-test passed.")

def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=Path("target"), help="repository directory to scan")
    parser.add_argument("--self-test", action="store_true")
    parser.add_argument("--output", type=Path, help="optional JSON output path")
    args = parser.parse_args()
    if args.self_test:
        self_test()
        return
    if not args.root.is_dir():
        raise SystemExit(f"Repository directory not found: {args.root}")
    report = audit(args.root)
    rendered = json.dumps(report, ensure_ascii=False, indent=2)
    if args.output:
        args.output.write_text(rendered + "\n", encoding="utf-8")
    print(rendered)

if __name__ == "__main__":
    main()
