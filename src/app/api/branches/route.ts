import { route } from "@/server/api";
import { createBranch, listBranches } from "@/server/services/branches";

export const GET = route(({ ctx }) => listBranches(ctx));
export const POST = route(({ ctx, body }) => createBranch(ctx, body));
