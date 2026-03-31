import { cn } from "@/lib/utils";
import { ButtonHTMLAttributes, forwardRef } from "react";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "outline" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "primary", size = "md", ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={cn(
          "inline-flex items-center justify-center font-display font-medium tracking-wide uppercase transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-gold-400/50 focus:ring-offset-2 focus:ring-offset-obsidian-950 disabled:opacity-40 disabled:cursor-not-allowed",
          {
            "bg-gradient-to-b from-gold-200 to-gold-400 text-obsidian-950 hover:from-gold-100 hover:to-gold-300 shadow-glow-gold rounded": variant === "primary",
            "bg-[#1a2030] text-parchment-300 hover:bg-[#1f2538] border border-frost-400/10 rounded": variant === "secondary",
            "border border-frost-400/25 text-frost-300 hover:border-frost-400/50 hover:text-frost-200 hover:shadow-glow-frost rounded": variant === "outline",
            "text-parchment-400 hover:text-frost-300 hover:bg-[#1a2030]/50 rounded": variant === "ghost",
            "bg-burgundy-600 text-parchment-100 hover:bg-burgundy-500 rounded": variant === "danger",
          },
          {
            "px-3 py-1.5 text-xs": size === "sm",
            "px-5 py-2.5 text-xs": size === "md",
            "px-8 py-3.5 text-sm": size === "lg",
          },
          className
        )}
        {...props}
      />
    );
  }
);

Button.displayName = "Button";
export { Button };
