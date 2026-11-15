import { route } from "@/server/api";
import { setProgramStatus } from "@/server/services/programs";

export const POST = route<{ id: string }>(({ ctx, params, body }) => setProgramStatus(ctx, params.id, body));
