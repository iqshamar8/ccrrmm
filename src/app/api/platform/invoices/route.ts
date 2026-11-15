import { route } from "@/server/api";
import { listPlatformInvoices } from "@/server/services/platform-billing";

export const GET = route(({ ctx }) => listPlatformInvoices(ctx));
