import { route } from "@/server/api";
import { itemCard } from "@/server/services/inventory";

export const GET = route<{ id: string }>(({ ctx, params }) => itemCard(ctx, params.id));
