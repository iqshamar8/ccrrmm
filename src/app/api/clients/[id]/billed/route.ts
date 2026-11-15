import { route } from "@/server/api";
import { billedSources } from "@/server/services/billing";

export const GET = route<{ id: string }>(({ ctx, params }) => billedSources(ctx, params.id));
