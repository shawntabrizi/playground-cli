#!/usr/bin/env node

// MUST be the first import — sets env vars that gate bulletin-deploy's
// Sentry + memory-report paths before their modules evaluate. See
// `src/bootstrap.ts` for the rationale.
import "./bootstrap.js";
import { Command } from "commander";
import pkg from "../package.json" with { type: "json" };
import { initCommand } from "./commands/init/index.js";
import { modCommand } from "./commands/mod/index.js";
import { buildCommand } from "./commands/build.js";
import { deployCommand } from "./commands/deploy/index.js";
import { logoutCommand } from "./commands/logout/index.js";
import { updateCommand } from "./commands/update.js";
import { installSignalHandlers, onProcessShutdown } from "./utils/process-guard.js";
import { clearWindowTitle } from "./utils/ui/theme/window-title.js";

// ── Bun compiled-binary stdin workaround ─────────────────────────────────────
// When `dot` is shipped via `bun build --compile`, Ink's internal
// `stdin.addListener('readable', …)` does NOT receive events until something
// else has already touched `process.stdin.on('readable', …)` first. Symptom:
// every useInput-driven TUI locks up — no arrow keys, no Enter, no Ctrl+C.
//
// Attaching a no-op `readable` listener here warms the stream up so Ink's
// own listener fires normally. Harmless under `bun run` and Node.
// Remove once Bun's compiled-binary TTY stdin behaves like Node's out of the
// box.
if (process.stdin.isTTY) {
    process.stdin.on("readable", () => {});
    // Don't let the listener itself hold the event loop open on exit.
    process.stdin.unref();
}

// Install SIGINT/SIGTERM/SIGHUP + unhandledRejection handlers so a force-quit
// or a stray async error can't turn `dot` into a zombie that grows memory
// indefinitely.
installSignalHandlers();

// Hand the terminal tab title back to the shell on exit. The shell usually
// repaints its own title immediately, but being explicit avoids leaving
// "dot deploy · my-app.dot · ✓" stuck on a long-lived tab.
onProcessShutdown(clearWindowTitle);

const program = new Command()
    .name("dot")
    .description("CLI for Polkadot Playground")
    .version(pkg.version);

program.addCommand(initCommand);
program.addCommand(modCommand);
program.addCommand(buildCommand);
program.addCommand(deployCommand);
program.addCommand(logoutCommand);
program.addCommand(updateCommand);

program.parseAsync().then(() => process.exit(0));
