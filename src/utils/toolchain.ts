import { exec } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { arch, homedir, platform } from "node:os";
import { runShell as runPiped } from "./process.js";

/** Async exec — resolves with stdout, rejects on non-zero exit. */
function run(cmd: string, opts?: { shell?: string }): Promise<string> {
    return new Promise((resolve, reject) => {
        exec(cmd, { shell: opts?.shell ?? "bash" }, (err, stdout) => {
            if (err) reject(err);
            else resolve(stdout);
        });
    });
}

export async function commandExists(cmd: string): Promise<boolean> {
    if (!/^[a-zA-Z0-9_-]+$/.test(cmd)) {
        throw new Error(`Invalid command name: ${cmd}`);
    }
    try {
        await run(`command -v ${cmd}`);
        return true;
    } catch {
        return false;
    }
}

async function hasRustNightly(): Promise<boolean> {
    try {
        const out = await run("rustup toolchain list");
        return out.includes("nightly");
    } catch {
        return false;
    }
}

async function hasRustSrc(): Promise<boolean> {
    try {
        const out = await run("rustup component list --toolchain nightly");
        return out.includes("rust-src (installed)");
    } catch {
        return false;
    }
}

async function hasCdm(): Promise<boolean> {
    return (await commandExists("cdm")) && (await commandExists("cargo-pvm-contract"));
}

async function hasFoundryPolkadot(): Promise<boolean> {
    // Stock `forge` lacks `--resolc`, which we need for PolkaVM codegen;
    // `foundryup-polkadot` wires in the polkadot fork.
    const home = homedir();
    const foundryupPolkadot = resolve(home, ".foundry/bin/foundryup-polkadot");
    return (await commandExists("forge")) && existsSync(foundryupPolkadot);
}

function isIpfsInitialized(): boolean {
    return existsSync(resolve(homedir(), ".ipfs"));
}

export async function isGhAuthenticated(): Promise<boolean> {
    try {
        await run("gh auth status");
        return true;
    } catch {
        return false;
    }
}

export interface ToolStep {
    name: string;
    check: () => Promise<boolean>;
    install: (onData?: (line: string) => void) => Promise<void>;
    manualHint?: string;
}

export const TOOL_STEPS: ToolStep[] = [
    {
        name: "rustup",
        check: () => commandExists("rustup"),
        install: (onData) =>
            runPiped(
                'curl --proto "=https" --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y',
                onData,
            ),
        manualHint: "https://rustup.rs",
    },
    {
        name: "Rust nightly",
        check: () => hasRustNightly(),
        install: (onData) => runPiped("rustup toolchain install nightly", onData),
    },
    {
        name: "rust-src",
        check: () => hasRustSrc(),
        install: (onData) => runPiped("rustup component add rust-src --toolchain nightly", onData),
    },
    {
        name: "cdm & cargo-pvm-contract",
        check: () => hasCdm(),
        install: (onData) =>
            runPiped(
                "curl -fsSL https://raw.githubusercontent.com/paritytech/contract-dependency-manager/main/install.sh | bash",
                onData,
            ),
        manualHint:
            "curl -fsSL https://raw.githubusercontent.com/paritytech/contract-dependency-manager/main/install.sh | bash",
    },
    {
        name: "IPFS",
        check: async () => (await commandExists("ipfs")) && isIpfsInitialized(),
        install: async (onData) => {
            if (!(await commandExists("ipfs"))) {
                if (platform() === "darwin" && (await commandExists("brew"))) {
                    await runPiped("brew install ipfs", onData);
                } else {
                    const os = platform() === "darwin" ? "darwin" : "linux";
                    const cpu = arch() === "arm64" ? "arm64" : "amd64";
                    await runPiped(
                        `curl -fsSL https://dist.ipfs.tech/kubo/v0.33.2/kubo_v0.33.2_${os}-${cpu}.tar.gz | tar xz && cd kubo && sudo bash install.sh && cd .. && rm -rf kubo`,
                        onData,
                    );
                }
            }
            if (!isIpfsInitialized()) {
                await runPiped("ipfs init", onData);
            }
        },
        manualHint: "https://docs.ipfs.tech/install/ then run: ipfs init",
    },
    {
        name: "foundry (polkadot)",
        check: () => hasFoundryPolkadot(),
        install: (onData) =>
            runPiped(
                "curl -L https://raw.githubusercontent.com/paritytech/foundry-polkadot/refs/heads/master/foundryup/install | bash && $HOME/.foundry/bin/foundryup-polkadot",
                onData,
            ),
        manualHint:
            "curl -L https://raw.githubusercontent.com/paritytech/foundry-polkadot/refs/heads/master/foundryup/install | bash && ~/.foundry/bin/foundryup-polkadot",
    },
    {
        name: "GitHub CLI",
        check: () => commandExists("gh"),
        install: async (onData) => {
            if (await commandExists("brew")) {
                await runPiped("brew install gh", onData);
            } else {
                // GH install instructions: https://github.com/cli/cli/blob/trunk/docs/install_linux.md
                await runPiped(
                    [
                        "(type -p wget >/dev/null || (sudo apt update && sudo apt-get install wget -y))",
                        "sudo mkdir -p -m 755 /etc/apt/keyrings",
                        "out=$(mktemp)",
                        "wget -nv -O$out https://cli.github.com/packages/githubcli-archive-keyring.gpg",
                        "cat $out | sudo tee /etc/apt/keyrings/githubcli-archive-keyring.gpg > /dev/null",
                        "sudo chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg",
                        `echo 'deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main' | sudo tee /etc/apt/sources.list.d/github-cli.list > /dev/null`,
                        "sudo apt update",
                        "sudo apt install gh -y",
                    ].join(" && "),
                    onData,
                );
            }
        },
        manualHint: "https://cli.github.com",
    },
];
