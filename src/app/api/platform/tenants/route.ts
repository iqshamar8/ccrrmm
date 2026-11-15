import { route } from "@/server/api";
import { createTenant, listTenants } from "@/server/services/platform";

export const GET = route(({ ctx, search }) =>
  listTenants(ctx, { search: search.get("q") ?? undefined, status: search.get("status") ?? undefined }),
);
export const POST = route(({ ctx, body }) => createTenant(ctx, body));
