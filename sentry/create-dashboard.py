#!/usr/bin/env python3
"""
Create a new Sentry dashboard from a payload file.

Usage: ./sentry/create-dashboard.py <payload.json>

The payload must NOT include a "projects" field — see spec §15f for the 403 footgun.
Prints the new dashboard ID on success.
"""

import json
import subprocess
import sys
import urllib.error
import urllib.request


def main() -> int:
    if len(sys.argv) != 2:
        print(__doc__, file=sys.stderr)
        return 2

    token = subprocess.check_output(
        ["security", "find-generic-password", "-s", "sentry-api-token", "-w"]
    ).decode().strip()

    with open(sys.argv[1]) as f:
        payload = json.load(f)

    if "projects" in payload:
        print("✖ remove 'projects' from payload — POST 403s with project ACL", file=sys.stderr)
        return 1

    body = json.dumps(payload).encode()
    req = urllib.request.Request(
        "https://de.sentry.io/api/0/organizations/paritytech/dashboards/",
        data=body, method="POST",
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req) as resp:
            data = json.load(resp)
            print(f"✔ created dashboard id={data['id']} title={data['title']!r}")
            return 0
    except urllib.error.HTTPError as e:
        print(f"✖ {e.code}: {e.read().decode()}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
