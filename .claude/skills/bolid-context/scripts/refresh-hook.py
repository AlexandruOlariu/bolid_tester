#!/usr/bin/env python3
"""PostToolUse hook: rebuild the bolid-context graph only when a STRUCTURAL file
changes (src/*.ts(x), docs/*.md, or the curated overlay).

Cross-platform (no dependency on `bash` being on PATH) and self-contained:
re-runs graph.py with the same interpreter that ran this hook. Always exits 0 so
it can never block an edit. Registered in .claude/settings.json. Reads the tool
event JSON from stdin and looks at tool_input.file_path.
"""
import sys
import re
import json
import subprocess
from pathlib import Path


def main():
    try:
        data = json.load(sys.stdin)
    except Exception:
        return
    fp = (data.get("tool_input") or {}).get("file_path") or ""
    if not fp:
        return
    norm = fp.replace("\\", "/")

    structural = bool(
        re.search(r"/src/.*\.(ts|tsx)$", norm)
        or re.search(r"/docs/.*\.md$", norm)
        or norm.endswith("bolid-context/graph/curated.json")
    )
    if not structural:
        return  # silent on non-structural paths

    graph_py = Path(__file__).resolve().parent / "graph.py"
    try:
        subprocess.run(
            [sys.executable, str(graph_py), "build"],
            capture_output=True, timeout=25,
        )
        print(f"bolid-context: graph rebuilt ({Path(norm).name})")
    except Exception:
        pass  # never surface an error to the editing flow


if __name__ == "__main__":
    main()
    sys.exit(0)
