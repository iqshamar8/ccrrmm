import { route } from "@/server/api";
import { clientCoverage } from "@/server/services/subscriptions";

export const GET = route<{ id: string }>(({ ctx, params }) => clientCoverage(ctx, params.id));
