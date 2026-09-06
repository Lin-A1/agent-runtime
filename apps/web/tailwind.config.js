/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: ["selector", '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        // Semantic tokens. Values live in index.css as RGB triplets
        // (`--x-rgb`), which lets Tailwind's opacity modifiers (`line/40`,
        // `bg-surface/80`, …) emit real `rgb(var(--x-rgb) / alpha)` colors.
        // Full-color aliases (`--bg`, `--line`, …) stay available for plain
        // CSS and inline styles.
        bg: "rgb(var(--bg-rgb) / <alpha-value>)",
        bg2: "rgb(var(--bg2-rgb) / <alpha-value>)",
        panel: "rgb(var(--panel-rgb) / <alpha-value>)",
        side: "rgb(var(--sidebar-rgb) / <alpha-value>)",
        card: "rgb(var(--card-rgb) / <alpha-value>)",
        cardhover: "rgb(var(--card-hover-rgb) / <alpha-value>)",
        "card-hover": "rgb(var(--card-hover-rgb) / <alpha-value>)",
        surface: "rgb(var(--surface-rgb) / <alpha-value>)",
        hover: "rgb(var(--hover-rgb) / calc(var(--hover-alpha) * <alpha-value>))",
        "hover-2": "rgb(var(--hover-2-rgb) / calc(var(--hover-2-alpha) * <alpha-value>))",
        line: "rgb(var(--line-rgb) / <alpha-value>)",
        linestrong: "rgb(var(--line-strong-rgb) / <alpha-value>)",
        "line-strong": "rgb(var(--line-strong-rgb) / <alpha-value>)",
        fg: "rgb(var(--txt-rgb) / <alpha-value>)",
        dim: "rgb(var(--txt-dim-rgb) / <alpha-value>)",
        faint: "rgb(var(--txt-faint-rgb) / <alpha-value>)",
        ghost: "rgb(var(--txt-ghost-rgb) / <alpha-value>)",
        accent: "rgb(var(--accent-rgb) / <alpha-value>)",
        accentstrong: "rgb(var(--accent-strong-rgb) / <alpha-value>)",
        "accent-strong": "rgb(var(--accent-strong-rgb) / <alpha-value>)",
        onaccent: "rgb(var(--on-accent-rgb) / <alpha-value>)",
        "on-accent": "rgb(var(--on-accent-rgb) / <alpha-value>)",
        interactive: "rgb(var(--interactive-rgb) / <alpha-value>)",
        ok: "rgb(var(--ok-rgb) / <alpha-value>)",
        warn: "rgb(var(--warn-rgb) / <alpha-value>)",
        bad: "rgb(var(--bad-rgb) / <alpha-value>)",
        // BeautifulUI ported surface/ink tokens (ToolTrace / ThinkingTrace)
        field: "rgb(var(--field-rgb) / <alpha-value>)",
        inset: "rgb(var(--inset-rgb) / <alpha-value>)",
        ink: "rgb(var(--ink-rgb) / <alpha-value>)",
        "ink-2": "rgb(var(--ink-2-rgb) / <alpha-value>)",
        "ink-3": "rgb(var(--ink-3-rgb) / <alpha-value>)",
        // semantic accent colors (goal pill, access pill, failure marks)
        green: "rgb(var(--green-rgb) / <alpha-value>)",
        "green-tint": "rgb(var(--green-rgb) / 0.13)",
        orange: "rgb(var(--orange-rgb) / <alpha-value>)",
        "orange-tint": "rgb(var(--orange-rgb) / 0.13)",
        red: "rgb(var(--red-rgb) / <alpha-value>)",
        trajuser: "rgb(var(--traj-user-rgb) / <alpha-value>)",
        trajassistant: "rgb(var(--traj-assistant-rgb) / <alpha-value>)",
        trajreasoning: "rgb(var(--traj-reasoning-rgb) / <alpha-value>)",
        trajtool: "rgb(var(--traj-tool-rgb) / <alpha-value>)",
        trajresult: "rgb(var(--traj-tool-result-rgb) / <alpha-value>)",
      },
      fontFamily: {
        sans: "var(--font-sans)",
        mono: "var(--font-mono)",
      },
      fontSize: {
        // Exact ZCode ladder: 11/12/13/14
        "2xs": ["0.6875rem", "1rem"],
        xs: ["0.75rem", "1.1rem"],
        sm: ["0.8125rem", "1.25rem"],
        base: ["0.875rem", "1.5rem"],
      },
      borderRadius: {
        sm: "0.25rem",
        DEFAULT: "0.375rem",
        lg: "0.5rem",
        xl: "0.75rem",
        chip: "6px",
        control: "8px",
      },
      boxShadow: {
        hairline: "var(--shadow-hairline)",
        card: "var(--shadow-card)",
        raised: "var(--shadow-raised)",
        overlay: "var(--shadow-overlay)",
      },
      transitionDuration: {
        "250": "250ms",
      },
    },
  },
  plugins: [],
}
