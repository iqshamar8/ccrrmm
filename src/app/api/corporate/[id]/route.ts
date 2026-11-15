import { route } from "@/server/api";
import { getCompany, saveCompany } from "@/server/services/corporate";

type P = { id: string };
export const GET = route<P>(({ ctx, params }) => getCompany(ctx, params.id));
export const PATCH = route<P>(({ ctx, params, body }) => saveCompany(ctx, params.id, body));
