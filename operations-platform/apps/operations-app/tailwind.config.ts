import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./index.html",
    "./src/**/*.{ts,tsx}",
    "../../packages/**/*.{ts,tsx}",
    "../../modules/**/*.{ts,tsx}"
  ],
  theme: {
    extend: {
      colors: {
        panel: {
          bg: "var(--panel-bg)",
          line: "var(--panel-line)"
        },
        brand: {
          ember: "var(--brand-ember)",
          ocean: "var(--brand-ocean)",
          steel: "var(--brand-steel)"
        }
      },
      boxShadow: {
        operation: "0 18px 55px rgba(6, 29, 51, 0.28)"
      },
      borderRadius: {
        operation: "1.1rem"
      }
    }
  },
  plugins: []
};

export default config;
