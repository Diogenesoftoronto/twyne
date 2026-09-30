/** Event and setting names for the in-flow tools, kept dependency-free so the
 * status bar and rubric can reference them without loading the tool catalog. */
export const IN_FLOW_EVENT = "twyne:in-flow";
export const IN_FLOW_OPEN_EVENT = "twyne:in-flow-open";
export const IN_FLOW_SETTING_KEY = "in-flow-tools-enabled";
export const IN_FLOW_SETTING_EVENT = "twyne:in-flow-setting";
/** Automatic focus: the flow conductor reading the keys. */
export const FLOW_SETTING_KEY = "flow-reading-enabled";
export const FLOW_SETTING_EVENT = "twyne:flow-setting";
/** Whether a named book or record may be looked up for its cover. */
export const COVER_LOOKUP_SETTING_KEY = "flow-cover-lookups";
/** Margin geometry changed without an edit to the manuscript. */
export const FLOW_LAYOUT_EVENT = "twyne:flow-layout";
