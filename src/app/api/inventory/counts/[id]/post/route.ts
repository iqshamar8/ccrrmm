import { route } from "@/server/api";
import { postCount } from "@/server/services/inventory";

export const POST = route<{ id: string }>(({ ctx, params }) => postCount(ctx, params.id));
