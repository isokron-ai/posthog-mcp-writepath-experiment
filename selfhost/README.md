# Self-hosted PostHog for the benchmark

The PostHog instance every published measurement ran against: PostHog's open-source hobby deployment at commit
`7b516983` (the same commit as the MCP server), adapted to run on loopback only. Using a self-hosted open-source
instance keeps the benchmark under PostHog's MIT licence rather than its Cloud terms of service, which restrict
benchmarking PostHog Cloud. Results from this instance are not a measurement of PostHog Cloud.

PostHog's guide for the hobby deployment asks for about 4 vCPU, 16 GB of RAM and 30 GB of disk. The measured instance
ran under Docker Desktop with 14 GB of memory on an Apple-silicon Mac (arm64 images; `IMAGES.lock` lists their digests).

## Files

| File | What it is |
| --- | --- |
| `docker-compose.localhost.yml` | The only changes to PostHog's hobby compose files, each with its reason (comments in the file): loopback-only proxy on `127.0.0.1:8010`, no outbound network for the stack, other host ports removed, every image pinned by digest, telemetry and crash reports off, the HogQL `system.*` tables linked to the stack's own Postgres, the CDP `plugins` service left out |
| `IMAGES.lock` | Every image: the reference used, the resolved repository digest and the source revision |
| `phs` | `docker compose` with a fixed project name, `.secrets/instance.env` and both compose files |
| `setup.sh` | Fetches PostHog's hobby files at the pin, puts them in place as PostHog's `bin/deploy-hobby` does, writes an empty GeoLite2 database and a fresh `.secrets/instance.env`. Starts nothing |
| `compose/` | The three small scripts PostHog's `bin/deploy-hobby` writes at this commit |
| `local/make-empty-geoip.py` | A valid but empty GeoLite2 City database, so nothing is downloaded from PostHog's CDN |
| `local/create-account.py` | One-time setup through the instance's own signup API on loopback: a placeholder user on a reserved `.test` domain, an organization, a project and a project-scoped personal API key with the scopes of PostHog's "MCP Server" key preset (`local/mcp-server-preset-scopes.json`). Secrets go to `.secrets/` (mode 600) and are never printed |
| `local/clickhouse-no-crash-reports.xml` | Turns ClickHouse crash reports off |

`docker-compose.localhost.yml`, `IMAGES.lock`, `phs` and `local/clickhouse-no-crash-reports.xml` are byte-identical to
the files hashed into the measured series' manifest (`selfhost_files`). `setup.sh` and this README were written for
publication and reproduce the measured instance's layout (PostHog's files at the pin, empty `docker/postgres-init-scripts`
and `products` folders, an empty GeoLite2 database); the `docker-compose.yml` and `docker-compose.base.yml` it puts in
place are byte-identical to the measured instance's (checked against the manifest). The measured instance's `.secrets/instance.env` holds its secrets
and is not published; `setup.sh` generates a new one with the variables PostHog's installer writes, which has not been
checked against that file.

## Steps

```sh
./setup.sh                                  # fetch PostHog's files at the pin; write .secrets/instance.env
./phs pull                                  # the pinned images (several GB)
./phs up -d --no-build
./phs ps                                    # wait until web is healthy: curl -s http://127.0.0.1:8010/_health
python3 -I -B local/create-account.py       # prints organization_id and project_id; writes .secrets/api-key
```

Then fill `POSTHOG_PROJECT_ID` and `EXPECTED_ORG_ID` in `../harness/config.selfhosted.env` and continue with
[`../harness/README.md`](../harness/README.md). `./phs stop` stops the stack. Never run `./phs down -v`: it deletes the
instance's data volumes.

The instance's HTTP API and UI are on `http://127.0.0.1:8010` only. Its containers have no route out (an `internal`
Docker network); only the proxy is also on a normal network, because Docker can publish ports only from one.
