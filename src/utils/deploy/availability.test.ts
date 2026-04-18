import { describe, it, expect, vi } from "vitest";

// Mock bulletin-deploy's DotNS class. Ownership check is now driven by the
// caller's H160 (derived from SS58 via `@polkadot-apps/address::ss58ToH160`),
// so the mock needs to reflect the full `{ owned, owner }` shape the caller
// sees when they DO pass a user address. `getUserPopStatus` + `isTestnet`
// feed the `needsPopUpgrade` prediction that's threaded into the summary
// card's phone-approval count.
const classifyName = vi.fn();
const checkOwnership = vi.fn();
const getUserPopStatus = vi.fn(async () => 2); // default: user already has Full PoP → no upgrade fires
const isTestnet = vi.fn(async () => true);
const connect = vi.fn(async () => {});
const disconnect = vi.fn();

vi.mock("bulletin-deploy", () => ({
    DotNS: vi.fn().mockImplementation(() => ({
        connect,
        classifyName,
        checkOwnership,
        getUserPopStatus,
        isTestnet,
        disconnect,
    })),
}));

// A realistic dev SS58 → H160 pair so the tests exercise the real derivation.
// We use Alice's substrate address; its H160 is deterministic.
const ALICE_SS58 = "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY";

import { checkDomainAvailability, formatAvailability } from "./availability.js";

beforeEach(() => {
    classifyName.mockReset();
    checkOwnership.mockReset();
    getUserPopStatus.mockReset();
    getUserPopStatus.mockResolvedValue(2); // default: Full PoP → no upgrade
    isTestnet.mockReset();
    isTestnet.mockResolvedValue(true);
    connect.mockClear();
    disconnect.mockClear();
});

// vitest implicitly imports `describe` and `it`; `beforeEach` needs to come from vitest too.
import { beforeEach } from "vitest";

describe("checkDomainAvailability", () => {
    it("returns 'available' when classification is NoStatus", async () => {
        classifyName.mockResolvedValue({ requiredStatus: 0, message: "" });

        const result = await checkDomainAvailability("my-app");
        // No ownerSs58Address passed → we can't check user's current PoP, so
        // we default the plan to the common path (register + no PoP upgrade).
        // The signing counter's clamp-up behavior fixes the summary at
        // runtime if we under-estimated.
        expect(result).toEqual({
            status: "available",
            label: "my-app",
            fullDomain: "my-app.dot",
            plan: { action: "register", needsPopUpgrade: false },
        });
    });

    it("returns 'reserved' when classification is Reserved (status 3)", async () => {
        classifyName.mockResolvedValue({
            requiredStatus: 3,
            message: "Reserved for Governance",
        });

        const result = await checkDomainAvailability("polkadot.dot");
        expect(result).toEqual({
            status: "reserved",
            label: "polkadot",
            fullDomain: "polkadot.dot",
            message: "Reserved for Governance",
        });
    });

    it("re-deploys: 'owned by you' returns available with an update note", async () => {
        // Regression: previously the availability check used the default dev
        // mnemonic's h160 as the comparison, so a domain owned by the user's
        // OWN phone signer came back as `owned: false, owner: <user h160>`
        // and we mis-classified it as `taken`, blocking every re-deploy.
        // Fix: derive the caller's H160 via `ss58ToH160` and pass it to
        // `checkOwnership`; "owned by the caller" becomes an update path.
        classifyName.mockResolvedValue({ requiredStatus: 0, message: "" });
        // DotNS computes owned = owner.toLowerCase() === checkAddress.toLowerCase().
        // The mock echoes the caller's h160 as "owner" so `owned = true`.
        checkOwnership.mockImplementation(async (_label: string, checkAddress: string) => ({
            owned: true,
            owner: checkAddress,
        }));

        const result = await checkDomainAvailability("my-existing-site", {
            ownerSs58Address: ALICE_SS58,
        });
        expect(result.status).toBe("available");
        if (result.status === "available") {
            expect(result.note).toMatch(/Already owned by you/i);
        }

        // Lock in that the H160 we pass to DotNS really is derived from the
        // SS58 we provided. Without this, the mock would silently accept any
        // string and a broken `ss58ToH160` regression would go undetected.
        // Alice's canonical H160 on Revive is the keccak256(pubkey)[12:] of
        // `5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY`; we assert the
        // call used the right length + `0x` shape + non-zero address — we
        // avoid hard-coding the exact hex so future SS58 encoding changes
        // don't cause spurious test failures as long as the derivation is
        // still wired up.
        expect(checkOwnership).toHaveBeenCalledTimes(1);
        const [, passedH160] = checkOwnership.mock.calls[0];
        expect(passedH160).toMatch(/^0x[0-9a-f]{40}$/);
        expect(passedH160).not.toBe("0x0000000000000000000000000000000000000000");
    });

    it("returns 'taken' when the domain is owned by a different H160", async () => {
        classifyName.mockResolvedValue({ requiredStatus: 0, message: "" });
        const otherOwner = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
        checkOwnership.mockImplementation(async () => ({ owned: false, owner: otherOwner }));

        const result = await checkDomainAvailability("someone-elses-site", {
            ownerSs58Address: ALICE_SS58,
        });
        expect(result.status).toBe("taken");
        if (result.status === "taken") expect(result.owner).toBe(otherOwner);
    });

    it("skips the ownership check when no SS58 address is provided", async () => {
        // Dev mode without a session signer: we can't do a meaningful
        // comparison, so we don't call checkOwnership at all and let
        // bulletin-deploy's own preflight handle it with the real signer.
        classifyName.mockResolvedValue({ requiredStatus: 0, message: "" });

        const result = await checkDomainAvailability("any-name");
        expect(result.status).toBe("available");
        expect(checkOwnership).not.toHaveBeenCalled();
    });

    it("treats PoP Lite / Full requirements as available-with-note, not blockers", async () => {
        // Regression: bulletin-deploy auto-sets PoP via setUserPopStatus on testnet,
        // so these names DO register successfully. We must not block them in preflight.
        classifyName.mockResolvedValue({ requiredStatus: 1, message: "PoP Lite" });

        const lite = await checkDomainAvailability("short");
        expect(lite.status).toBe("available");
        if (lite.status === "available") {
            expect(lite.note).toMatch(/Lite/);
            expect(lite.note).toMatch(/automatically/);
        }

        classifyName.mockResolvedValue({ requiredStatus: 2, message: "PoP Full" });
        const full = await checkDomainAvailability("shortr");
        expect(full.status).toBe("available");
        if (full.status === "available") {
            expect(full.note).toMatch(/Full/);
        }
    });

    it("predicts needsPopUpgrade=true when the user's current PoP is below what the label demands", async () => {
        // Regression: the TUI used to hard-code "3 DotNS taps" for phone mode
        // and print "step 5 of 4" on the phone prompt once bulletin-deploy
        // fired its `setUserPopStatus` tx. Fix: plumb the predicted PoP
        // transition from availability → `resolveSignerSetup` so the summary
        // card and runtime counter agree on the real count.
        classifyName.mockResolvedValue({ requiredStatus: 2, message: "PoP Full" }); // name wants Full
        checkOwnership.mockResolvedValue({ owned: false, owner: null });
        getUserPopStatus.mockResolvedValue(1); // user only has Lite
        isTestnet.mockResolvedValue(true);

        const result = await checkDomainAvailability("short", { ownerSs58Address: ALICE_SS58 });
        expect(result.status).toBe("available");
        if (result.status === "available") {
            expect(result.plan).toEqual({ action: "register", needsPopUpgrade: true });
        }
    });

    it("predicts needsPopUpgrade=false when the user already has ≥ the required PoP", async () => {
        classifyName.mockResolvedValue({ requiredStatus: 2, message: "PoP Full" });
        checkOwnership.mockResolvedValue({ owned: false, owner: null });
        getUserPopStatus.mockResolvedValue(2); // already Full
        isTestnet.mockResolvedValue(true);

        const result = await checkDomainAvailability("short", { ownerSs58Address: ALICE_SS58 });
        if (result.status === "available") {
            expect(result.plan.needsPopUpgrade).toBe(false);
        }
    });

    it("re-deploy: plan is { action: 'update', needsPopUpgrade: false } — only setContenthash fires", async () => {
        classifyName.mockResolvedValue({ requiredStatus: 0, message: "" });
        checkOwnership.mockImplementation(async (_label: string, checkAddress: string) => ({
            owned: true,
            owner: checkAddress,
        }));

        const result = await checkDomainAvailability("my-existing-site", {
            ownerSs58Address: ALICE_SS58,
        });
        if (result.status === "available") {
            expect(result.plan).toEqual({ action: "update", needsPopUpgrade: false });
        }
    });

    it("falls back to a safe default when getUserPopStatus throws", async () => {
        // RPC flake on the PoP query shouldn't block the whole availability
        // check — under-counting is recoverable via the counter's clamp.
        classifyName.mockResolvedValue({ requiredStatus: 2, message: "PoP Full" });
        checkOwnership.mockResolvedValue({ owned: false, owner: null });
        getUserPopStatus.mockRejectedValue(new Error("RPC hiccup"));

        const result = await checkDomainAvailability("short", { ownerSs58Address: ALICE_SS58 });
        expect(result.status).toBe("available");
        if (result.status === "available") {
            expect(result.plan).toEqual({ action: "register", needsPopUpgrade: false });
        }
    });

    it("returns 'unknown' and disconnects when the RPC call throws", async () => {
        classifyName.mockRejectedValue(new Error("RPC down"));

        const result = await checkDomainAvailability("whatever");
        expect(result.status).toBe("unknown");
        if (result.status === "unknown") expect(result.message).toMatch(/RPC down/);
        expect(disconnect).toHaveBeenCalled();
    });

    it("rejects invalid domain syntax before touching the network", async () => {
        await expect(checkDomainAvailability("NOT valid!")).rejects.toThrow(/Invalid domain/);
        expect(classifyName).not.toHaveBeenCalled();
    });
});

describe("formatAvailability", () => {
    it("renders a friendly sentence for each result kind", () => {
        const freshRegisterPlan = { action: "register" as const, needsPopUpgrade: false };
        expect(
            formatAvailability({
                status: "available",
                label: "x",
                fullDomain: "x.dot",
                plan: freshRegisterPlan,
            }),
        ).toBe("x.dot is available");
        expect(
            formatAvailability({
                status: "reserved",
                label: "polkadot",
                fullDomain: "polkadot.dot",
                message: "Reserved for Governance",
            }),
        ).toMatch(/reserved/);
        expect(
            formatAvailability({
                status: "available",
                label: "x",
                fullDomain: "x.dot",
                note: "Requires Proof of Personhood (Lite). Will be set up automatically.",
                plan: freshRegisterPlan,
            }),
        ).toMatch(/Proof of Personhood \(Lite\)/);
        expect(
            formatAvailability({
                status: "taken",
                label: "x",
                fullDomain: "x.dot",
                owner: "0xabc",
            }),
        ).toMatch(/already registered by 0xabc/);
        expect(
            formatAvailability({
                status: "unknown",
                label: "x",
                fullDomain: "x.dot",
                message: "RPC down",
            }),
        ).toMatch(/Could not verify/);
    });
});
