import { route } from "@/server/api";
import { listGroups, saveGroup } from "@/server/services/inventory";

export const GET = route(({ ctx }) => listGroups(ctx));
export const POST = route(({ ctx, body }) => saveGroup(ctx, null, body));
