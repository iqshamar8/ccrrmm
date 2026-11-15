import { route } from "@/server/api";
import { deleteSupply } from "@/server/services/surgeries";

export const DELETE = route<{ id: string }>(({ ctx, params }) => deleteSupply(ctx, params.id));
