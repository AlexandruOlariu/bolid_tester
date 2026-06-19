#!/usr/bin/env python3
"""bolid-context: a token-light project map for the bolid-tester repo.

Stdlib-only. The graph JSON is NEVER meant to be loaded into context — only the
compact query output is. A query returns *references + one-line summaries*, never
file contents. That is the token win: replace `glob -> grep -> read -> "not it"`
with one call that hands you the curated file set, then read only what you need.

Commands:
  build                 (re)derive nodes.json + edges.json from src/ + docs/ + curated.json
  stats                 node/edge counts by type + the biggest hubs
  context <term...>     a ranked, grouped context pack for a task/feature/term
  find <term...>        list nodes matching a term (id, path, summary)
  neighbors <id>        direct neighbours of a node, grouped by relation
  docs <term...>        docs/concepts related to a term

Layers:
  1. Structural (regenerated): screens, features, core/lib/store/ui/transport/
     service/vehicle modules, docs  +  serves/imports/documents/named edges.
  2. Curated (graph/curated.json, hand-edited): `concept` nodes and `relates`
     links — the domain knowledge code structure can't express.
"""

import sys
import re
import json
import heapq
from pathlib import Path

# --------------------------------------------------------------------------- #
# Paths                                                                        #
# --------------------------------------------------------------------------- #
HERE = Path(__file__).resolve().parent          # .../bolid-context/scripts
SKILL = HERE.parent                              # .../bolid-context
REPO = SKILL.parents[2]                          # skills -> .claude -> repo root
SRC = REPO / "src"
DOCS = REPO / "docs"
GRAPH_DIR = SKILL / "graph"
NODES_JSON = GRAPH_DIR / "nodes.json"
EDGES_JSON = GRAPH_DIR / "edges.json"
CURATED_JSON = GRAPH_DIR / "curated.json"

# --------------------------------------------------------------------------- #
# Small helpers                                                                #
# --------------------------------------------------------------------------- #
STOP_TOKENS = {
    "src", "index", "model", "ui", "hooks", "api", "use", "the", "and", "for",
    "screen", "store", "test", "ts", "tsx", "md", "obd", "core", "shared",
    "feature", "features", "lib", "with", "from", "pure", "see", "docs",
}

_CAMEL = re.compile(r"[A-Z]+(?=[A-Z][a-z])|[A-Z]?[a-z]+|[A-Z]+|\d+")


def tokenize(text):
    """Lowercased word/camelCase/number tokens, length>=2, minus stop words."""
    if not text:
        return []
    out = []
    for chunk in re.split(r"[^A-Za-z0-9]+", str(text)):
        for piece in _CAMEL.findall(chunk):
            t = piece.lower()
            if len(t) >= 2 and t not in STOP_TOKENS:
                out.append(t)
    return out


def humanize(slug):
    return re.sub(r"[-_/]+", " ", str(slug)).strip()


def rel(path):
    try:
        return str(Path(path).resolve().relative_to(REPO)).replace("\\", "/")
    except ValueError:
        return str(path).replace("\\", "/")


def read_text(path):
    try:
        return Path(path).read_text(encoding="utf-8", errors="ignore")
    except OSError:
        return ""


def first_heading(md_text):
    for line in md_text.splitlines():
        s = line.strip()
        if s.startswith("#"):
            return s.lstrip("#").strip()
    return ""


def first_para(md_text):
    for line in md_text.splitlines():
        s = line.strip()
        if s and not s.startswith("#") and not s.startswith("!["):
            return s
    return ""


_JSDOC = re.compile(r"/\*\*(.*?)\*/", re.S)
_LINE_COMMENT = re.compile(r"^\s*//\s?(.*)$", re.M)
_EXPORT_DECL = re.compile(
    r"^export\s+(?:default\s+)?(?:async\s+)?(?:abstract\s+)?"
    r"(?:function|const|let|var|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)",
    re.M,
)


def clip(text, n=150):
    text = re.sub(r"\s+", " ", (text or "").strip())
    return text if len(text) <= n else text[: n - 1].rstrip() + "…"


def ts_summary(path):
    """One-line summary for a TS/TSX module: first JSDoc sentence, else first
    `//` comment, else first exported symbol name."""
    txt = read_text(path)
    m = _JSDOC.search(txt[:1200])
    if m:
        body = re.sub(r"^\s*\*\s?", "", m.group(1), flags=re.M)
        body = re.sub(r"\s+", " ", body).strip()
        sentence = re.split(r"(?<=[.!?])\s", body)[0] if body else ""
        if sentence:
            return clip(sentence)
    m = _LINE_COMMENT.search(txt[:600])
    if m and not m.group(1).startswith(("eslint", "@ts", "/")):
        return clip(m.group(1))
    m = _EXPORT_DECL.search(txt)
    if m:
        return f"exports {m.group(1)}"
    return ""


def exported_symbols(path):
    """Identifiers a TS module exports (declarations + `export {{ ... }}`)."""
    txt = read_text(path)
    out = set(_EXPORT_DECL.findall(txt))
    for block in re.findall(r"^export\s*\{([^}]*)\}", txt, re.M):
        for clause in block.split(","):
            clause = clause.strip()
            if not clause:
                continue
            name = clause.split(" as ")[-1].strip() if " as " in clause else clause
            name = re.sub(r"^type\s+", "", name).strip()
            if re.fullmatch(r"[A-Za-z_$][\w$]*", name):
                out.add(name)
    return out


def load_jsonc(path):
    """Parse JSON that allows whole-line `//` comments."""
    raw = read_text(path)
    cleaned = "\n".join(
        line for line in raw.splitlines() if not line.lstrip().startswith("//")
    )
    return json.loads(cleaned) if cleaned.strip() else {}


# --------------------------------------------------------------------------- #
# Graph                                                                        #
# --------------------------------------------------------------------------- #
class Graph:
    def __init__(self):
        self.nodes = {}            # id -> {type, path, summary, tokens, tests}
        self.edges = []            # [src, dst, rel]
        self._adj = {}             # id -> [(other, rel)]
        self._deg = {}

    def add_node(self, nid, ntype, path=None, summary="", tokens=None, tests=None):
        if nid in self.nodes:
            n = self.nodes[nid]
            if path and not n.get("path"):
                n["path"] = path
            if summary and not n.get("summary"):
                n["summary"] = summary
            if tokens:
                n["tokens"] = sorted(set(n["tokens"]) | set(tokens))
            if tests:
                n.setdefault("tests", [])
                n["tests"] = sorted(set(n["tests"]) | set(tests))
            return nid
        toks = set(tokens or [])
        toks |= set(tokenize(nid.split(":", 1)[-1]))
        self.nodes[nid] = {
            "type": ntype,
            "path": path,
            "summary": summary or "",
            "tokens": sorted(toks),
        }
        if tests:
            self.nodes[nid]["tests"] = sorted(set(tests))
        return nid

    def add_edge(self, a, b, relation):
        if a == b or a not in self.nodes or b not in self.nodes:
            return
        self.edges.append([a, b, relation])

    def index(self):
        self._adj = {nid: [] for nid in self.nodes}
        seen, uniq = set(), []
        for a, b, r in self.edges:
            key = (a, b, r)
            if key in seen or a not in self.nodes or b not in self.nodes:
                continue
            seen.add(key)
            uniq.append([a, b, r])
            self._adj[a].append((b, r))
            self._adj[b].append((a, r))
        self.edges = uniq
        self._deg = {nid: len(adj) for nid, adj in self._adj.items()}

    def neighbors(self, nid):
        return self._adj.get(nid, [])

    def degree(self, nid):
        return self._deg.get(nid, 0)


# --------------------------------------------------------------------------- #
# Node discovery (bolid-tester specific)                                       #
# --------------------------------------------------------------------------- #
# Module-level resolver tables, populated during discovery.
FILE_OWNER = {}     # src-relative path (with ext) -> node id
PATH_TO_NODE = {}   # src-relative path (no ext)   -> node id
SYMBOL_TO_NODE = {} # exported identifier          -> node id
BARRELS = {}        # src-relative dir             -> barrel node id


def _register_file(node_id, abspath):
    relp = str(abspath.relative_to(SRC)).replace("\\", "/")
    FILE_OWNER[relp] = node_id
    PATH_TO_NODE[relp.rsplit(".", 1)[0]] = node_id
    for sym in exported_symbols(abspath):
        SYMBOL_TO_NODE.setdefault(sym, node_id)


def _iter_src(root, suffixes=(".ts", ".tsx")):
    for p in sorted(root.rglob("*")):
        if p.is_file() and p.suffix in suffixes and ".test." not in p.name:
            yield p


def build_screens(g):
    app = SRC / "app"
    if not app.is_dir():
        return
    for p in sorted(app.glob("*.tsx")):
        slug = p.stem
        nid = f"screen:{slug}"
        summary = ts_summary(p) or f"Route screen '{humanize(slug)}' (expo-router)."
        g.add_node(nid, "screen", path=rel(p), summary=summary,
                   tokens=tokenize(slug))
        _register_file(nid, p)


def build_features(g):
    root = SRC / "features"
    if not root.is_dir():
        return
    for d in sorted(root.iterdir()):
        if not d.is_dir():
            continue
        slug = d.name
        nid = f"feature:{slug}"
        doc = DOCS / "features" / f"{slug}.md"
        summary = ""
        if doc.is_file():
            summary = first_para(read_text(doc)) or first_heading(read_text(doc))
        if not summary:
            idx = d / "index.ts"
            summary = ts_summary(idx) if idx.is_file() else ""
        if not summary:
            summary = f"{humanize(slug).title()} feature (screen + hooks + model)."
        g.add_node(nid, "feature", path=rel(d), summary=clip(summary),
                   tokens=tokenize(slug))
        for p in _iter_src(d):
            _register_file(nid, p)


# (src-relative-dir, node-id-prefix, type) for per-file shared modules.
def build_shared(g):
    root = SRC / "shared"
    if not root.is_dir():
        return

    def add_filenode(nid, ntype, p, summary_default=""):
        g.add_node(nid, ntype, path=rel(p),
                   summary=ts_summary(p) or summary_default,
                   tokens=tokenize(nid.split(":", 1)[1]))
        _register_file(nid, p)

    # obd-core: one node per source file, keyed by sub-path (e.g. analysis/dpf)
    core = root / "obd-core"
    if core.is_dir():
        for p in _iter_src(core):
            sub = str(p.relative_to(core)).replace("\\", "/").rsplit(".", 1)[0]
            if sub == "index":
                bid = "core:public-api"
                BARRELS["shared/obd-core"] = bid
                g.add_node(bid, "core", path=rel(p),
                           summary=ts_summary(p) or "obd-core public barrel.",
                           tokens=["obdcore", "public", "api"])
                _register_file(bid, p)
            else:
                add_filenode(f"core:{sub}", "core", p)

    # lib / state(store) / ui / transports(ble)
    for sub, prefix, ntype in (
        ("lib", "lib", "lib"),
        ("state", "store", "store"),
        ("ui", "ui", "ui"),
        ("transports/ble", "transport", "transport"),
    ):
        d = root / sub
        if not d.is_dir():
            continue
        for p in _iter_src(d):
            if p.stem == "index":
                continue
            add_filenode(f"{prefix}:{p.stem}", ntype, p)

    # ai / notify: collapse each directory to a single service node
    for sub, nid, default in (
        ("ai", "service:ai", "AI client (OpenAI-compatible) for the diagnose feature."),
        ("notify", "service:notify", "Local notifications + permission wrapper."),
    ):
        d = root / sub
        if not d.is_dir():
            continue
        summary = default
        for p in _iter_src(d):
            summary = ts_summary(p) or summary
            break
        g.add_node(nid, "service", path=rel(d), summary=summary,
                   tokens=tokenize(sub) + tokenize(default))
        for p in _iter_src(d):
            _register_file(nid, p)

    # vehicles: registry barrel + one node per profile / types
    veh = root / "vehicles"
    if veh.is_dir():
        for p in _iter_src(veh):
            if p.stem == "index":
                bid = "vehicle:registry"
                BARRELS["shared/vehicles"] = bid
                g.add_node(bid, "vehicle", path=rel(p),
                           summary=ts_summary(p) or "Vehicle profile registry.",
                           tokens=["vehicle", "registry", "profile"])
                _register_file(bid, p)
            else:
                add_filenode(f"vehicle:{p.stem}", "vehicle", p)


def build_docs(g):
    if not DOCS.is_dir():
        return
    for p in sorted(DOCS.rglob("*.md")):
        rp = p.relative_to(DOCS)
        slug = str(rp).replace("\\", "/").rsplit(".", 1)[0]
        nid = f"doc:{slug}"
        txt = read_text(p)
        summary = first_heading(txt) or first_para(txt) or humanize(slug)
        g.add_node(nid, "doc", path=rel(p), summary=clip(summary),
                   tokens=tokenize(slug) + tokenize(first_heading(txt)))


# --------------------------------------------------------------------------- #
# Edge derivation                                                              #
# --------------------------------------------------------------------------- #
_IMPORT_STMT = re.compile(
    r"(?:import|export)\b(?P<body>[^;{]*\{[^}]*\}|[^;]*?)\s*from\s*['\"](?P<spec>[^'\"]+)['\"]",
    re.S,
)
_NAMED = re.compile(r"\{([^}]*)\}")


def _named_imports(body):
    m = _NAMED.search(body or "")
    if not m:
        return []
    out = []
    for clause in m.group(1).split(","):
        clause = clause.strip()
        if not clause:
            continue
        name = clause.split(" as ")[0].strip()
        name = re.sub(r"^type\s+", "", name).strip()
        if re.fullmatch(r"[A-Za-z_$][\w$]*", name):
            out.append(name)
    return out


def _resolve(spec, importer_relpath, names):
    """Map an import specifier to a set of target node ids (src-relative keys)."""
    # Normalise to a key relative to src/ (no leading 'src/').
    if spec.startswith("@/"):
        key = spec[2:]
    elif spec.startswith("."):
        base = Path(importer_relpath).parent
        key = str((base / spec).as_posix())
        # collapse ./ and ../
        parts = []
        for seg in key.split("/"):
            if seg in ("", "."):
                continue
            if seg == "..":
                if parts:
                    parts.pop()
            else:
                parts.append(seg)
        key = "/".join(parts)
    else:
        return set()  # external package

    targets = set()

    # feature directory (coarse: whole feature is one node)
    m = re.match(r"features/([^/]+)", key)
    if m and f"feature:{m.group(1)}" in NODE_IDS:
        targets.add(f"feature:{m.group(1)}")
        return targets

    # ai / notify collapse
    if key.startswith("shared/ai"):
        targets.add("service:ai")
        return targets
    if key.startswith("shared/notify"):
        targets.add("service:notify")
        return targets

    # exact file
    if key in PATH_TO_NODE:
        targets.add(PATH_TO_NODE[key])
        return targets

    # barrel directory -> resolve named imports through the symbol map
    if key in BARRELS:
        for nm in names:
            if nm in SYMBOL_TO_NODE:
                targets.add(SYMBOL_TO_NODE[nm])
        if not targets:
            targets.add(BARRELS[key])
        return targets

    # a relative import that lands on a directory index
    if (key + "/index") in PATH_TO_NODE:
        targets.add(PATH_TO_NODE[key + "/index"])
    return targets


NODE_IDS = set()  # filled in build()


def link_imports(g):
    for relp, owner in FILE_OWNER.items():
        txt = read_text(SRC / relp)
        for m in _IMPORT_STMT.finditer(txt):
            spec = m.group("spec")
            names = _named_imports(m.group("body"))
            for tgt in _resolve(spec, relp, names):
                if tgt == owner or tgt not in g.nodes:
                    continue
                ot, tt = g.nodes[owner]["type"], g.nodes[tgt]["type"]
                relation = "serves" if (ot == "screen" and tt == "feature") else "imports"
                g.add_edge(owner, tgt, relation)


def link_by_name(g):
    """`named` edges: cross-type nodes sharing a distinctive (rare) token."""
    tok_index = {}
    for nid, n in g.nodes.items():
        for t in set(n["tokens"]):
            tok_index.setdefault(t, []).append(nid)
    existing = {(a, b) for a, b, _ in g.edges} | {(b, a) for a, b, _ in g.edges}
    per_node = {}
    for tok, ids in sorted(tok_index.items()):
        if len(ids) > 4:          # too common -> not distinctive
            continue
        for i in range(len(ids)):
            for j in range(i + 1, len(ids)):
                a, b = ids[i], ids[j]
                if g.nodes[a]["type"] == g.nodes[b]["type"]:
                    continue
                if (a, b) in existing:
                    continue
                if per_node.get(a, 0) >= 4 or per_node.get(b, 0) >= 4:
                    continue
                g.add_edge(a, b, "named")
                existing.add((a, b))
                existing.add((b, a))
                per_node[a] = per_node.get(a, 0) + 1
                per_node[b] = per_node.get(b, 0) + 1


def link_docs(g):
    """`documents` edges: a doc node -> the code node(s) it describes."""
    feature_slugs = {nid.split(":", 1)[1]: nid
                     for nid in g.nodes if nid.startswith("feature:")}
    for nid, n in list(g.nodes.items()):
        if not nid.startswith("doc:"):
            continue
        slug = nid.split(":", 1)[1]
        leaf = slug.split("/")[-1]
        # docs/features/<slug>.md  -> feature:<slug>
        if slug.startswith("features/") and leaf in feature_slugs:
            g.add_edge(nid, feature_slugs[leaf], "documents")
        # docs/vehicles/<slug>.md  -> vehicle:<slug>
        if slug.startswith("vehicles/") and f"vehicle:{leaf}" in g.nodes:
            g.add_edge(nid, f"vehicle:{leaf}", "documents")
        # token overlap with feature names (catches maintenance-log -> maintenance)
        dtoks = set(tokenize(leaf))
        if slug.startswith("features/"):
            for fslug, fid in feature_slugs.items():
                if dtoks & set(tokenize(fslug)) and not slug.endswith(fslug):
                    g.add_edge(nid, fid, "documents")


def attach_tests(g):
    """Record co-located test files as node metadata (not separate nodes)."""
    for p in sorted(SRC.rglob("*.test.*")):
        if p.suffix not in (".ts", ".tsx"):
            continue
        relp = str(p.relative_to(SRC)).replace("\\", "/")
        base = relp.replace(".test.", ".").rsplit(".", 1)[0]
        owner = PATH_TO_NODE.get(base)
        if not owner:
            # belongs to a feature/dir node -> attribute to nearest known owner
            m = re.match(r"features/([^/]+)", relp)
            if m:
                owner = f"feature:{m.group(1)}"
        if owner and owner in g.nodes:
            g.nodes[owner].setdefault("tests", [])
            tp = rel(p)
            if tp not in g.nodes[owner]["tests"]:
                g.nodes[owner]["tests"].append(tp)


# --------------------------------------------------------------------------- #
# Curated overlay                                                              #
# --------------------------------------------------------------------------- #
def resolve_id(g, raw):
    if raw in g.nodes:
        return raw
    # allow bare ids or suffix matches
    cands = [nid for nid in g.nodes if nid == raw or nid.endswith(":" + raw)]
    if len(cands) == 1:
        return cands[0]
    return raw  # unresolved -> caller decides


def apply_curated(g):
    if not CURATED_JSON.is_file():
        return [], []
    data = load_jsonc(CURATED_JSON)
    concept_ids = set()
    for c in data.get("concepts", []):
        nid = c["id"] if c["id"].startswith("concept:") else f"concept:{c['id']}"
        concept_ids.add(nid)
        g.add_node(nid, "concept", path=None, summary=clip(c.get("summary", "")),
                   tokens=(c.get("tokens", []) + tokenize(nid.split(":", 1)[1])))
    for nid, summ in data.get("summaries", {}).items():
        rid = resolve_id(g, nid)
        if rid in g.nodes:
            g.nodes[rid]["summary"] = clip(summ)
    unresolved = []
    for link in data.get("links", []):
        a = resolve_id(g, link[0])
        b = resolve_id(g, link[1])
        relation = link[2] if len(link) > 2 else "relates"
        if a in g.nodes and b in g.nodes:
            g.add_edge(a, b, relation)
        else:
            unresolved.append([link[0], link[1]])
    return sorted(concept_ids), unresolved


# --------------------------------------------------------------------------- #
# Build orchestration                                                          #
# --------------------------------------------------------------------------- #
def build():
    FILE_OWNER.clear(); PATH_TO_NODE.clear(); SYMBOL_TO_NODE.clear(); BARRELS.clear()
    g = Graph()
    build_screens(g)
    build_features(g)
    build_shared(g)
    build_docs(g)
    NODE_IDS.clear()
    NODE_IDS.update(g.nodes.keys())
    link_imports(g)
    link_by_name(g)
    link_docs(g)
    attach_tests(g)
    concepts, unresolved = apply_curated(g)
    g.index()

    GRAPH_DIR.mkdir(parents=True, exist_ok=True)
    NODES_JSON.write_text(json.dumps(g.nodes, indent=2, sort_keys=True) + "\n")
    edges_sorted = sorted(g.edges)
    EDGES_JSON.write_text(json.dumps(edges_sorted, indent=2) + "\n")

    rel_counts = {}
    for _, _, r in g.edges:
        rel_counts[r] = rel_counts.get(r, 0) + 1
    print(f"bolid-context: built {len(g.nodes)} nodes, {len(g.edges)} edges")
    print("  edges:", ", ".join(f"{k}={v}" for k, v in sorted(rel_counts.items())))
    print(f"  concepts: {len(concepts)}", end="")
    if unresolved:
        print(f"  | UNRESOLVED curated links: {unresolved}")
    else:
        print("  | curated links: all resolved")
    return g


# --------------------------------------------------------------------------- #
# Query side — the four tuning knobs                                           #
# --------------------------------------------------------------------------- #
KIND_WEIGHT = {                  # how strongly each relation conducts relevance
    "serves": 3.0,
    "documents": 2.6,
    "relates": 2.6,
    "named": 1.4,
    "imports": 1.1,
}
HUB_DEGREE = 14                  # nodes above this are not expanded through
RELEVANCE_FLOOR = 0.16           # drop anything below this score
GROUP_CAP = 7                    # max nodes shown per group

TYPE_GROUPS = {
    "screen": "screens",
    "feature": "features",
    "core": "obd-core",
    "store": "state/stores",
    "ui": "ui",
    "transport": "transport",
    "service": "services",
    "vehicle": "vehicles",
    "lib": "lib",
    "doc": "docs",
    "concept": "concepts",
}
GROUP_ORDER = ["concepts", "features", "screens", "obd-core", "state/stores",
               "transport", "services", "ui", "vehicles", "lib", "docs"]


def load_graph():
    if not NODES_JSON.is_file():
        sys.exit("graph not built — run: python3 graph.py build")
    g = Graph()
    g.nodes = json.loads(read_text(NODES_JSON))
    g.edges = json.loads(read_text(EDGES_JSON))
    g.index()
    return g


def node_terms(n, nid):
    terms = set(n.get("tokens", []))
    terms |= set(tokenize(nid.split(":", 1)[-1]))
    terms |= set(tokenize(n.get("summary", "")))
    return terms


def score(qtokens, n, nid):
    if not qtokens:
        return 0.0
    terms = node_terms(n, nid)
    hits = sum(1 for t in qtokens if t in terms)
    if hits == 0:
        return 0.0
    s = hits / len(qtokens)
    # a slug/id hit is worth more than a summary-only hit
    id_terms = set(tokenize(nid.split(":", 1)[-1]))
    if any(t in id_terms for t in qtokens):
        s += 0.35
    return s


def rank(g, term, limit=30):
    qt = tokenize(term)
    scored = [(score(qt, n, nid), nid) for nid, n in g.nodes.items()]
    scored = [x for x in scored if x[0] > 0]
    scored.sort(key=lambda x: (-x[0], x[1]))
    return scored[:limit]


def context_pack(g, term):
    qt = tokenize(term)
    seeds = rank(g, term, limit=8)
    if not seeds:
        return None, {}
    top = seeds[0][0] or 1.0
    best = {}
    heap = []
    for s, nid in seeds:
        rv = min(1.0, s / top)
        if rv >= best.get(nid, 0):
            best[nid] = rv
            heapq.heappush(heap, (-rv, nid))
    while heap:
        nrv, nid = heapq.heappop(heap)
        rv = -nrv
        if rv < best.get(nid, 0):
            continue
        if g.degree(nid) > HUB_DEGREE and rv < 0.95:
            continue                       # don't expand through hubs
        for other, relation in g.neighbors(nid):
            w = KIND_WEIGHT.get(relation, 1.0) / 3.0
            cand = rv * 0.6 * w
            if g.degree(other) > HUB_DEGREE:
                cand *= 0.5                 # down-weight hub targets
            if cand >= RELEVANCE_FLOOR and cand > best.get(other, 0):
                best[other] = cand
                heapq.heappush(heap, (-cand, other))
    return seeds, best


def cmd_context(g, term):
    seeds, best = context_pack(g, term)
    if not best:
        print(f"No matches for '{term}'. Try: python3 graph.py find {term}")
        return
    seed_ids = {nid for _, nid in seeds}
    groups = {}
    for nid, rv in best.items():
        grp = TYPE_GROUPS.get(g.nodes[nid]["type"], "other")
        groups.setdefault(grp, []).append((rv, nid))

    print(f"# context pack: '{term}'   ({len(best)} nodes)")
    print("# read only the files you need from the references below.\n")
    for grp in GROUP_ORDER + sorted(set(groups) - set(GROUP_ORDER)):
        if grp not in groups:
            continue
        rows = sorted(groups[grp], key=lambda x: (-x[0], x[1]))[:GROUP_CAP]
        print(f"## {grp}")
        for rv, nid in rows:
            n = g.nodes[nid]
            mark = "*" if nid in seed_ids else " "
            path = n.get("path") or "(curated)"
            line = f" {mark}[{rv:.2f}] {nid}  — {n.get('summary','')}"
            print(line)
            print(f"        {path}", end="")
            if n.get("tests"):
                print(f"   tests: {', '.join(n['tests'][:3])}", end="")
            print()
        print()


def cmd_find(g, term):
    rows = rank(g, term, limit=30)
    if not rows:
        print(f"No matches for '{term}'.")
        return
    print(f"# find: '{term}'  ({len(rows)} matches)")
    for s, nid in rows:
        n = g.nodes[nid]
        print(f" [{s:.2f}] {nid}  — {n.get('summary','')}")
        print(f"        {n.get('path') or '(curated)'}")


def cmd_neighbors(g, raw):
    nid = raw if raw in g.nodes else resolve_id(g, raw)
    if nid not in g.nodes:
        cands = [x for x in g.nodes if raw.lower() in x.lower()][:12]
        print(f"Unknown node '{raw}'." + (f" Did you mean: {', '.join(cands)}" if cands else ""))
        return
    n = g.nodes[nid]
    print(f"# {nid}  — {n.get('summary','')}")
    print(f"  path: {n.get('path') or '(curated)'}   degree: {g.degree(nid)}")
    if n.get("tests"):
        print(f"  tests: {', '.join(n['tests'])}")
    by_rel = {}
    for other, relation in g.neighbors(nid):
        by_rel.setdefault(relation, []).append(other)
    for relation in sorted(by_rel):
        print(f"\n  {relation}:")
        for other in sorted(set(by_rel[relation])):
            print(f"    {other}  — {clip(g.nodes[other].get('summary',''), 90)}")


def cmd_docs(g, term):
    seeds, best = context_pack(g, term)
    if not best:
        print(f"No doc matches for '{term}'.")
        return
    rows = [(rv, nid) for nid, rv in best.items()
            if g.nodes[nid]["type"] in ("doc", "concept")]
    rows.sort(key=lambda x: (-x[0], x[1]))
    print(f"# docs/concepts for '{term}'")
    for rv, nid in rows[:15]:
        n = g.nodes[nid]
        print(f" [{rv:.2f}] {nid}  — {n.get('summary','')}")
        print(f"        {n.get('path') or '(curated)'}")


def cmd_stats(g):
    by_type, by_rel = {}, {}
    for n in g.nodes.values():
        by_type[n["type"]] = by_type.get(n["type"], 0) + 1
    for _, _, r in g.edges:
        by_rel[r] = by_rel.get(r, 0) + 1
    print(f"# bolid-context graph stats")
    print(f"  nodes: {len(g.nodes)}   edges: {len(g.edges)}")
    print("  nodes by type:")
    for t, c in sorted(by_type.items(), key=lambda x: -x[1]):
        print(f"    {t:10s} {c}")
    print("  edges by relation:")
    for r, c in sorted(by_rel.items(), key=lambda x: -x[1]):
        print(f"    {r:10s} {c}")
    hubs = sorted(g.nodes, key=lambda nid: -g.degree(nid))[:8]
    print("  biggest hubs (not expanded through during traversal):")
    for nid in hubs:
        print(f"    deg {g.degree(nid):3d}  {nid}")


# --------------------------------------------------------------------------- #
# CLI                                                                          #
# --------------------------------------------------------------------------- #
def main(argv):
    if not argv:
        print(__doc__)
        return
    cmd, rest = argv[0], argv[1:]
    if cmd == "build":
        build()
        return
    g = load_graph()
    term = " ".join(rest).strip()
    if cmd == "context":
        cmd_context(g, term)
    elif cmd == "find":
        cmd_find(g, term)
    elif cmd == "neighbors":
        cmd_neighbors(g, term)
    elif cmd == "docs":
        cmd_docs(g, term)
    elif cmd == "stats":
        cmd_stats(g)
    else:
        print(f"unknown command: {cmd}")
        print(__doc__)


if __name__ == "__main__":
    main(sys.argv[1:])
