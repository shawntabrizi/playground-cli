---
"playground-cli": patch
---

The memory-watchdog abort message now reliably reaches stderr when the output is redirected to a file. Previously, on a SIGKILL-on-memory-cap path, the `✖ Memory use exceeded …` message could be lost from a redirected stderr buffer because `process.stderr.write()` queues through the writable-stream layer. The watchdog now uses `fs.writeSync(2, …)`, a blocking syscall that completes before the kill, so users diagnosing memory issues see the full abort context.
