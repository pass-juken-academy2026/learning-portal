import sys
import tempfile
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from audit_html_fragments import audit

class FragmentAuditTests(unittest.TestCase):
    def test_same_page_fragment_passes(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            (root / "index.html").write_text('<a href="#section">go</a><h2 id="section">Hi</h2>', encoding="utf-8")
            self.assertEqual(audit(root), [])
    def test_cross_page_fragment_passes(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            (root / "index.html").write_text('<a href="other.html#part">go</a>', encoding="utf-8")
            (root / "other.html").write_text('<div id="part">ok</div>', encoding="utf-8")
            self.assertEqual(audit(root), [])
    def test_missing_fragment_fails(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            (root / "index.html").write_text('<a href="#missing">go</a>', encoding="utf-8")
            self.assertTrue(any("missing #missing" in e for e in audit(root)))
    def test_missing_target_file_fails(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            (root / "index.html").write_text('<a href="absent.html#part">go</a>', encoding="utf-8")
            self.assertTrue(any("missing fragment target file" in e for e in audit(root)))
    def test_external_and_root_relative_links_are_skipped(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            (root / "index.html").write_text('<a href="https://example.com/#x">external</a><a href="/site/index.html#x">root</a>', encoding="utf-8")
            self.assertEqual(audit(root), [])
if __name__ == "__main__":
    unittest.main()
