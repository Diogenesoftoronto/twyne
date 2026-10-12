//! CSS focus outlines painted around the existing native control geometry.

use gpui_kit::{
    AnyElement, App, BorderStyle, Bounds, Element, ElementId, FocusHandle, GlobalElementId,
    InspectorElementId, IntoElement, LayoutId, Pixels, Window, outline, px, rgb,
};

/// Forward the real control's layout, input and accessibility subtree. The
/// outline takes no space and follows native keyboard focus rather than clicks.
pub fn focus_outline(
    element: impl IntoElement,
    offset: f32,
    radius: f32,
    color: u32,
) -> AnyElement {
    FocusOutline {
        child: element.into_any_element(),
        offset,
        radius,
        color,
    }
    .into_any_element()
}

struct FocusOutline {
    child: AnyElement,
    offset: f32,
    radius: f32,
    color: u32,
}

impl IntoElement for FocusOutline {
    type Element = Self;

    fn into_element(self) -> Self {
        self
    }
}

impl Element for FocusOutline {
    type RequestLayoutState = ();
    type PrepaintState = Option<FocusHandle>;

    fn id(&self) -> Option<ElementId> {
        None
    }

    fn source_location(&self) -> Option<&'static core::panic::Location<'static>> {
        None
    }

    fn request_layout(
        &mut self,
        _: Option<&GlobalElementId>,
        _: Option<&InspectorElementId>,
        window: &mut Window,
        cx: &mut App,
    ) -> (LayoutId, Self::RequestLayoutState) {
        (self.child.request_layout(window, cx), ())
    }

    fn prepaint(
        &mut self,
        _: Option<&GlobalElementId>,
        _: Option<&InspectorElementId>,
        _: Bounds<Pixels>,
        _: &mut Self::RequestLayoutState,
        window: &mut Window,
        cx: &mut App,
    ) -> Self::PrepaintState {
        self.child.prepaint(window, cx)
    }

    fn paint(
        &mut self,
        _: Option<&GlobalElementId>,
        _: Option<&InspectorElementId>,
        bounds: Bounds<Pixels>,
        _: &mut Self::RequestLayoutState,
        focus: &mut Self::PrepaintState,
        window: &mut Window,
        cx: &mut App,
    ) {
        self.child.paint(window, cx);
        if window.last_input_was_keyboard()
            && focus.as_ref().is_some_and(|focus| focus.is_focused(window))
        {
            let extent = self.offset + 2.;
            window.paint_quad(
                outline(
                    bounds.dilate(px(extent)),
                    rgb(self.color),
                    BorderStyle::default(),
                )
                .border_widths(px(2.))
                .corner_radii(px((self.radius + extent).max(0.))),
            );
        }
    }
}
