import { route } from "@/server/api";
import { updatePayrollItem } from "@/server/services/hr";

export const PATCH = route<{ id: string }>(({ ctx, params, body }) => updatePayrollItem(ctx, params.id, body));
