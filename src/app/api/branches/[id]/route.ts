import { route } from "@/server/api";
import { deleteBranch, updateBranch } from "@/server/services/branches";

type P = { id: string };
export const PATCH = route<P>(({ ctx, params, body }) => updateBranch(ctx, params.id, body));
export const DELETE = route<P>(({ ctx, params }) => deleteBranch(ctx, params.id));
