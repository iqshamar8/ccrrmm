import { route } from "@/server/api";
import { deleteRole, updateRole } from "@/server/services/roles";

type P = { id: string };
export const PATCH = route<P>(({ ctx, params, body }) => updateRole(ctx, params.id, body));
export const DELETE = route<P>(({ ctx, params }) => deleteRole(ctx, params.id));
