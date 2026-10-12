// Premultiplied source group -> effective destination factor. Opacity applies
// ONCE to the group, not independently to its five overlapping backgrounds.
@fragment
fn fs_poly_multiply(input: PolySpriteVarying) -> @location(0) vec4<f32> {
    let sprite = load_poly_sprite(input.sprite_id);
    let atlas_size = vec2<f32>(textureDimensions(t_sprite, 0));
    // Atlas tiles have no padding. Clamp to this tile's pixel centers so the
    // linear sampler cannot pick a neighbouring normal-image texel.
    let first_center = (vec2<f32>(sprite.tile.bounds.origin) + vec2<f32>(0.5)) / atlas_size;
    let last_center = (vec2<f32>(sprite.tile.bounds.origin + sprite.tile.bounds.size) - vec2<f32>(0.5)) / atlas_size;
    let sample = textureSample(t_sprite, s_sprite, clamp(input.tile_position, first_center, last_center));
    // Sample before non-uniform clipping so implicit derivatives are valid.
    // Returning zero would erase the destination under multiply; identity is 1.
    if (any(input.clip_distances < vec4<f32>(0.0))) {
        return vec4<f32>(1.0);
    }
    let distance = quad_sdf(input.position.xy, sprite.bounds, sprite.corner_radii);
    let opacity = sprite.opacity * saturate(0.5 - distance);
    let factor = vec3<f32>(1.0 - sample.a * opacity) + sample.rgb * opacity;
    // Do NOT call blend_color: it would premultiply the FACTOR in transparent
    // surface mode. Pipeline color = 0*src + factor*dst, alpha = 0*src + 1*dst.
    return vec4<f32>(factor, 1.0);
}
