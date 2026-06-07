---
"playground-cli": minor
---

Upgrade the mobile pairing stack to host-papp 0.8.6 (via @parity/product-sdk-terminal 0.3.2). QR pairing now requires Polkadot mobile app build 1231 or newer: the handshake success message carries `rootEntropySource` (RFC-0007), which older builds do not send, so pairing against a phone on build 1230 or older fails at the QR step. Existing paired sessions are not migrated. Run `playground logout` and then `playground init` to pair again after upgrading.
