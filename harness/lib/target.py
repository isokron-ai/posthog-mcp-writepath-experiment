"""Which PostHog the harness talks to. There is NO default: every live script needs TARGET=cloud or TARGET=selfhosted
in the environment, so a run meant for the self-hosted instance can never fall back to PostHog Cloud by omission.

  TARGET=cloud        config.env as it is (PostHog Cloud US, the owner's test project).
  TARGET=selfhosted   config.env, then config.selfhosted.env on top. The overlay must itself define POSTHOG_HOST,
                      POSTHOG_PROJECT_ID, EXPECTED_ORG_ID and POSTHOG_KEY_FILE (none of them may be inherited from the
                      Cloud settings), the host must be loopback (127.0.0.1 / localhost / ::1), and the key file must not
                      be the Cloud key or anything under ~/.isokron.

Shell use (non-secret values only; the key is never read here):
  eval "$(python3 -I -B lib/target.py --shell)"      exports the resolved settings, or prints a refusal and exits non-zero
"""
import os, sys, urllib.parse

sys.dont_write_bytecode = True
ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
OVERLAYS = {"cloud": None, "selfhosted": "config.selfhosted.env"}
LOOPBACK = {"127.0.0.1", "localhost", "::1"}
CLOUD_KEY_FILE = "~/.isokron/posthog-audit-key"
MUST_OVERRIDE = ("POSTHOG_HOST", "POSTHOG_PROJECT_ID", "EXPECTED_ORG_ID", "POSTHOG_KEY_FILE")


def read_env(path):
    cfg = {}
    for line in open(path):
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            cfg[k.strip()] = v.strip()
    return cfg


def _real(p):
    return os.path.realpath(os.path.expanduser(p))


def check(cfg):
    """Refuse (SystemExit) unless cfg is consistent with its TARGET. Returns cfg."""
    t = cfg.get("TARGET")
    if t not in OVERLAYS:
        raise SystemExit("TARGET is %r: set TARGET=cloud or TARGET=selfhosted (there is no default)" % (t,))
    host = urllib.parse.urlsplit(cfg.get("POSTHOG_HOST", ""))
    kf = cfg.get("POSTHOG_KEY_FILE", "")
    if t == "selfhosted":
        if host.scheme not in ("http", "https") or host.hostname not in LOOPBACK:
            raise SystemExit("REFUSED: TARGET=selfhosted but POSTHOG_HOST is %r, not a loopback address (127.0.0.1, localhost, ::1)" % cfg.get("POSTHOG_HOST"))
        if not kf:
            raise SystemExit("REFUSED: TARGET=selfhosted but POSTHOG_KEY_FILE is empty")
        if _real(kf) == _real(CLOUD_KEY_FILE):
            raise SystemExit("REFUSED: TARGET=selfhosted but POSTHOG_KEY_FILE is the PostHog Cloud key (%s)" % CLOUD_KEY_FILE)
        if _real(kf).startswith(_real("~/.isokron") + os.sep):
            raise SystemExit("REFUSED: TARGET=selfhosted but POSTHOG_KEY_FILE lies under ~/.isokron (Cloud credentials live there)")
        if cfg.get("_OVERLAY_MISSING"):
            raise SystemExit("REFUSED: config.selfhosted.env does not define %s itself (they would be inherited from the Cloud config)" % cfg["_OVERLAY_MISSING"])
    else:
        if host.hostname in LOOPBACK:
            raise SystemExit("REFUSED: TARGET=cloud but POSTHOG_HOST is loopback (%s): use TARGET=selfhosted" % cfg.get("POSTHOG_HOST"))
    return cfg


def load(path=None, target=None, environ=None):
    """config.env (or `path`), the target overlay, then environment overrides of keys already defined; then check()."""
    environ = os.environ if environ is None else environ
    cfg = read_env(path or os.path.join(ROOT, "config.env"))
    t = target or environ.get("TARGET") or ""
    cfg["TARGET"] = t
    ov = OVERLAYS.get(t)
    if ov:
        o = read_env(os.path.join(ROOT, ov))
        missing = [k for k in MUST_OVERRIDE if not o.get(k)]
        if missing:
            cfg["_OVERLAY_MISSING"] = ", ".join(missing)
        cfg.update(o)
    for k in list(cfg):  # environment overrides (used by tests); checked like everything else
        if k not in ("TARGET", "_OVERLAY_MISSING") and environ.get(k):
            cfg[k] = environ[k]
    check(cfg)
    cfg.pop("_OVERLAY_MISSING", None)
    cfg.setdefault("CATALOG_DIR", "catalog")
    return cfg


def _sh_quote(v):
    return "'" + v.replace("'", "'\"'\"'") + "'"


if __name__ == "__main__":
    if sys.argv[1:] == ["--shell"]:
        try:
            c = load()
        except SystemExit as e:
            sys.stderr.write("%s\n" % e); print("false"); sys.exit(2)
        for k, v in sorted(c.items()):
            if not k.replace("_", "").isalnum() or k.startswith("_"):
                continue
            print("export %s=%s" % (k, _sh_quote(v)))
    elif sys.argv[1:] == ["--show"]:
        c = load()
        print("target=%s host=%s project=%s org=%s key_file=%s" % (c["TARGET"], c["POSTHOG_HOST"], c["POSTHOG_PROJECT_ID"], c["EXPECTED_ORG_ID"], c["POSTHOG_KEY_FILE"]))
    else:
        sys.exit("usage: lib/target.py --shell | --show")
