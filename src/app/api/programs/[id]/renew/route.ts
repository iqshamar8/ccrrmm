import { route } from "@/server/api";
import { renewProgram } from "@/server/services/programs";

export const POST = route<{ id: string }>(({ ctx, params, body }) => renewProgram(ctx, params.id, body));
