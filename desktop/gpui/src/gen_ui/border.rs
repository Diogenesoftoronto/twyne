//! Paint the Source card's left border at its outer edge without changing layout.
use gpui_kit::{
    AnyElement, App, Bounds, Corners, Element, ElementId, FocusHandle, GlobalElementId,
    InspectorElementId, IntoElement, LayoutId, Pixels, Window, fill, px, rgb, size,
};

pub(super) fn accent_border(child: impl IntoElement, color: u32) -> AnyElement {
    AccentBorder {
        child: child.into_any_element(),
        color,
    }
    .into_any_element()
}

struct AccentBorder {
    child: AnyElement,
    color: u32,
}

impl IntoElement for AccentBorder {
    type Element = Self;
    fn into_element(self) -> Self {
        self
    }
}

impl Element for AccentBorder {
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
        _: &mut Self::PrepaintState,
        window: &mut Window,
        cx: &mut App,
    ) {
        self.child.paint(window, cx);
        window.paint_quad(
            fill(
                Bounds::new(bounds.origin, size(px(3.), bounds.size.height)),
                rgb(self.color),
            )
            .corner_radii(Corners {
                top_left: px(2.),
                top_right: px(0.),
                bottom_left: px(2.),
                bottom_right: px(0.),
            }),
        );
    }
}
