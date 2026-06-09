---
"playground-cli": patch
---

`playground mod`: when an app's published source repository is no longer publicly available (the publisher made it private, deleted, or renamed it), show a friendly "Source unavailable" notice instead of a raw GitHub 404. In the interactive picker the notice appears at the bottom and the picker stays open so you can choose another app; the direct `playground mod <domain>` path shows the same notice in place of the red "setup failed" error.
