import { cn } from "@/lib/utils";
import { InputHTMLAttributes, forwardRef } from "react";

const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => {
    return (
      <input
        ref={ref}
        className={cn(
          "w-full rounded border border-frost-400/10 bg-[#151b2a]/80 px-4 py-2.5 text-sm text-parchment-200 placeholder-obsidian-500 focus:border-frost-400/30 focus:outline-none focus:ring-1 focus:ring-frost-400/15 focus:shadow-glow-frost transition-all duration-200",
          className
        )}
        {...props}
      />
    );
  }
);

Input.displayName = "Input";
export { Input };
