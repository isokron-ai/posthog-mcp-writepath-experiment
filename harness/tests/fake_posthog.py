"""In-memory stand-in for the PostHog REST endpoints the harness uses (tests only; injected as PostHog(transport=...)).
Mimics: list with search/limit/offset and `next` links, soft delete through PATCH {deleted: true}, DELETE -> 405 (surveys:
DELETE removes the survey, as PostHog's does), insight<->dashboard tiles, and server-generated bookkeeping inside flag filters
and survey questions (ids)."""
import copy, itertools, urllib.parse


class Fake:
    KINDS = {"insights": "name", "dashboards": "name", "feature_flags": "key", "annotations": "content", "surveys": "name"}

    def __init__(self, project_id="1", org="org-test", page_cap=100):
        self.pid, self.org, self.cap = str(project_id), org, page_cap
        self.db = {k: [] for k in self.KINDS}; self.ids = itertools.count(1000); self.calls = []

    def __call__(self, method, path, body=None):
        self.calls.append((method, path))
        u = urllib.parse.urlsplit(path); q = dict(urllib.parse.parse_qsl(u.query))
        parts = [p for p in u.path.split("/") if p]  # api projects <id> [kind] [id]
        assert parts[:3] == ["api", "projects", self.pid], path
        if len(parts) == 3:
            return 200, {"id": int(self.pid), "organization": self.org, "name": "Fake project", "api_token": "phc_FAKEFAKEFAKEFAKE"}
        kind = parts[3]; rows = self.db[kind]; field = self.KINDS[kind]
        if len(parts) == 4 and method == "GET":
            sel = [r for r in rows if not r.get("deleted")]
            if q.get("search"):
                sel = [r for r in sel if q["search"].lower() in str(r.get(field) or "").lower()]
            sel = sorted(sel, key=lambda r: -r["id"])
            lim = min(int(q.get("limit", self.cap)), self.cap); off = int(q.get("offset", 0))
            nxt = None
            if off + lim < len(sel):
                q2 = dict(q, limit=lim, offset=off + lim)
                nxt = "https://fake.invalid%s?%s" % (u.path, urllib.parse.urlencode(q2))
            return 200, {"count": len(sel), "next": nxt, "results": [self._out(kind, r) for r in sel[off:off + lim]]}
        if len(parts) == 4 and method == "POST":
            r = copy.deepcopy(body); r["id"] = next(self.ids); r.setdefault("deleted", False)
            if kind == "feature_flags":
                if any(x["key"] == r["key"] and not x["deleted"] for x in rows):
                    return 400, {"detail": "There is already a feature flag with this key."}
                self._flag_ids(r)
            if kind == "surveys":
                r.pop("deleted", None); r.setdefault("archived", False); self._question_ids(r)
            if kind == "insights":
                r["short_id"] = "S%07d" % r["id"]; r["_dash"] = list(r.pop("dashboards", []) or []); r.setdefault("tags", []); r.setdefault("favorited", False)
            rows.append(r); return 201, self._out(kind, r)
        rid = int(parts[4]); r = next((x for x in rows if x["id"] == rid), None)
        if r is None:
            return 404, {"detail": "Not found."}
        if method == "GET":
            return 200, self._out(kind, r, detail=True)
        if method == "PATCH":
            b = copy.deepcopy(body)
            if kind == "feature_flags" and "filters" in b and "early_exit" in (r.get("filters") or {}) and "early_exit" not in (b["filters"] or {}):
                b["filters"]["early_exit"] = r["filters"]["early_exit"]  # as observed on PostHog: a stored early_exit survives a filters PATCH that omits it
            if kind == "insights" and "dashboards" in b:
                r["_dash"] = list(b.pop("dashboards") or [])
            r.update(b)
            if kind == "feature_flags" and "filters" in b:
                self._flag_ids(r)
            if kind == "surveys" and "questions" in b:
                self._question_ids(r)
            return 200, self._out(kind, r)
        if method == "DELETE" and kind == "surveys":
            rows.remove(r); return 204, None
        if method == "DELETE":
            return 405, {"detail": "Hard delete of this model is not allowed. Use a patch API call to set \"deleted\" to true"}
        return 405, None

    def _flag_ids(self, r):
        for g in (r.get("filters") or {}).get("groups") or []:
            g.setdefault("sort_key", "sk-%d" % next(self.ids))

    def _question_ids(self, r):
        for q in r.get("questions") or []:
            q.setdefault("id", "q-%d" % next(self.ids))

    def _out(self, kind, r, detail=False):
        o = {k: copy.deepcopy(v) for k, v in r.items() if not k.startswith("_")}
        if kind == "insights":
            o["dashboard_tiles"] = [{"id": 5000 + d, "dashboard_id": d} for d in r.get("_dash", [])
                                    if any(x["id"] == d and not x.get("deleted") for x in self.db["dashboards"])]
        if kind == "dashboards" and detail:
            o["tiles"] = [{"id": 7000 + i["id"], "insight": self._out("insights", i), "text": None}
                          for i in self.db["insights"] if r["id"] in i.get("_dash", []) and not i.get("deleted")]
        return o
