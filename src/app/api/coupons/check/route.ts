import { route } from "@/server/api";
import { checkCoupon } from "@/server/services/coupons";

export const POST = route(({ ctx, body }) => checkCoupon(ctx, body));
