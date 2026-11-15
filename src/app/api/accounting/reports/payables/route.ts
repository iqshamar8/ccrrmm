import { route } from "@/server/api";
import { supplierBalances } from "@/server/services/accounting";

export const GET = route(({ ctx }) => supplierBalances(ctx));
