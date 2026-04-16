import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { homedir, platform } from "node:os";

export function commandExists(cmd: string): boolean {
    try {
        execSync(`command -v ${cmd}`, { stdio: "pipe" });
        return true;
    } catch {
        return false;
    }
}

function hasRustNightly(): boolean {
    try {
        const out = execSync("rustup toolchain list", { encoding: "utf-8", stdio: "pipe" });
        return out.includes("nightly");
    } catch {
        return false;
    }
}

function hasRustSrc(): boolean {
    try {
        const out = execSync("rustup component list --toolchain nightly", {
            encoding: "utf-8",
            stdio: "pipe",
        });
        return out.includes("rust-src (installed)");
    } catch {
        return false;
    }
}

function hasCdm(): boolean {
    return commandExists("cdm") && commandExists("cargo-pvm-contract");
}

function isIpfsInitialized(): boolean {
    return existsSync(resolve(homedir(), ".ipfs"));
}

export function isGhAuthenticated(): boolean {
    try {
        execSync("gh auth status", { stdio: "pipe" });
        return true;
    } catch {
        return false;
    }
}

export interface ToolStep {
    name: string;
    check: () => boolean;
    install: () => void;
    manualHint?: string;
}

export const TOOL_STEPS: ToolStep[] = [
    {
        name: "rustup",
        check: () => commandExists("rustup"),
        install: () =>
            execSync('curl --proto "=https" --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y', {
                stdio: "inherit",
                shell: "/bin/bash",
            }),
        manualHint: "https://rustup.rs",
    },
    {
        name: "Rust nightly",
        check: () => hasRustNightly(),
        install: () => execSync("rustup toolchain install nightly", { stdio: "inherit" }),
    },
    {
        name: "rust-src",
        check: () => hasRustSrc(),
        install: () =>
            execSync("rustup component add rust-src --toolchain nightly", { stdio: "inherit" }),
    },
    {
        name: "cdm & cargo-pvm-contract",
        check: () => hasCdm(),
        install: () =>
            execSync(
                "curl -fsSL https://raw.githubusercontent.com/paritytech/contract-dependency-manager/main/install.sh | bash",
                { stdio: "inherit", shell: "/bin/bash" },
            ),
        manualHint:
            "curl -fsSL https://raw.githubusercontent.com/paritytech/contract-dependency-manager/main/install.sh | bash",
    },
    {
        name: "IPFS",
        check: () => commandExists("ipfs") && isIpfsInitialized(),
        install: () => {
            if (!commandExists("ipfs")) {
                if (platform() === "darwin" && commandExists("brew")) {
                    execSync("brew install ipfs", { stdio: "inherit" });
                } else if (platform() === "darwin") {
                    execSync(
                        "curl -fsSL https://dist.ipfs.tech/kubo/v0.33.2/kubo_v0.33.2_darwin-arm64.tar.gz | tar xz && cd kubo && sudo bash install.sh && cd .. && rm -rf kubo",
                        { stdio: "inherit", shell: "/bin/bash" },
                    );
                } else {
                    execSync(
                        "curl -fsSL https://dist.ipfs.tech/kubo/v0.33.2/kubo_v0.33.2_linux-amd64.tar.gz | tar xz && cd kubo && sudo bash install.sh && cd .. && rm -rf kubo",
                        { stdio: "inherit", shell: "/bin/bash" },
                    );
                }
            }
            if (!isIpfsInitialized()) {
                execSync("ipfs init", { stdio: "inherit" });
            }
        },
        manualHint: "https://docs.ipfs.tech/install/ then run: ipfs init",
    },
];
