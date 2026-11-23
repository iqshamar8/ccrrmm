import { cookies } from "next/headers";
import { isLocale } from "@/lib/i18n";
import LoginForm from "./LoginForm";

export default async function LoginPage() {
  const jar = await cookies();
  const l = jar.get("locale")?.value;
  return <LoginForm locale={isLocale(l) ? l : "ar"} theme={jar.get("theme")?.value === "light" ? "light" : "dark"} />;
}
