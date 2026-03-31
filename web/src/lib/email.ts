import { Resend } from "resend";
import crypto from "crypto";

let _resend: Resend | null = null;
function getResend() {
  if (!_resend) _resend = new Resend(process.env.RESEND_API_KEY || "");
  return _resend;
}
const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || "noreply@eqemulator.dev";
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://eqemulator.dev";

/** Generate a cryptographically secure 6-digit numeric code. */
export function generateMfaCode(): string {
  return String(crypto.randomInt(100000, 999999));
}

export async function sendVerificationEmail(
  email: string,
  token: string
): Promise<boolean> {
  if (!process.env.RESEND_API_KEY || process.env.RESEND_API_KEY === "placeholder") {
    console.warn("[email] No RESEND_API_KEY configured, skipping email send");
    return true;
  }

  const verifyUrl = `${SITE_URL}/verify-email?token=${token}`;

  try {
    const { error } = await getResend().emails.send({
      from: FROM_EMAIL,
      to: email,
      subject: "Verify your EQEmulator account",
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 20px; color: #d4cfc6; background: #0a0e17;">
          <h1 style="font-size: 20px; color: #f3efe5; margin-bottom: 8px;">Welcome to EQEmulator</h1>
          <p style="color: #9ca3af; font-size: 14px; margin-bottom: 24px;">
            Click the button below to verify your email address and activate your account.
          </p>
          <a href="${verifyUrl}" style="display: inline-block; background: #34bbfa; color: #080b12; padding: 12px 28px; border-radius: 6px; text-decoration: none; font-weight: 600; font-size: 14px;">
            Verify Email
          </a>
          <p style="color: #6b7280; font-size: 12px; margin-top: 32px;">
            If you didn't create an account, you can ignore this email.
          </p>
          <p style="color: #4b5563; font-size: 11px; margin-top: 16px;">
            Or copy this link: ${verifyUrl}
          </p>
        </div>
      `,
    });

    if (error) {
      console.error("[email] Send error:", error);
      return false;
    }
    return true;
  } catch (err) {
    console.error("[email] Exception:", err);
    return false;
  }
}

/**
 * Send a 6-digit MFA login verification code via email.
 * Used for admin and server owner accounts.
 */
export async function sendMfaCode(
  email: string,
  code: string
): Promise<boolean> {
  if (!process.env.RESEND_API_KEY || process.env.RESEND_API_KEY === "placeholder") {
    console.warn("[email] No RESEND_API_KEY configured, skipping MFA code send");
    console.log(`[email] MFA code for debug: ${code}`);
    return true;
  }

  try {
    const { error } = await getResend().emails.send({
      from: FROM_EMAIL,
      to: email,
      subject: "EQEmulator Login Verification Code",
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 20px; color: #d4cfc6; background: #0a0e17;">
          <h1 style="font-size: 20px; color: #f3efe5; margin-bottom: 8px;">Login Verification</h1>
          <p style="color: #9ca3af; font-size: 14px; margin-bottom: 24px;">
            Enter the following code to complete your login. This code expires in 5 minutes.
          </p>
          <div style="background: #111827; border: 1px solid #1f2937; border-radius: 8px; padding: 20px; text-align: center; margin-bottom: 24px;">
            <span style="font-size: 32px; font-weight: 700; letter-spacing: 8px; color: #34bbfa; font-family: monospace;">
              ${code}
            </span>
          </div>
          <p style="color: #6b7280; font-size: 12px;">
            If you didn't attempt to log in, your password may be compromised. Please change it immediately.
          </p>
        </div>
      `,
    });

    if (error) {
      console.error("[email] MFA send error:", error);
      return false;
    }
    return true;
  } catch (err) {
    console.error("[email] MFA exception:", err);
    return false;
  }
}
