import { route } from "@/server/api";
import { getDocument } from "@/server/services/inventory";

export const GET = route<{ id: string }>(({ ctx, params }) => getDocument(ctx, params.id));
