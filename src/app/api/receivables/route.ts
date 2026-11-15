import { route } from "@/server/api";
import { receivables } from "@/server/services/billing";

export const GET = route(({ ctx }) => receivables(ctx));
