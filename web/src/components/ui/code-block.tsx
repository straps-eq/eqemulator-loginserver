"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Preformatted code block with a copy-to-clipboard button.
 * Matches the existing `bg-[#241c14] border-frost-400/8` code styling.
 */
export function CodeBlock({
  code,
  label,
  className,
}: {
  code: string;
  /** Accessible name for the copy button, e.g. "eqhost.txt for RoF2". */
  label?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard unavailable (insecure context / permissions); text remains selectable.
    }
  }

  return (
    <div className={cn("relative group", className)}>
      <pre className="bg-[#241c14] border border-frost-400/8 rounded p-4 pr-12 text-xs sm:text-sm text-parchment-300 whitespace-pre-wrap break-all font-mono">
        {code}
      </pre>
      <button
        type="button"
        onClick={copy}
        aria-label={copied ? "Copied" : `Copy ${label ?? "code"}`}
        className="absolute top-2 right-2 inline-flex items-center justify-center w-8 h-8 rounded border border-frost-400/10 bg-[#3a2e23] text-parchment-500 hover:text-frost-300 hover:border-frost-400/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-frost-400/50 transition-colors"
      >
        {copied ? <Check className="h-4 w-4 text-frost-300" /> : <Copy className="h-4 w-4" />}
      </button>
      <span className="sr-only" aria-live="polite">
        {copied ? "Copied to clipboard" : ""}
      </span>
    </div>
  );
}
