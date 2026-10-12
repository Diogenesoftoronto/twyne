//! Native select semantics on Kit's existing dropdown trigger.

use gpui_kit::{
    App, InteractiveElement, Interactivity, IntoElement, RenderOnce, SharedString,
    StatefulInteractiveElement, StyleRefinement, Styled, Window,
    component::{Selectable, button::Button, menu::DropdownMenu},
};

/// Keep the real Button root, focus and input path. Kit's popover supplies its
/// actual open state through `Selectable::open` on every rendered frame.
#[derive(IntoElement)]
pub struct PageSelectorTrigger {
    button: Button,
}

impl PageSelectorTrigger {
    pub fn new(button: Button, value: impl Into<SharedString>) -> Self {
        Self { button }.aria_value(value).aria_expanded(false)
    }
}

impl Styled for PageSelectorTrigger {
    fn style(&mut self) -> &mut StyleRefinement {
        self.button.style()
    }
}

impl InteractiveElement for PageSelectorTrigger {
    fn interactivity(&mut self) -> &mut Interactivity {
        self.button.interactivity()
    }
}

impl StatefulInteractiveElement for PageSelectorTrigger {}

impl Selectable for PageSelectorTrigger {
    fn selected(mut self, selected: bool) -> Self {
        self.button = self.button.selected(selected);
        self
    }

    fn is_selected(&self) -> bool {
        self.button.is_selected()
    }

    fn open(mut self, open: bool) -> Self {
        self.button = self.button.open(open);
        self.aria_expanded(open)
    }

    fn is_open(&self) -> bool {
        self.button.is_open()
    }
}

impl DropdownMenu for PageSelectorTrigger {}

impl RenderOnce for PageSelectorTrigger {
    fn render(self, _: &mut Window, _: &mut App) -> impl IntoElement {
        self.button
    }
}
