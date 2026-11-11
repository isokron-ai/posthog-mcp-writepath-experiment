"""One-runner lock: a directory created with mkdir (atomic). A second session that tries to run is refused.
The lock is never broken automatically; a stale one (dead pid) is reported and must be removed by hand."""
import json, os, sys, time
ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
LOCK = os.path.join(ROOT, ".lock", "runner")


def _alive(pid):
    try:
        os.kill(pid, 0); return True
    except ProcessLookupError:
        return False
    except PermissionError:
        return True


def acquire(what, lock_dir=LOCK):
    os.makedirs(os.path.dirname(lock_dir), exist_ok=True)
    try:
        os.mkdir(lock_dir)
    except FileExistsError:
        try:
            info = json.load(open(os.path.join(lock_dir, "owner.json")))
        except (OSError, ValueError):
            info = {}
        state = "still running" if info.get("pid") and _alive(int(info["pid"])) else "NOT running (stale lock: check the last run, then remove %s by hand)" % lock_dir
        raise SystemExit("REFUSED: another runner holds the lock (%s, pid %s, started %s; that process is %s)" % (
            info.get("what", "?"), info.get("pid", "?"), info.get("started", "?"), state))
    with open(os.path.join(lock_dir, "owner.json"), "w") as f:
        json.dump({"pid": os.getpid(), "what": what, "started": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}, f)
    return lock_dir


def release(lock_dir=LOCK):
    try:
        os.remove(os.path.join(lock_dir, "owner.json"))
    except OSError:
        pass
    try:
        os.rmdir(lock_dir)
    except OSError:
        pass
