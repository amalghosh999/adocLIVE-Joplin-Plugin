import { VISUAL_CANDIDATE_IDS } from "./contracts";

export interface VisualScenarioDescriptor {
  id: (typeof VISUAL_CANDIDATE_IDS)[number];
  fileName: `${(typeof VISUAL_CANDIDATE_IDS)[number]}.png`;
  scenario: string;
}

const scenarioGroups: Record<(typeof VISUAL_CANDIDATE_IDS)[number], string> = {
  "block-gallery": "block-gallery",
  "block-editor-modal": "tables-code/block-editor-modal",
  "dark-live-preview": "inline-sections/dark/live-preview",
  "floating-section-preview": "tables-code/floating-section-preview",
  "footnote-popup": "tables-code/footnote-popup",
  "high-contrast-live-preview": "inline-sections/high-contrast/live-preview",
  "light-live-preview": "inline-sections/light/live-preview",
  "light-preview": "inline-sections/light/preview",
  "light-raw": "inline-sections/light/raw",
  "light-split": "inline-sections/light/split",
  "narrow-high-contrast": "inline-sections/high-contrast/375x667",
  "search-ui": "tables-code/search-ui",
  "toolbar-dropdown": "tables-code/toolbar-dropdown",
};

export const VISUAL_SCENARIOS: readonly VisualScenarioDescriptor[] = VISUAL_CANDIDATE_IDS.map(id => ({
  id,
  fileName: `${id}.png`,
  scenario: scenarioGroups[id],
}));

export function visualScenario(id: (typeof VISUAL_CANDIDATE_IDS)[number]): VisualScenarioDescriptor {
  const descriptor = VISUAL_SCENARIOS.find(candidate => candidate.id === id);
  if (!descriptor) throw new Error(`Unknown visual scenario: ${id}`);
  return descriptor;
}
