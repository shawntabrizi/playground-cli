---
"playground-cli": minor
---

`dot decentralize` is now interactive when invoked with no `--site` flag.
Running `dot decentralize` on its own opens a TUI that walks through a
short flow — a yellow "about this command" callout explaining that the
command mirrors a live static site (https URL) and republishes it as a
.dot site, then prompts for the site URL, a signer (dev / your phone),
and a `.dot` name. Domain availability is checked inline against the
chain (same path as `dot deploy`); leaving the name blank auto-generates
a free hostname-derived label as before. The pipeline then runs the same
mirror + Bulletin upload + DotNS register the headless path uses, and
prints a final summary card with the live URL, IPFS CID, and gateway.

`dot decentralize --site=…` (with or without `--dot` / `--suri`) keeps
the existing headless contract — the demo service that passes
`--suri=//Bob` is unchanged.
