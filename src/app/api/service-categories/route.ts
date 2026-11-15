import { route } from "@/server/api";
import { createCategory } from "@/server/services/catalog";

export const POST = route(({ ctx, body }) => createCategory(ctx, body));
