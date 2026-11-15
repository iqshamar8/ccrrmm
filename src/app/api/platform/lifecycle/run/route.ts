import { route } from "@/server/api";
import { runSubscriptionLifecycleAsPlatform } from "@/server/services/subscription-lifecycle";

export const POST = route(({ ctx }) => runSubscriptionLifecycleAsPlatform(ctx));
