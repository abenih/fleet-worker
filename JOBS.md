# Fleet CI worker

This repo doubles as a batch worker: GitHub Actions runs the fleet's own
build / test / probe scripts on demand. Jobs are dispatched **by name only** —
the workflow takes a fixed choice of job names, never free-form input.

## Adding a job

1. Add a script at `jobs/<name>.sh`.
2. Add `<name>` to the `job` choice options in
   `.github/workflows/fleet-job.yml`.
3. Commit and push, then dispatch:
   `gh workflow run fleet-job.yml --repo abenih/fleet-worker -f job=<name>`

## Jobs

- `probe` — prints runner specs, egress identity (via Cloudflare trace), and
  HTTP status checks against the demo hosts the fleet's captures talk to.

## Standing rule

Jobs stay our own build/test/probe scripts, at moderate volume. Nothing here
runs third-party code or hammers external services; probes are status-only.
- `gb-recon` — bounded reachability probe (Golden Boot capture, 2026-11-10):
  loads two 1win penalty-title play pages logged-out in headless Chrome,
  clicks only the demo gate control, uploads frames/net/screenshots as a
  run artifact. Run 42740697657: gate inert from the runner's US egress too.
