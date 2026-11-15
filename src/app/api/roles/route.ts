import { route } from "@/server/api";
import { createRole, listRoles } from "@/server/services/roles";

export const GET = route(({ ctx }) => listRoles(ctx));
export const POST = route(({ ctx, body }) => createRole(ctx, body));
