---
"playground-cli": minor
---

Sign transactions through the Polkadot app's native transaction builder (product-sdk 0.9, RFC-0020 `createTransaction`). The wallet now decodes and displays what it signs, and chain-declared signed extensions (`AsPgas`, `AuthorizeValueTransfer`, …) are forwarded to the wallet verbatim — eliminating the "PJS does not support this signed-extension" failures on username claim, deploy, and account mapping.

Existing logins keep working — no re-pair needed. Resource allowances (Bulletin, Statement Store, smart-contract gas) are re-requested once in a single phone dialog the next time they're needed (the allowance cache moved to the SDK's store).
