"""Task d: count the fixture flags (more than one page of them) and name the disabled ones. Ground truth is read live from the API."""
import os, re, sys
sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _lib as L


def evaluate(live, base, ctx):
    pre = ctx["P"] + "flag-"
    flags = [f for f in live["flags"] if f["key"].startswith(pre)]
    truth_count = len(flags); truth_disabled = sorted(f["key"] for f in flags if not f.get("active"))
    lines = L.answer_lines(ctx["answer"])
    c, info = {}, {"truth_count": truth_count, "truth_disabled": truth_disabled}
    cl = [l for l in lines if re.match(r"^FLAG_COUNT\s*:", l)]
    dl = [l for l in lines if re.match(r"^DISABLED\s*:", l)]
    c["count_line_present_once"] = len(cl) == 1
    m = re.match(r"^FLAG_COUNT\s*:\s*(\d+)\s*$", cl[0]) if cl else None
    info["reported_count"] = int(m.group(1)) if m else None
    c["count_matches_api"] = bool(m) and int(m.group(1)) == truth_count
    c["disabled_line_present_once"] = len(dl) == 1
    rep = [x.strip() for x in dl[0].split(":", 1)[1].split(",") if x.strip()] if dl else []
    info["reported_disabled"] = rep
    c["disabled_set_matches_api"] = bool(dl) and sorted(rep) == truth_disabled
    c["disabled_sorted_ascending"] = bool(dl) and rep == sorted(rep)
    bad = L.collateral(live, base)
    c["nothing_changed"] = not bad; info["collateral"] = bad
    return c, info


if __name__ == "__main__":
    sys.exit(L.run("d-flag-inventory", evaluate))
