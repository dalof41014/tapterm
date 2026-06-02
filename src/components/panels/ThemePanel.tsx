import { Check, Palette, Type } from "lucide-react";
import { useStore } from "../../store/useStore";
import { THEMES } from "../../lib/themes";
import { FONTS } from "../../lib/fonts";
import type { ITheme } from "@xterm/xterm";

function Preview({ t }: { t: ITheme }) {
  const fg = (o: number) => ({ background: t.foreground, opacity: o });
  return (
    <div
      className="relative h-16 w-24 shrink-0 overflow-hidden rounded-lg border border-line-strong"
      style={{ background: t.background }}
    >
      <div className="space-y-1.5 p-2">
        <div className="flex gap-1">
          <span className="h-1.5 w-4 rounded-full" style={{ background: t.green }} />
          <span className="h-1.5 w-10 rounded-full" style={fg(0.85)} />
        </div>
        <span className="block h-1.5 w-14 rounded-full" style={fg(0.5)} />
        <div className="flex gap-1">
          <span className="h-1.5 w-3 rounded-full" style={{ background: t.blue }} />
          <span className="h-1.5 w-6 rounded-full" style={fg(0.6)} />
          <span className="h-1.5 w-3 rounded-full" style={{ background: t.red }} />
        </div>
      </div>
      <div className="absolute bottom-0 left-0 right-0 flex h-1.5">
        {[t.red, t.green, t.yellow, t.blue, t.magenta, t.cyan].map((c, i) => (
          <span key={i} className="flex-1" style={{ background: c }} />
        ))}
      </div>
    </div>
  );
}

export function ThemePanel() {
  const themeId = useStore((s) => s.terminalThemeId);
  const setTerminalTheme = useStore((s) => s.setTerminalTheme);
  const fontId = useStore((s) => s.terminalFontId);
  const setTerminalFont = useStore((s) => s.setTerminalFont);

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-12 items-center gap-2 border-b border-line px-4">
        <Palette size={16} className="text-accent" />
        <span className="text-sm font-semibold">Appearance</span>
      </div>

      <div className="border-b border-line p-3">
        <label className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-content-faint">
          <Type size={12} /> Font (default)
        </label>
        <select
          className="input py-1.5 text-xs"
          value={fontId}
          onChange={(e) => setTerminalFont(e.target.value)}
          style={{ fontFamily: FONTS.find((f) => f.id === fontId)?.family }}
        >
          {FONTS.map((f) => (
            <option key={f.id} value={f.id} style={{ fontFamily: f.family }}>
              {f.name}
            </option>
          ))}
        </select>
        <p className="mt-2 rounded bg-bg-inset px-2 py-1.5 text-[13px] text-content-muted" style={{ fontFamily: FONTS.find((f) => f.id === fontId)?.family }}>
          {`const x = () => { return 0 == 1; }; // 0O1lI`}
        </p>
      </div>

      <div className="px-3 pt-2 text-[10px] font-semibold uppercase tracking-wide text-content-faint">Theme</div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {THEMES.map((t) => {
          const active = themeId === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setTerminalTheme(t.id)}
              className={`mb-1 flex w-full items-center gap-3 rounded-xl p-2 text-left transition-colors duration-150 ${
                active ? "bg-surface ring-1 ring-inset ring-accent/40" : "hover:bg-surface-hover"
              }`}
            >
              <Preview t={t.theme} />
              <span className="min-w-0 flex-1 truncate text-sm text-content">{t.name}</span>
              {active && <Check size={16} className="shrink-0 text-accent" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}
