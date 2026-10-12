//! Device-local presentation state, following the web writing desk.
//!
//! These choices never belong to a folio or its exported document.

use serde::{Deserialize, Deserializer, Serialize};
use serde_json::Value;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EditorViewPreferences {
    #[serde(default = "default_zen", deserialize_with = "read_zen")]
    pub zen_mode: bool,
    #[serde(default, deserialize_with = "read_compositor")]
    pub compositor_open: bool,
}

fn default_zen() -> bool {
    true
}

fn read_zen<'de, D: Deserializer<'de>>(deserializer: D) -> Result<bool, D::Error> {
    Ok(Value::deserialize(deserializer)?.as_bool().unwrap_or(true))
}

fn read_compositor<'de, D: Deserializer<'de>>(deserializer: D) -> Result<bool, D::Error> {
    Ok(Value::deserialize(deserializer)?.as_bool().unwrap_or(false))
}

impl Default for EditorViewPreferences {
    fn default() -> Self {
        Self {
            zen_mode: true,
            compositor_open: false,
        }
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum CompositorTab {
    #[default]
    Home,
    Insert,
    Review,
    View,
}

impl CompositorTab {
    pub const ALL: [Self; 4] = [Self::Home, Self::Insert, Self::Review, Self::View];

    pub fn label(self) -> &'static str {
        match self {
            Self::Home => "Home",
            Self::Insert => "Insert",
            Self::Review => "Review",
            Self::View => "View",
        }
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum BoardContext {
    #[default]
    Cast,
    Rubric,
    Marginalia,
    Apparatus,
    Tools,
    Versions,
}

impl BoardContext {
    pub const ALL: [Self; 6] = [
        Self::Cast,
        Self::Rubric,
        Self::Marginalia,
        Self::Apparatus,
        Self::Tools,
        Self::Versions,
    ];

    pub fn label(self) -> &'static str {
        match self {
            Self::Cast => "Cast",
            Self::Rubric => "Rubric",
            Self::Marginalia => "Marginalia",
            Self::Apparatus => "Apparatus",
            Self::Tools => "Tools",
            Self::Versions => "Versions",
        }
    }
}

pub fn folio_number(index: usize) -> String {
    const NUMERALS: [&str; 10] = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];
    NUMERALS
        .get(index)
        .map_or_else(|| (index + 1).to_string(), |value| (*value).into())
}

#[derive(Clone, Debug)]
pub struct DeskState {
    pub preferences: EditorViewPreferences,
    pub zen: bool,
    pub drawer_open: bool,
    pub board_open: bool,
    pub compositor_tab: CompositorTab,
    pub board_context: BoardContext,
    panels_before_zen: Option<(bool, bool)>,
}

impl DeskState {
    pub fn new(preferences: EditorViewPreferences) -> Self {
        Self {
            preferences,
            zen: preferences.zen_mode,
            drawer_open: false,
            board_open: false,
            compositor_tab: CompositorTab::Home,
            board_context: BoardContext::Cast,
            panels_before_zen: preferences.zen_mode.then_some((false, false)),
        }
    }

    /// A panel link changes this visit, without overwriting device preferences.
    pub fn open_linked_panel(&mut self, panel: BoardContext) {
        self.set_zen(false, false);
        self.board_context = panel;
        self.board_open = true;
    }

    pub fn set_zen(&mut self, zen: bool, persist: bool) {
        self.zen = zen;
        if persist {
            self.preferences.zen_mode = zen;
        }
        if zen {
            if self.panels_before_zen.is_none() {
                self.panels_before_zen = Some((self.drawer_open, self.board_open));
                self.drawer_open = false;
                self.board_open = false;
            }
        } else if let Some((drawer, board)) = self.panels_before_zen.take() {
            self.drawer_open = drawer;
            self.board_open = board;
        }
    }

    pub fn toggle_zen(&mut self) {
        self.set_zen(!self.zen, true);
    }

    pub fn compositor_visible(&self) -> bool {
        self.preferences.compositor_open && !self.zen
    }

    pub fn toggle_compositor(&mut self) {
        let opening = !self.preferences.compositor_open || self.zen;
        self.preferences.compositor_open = opening;
        if opening {
            self.set_zen(false, true);
        }
    }

    pub fn close_compositor(&mut self) {
        self.preferences.compositor_open = false;
    }

    pub fn toggle_drawer(&mut self) {
        self.set_zen(false, true);
        self.drawer_open = !self.drawer_open;
    }

    pub fn toggle_board(&mut self) {
        self.set_zen(false, true);
        self.board_open = !self.board_open;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compositor_and_zen_restore_chosen_panels_without_changing_the_tool_choice() {
        let mut desk = DeskState::new(EditorViewPreferences::default());
        assert!(desk.zen);
        assert!(!desk.compositor_visible());
        desk.toggle_compositor();
        assert!(!desk.zen);
        desk.drawer_open = true;
        desk.board_open = true;
        desk.toggle_zen();
        assert!(!desk.drawer_open && !desk.board_open);
        assert!(!desk.compositor_visible());
        desk.toggle_zen();
        assert!(desk.drawer_open && desk.board_open && desk.compositor_visible());
        desk.close_compositor();
        let reloaded = DeskState::new(desk.preferences);
        assert!(!reloaded.zen && !reloaded.compositor_visible());
        assert!(!reloaded.drawer_open && !reloaded.board_open);
    }

    #[test]
    fn panel_link_does_not_replace_the_saved_quiet_default() {
        let mut desk = DeskState::new(EditorViewPreferences::default());
        desk.open_linked_panel(BoardContext::Versions);
        assert!(!desk.zen && desk.board_open);
        assert_eq!(desk.board_context, BoardContext::Versions);
        assert!(DeskState::new(desk.preferences).zen);
    }

    #[test]
    fn old_or_malformed_fields_use_the_web_defaults_individually() {
        let preferences: EditorViewPreferences =
            serde_json::from_str(r#"{"zenMode":"false","compositorOpen":true}"#).unwrap();
        assert_eq!(
            preferences,
            EditorViewPreferences {
                zen_mode: true,
                compositor_open: true
            }
        );
        assert_eq!(
            serde_json::from_str::<EditorViewPreferences>("{}").unwrap(),
            EditorViewPreferences::default()
        );
    }
}
