# Security

This repository is an unsupported research experiment by [IsoKron](https://isokron.ai), based on the MCP server in
`PostHog/posthog` at commit `7b516983`. It is not an official PostHog release, it receives no security updates, and it is
not meant for production use.

**Do not run it with a key that can reach anything you care about.** If you run it at all, use a disposable test
project (for example the self-hosted instance in [`selfhost/`](selfhost/)) and a personal API key scoped to that project.

## Reporting

- **Vulnerabilities in PostHog's MCP server or PostHog itself** (anything that also exists upstream): report them to
  PostHog through its security policy (the `SECURITY.md` of the PostHog organization on GitHub), not here.
- **Problems specific to the experiment** (the commits in [CHANGES-EXPERIMENT.md](CHANGES-EXPERIMENT.md), the harness
  or the self-host setup): use this repository's private vulnerability reporting (Security tab), or open an issue if the
  problem is not sensitive.

Reports are read, but no response time or fix is promised.
