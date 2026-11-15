import { route } from "@/server/api";
import { createUser, listUsers } from "@/server/services/users";

export const GET = route(({ ctx, search }) =>
  listUsers(ctx, {
    search: search.get("q") ?? undefined,
    roleId: search.get("roleId") ?? undefined,
    status: search.get("status") ?? undefined,
  }),
);
export const POST = route(({ ctx, body }) => createUser(ctx, body));
