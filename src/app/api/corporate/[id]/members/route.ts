import { route } from "@/server/api";
import { addMember } from "@/server/services/corporate";

export const POST = route<{ id: string }>(({ ctx, params, body }) => addMember(ctx, params.id, body));
