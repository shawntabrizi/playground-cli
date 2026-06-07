---
"playground-cli": patch
---

Fix `playground init` losing the resource-allowance approval after a fresh QR pairing. The CLI fired the allowance request the instant pairing completed, but the phone is still showing its (non-cancellable) "Connecting device" modal at that point, so the approval dialog was obscured and then dismissed when the pairing modal closed — leaving the CLI stuck on "approve on your phone". The CLI now waits a short grace period after a fresh pairing before sending the request, so it lands once the phone has dismissed its modal. Re-runs with an existing session are unaffected.
