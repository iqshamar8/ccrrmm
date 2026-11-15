import { route } from "@/server/api";
import { listProducts, saveProduct } from "@/server/services/billing";

export const GET = route(({ ctx, search }) => listProducts(ctx, search.get("active") === "1"));
export const POST = route(({ ctx, body }) => saveProduct(ctx, null, body));
