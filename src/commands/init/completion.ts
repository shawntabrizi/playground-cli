/**
 * Pure predicate over the three parallel init streams (deps / auth / account
 * setup). Lives in its own file so tests can import it without dragging React
 * + Ink into the test runner.
 */
export interface InitCompletionState {
    needsQr: boolean;
    authResolved: boolean;
    loggedInAddress: string | null;
    depsComplete: boolean;
    accountComplete: boolean;
}

export function computeAllDone(state: InitCompletionState): boolean {
    const needsAccountSetup = state.loggedInAddress !== null;
    return (
        state.depsComplete &&
        state.authResolved &&
        (needsAccountSetup ? state.accountComplete : true)
    );
}
