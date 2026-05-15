export type ThemeAppearance = "system" | "light" | "dark";
export type ResolvedThemeAppearance = "light" | "dark";
export type ThemeSource = "builtin" | "custom";

export interface ThemeMargins {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface ThemeFonts {
  ui: string;
  editor: string;
  preview: string;
  code: string;
}

export interface ThemeMermaidConfig {
  theme: "default" | "dark" | "neutral" | "forest" | "base";
  variables?: Record<string, string>;
}

export interface ThemeVariant {
  fonts?: Partial<ThemeFonts>;
  margins?: Partial<ThemeMargins>;
  tokens?: Record<string, string>;
  mermaid?: ThemeMermaidConfig;
}

export interface ThemeDefinition {
  id: string;
  name: string;
  description: string;
  source?: ThemeSource;
  version?: string;
  fonts?: Partial<ThemeFonts>;
  margins?: Partial<ThemeMargins>;
  variants: {
    light: ThemeVariant;
    dark: ThemeVariant;
  };
}

export interface ThemeValidationError {
  themeId?: string;
  filePath?: string;
  message: string;
}

export interface ThemeRegistryEntry {
  id: string;
  name: string;
  description: string;
  source: ThemeSource;
  version: string;
}

export interface ResolvedTheme {
  id: string;
  name: string;
  description: string;
  source: ThemeSource;
  version: string;
  appearance: ThemeAppearance;
  resolvedAppearance: ResolvedThemeAppearance;
  fonts: ThemeFonts;
  margins: ThemeMargins;
  tokens: Record<string, string>;
  mermaid: ThemeMermaidConfig;
}

export interface ThemeState {
  activeThemeId: string;
  appearance: ThemeAppearance;
  resolvedTheme: ResolvedTheme;
  themes: ThemeRegistryEntry[];
  validationErrors: ThemeValidationError[];
}
