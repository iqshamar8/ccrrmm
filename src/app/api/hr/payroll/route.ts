import { route } from "@/server/api";
import { generatePayroll, listPayrollRuns } from "@/server/services/hr";

export const GET = route(({ ctx }) => listPayrollRuns(ctx));
/** {period: "YYYY-MM"} — builds or rebuilds the draft run */
export const POST = route(({ ctx, body }) => generatePayroll(ctx, body));
