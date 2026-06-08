---
"playground-cli": patch
---

Validate DotNS domain names against the canonical on-chain rules (length 3-63, lowercase only, no leading/trailing dash, digit suffix of exactly 0 or 2, no dash before the digit suffix), correct the Proof-of-Personhood tier classification (names with a 9+ character base are open to everyone), and replace the misleading "set up automatically" message with truthful guidance about personhood requirements. Also upgrade bulletin-deploy to 0.9.0.
