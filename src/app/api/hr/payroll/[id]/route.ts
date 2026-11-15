import { route } from "@/server/api";
import { getPayrollRun } from "@/server/services/hr";

export const GET = route<{ id: string }>(({ ctx, params }) => getPayrollRun(ctx, params.id));
