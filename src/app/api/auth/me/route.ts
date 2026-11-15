import { route } from "@/server/api";

export const GET = route(async ({ ctx }) => ({
  user: ctx.user,
  tenant: ctx.tenant,
  permissions: [...ctx.permissions],
  features: [...ctx.features],
}));
