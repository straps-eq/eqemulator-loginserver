import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        obsidian: {
          950: "#0a0b0d",
          900: "#121418",
          800: "#1a1d24",
          700: "#252930",
          600: "#31363f",
          500: "#3e444f",
        },
        gold: {
          50: "#f5f0e6",
          100: "#e8dcc8",
          200: "#d4c4a0",
          300: "#c9a96e",
          400: "#b8944f",
          500: "#a07d3a",
          600: "#856630",
          700: "#6b5028",
          800: "#574123",
          900: "#48361f",
        },
        parchment: {
          50: "#faf7f2",
          100: "#f3efe5",
          200: "#e8e0d0",
          300: "#d9ccb4",
          400: "#c7b494",
          500: "#b89e7a",
        },
        frost: {
          50: "#f0f9ff",
          100: "#dff2fe",
          200: "#b8e5fe",
          300: "#7ad2fd",
          400: "#34bbfa",
          500: "#0aa2eb",
          600: "#0080c9",
          700: "#0166a3",
          800: "#065686",
          900: "#0b486f",
        },
        arcane: {
          400: "#5eead4",
          500: "#2dd4bf",
          600: "#14b8a6",
          700: "#0d9488",
        },
        burgundy: {
          400: "#c2697b",
          500: "#a84c5e",
          600: "#8e3349",
          700: "#742639",
          800: "#5e1f2e",
        },
        forest: {
          400: "#6da67a",
          500: "#4d8a5c",
          600: "#3a6f47",
          700: "#2d5838",
        },
      },
      fontFamily: {
        display: ["Cinzel", "Georgia", "serif"],
        body: ["Inter", "system-ui", "sans-serif"],
      },
      backgroundImage: {
        "noise": "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.04'/%3E%3C/svg%3E\")",
      },
      boxShadow: {
        "glow-gold": "0 0 20px rgba(201, 169, 110, 0.12)",
        "glow-frost": "0 0 20px rgba(122, 210, 253, 0.18)",
        "glow-arcane": "0 0 20px rgba(94, 234, 212, 0.15)",
        "inner-gold": "inset 0 1px 0 rgba(201, 169, 110, 0.08)",
      },
    },
  },
  plugins: [],
};

export default config;
