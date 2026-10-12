
#[cfg(test)]
mod destination_multiply_tests {
    use super::*;
    use crate::{AtlasTextureKind, DevicePixels, TileId, size};

    fn bounds() -> Bounds<ScaledPixels> {
        Bounds::new(point(ScaledPixels(0.), ScaledPixels(0.)), size(ScaledPixels(64.), ScaledPixels(64.)))
    }

    fn sprite(tile_id: u32, blend: PolychromeSpriteBlend) -> PolychromeSprite {
        PolychromeSprite {
            order: 0, blend, grayscale: false.into(), opacity: 0.7,
            bounds: bounds(), content_mask: ContentMask { bounds: bounds() },
            corner_radii: Default::default(),
            tile: AtlasTile {
                texture_id: AtlasTextureId { index: 0, kind: AtlasTextureKind::Polychrome },
                tile_id: TileId(tile_id), padding: 0,
                bounds: Bounds::new(point(DevicePixels(0), DevicePixels(0)), size(DevicePixels(64), DevicePixels(64))),
            },
        }
    }

    #[test]
    fn opaque_backdrop_and_normal_image_precede_separate_multiply_layer() {
        let mut scene = Scene::default();
        scene.push_layer(bounds());
        scene.insert_primitive(Quad { bounds: bounds(), content_mask: ContentMask { bounds: bounds() }, ..Quad::default() });
        scene.insert_primitive(sprite(9, PolychromeSpriteBlend::SourceOver));
        // The new Window paint API nests a fresh layer for the LAST overlay.
        scene.push_layer(bounds());
        scene.insert_primitive(sprite(1, PolychromeSpriteBlend::DestinationMultiply));
        scene.pop_layer();
        scene.pop_layer();
        scene.finish();
        let overlay = &scene.polychrome_sprites[1];
        assert!(scene.quads[0].order < overlay.order);
        assert!(scene.polychrome_sprites[0].order < overlay.order);
        let batches: Vec<_> = scene.batches().collect();
        assert_eq!(batches.len(), 3);
        assert!(matches!(&batches[2], PrimitiveBatch::PolychromeSprites { range, .. } if range == &(1..2)));
    }

    #[test]
    fn sprite_texture_sort_cannot_cross_a_blend_transition() {
        let mut scene = Scene::default();
        scene.push_layer(bounds());
        for (id, blend) in [(9, PolychromeSpriteBlend::SourceOver), (2, PolychromeSpriteBlend::DestinationMultiply), (1, PolychromeSpriteBlend::SourceOver)] {
            scene.insert_primitive(sprite(id, blend));
        }
        scene.pop_layer();
        scene.finish();
        assert_eq!(scene.polychrome_sprites.iter().map(|s| s.tile.tile_id.0).collect::<Vec<_>>(), [9, 2, 1]);
        assert_eq!(scene.batches().count(), 3);
        assert_eq!(std::mem::size_of::<PolychromeSprite>(), 96);
        assert_eq!(std::mem::size_of::<PolychromeSpriteBlend>(), 4);
    }

    #[test]
    fn ordinary_only_draw_orders_keep_the_pinned_tile_sort_even_with_an_overlay() {
        for add_overlay in [false, true] {
            let mut scene = Scene::default();
            scene.push_layer(bounds());
            for id in [9, 2, 1] {
                scene.insert_primitive(sprite(id, PolychromeSpriteBlend::SourceOver));
            }
            if add_overlay {
                scene.push_layer(bounds());
                scene.insert_primitive(sprite(0, PolychromeSpriteBlend::DestinationMultiply));
                scene.pop_layer();
            }
            scene.pop_layer();
            scene.finish();
            assert_eq!(scene.polychrome_sprites[..3].iter().map(|s| s.tile.tile_id.0).collect::<Vec<_>>(), [1, 2, 9]);
        }
    }
}
