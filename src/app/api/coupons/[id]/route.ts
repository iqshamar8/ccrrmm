import { route } from "@/server/api";
import { deleteCoupon, updateCoupon } from "@/server/services/coupons";

type P = { id: string };
export const PATCH = route<P>(({ ctx, params, body }) => updateCoupon(ctx, params.id, body));
export const DELETE = route<P>(({ ctx, params }) => deleteCoupon(ctx, params.id));
