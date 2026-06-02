/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        // Design system — developer tool dark (ui-ux-pro-max)
        bg: {
          DEFAULT: "#0F172A", // app background (slate-900)
          raised: "#131C31", // panels
          inset: "#0B1220", // terminal / deep wells
        },
        surface: {
          DEFAULT: "#1E293B", // primary surface (slate-800)
          hover: "#243044",
          active: "#2C3A52",
        },
        line: {
          DEFAULT: "#1F2A3D",
          strong: "#334155", // borders (slate-700)
        },
        content: {
          DEFAULT: "#F8FAFC", // text
          muted: "#94A3B8", // slate-400
          faint: "#64748B", // slate-500
        },
        accent: {
          DEFAULT: "#6366F1", // indigo — tech blue/purple brand
          hover: "#4F46E5",
          soft: "rgba(99,102,241,0.15)",
        },
        info: "#38BDF8",
        warn: "#FBBF24",
        danger: "#F43F5E",
      },
      fontFamily: {
        sans: ["IBM Plex Sans", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "Menlo", "monospace"],
      },
      borderRadius: {
        xl: "0.75rem",
      },
      transitionDuration: {
        DEFAULT: "200ms",
      },
      keyframes: {
        "fade-in": {
          "0%": { opacity: "0", transform: "translateY(4px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "pulse-dot": {
          "0%,100%": { opacity: "1" },
          "50%": { opacity: "0.35" },
        },
      },
      animation: {
        "fade-in": "fade-in 180ms ease-out",
        "pulse-dot": "pulse-dot 1.6s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};
