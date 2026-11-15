import { route } from "@/server/api";
import { listCompanies, saveCompany } from "@/server/services/corporate";

export const GET = route(({ ctx }) => listCompanies(ctx));
export const POST = route(({ ctx, body }) => saveCompany(ctx, null, body));
