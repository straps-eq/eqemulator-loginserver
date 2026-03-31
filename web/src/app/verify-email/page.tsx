"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Navbar } from "@/components/navbar";

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={
      <>
        <Navbar />
        <div className="mx-auto max-w-md px-4 py-16 text-center">
          <div className="rounded-lg border border-frost-400/10 bg-[#0a0e17]/80 p-10">
            <div className="h-2 w-2 rounded-full bg-frost-400/40 animate-pulse mx-auto mb-4" />
            <p className="text-parchment-400 text-sm">Verifying your email...</p>
          </div>
        </div>
      </>
    }>
      <VerifyEmailContent />
    </Suspense>
  );
}

function VerifyEmailContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  const [status, setStatus] = useState<"loading" | "success" | "already" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    if (!token) {
      setStatus("error");
      setErrorMsg("No verification token provided.");
      return;
    }

    fetch("/api/account/verify-email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.success) {
          setStatus(data.alreadyVerified ? "already" : "success");
        } else {
          setStatus("error");
          setErrorMsg(data.error || "Verification failed");
        }
      })
      .catch(() => {
        setStatus("error");
        setErrorMsg("An unexpected error occurred");
      });
  }, [token]);

  return (
    <>
      <Navbar />
      <div className="mx-auto max-w-md px-4 py-16 text-center">
        <div className="rounded-lg border border-frost-400/10 bg-[#0a0e17]/80 p-10">
          {status === "loading" && (
            <>
              <div className="h-2 w-2 rounded-full bg-frost-400/40 animate-pulse mx-auto mb-4" />
              <p className="text-parchment-400 text-sm">Verifying your email...</p>
            </>
          )}
          {status === "success" && (
            <>
              <div className="h-3 w-3 rounded-full bg-forest-500 mx-auto mb-4" />
              <h1 className="font-display text-xl font-bold text-parchment-100 mb-2">Email Verified</h1>
              <p className="text-parchment-400 text-sm mb-6">
                Your account is now active. You can log in and start playing.
              </p>
              <Link
                href="/login"
                className="inline-block bg-frost-400/10 text-frost-400 border border-frost-400/20 px-6 py-2.5 rounded-lg text-sm font-display hover:bg-frost-400/15 transition-colors"
              >
                Log In
              </Link>
            </>
          )}
          {status === "already" && (
            <>
              <div className="h-3 w-3 rounded-full bg-frost-400 mx-auto mb-4" />
              <h1 className="font-display text-xl font-bold text-parchment-100 mb-2">Already Verified</h1>
              <p className="text-parchment-400 text-sm mb-6">
                Your email has already been verified.
              </p>
              <Link
                href="/login"
                className="inline-block bg-frost-400/10 text-frost-400 border border-frost-400/20 px-6 py-2.5 rounded-lg text-sm font-display hover:bg-frost-400/15 transition-colors"
              >
                Log In
              </Link>
            </>
          )}
          {status === "error" && (
            <>
              <div className="h-3 w-3 rounded-full bg-red-500/60 mx-auto mb-4" />
              <h1 className="font-display text-xl font-bold text-parchment-100 mb-2">Verification Failed</h1>
              <p className="text-parchment-400 text-sm mb-6">{errorMsg}</p>
              <Link
                href="/register"
                className="inline-block bg-frost-400/10 text-frost-400 border border-frost-400/20 px-6 py-2.5 rounded-lg text-sm font-display hover:bg-frost-400/15 transition-colors"
              >
                Try Again
              </Link>
            </>
          )}
        </div>
      </div>
    </>
  );
}
