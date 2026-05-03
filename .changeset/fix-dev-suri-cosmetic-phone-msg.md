---
"playground-cli": patch
---

Fixed misleading "📱 Approve on your phone" log line during `dot deploy --signer dev --suri X --playground`. The session-key funding step now signs directly with the dev keypair instead of wrapping it in the phone-mode signing-event proxy. Phone-session deploys are unchanged.
