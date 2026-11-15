import { route } from "@/server/api";
import { createCoupon, listCoupons } from "@/server/services/coupons";

export const GET = route(({ ctx }) => listCoupons(ctx));
export const POST = route(({ ctx, body }) => createCoupon(ctx, body));
