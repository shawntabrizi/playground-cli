// Empty stub for `@polkadot-api/descriptors` referenced by `@parity/dotns-cli`.
//
// dotns-cli@0.5.6's published package.json declares
// `"@polkadot-api/descriptors": "file:.papi/descriptors"` — a workspace path
// that doesn't exist in the published tarball. npm tolerates the dangling
// `file:` reference and creates a broken symlink, but pnpm's strict resolver
// fails the install.
//
// The line is functionally vestigial: dotns-cli's `dist/cli.js` is fully
// bundled (Bun build with no externals) and inlines the descriptors at build
// time, so nothing imports this package at runtime. We point the override
// here so pnpm's resolver has *something* to satisfy the dependency. The
// stub exporting `{}` is correct: the bundled CLI will never reach for it.
//
// Remove once `@parity/dotns-cli` republishes without the broken
// `file:.papi/descriptors` line. Tracked upstream against paritytech/dotns-sdk.
export default {};
