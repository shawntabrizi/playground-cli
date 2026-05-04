---
"playground-cli": patch
---

Fix `dot init` failing on a clean macOS/Linux machine where `rustup` isn't yet installed. The rustup installer writes its binaries to `~/.cargo/bin` and adds that directory to PATH only via shell rc files, which doesn't reach the running `dot` process. The next two steps (`Rust nightly`, `rust-src`) then fail with `bash: rustup: command not found`. After installing rustup we now prepend `$CARGO_HOME/bin` (default `~/.cargo/bin`) to `process.env.PATH` so the rest of `dot init` can resolve `rustup` immediately.
