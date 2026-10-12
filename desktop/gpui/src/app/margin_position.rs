//! The current manuscript conversation placement contract. Text coordinates
//! come from native layout; these calculations neither find nor edit text.

const CARD_WIDTH: f32 = 340.;
const POPOVER_MARGIN: f32 = 8.;
const MARGIN_GAP: f32 = 12.;

#[derive(Clone, Copy, Debug)]
pub(super) struct MarginAnchor {
    pub(super) left: f32,
    pub(super) top: f32,
    pub(super) bottom: f32,
}

#[derive(Clone, Copy, Debug)]
pub(super) struct MarginViewport {
    pub(super) width: f32,
    pub(super) height: f32,
    pub(super) page_left: f32,
    pub(super) page_right: f32,
    pub(super) scroll_top: f32,
    pub(super) scroll_bottom: f32,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub(super) struct MarginPosition {
    pub(super) x: f32,
    pub(super) top: Option<f32>,
    pub(super) bottom: Option<f32>,
    pub(super) max_height: f32,
}

fn popover(anchor: MarginAnchor, view: MarginViewport, ideal: f32) -> MarginPosition {
    let x = anchor
        .left
        .min(view.width - CARD_WIDTH - POPOVER_MARGIN)
        .max(POPOVER_MARGIN);
    let below_top = anchor.bottom + POPOVER_MARGIN;
    let above_bottom = anchor.top - POPOVER_MARGIN;
    let below = (view.height - POPOVER_MARGIN - below_top).max(0.);
    let above = (above_bottom - POPOVER_MARGIN).max(0.);
    if below < ideal && above > below {
        MarginPosition {
            x,
            top: None,
            bottom: Some((view.height - anchor.top + POPOVER_MARGIN).max(0.)),
            max_height: ideal.min(above).max(0.),
        }
    } else {
        MarginPosition {
            x,
            top: Some(below_top),
            bottom: None,
            max_height: ideal.min(below).max(0.),
        }
    }
}

fn margin(anchor: MarginAnchor, view: MarginViewport, ideal: f32) -> MarginPosition {
    let right = view.page_right + MARGIN_GAP;
    let left = view.page_left - CARD_WIDTH - MARGIN_GAP;
    let x = if right + CARD_WIDTH <= view.width - MARGIN_GAP {
        right
    } else if left >= MARGIN_GAP {
        left
    } else {
        let x = if view.width - view.page_right >= view.page_left {
            right
        } else {
            left
        }
        .min(view.width - CARD_WIDTH - MARGIN_GAP)
        .max(MARGIN_GAP);
        return MarginPosition {
            x,
            ..popover(anchor, view, ideal)
        };
    };
    let max_height = ideal.min(view.height - MARGIN_GAP * 2.).max(0.);
    MarginPosition {
        x,
        top: Some(
            anchor
                .top
                .min(view.height - max_height - MARGIN_GAP)
                .max(MARGIN_GAP),
        ),
        bottom: None,
        max_height,
    }
}

/// Idle conversations close when their subject is offscreen; a composing or
/// held-reply conversation follows the visible edge without losing its draft.
pub(super) fn fallback(
    anchor: MarginAnchor,
    view: MarginViewport,
    ideal: f32,
    keep_open: bool,
) -> Option<MarginPosition> {
    let viewport_top = view.scroll_top.max(0.);
    let viewport_bottom = view.scroll_bottom.min(view.height);
    let outside = anchor.bottom <= viewport_top || anchor.top >= viewport_bottom;
    if outside && !keep_open {
        return None;
    }
    let edge = if anchor.bottom <= viewport_top {
        viewport_top + POPOVER_MARGIN
    } else {
        viewport_bottom - POPOVER_MARGIN
    };
    let mut position = margin(
        if outside {
            MarginAnchor {
                left: anchor.left,
                top: edge,
                bottom: edge,
            }
        } else {
            anchor
        },
        view,
        ideal,
    );
    position.max_height = position
        .max_height
        .min((viewport_bottom - viewport_top - POPOVER_MARGIN * 2.).max(0.));
    let clamp = |value: f32, low: f32, high: f32| value.min(high.max(low)).max(low);
    position.top = position.top.map(|top| {
        clamp(
            top,
            viewport_top + POPOVER_MARGIN,
            viewport_bottom - position.max_height - POPOVER_MARGIN,
        )
    });
    position.bottom = position.bottom.map(|bottom| {
        clamp(
            bottom,
            view.height - viewport_bottom + POPOVER_MARGIN,
            view.height - viewport_top - position.max_height - POPOVER_MARGIN,
        )
    });
    Some(position)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;
    use sha2::{Digest, Sha256};

    #[test]
    fn native_placement_matches_fifty_executed_original_cases() {
        let fixture: Value = serde_json::from_str(include_str!(
            "../../fixtures/native_margin/position-reference.json"
        ))
        .unwrap();
        let hash = format!(
            "{:x}",
            Sha256::digest(include_bytes!(
                "../../../../src/components/editor/popover-positioning.ts"
            ))
        );
        assert_eq!(fixture["sourceSha256"].as_str(), Some(hash.as_str()));
        let number = |value: &Value| value.as_f64().unwrap() as f32;
        for case in fixture["cases"].as_array().unwrap() {
            let input = &case["input"];
            let result = fallback(
                MarginAnchor {
                    left: number(&input["rect"]["left"]),
                    top: number(&input["rect"]["top"]),
                    bottom: number(&input["rect"]["bottom"]),
                },
                MarginViewport {
                    width: number(&input["vw"]),
                    height: number(&input["vh"]),
                    page_left: number(&input["page"]["left"]),
                    page_right: number(&input["page"]["right"]),
                    scroll_top: number(&input["viewport"]["top"]),
                    scroll_bottom: number(&input["viewport"]["bottom"]),
                },
                number(&input["idealH"]),
                input["keepOpen"].as_bool().unwrap(),
            );
            let expected = &case["expected"];
            assert_eq!(result.is_none(), expected.is_null(), "{}", case["name"]);
            if let Some(result) = result {
                for (field, actual) in [
                    ("x", Some(result.x)),
                    ("top", result.top),
                    ("bottom", result.bottom),
                    ("maxH", Some(result.max_height)),
                ] {
                    let expected = expected[field].as_f64().map(|n| n as f32);
                    assert_eq!(
                        actual.is_none(),
                        expected.is_none(),
                        "{} {field}",
                        case["name"]
                    );
                    if let (Some(actual), Some(expected)) = (actual, expected) {
                        assert!(
                            (actual - expected).abs() < 0.001,
                            "{} {field}: {actual} != {expected}",
                            case["name"]
                        );
                    }
                }
            }
        }
    }
}
