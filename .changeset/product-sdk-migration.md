---
"playground-cli": minor
---

Migrate the CLI runtime from `@polkadot-apps/*` packages to `@parity/product-sdk-*`, including terminal product-account signing for `playground.dot`. The QR-paired session signer routes transaction signing through `session.signPayload` (no `<Bytes>` envelope) so the chain accepts the produced signature, and arbitrary-byte signing through `session.signRaw` (envelope applied by mobile, correct for free-form data). Product-SDK packages use caret ranges so upstream patch and minor releases land automatically on a fresh `pnpm install`.
