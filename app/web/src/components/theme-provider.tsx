import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { fetchUserAttributes, updateUserAttributes } from "aws-amplify/auth";

type Theme = "dark" | "light" | "system";

type ThemeProviderProps = {
  children: React.ReactNode;
  defaultTheme?: Theme;
  storageKey?: string;
};

type ThemeProviderState = {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  syncing: boolean;
};

const initialState: ThemeProviderState = {
  theme: "system",
  setTheme: () => null,
  syncing: false,
};

const ThemeProviderContext = createContext<ThemeProviderState>(initialState);

export function ThemeProvider({
  children,
  defaultTheme = "system",
  storageKey = "vite-ui-theme",
  ...props
}: ThemeProviderProps) {
  const [theme, setThemeState] = useState<Theme>(
    () => (localStorage.getItem(storageKey) as Theme) || defaultTheme
  );
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    const root = window.document.documentElement;

    root.classList.remove("light", "dark");

    if (theme === "system") {
      const systemTheme = window.matchMedia("(prefers-color-scheme: dark)")
        .matches
        ? "dark"
        : "light";

      root.classList.add(systemTheme);
      return;
    }

    root.classList.add(theme);
  }, [theme]);

  // On mount, try to load the theme preference from Cognito
  useEffect(() => {
    (async () => {
      try {
        const attrs = await fetchUserAttributes();
        const saved = attrs["custom:theme"] as Theme | undefined;
        if (saved && ["dark", "light", "system"].includes(saved)) {
          localStorage.setItem(storageKey, saved);
          setThemeState(saved);
        }
      } catch {
        // User not signed in yet or attribute not set — use localStorage value
      }
    })();
  }, [storageKey]);

  const setTheme = useCallback(
    (newTheme: Theme) => {
      localStorage.setItem(storageKey, newTheme);
      setThemeState(newTheme);

      // Persist to Cognito in the background
      setSyncing(true);
      updateUserAttributes({
        userAttributes: { "custom:theme": newTheme },
      })
        .catch(() => {})
        .finally(() => setSyncing(false));
    },
    [storageKey]
  );

  const value = {
    theme,
    setTheme,
    syncing,
  };

  return (
    <ThemeProviderContext.Provider {...props} value={value}>
      {children}
    </ThemeProviderContext.Provider>
  );
}

export const useTheme = () => {
  const context = useContext(ThemeProviderContext);

  if (context === undefined)
    throw new Error("useTheme must be used within a ThemeProvider");

  return context;
};
