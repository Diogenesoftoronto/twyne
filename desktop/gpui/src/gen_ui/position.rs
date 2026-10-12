pub const CARD_WIDTH: f32 = 296.0;
pub const RAIL_GAP: f32 = 28.0;
pub const SHELF_WIDTH: f32 = 176.0;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Rect {
    pub left: f32,
    pub top: f32,
    pub right: f32,
    pub bottom: f32,
}

impl Rect {
    pub fn width(&self) -> f32 {
        self.right - self.left
    }

    pub fn height(&self) -> f32 {
        self.bottom - self.top
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Viewport {
    pub width: f32,
    pub height: f32,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Position {
    pub rail: bool,
    pub shelf: bool,
    pub x: f32,
    pub top: f32,
    pub connector_top: f32,
}

pub fn position(canvas: Rect, scroller: Rect, anchor: Rect, viewport: Viewport) -> Position {
    let margin_right = scroller.right - canvas.right;
    let margin_left = canvas.left - scroller.left;

    let rail = margin_right >= CARD_WIDTH + RAIL_GAP + 8.0;
    let shelf = margin_left >= SHELF_WIDTH + RAIL_GAP;

    let anchor_top = anchor.top - canvas.top;
    let anchor_height = anchor.height();
    let card_top = (anchor_top - 6.0).max(0.0);
    let connector_top = anchor.top + (anchor_height / 2.0).min(12.0);

    if rail {
        Position {
            rail: true,
            shelf,
            x: canvas.right + RAIL_GAP,
            top: canvas.top + card_top,
            connector_top,
        }
    } else {
        let pop_left = anchor
            .left
            .min(viewport.width - CARD_WIDTH - 12.0)
            .max(12.0);
        let pop_top = (anchor.bottom + 10.0)
            .min(viewport.height - 120.0)
            .max(12.0);
        Position {
            rail: false,
            shelf,
            x: pop_left,
            top: pop_top,
            connector_top,
        }
    }
}
