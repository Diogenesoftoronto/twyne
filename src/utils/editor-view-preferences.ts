export const EDITOR_VIEW_PREFERENCES_KEY = "twyne:editor:view:v1";
export interface EditorViewPreferences {
  zenMode: boolean;
  compositorOpen: boolean;
}
export const DEFAULT_EDITOR_VIEW_PREFERENCES: EditorViewPreferences = {
  zenMode: true,
  compositorOpen: false,
};

/** Device-local presentation only; never stores manuscript or account data. */
export function loadEditorViewPreferences(
  storage: Pick<Storage, "getItem">,
): EditorViewPreferences {
  try {
    const saved = JSON.parse(
      storage.getItem(EDITOR_VIEW_PREFERENCES_KEY) ?? "null",
    );
    return {
      zenMode: typeof saved?.zenMode === "boolean" ? saved.zenMode : true,
      compositorOpen:
        typeof saved?.compositorOpen === "boolean"
          ? saved.compositorOpen
          : false,
    };
  } catch {
    return { ...DEFAULT_EDITOR_VIEW_PREFERENCES };
  }
}

export function saveEditorViewPreferences(
  storage: Pick<Storage, "setItem">,
  preferences: EditorViewPreferences,
): void {
  try {
    storage.setItem(EDITOR_VIEW_PREFERENCES_KEY, JSON.stringify(preferences));
  } catch {
    // Tools stay available when private browsing or quota prevents persistence.
  }
}
