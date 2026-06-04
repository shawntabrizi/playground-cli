---
"playground-cli": patch
---

Fix runaway memory growth in lingering `playground init` processes. The 4 GB memory watchdog now runs for every command by default (previously only `deploy`, `mod`, and `contract`), so a process whose event loop gets starved by a leaked subscription is killed with an actionable message instead of growing to tens of GB and freezing the machine. Also plugs the session-probe adapter leak in `playground init`: the login adapter's WebSocket is now released on the already-logged-in path, on probe failure, and after the QR login completes.
