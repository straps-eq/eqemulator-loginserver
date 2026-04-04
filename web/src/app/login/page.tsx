import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const session = await getSession();

  // If already logged in (e.g. after OAuth callback), go straight to account
  if (session.isLoggedIn) {
    redirect("/account");
  }

  return <LoginForm />;
}
