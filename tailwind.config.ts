import type { Config } from "tailwindcss";

/**
 * Tailwind for the standalone bertclips cockpit. The palette mirrors the warm
 * BertClipsHub console theme the cockpit was designed in (ink + orange accent).
 */
const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: {
          DEFAULT: "#e8e9ee",
          faint: "#b7b9c4",
          ghost: "#7f8393",
        },
        line: "#e8e9ee",
      },
    },
  },
  plugins: [],
};
export default config;
