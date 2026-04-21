/**
 * Public surface for build detection + execution.
 *
 * Kept free of React/Ink imports so this module can be consumed from a
 * WebContainer (RevX) as well as the Node CLI.
 */

export {
    detectBuildConfig,
    detectContractsType,
    detectInstallConfig,
    detectPackageManager,
    BuildDetectError,
    PM_LOCKFILES,
    type BuildConfig,
    type ContractsType,
    type DetectInput,
    type InstallConfig,
    type PackageManager,
} from "./detect.js";
export { loadDetectInput, runBuild, type RunBuildOptions, type RunBuildResult } from "./runner.js";
