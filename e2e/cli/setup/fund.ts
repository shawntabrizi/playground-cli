// Copyright (C) Parity Technologies (UK) Ltd.
// SPDX-License-Identifier: Apache-2.0

// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

/**
 * Top up the E2E deployer account before tests run.
 *
 * Tests sign `registry.publish()` (and any other user-signed extrinsic) with
 * `SIGNER`, paying substrate-side fees from its ss58 balance. We fund it from
 * the production CLI's funder chain (`FUNDER_CHAIN`) so the deployer always
 * has enough PAS to cover an entire test run, regardless of who else has
 * been spending //Alice or any other shared dev account.
 *
 * Idempotent: only triggers a transfer when the deployer's free balance
 * dips below `MIN_BALANCE`. No-op the rest of the time.
 */

import { checkBalance, ensureFunded } from "../../../src/utils/account/funding.js";
import { getTestClient } from "../helpers/chain.js";
import { SIGNER } from "../fixtures/accounts.js";

const PAS = 10_000_000_000n;

/** Top up the deployer if it falls below this. */
export const MIN_BALANCE = 500n * PAS;

/** Amount to send when topping up. */
export const TOP_UP_AMOUNT = 1000n * PAS;

export async function fundDeployerIfLow(): Promise<void> {
	const client = await getTestClient();
	const before = await checkBalance(client, SIGNER.address, MIN_BALANCE);
	console.log(
		`[e2e setup] SIGNER (${SIGNER.name}) balance: ${before.free / PAS} PAS (${SIGNER.address})`,
	);
	if (before.sufficient) return;

	console.log(
		`[e2e setup] balance below ${MIN_BALANCE / PAS} PAS — topping up by ${TOP_UP_AMOUNT / PAS} PAS…`,
	);
	await ensureFunded(client, SIGNER.address, MIN_BALANCE, TOP_UP_AMOUNT);
	const after = await checkBalance(client, SIGNER.address, MIN_BALANCE);
	console.log(`[e2e setup] SIGNER topped up: ${after.free / PAS} PAS`);
}
