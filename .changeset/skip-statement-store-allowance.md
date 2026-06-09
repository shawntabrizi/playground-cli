---
"playground-cli": patch
---

`playground init` no longer requests a Statement Store allowance. The CLI never
consumes the resulting slot key (all phone interactions ride the SSO channel keyed
on the QR-login secret, and storage uploads use the Bulletin slot key), but
requesting it was the one grant that needs the phone to seat a slot in the
scarce on-chain Statement Store ring. Users whose ring was full hit
`denied: Statement Store` and saw account setup fail over a grant nothing
consumes. Account setup now requests only the Bulletin and smart-contract gas
allowances it actually needs.
