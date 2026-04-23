import { Row } from "../../utils/ui/theme/index.js";
import { statusToRow } from "./status.js";
import type { LogoutStatus as LogoutStatusType } from "../../utils/auth.js";

/**
 * Single-row presentational view of the current sign-out step. Pure — all
 * visual/copy decisions live in `statusToRow` so they're unit-testable.
 */
export function LogoutStatus({ status }: { status: LogoutStatusType }) {
    const spec = statusToRow(status);
    return (
        <Row
            mark={spec.mark}
            label={spec.label}
            value={spec.value}
            hint={spec.hint}
            tone={spec.tone}
        />
    );
}
