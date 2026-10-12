// Unapplied CPU-only tests for gpui-pre-wgpu/src/wgpu_renderer.rs.
#[cfg(test)]
mod destination_multiply_format_capability_tests {
    use super::destination_multiply_formats_supported;
    use wgpu::TextureFormat;

    #[test]
    fn destination_multiply_formats_are_exact_byte_channel_pairs() {
        let supported = [TextureFormat::Bgra8Unorm, TextureFormat::Rgba8Unorm];
        for target in supported {
            for atlas in supported {
                assert!(destination_multiply_formats_supported(target, atlas));
            }
        }
    }

    #[test]
    fn destination_multiply_rejects_srgb_hdr_integer_and_mono_atlases() {
        let unsupported = [
            TextureFormat::Bgra8UnormSrgb,
            TextureFormat::Rgba8UnormSrgb,
            TextureFormat::Rgba16Float,
            TextureFormat::Rgb10a2Unorm,
            TextureFormat::Rgba8Uint,
            TextureFormat::R8Unorm,
        ];
        for format in unsupported {
            for supported in [TextureFormat::Bgra8Unorm, TextureFormat::Rgba8Unorm] {
                assert!(
                    !destination_multiply_formats_supported(format, supported),
                    "target {format:?}"
                );
                assert!(
                    !destination_multiply_formats_supported(supported, format),
                    "atlas {format:?}"
                );
            }
        }
    }
}
