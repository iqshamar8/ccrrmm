import { route } from "@/server/api";
import { getOrganization, tenantOverview, updateOrganization } from "@/server/services/organization";

export const GET = route(({ ctx, search }) => (search.get("overview") ? tenantOverview(ctx) : getOrganization(ctx)));
export const PATCH = route(({ ctx, body }) => updateOrganization(ctx, body));
