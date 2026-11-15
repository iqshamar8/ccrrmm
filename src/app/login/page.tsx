import { cookies } from "next/headers";
import { isLocale } from "@/lib/i18n";
import LoginForm from "./LoginForm";

export default async function LoginPage() {
  const l = (await cookies()).get("locale")?.value;
  return <LoginForm locale={isLocale(l) ? l : "ar"} />;
}
