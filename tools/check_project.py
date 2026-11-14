"""Check active case paths, local links and downloaded source hashes."""
from pathlib import Path
from urllib.parse import unquote
import hashlib, json, re

ROOT = Path(__file__).resolve().parent.parent

def main():
    from case_content import load_catalog
    catalog = load_catalog(ROOT)
    registered = {item["folder"]: item for item in catalog["cases"]}
    links = 0
    for item in catalog["cases"]:
        case = ROOT / "cases" / item["folder"]
        assert case.is_dir(), case
        for locale, entry in item["locales"].items():
            path = case / entry["file"]
            assert path.is_file(), (item["case_id"], locale, path)
    for case in (ROOT / "cases").iterdir():
        if not case.is_dir() or case.name.startswith("."):
            continue
        assert case.name in registered, f"Unregistered case directory: {case}"
        for markdown in case.glob("*.md"):
            for target in re.findall(r"\]\(([^\n)]+)\)", markdown.read_text(encoding="utf-8")):
                target = target.strip("<>")
                if target.startswith(("http:", "https:", "app:", "#", "/Users/ink/Downloads/")):
                    continue
                rel = unquote(target.split("#")[0])
                assert (markdown.parent / rel).exists(), (markdown, target)
                links += 1
    for manifest in (ROOT / "research").rglob("source_manifest.json"):
        data = json.loads(manifest.read_text(encoding="utf-8"))
        records = data if isinstance(data, list) else data.get("sources", [])
        for item in records:
            if not isinstance(item, dict) or item.get("status") != "downloaded":
                continue
            source = manifest.parent / item.get("file", "")
            assert source.exists(), source
            if item.get("sha256"):
                assert hashlib.sha256(source.read_bytes()).hexdigest() == item["sha256"], source
    from check_content import check
    check(ROOT)
    print(f"{len(catalog["cases"])} active cases, {links} local Markdown links verified; source download hashes intact.")

if __name__ == "__main__":
    from python_environment import use_project_python
    use_project_python()
    main()
