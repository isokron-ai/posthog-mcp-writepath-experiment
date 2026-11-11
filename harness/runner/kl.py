#!/usr/bin/env python3
"""Record benchmark evidence on the kronicle-lite chain (same calls as the Grafana harness's runner/kl.py).

  kl.py blob FILE [--media-type T]                      -> prints the blob ref JSON
  kl.py freeze --manifest FILE --planned-runs N         -> harness_frozen event (fingerprint = sha256 of the manifest)
  kl.py run --run-id ID --status S --result FILE [--evidence-file F ...] [--interrupted WHY]
  kl.py events                                          -> seq, kind, event_key, event_id

The chain lives in <root>/.kl (ignored by git). Chain run numbers are 1..N with no gaps in the order runs were recorded
(failed and repeated attempts included); the plan's own run_seq is kept inside each record. Anchoring (checkpoint --push)
and RFC 3161 stamping are done by bench/freeze.py, not here; this file never reads the anchor key.

A named series (bench/freeze.py --series NAME, bench/run-bench.sh --series NAME) keeps its own record apart from the
2026-11-10 two-build series, which stays as it is: PA_KL_AUDIT_ID (its own kronicle-lite audit, so event keys never collide),
PA_KL_STATE (its own state directory instead of .kl-state/) and PA_KL_EVIDENCE (its own chain-runs directory instead of
evidence/chain-runs/). Unset, everything is exactly as before."""
import argparse, hashlib, json, os, subprocess, sys

ROOT = os.environ.get('PA_ROOT') or os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
AUDIT_ID = os.environ.get('PA_KL_AUDIT_ID') or 'posthog-mcp-bench'
STATE = os.environ.get('PA_KL_STATE') or os.path.join(ROOT, '.kl-state')
EVIDENCE = os.environ.get('PA_KL_EVIDENCE') or os.path.join(ROOT, 'evidence', 'chain-runs')
KL = os.environ.get('PA_KL') or os.path.join(ROOT, 'runner', 'node_modules', '.bin', 'kronicle-lite')
ENV = {**os.environ, 'KRONICLE_LITE_DATA_DIR': os.path.join(ROOT, '.kl')}
ENV.pop('KRONICLE_ANCHOR_KEY', None)


def kl(*args, stdin=None):
    p = subprocess.run([KL, *args], input=stdin, capture_output=True, text=True, env=ENV)
    if p.returncode != 0:
        sys.exit(f'kronicle-lite {args[0]} {args[1] if len(args) > 1 else ""} failed ({p.returncode}): {p.stderr.strip() or p.stdout.strip()}')
    return p.stdout


def blob(path, media_type=None):
    args = ['audit', 'put-blob', path]
    if media_type:
        args += ['--media-type', media_type]
    return json.loads(kl(*args).strip().splitlines()[-1])


def record(events):
    lines = '\n'.join(json.dumps(e, sort_keys=True) for e in events) + '\n'
    out = json.loads(kl('audit', 'record', '--audit-id', AUDIT_ID, '--in', '-', '--json', stdin=lines))
    return out['recorded']


def load(name, default=None):
    p = os.path.join(STATE, name)
    return json.load(open(p)) if os.path.exists(p) else default


def save(name, obj):
    os.makedirs(STATE, exist_ok=True)
    with open(os.path.join(STATE, name), 'w') as fh:
        json.dump(obj, fh, indent=2, sort_keys=True); fh.write('\n')


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest='cmd', required=True)
    b = sub.add_parser('blob'); b.add_argument('file'); b.add_argument('--media-type')
    f = sub.add_parser('freeze'); f.add_argument('--manifest', required=True); f.add_argument('--planned-runs', type=int, required=True); f.add_argument('--nonce', default=''); f.add_argument('--event-key', default='freeze'); f.add_argument('--title', default='PostHog MCP before/after benchmark harness')
    r = sub.add_parser('run')
    r.add_argument('--run-id', required=True); r.add_argument('--status', required=True); r.add_argument('--result', required=True)
    r.add_argument('--evidence-file', action='append', default=[]); r.add_argument('--interrupted')
    sub.add_parser('events')
    a = ap.parse_args()

    if a.cmd == 'blob':
        print(json.dumps(blob(a.file, a.media_type)))
    elif a.cmd == 'events':
        sys.stdout.write(kl('audit', 'query', '--audit-id', AUDIT_ID))
    elif a.cmd == 'freeze':
        if load('freeze.json'):
            sys.exit('already frozen: %s/freeze.json exists' % os.path.relpath(STATE, ROOT))
        fp = hashlib.sha256(open(a.manifest, 'rb').read()).hexdigest()
        ref = blob(a.manifest, 'application/json')
        rec = record([{'kind': 'harness_frozen', 'event_key': a.event_key, 'payload': {
            'harness_id': AUDIT_ID, 'fingerprint': fp, 'manifest': ref, 'planned_runs': a.planned_runs,
            'title': a.title}}])
        save('freeze.json', {'audit_id': AUDIT_ID, 'fingerprint': fp, 'planned_runs': a.planned_runs, 'event_id': rec[0]['event_id'], 'nonce': a.nonce})
        print(json.dumps({'fingerprint': fp, 'event_id': rec[0]['event_id']}))
    elif a.cmd == 'run':
        st = load('freeze.json')
        if not st:
            sys.exit('not frozen yet: %s/freeze.json is missing' % os.path.relpath(STATE, ROOT))
        idx = load('runs.json', {})
        seq = len(idx) + 1
        caps = [{'path': os.path.relpath(p, ROOT), **blob(p, 'application/x-ndjson' if p.endswith('.jsonl') else 'application/json')} for p in a.evidence_file]
        res = json.load(open(a.result))
        wrapper = {'run_id': a.run_id, 'run_seq': seq, 'nonce': st.get('nonce', ''), 'result': res, 'captures': caps}
        wdir = EVIDENCE; os.makedirs(wdir, exist_ok=True)
        wpath = os.path.join(wdir, f'run-{seq:03d}.evidence.json')
        if os.path.exists(wpath):
            sys.exit(f'{wpath} exists: evidence files are never overwritten')
        with open(wpath, 'w') as fh:
            json.dump(wrapper, fh, indent=2, sort_keys=True); fh.write('\n')
        ref = blob(wpath, 'application/json')
        payload = {'run_id': a.run_id, 'run_seq': seq, 'fingerprint': st['fingerprint'], 'status': a.status,
                   'result': ref, 'capture': 'interrupted' if a.interrupted else 'complete'}
        if st.get('nonce'):
            payload['nonce'] = st['nonce']
        if a.interrupted:
            payload['interruption'] = a.interrupted[:200]
        rec = record([{'kind': 'run_completed', 'event_key': f'run-{seq:03d}', 'payload': payload}])
        idx[str(seq)] = {'run_id': a.run_id, 'event_id': rec[0]['event_id'], 'evidence': os.path.relpath(wpath, ROOT)}
        save('runs.json', idx)
        print(f"recorded chain run {seq} ({a.run_id}) event {rec[0]['event_id']}")


if __name__ == '__main__':
    main()
