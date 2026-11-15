import { route } from "@/server/api";
import { addSupply } from "@/server/services/surgeries";

export const POST = route<{ id: string }>(({ ctx, params, body }) => addSupply(ctx, params.id, body));
