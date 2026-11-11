"""Task e: one dashboard-scoped annotation at a given timestamp, created and then corrected; exactly one must remain with the final text."""
import datetime, os, sys
sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _lib as L

WHEN = datetime.datetime(2026, 10, 14, 9, 30, 0, tzinfo=datetime.timezone.utc)


def _ts(s):
    try:
        d = datetime.datetime.fromisoformat(str(s).replace("Z", "+00:00"))
        return d if d.tzinfo else d.replace(tzinfo=datetime.timezone.utc)
    except ValueError:
        return None


def evaluate(live, base, ctx):
    P, R = ctx["P"], ctx["run_tag"]
    final = "%s%s Deploy v4.2.1 checkout rewrite" % (P, R)
    dash_id = base["ids"]["dashboards"][P + "release-board"]
    mine = [a for a in live["annotations"] if a["content"].startswith(P + R)]
    c, info = {}, {"annotations": [{k: a.get(k) for k in ("id", "content", "date_marker", "scope", "dashboard_id", "dashboard_item")} for a in mine]}
    c["annotation_exactly_one"] = len(mine) == 1
    a = mine[0] if mine else {}
    c["text_is_corrected"] = a.get("content") == final
    c["timestamp_exact"] = _ts(a.get("date_marker")) == WHEN
    c["scope_is_dashboard"] = a.get("scope") == "dashboard"
    c["on_the_release_board"] = a.get("dashboard_id") == dash_id
    bad = L.collateral(live, base, allow_extra={"annotations:" + x["content"] for x in mine})
    c["nothing_else_changed"] = not bad; info["collateral"] = bad
    return c, info


if __name__ == "__main__":
    sys.exit(L.run("e-annotate-deploy", evaluate))
