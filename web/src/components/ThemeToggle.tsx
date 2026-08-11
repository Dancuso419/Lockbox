import { Moon, Sun } from "lucide-react";
import { useTheme } from "@/lib/theme";

export default function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const isDark = theme === "dark";
  return (
    <button
      onClick={(e) => {
        // Reveal from the switch itself. Keyboard activation reports 0,0 for
        // clientX/Y, so fall back to the button's own centre.
        const r = e.currentTarget.getBoundingClientRect();
        const fromPointer = e.clientX !== 0 || e.clientY !== 0;
        toggle({
          x: fromPointer ? e.clientX : r.left + r.width / 2,
          y: fromPointer ? e.clientY : r.top + r.height / 2,
        });
      }}
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
      className="grid size-9 place-items-center rounded-full border border-border text-foreground/70 transition-colors hover:text-foreground hover:border-border-strong"
    >
      <span className="relative block size-4">
        <Sun
          className={`absolute inset-0 size-4 transition-all duration-300 ${
            isDark ? "rotate-90 scale-0 opacity-0" : "rotate-0 scale-100 opacity-100"
          }`}
        />
        <Moon
          className={`absolute inset-0 size-4 transition-all duration-300 ${
            isDark ? "rotate-0 scale-100 opacity-100" : "-rotate-90 scale-0 opacity-0"
          }`}
        />
      </span>
    </button>
  );
}
