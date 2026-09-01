"use client";

import { useEffect, useState } from "react";
import { Palette } from "lucide-react";

type Theme = "dim" | "solarized" | "sepia";

export default function ThemeSwitcher() {
  const [mounted, setMounted] = useState(false);
  const [theme, setTheme] = useState<Theme>("dim");
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setMounted(true);
    const storedTheme = localStorage.getItem("theme") as Theme | null;
    const currentTheme = storedTheme || "dim";
    setTheme(currentTheme);
  }, []);

  const changeTheme = (newTheme: Theme) => {
    setTheme(newTheme);
    localStorage.setItem("theme", newTheme);
    document.documentElement.setAttribute("data-theme", newTheme);
    setOpen(false);
  };

  if (!mounted) {
    return <div className="w-8 h-8" />;
  }

  return (
    <div className="relative inline-block">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label="Cambiar tema"
        className="p-2 bg-[var(--surface-2)] text-[var(--text-muted)] hover:text-[var(--accent)] rounded-[var(--radius-sm)] border border-transparent hover:border-[var(--border)] transition-colors flex items-center justify-center"
      >
        <Palette className="w-4 h-4" />
      </button>

      <div
        className={`absolute right-0 mt-2 w-48 bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius)] shadow-xl transition-all z-50 overflow-hidden ${
          open ? "opacity-100 visible" : "opacity-0 invisible"
        }`}
      >
        <div className="p-1">
          <button
            onClick={() => changeTheme("dim")}
            className={`w-full text-left px-3 py-2 text-sm rounded-[var(--radius-sm)] flex items-center gap-2 transition-colors ${
              theme === "dim" ? "bg-[var(--accent)]/10 text-[var(--accent)] font-medium" : "text-[var(--text-muted)] hover:bg-[var(--surface-2)] hover:text-[var(--text)]"
            }`}
          >
            <div className="w-3 h-3 rounded-full bg-[#313338] border border-[#4E5058]" />
            Dim (Oscuro)
          </button>
          <button
            onClick={() => changeTheme("solarized")}
            className={`w-full text-left px-3 py-2 text-sm rounded-[var(--radius-sm)] flex items-center gap-2 transition-colors mt-1 ${
              theme === "solarized" ? "bg-[var(--accent)]/10 text-[var(--accent)] font-medium" : "text-[var(--text-muted)] hover:bg-[var(--surface-2)] hover:text-[var(--text)]"
            }`}
          >
            <div className="w-3 h-3 rounded-full bg-[#002B36] border border-[#215A68]" />
            Solarized
          </button>
          <button
            onClick={() => changeTheme("sepia")}
            className={`w-full text-left px-3 py-2 text-sm rounded-[var(--radius-sm)] flex items-center gap-2 transition-colors mt-1 ${
              theme === "sepia" ? "bg-[var(--accent)]/10 text-[var(--accent)] font-medium" : "text-[var(--text-muted)] hover:bg-[var(--surface-2)] hover:text-[var(--text)]"
            }`}
          >
            <div className="w-3 h-3 rounded-full bg-[#3E2723] border border-[#6D4C41]" />
            Sepia
          </button>
        </div>
      </div>
    </div>
  );
}
