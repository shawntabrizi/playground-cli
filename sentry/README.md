# Sentry Dashboards

Dashboard JSON backups live in `sentry/dashboards/`.

Run `./sentry/backup-dashboards.sh` before editing dashboards through the Sentry API. A dashboard
`PUT` replaces the full widget list, so the checked-in JSON is the source of truth for future
modifications.

Current dashboards:

- `2143100` — Playground CLI Health
