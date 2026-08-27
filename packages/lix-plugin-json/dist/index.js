import { applyChanges } from "./applyChanges.js";
import { detectChanges } from "./detectChanges.js";

export const plugin = {
  key: "plugin_json",
  detectChangesGlob: "*.json",
  applyChanges,
  detectChanges,
};
