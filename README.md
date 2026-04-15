# playground-cli

CLI tooling for Polkadot Playground. Installed as the `dot` command.

## Quick Start

```bash
curl -fsSL https://raw.githubusercontent.com/paritytech/playground-cli/main/install.sh | bash
```

To install a specific version:

```bash
curl -fsSL https://raw.githubusercontent.com/paritytech/playground-cli/main/install.sh | VERSION=v0.2.0 bash
```

## Contributing

### Setup

```bash
pnpm install
pnpm build
```

### Local Install

Compile and install the `dot` binary to `~/.polkadot/bin/`:

```bash
pnpm cli:install
```

### Testing a Branch Build

Every PR automatically publishes a dev release tagged with the branch name. Others can try it with:

```bash
curl -fsSL https://raw.githubusercontent.com/paritytech/playground-cli/main/install.sh | VERSION=dev/my-branch bash
```

### Releasing

Releases are triggered by [changesets](https://github.com/changesets/changesets). To cut a release:

1. Create a changeset: `pnpm changeset`
2. Commit the generated `.changeset/*.md` file with your PR
3. On merge to `main`, CI consumes the changeset, bumps the version, compiles binaries, and creates a GitHub release

### Formatting

Uses [Biome](https://biomejs.dev/). Checked in CI on every PR.

```bash
pnpm format        # fix
pnpm format:check  # check only
```
