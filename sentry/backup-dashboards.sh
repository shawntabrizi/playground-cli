#!/usr/bin/env bash
set -euo pipefail

TOKEN=$(security find-generic-password -s sentry-api-token -w)
BASE="https://de.sentry.io/api/0/organizations/paritytech"

mkdir -p sentry/dashboards

for id in 2143100; do
    curl -sf \
        -H "Authorization: Bearer ${TOKEN}" \
        "${BASE}/dashboards/${id}/" \
        | python3 -m json.tool > "sentry/dashboards/${id}.json"
done
