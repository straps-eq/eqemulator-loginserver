import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { SiteFooter } from "@/components/site-footer";
import { getSession } from "@/lib/session";
import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Sign in to your EQEmulator.dev account",
  robots: { index: false },
};

export default async function LoginPage() {
  const session = await getSession();

  // If already logged in (e.g. after OAuth callback), go straight to account
  if (session.isLoggedIn) {
    redirect("/account");
  }

  return (
    <>
      <LoginForm />
      <SiteFooter />
    </>
  );
}
