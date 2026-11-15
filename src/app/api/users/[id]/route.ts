import { route } from "@/server/api";
import { deleteUser, getUser, updateUser } from "@/server/services/users";

type P = { id: string };
export const GET = route<P>(({ ctx, params }) => getUser(ctx, params.id));
export const PATCH = route<P>(({ ctx, params, body }) => updateUser(ctx, params.id, body));
export const DELETE = route<P>(({ ctx, params }) => deleteUser(ctx, params.id));
