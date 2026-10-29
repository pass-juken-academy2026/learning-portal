#!/usr/bin/env python3
"""Audit local HTML fragment links without requiring external packages."""
from __future__ import annotations
import argparse
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote, urlsplit

class PageParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.ids = set()
        self.links = []
    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if attrs.get("id"):
            self.ids.add(attrs["id"])
        if tag.lower() == "a" and attrs.get("name"):
            self.ids.add(attrs["name"])
        if tag.lower() in ("a", "area", "link") and attrs.get("href"):
            self.links.append(attrs["href"])

def parse_page(path: Path) -> PageParser:
    parser = PageParser()
    parser.feed(path.read_text(encoding="utf-8"))
    parser.close()
    return parser

def audit(root: Path):
    root = root.resolve()
    pages = sorted(root.rglob("*.html"))
    errors = []
    if not pages:
        return ["No HTML pages found under " + str(root)]
    cache = {}
    for page in pages:
        try:
            parsed = cache.setdefault(page, parse_page(page))
        except (OSError, UnicodeError) as exc:
            errors.append(f"{page.relative_to(root)}: unable to parse page: {exc}")
            continue
        for href in parsed.links:
            url = urlsplit(href.strip())
            if not url.fragment or url.scheme or url.netloc:
                continue
            # Root-relative URLs are site-host-rooted and cannot be resolved
            # correctly without the deployment base path, so leave them to URL audit.
            if url.path.startswith("/"):
                continue
            target = page if not url.path else (page.parent / unquote(url.path)).resolve()
            try:
                target.relative_to(root)
            except ValueError:
                errors.append(f"{page.relative_to(root)}: fragment link escapes repository: {href}")
                continue
            if target.is_dir():
                target = target / "index.html"
            if not target.exists():
                errors.append(f"{page.relative_to(root)}: missing fragment target file: {href}")
                continue
            if target.suffix.lower() != ".html":
                continue
            try:
                target_page = cache.get(target)
                if target_page is None:
                    target_page = parse_page(target)
                    cache[target] = target_page
            except (OSError, UnicodeError) as exc:
                errors.append(f"{page.relative_to(root)}: cannot read fragment target {href}: {exc}")
                continue
            fragment = unquote(url.fragment)
            if fragment not in target_page.ids and fragment != "top":
                errors.append(f"{page.relative_to(root)}: missing #{fragment} in {target.relative_to(root)} (href={href})")
    return errors

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", default=".", help="repository root to audit")
    args = parser.parse_args()
    errors = audit(Path(args.root))
    if errors:
        print("\\n".join(errors))
        raise SystemExit(1)
    print("PASS local HTML fragment audit")
if __name__ == "__main__":
    main()
