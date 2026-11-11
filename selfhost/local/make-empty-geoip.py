"""Write share/GeoLite2-City.mmdb as a valid but EMPTY MaxMind DB (every lookup: not found), plus share/GeoLite2-City.json.
  python3 -I -B local/make-empty-geoip.py
Why: the hobby installer downloads the GeoLite2 City database from PostHog's CDN (mmdbcdn.posthog.net). This instance
makes no call to PostHog-operated hosts, and the feature-flags service refuses to start without a database file. Geo
enrichment of events plays no part in the benchmark (it captures no events), so an empty database is enough.
Format: MaxMind DB 2.0 (https://maxmind.github.io/MaxMind-DB/): one search-tree node whose two records both equal
node_count (= "no data"), the 16-byte data-section separator, an empty data section, then the metadata."""
import json, os, struct, time

def ctrl(t, size):
    assert size < 29
    return bytes([(t << 5) | size]) if t <= 7 else bytes([size, t - 7])

def s(x):
    b = x.encode(); return ctrl(2, len(b)) + b

def u16(v):
    b = v.to_bytes(2, "big").lstrip(b"\0"); return ctrl(5, len(b)) + b

def u32(v):
    b = v.to_bytes(4, "big").lstrip(b"\0"); return ctrl(6, len(b)) + b

def u64(v):
    b = v.to_bytes(8, "big").lstrip(b"\0"); return ctrl(9, len(b)) + b

def m(pairs):
    out = ctrl(7, len(pairs))
    for k, v in pairs: out += s(k) + v
    return out

def arr(items):
    return ctrl(11, len(items)) + b"".join(items)

node_count, record_size = 1, 24
tree = (node_count).to_bytes(3, "big") * 2            # left and right record of node 0: both "no data"
meta = m([("binary_format_major_version", u16(2)), ("binary_format_minor_version", u16(0)), ("build_epoch", u64(int(time.time()))),
          ("database_type", s("GeoLite2-City")), ("description", m([("en", s("Empty placeholder"))])),
          ("ip_version", u16(6)), ("languages", arr([s("en")])), ("node_count", u32(node_count)), ("record_size", u16(record_size))])
db = tree + b"\0" * 16 + b"\xab\xcd\xefMaxMind.com" + meta
here = os.path.dirname(os.path.abspath(__file__)); share = os.path.join(os.path.dirname(here), "share")
os.makedirs(share, exist_ok=True)
open(os.path.join(share, "GeoLite2-City.mmdb"), "wb").write(db)
json.dump({"date": time.strftime("%Y-%m-%d"), "note": "empty placeholder written by local/make-empty-geoip.py"}, open(os.path.join(share, "GeoLite2-City.json"), "w"))
os.chmod(os.path.join(share, "GeoLite2-City.mmdb"), 0o644)
print("wrote share/GeoLite2-City.mmdb (%d bytes, empty)" % len(db))
