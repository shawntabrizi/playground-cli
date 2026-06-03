---
"playground-cli": minor
---

Sign transactions through the Polkadot app's native transaction builder (product-sdk 0.9 / host-papp 0.8). The wallet now decodes and displays what it signs, and chain-declared signed extensions (`AsPgas`, `AuthorizeValueTransfer`, …) work end-to-end — fixing "PJS does not support this signed-extension" failures on username claim, deploy, and account mapping.

**After updating, run `playground logout` and then `playground init` once**: the pairing protocol changed and older stored sessions can't be read. Resource allowances (Bulletin, Statement Store, smart-contract gas) are re-requested in a single phone dialog during init.
