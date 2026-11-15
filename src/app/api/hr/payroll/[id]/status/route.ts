import { route } from "@/server/api";
import { setPayrollStatus } from "@/server/services/hr";

export const POST = route<{ id: string }>(({ ctx, params, body }) => setPayrollStatus(ctx, params.id, body));
