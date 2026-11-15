import { route } from "@/server/api";
import { deleteCategory, updateCategory } from "@/server/services/catalog";

type P = { id: string };
export const PATCH = route<P>(({ ctx, params, body }) => updateCategory(ctx, params.id, body));
export const DELETE = route<P>(({ ctx, params }) => deleteCategory(ctx, params.id));
