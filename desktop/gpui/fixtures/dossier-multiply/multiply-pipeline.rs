        // No dual-source blending, extra attachment, framebuffer copy or
        // destination sample is required. The fragment outputs the RGB factor.
        let poly_multiply = matches!(
            surface_format,
            wgpu::TextureFormat::Bgra8Unorm | wgpu::TextureFormat::Rgba8Unorm
        ).then(|| create_pipeline(
            "poly_multiply",
            "vs_poly_sprite",
            "fs_poly_multiply",
            &layouts.globals,
            &layouts.instances,
            Some(&layouts.texture),
            wgpu::PrimitiveTopology::TriangleStrip,
            &[Some(wgpu::ColorTargetState {
                format: surface_format,
                blend: Some(wgpu::BlendState {
                    color: wgpu::BlendComponent {
                        src_factor: wgpu::BlendFactor::Zero,
                        dst_factor: wgpu::BlendFactor::Src,
                        operation: wgpu::BlendOperation::Add,
                    },
                    alpha: wgpu::BlendComponent {
                        src_factor: wgpu::BlendFactor::Zero,
                        dst_factor: wgpu::BlendFactor::One,
                        operation: wgpu::BlendOperation::Add,
                    },
                }),
                write_mask: wgpu::ColorWrites::ALL,
            })],
            1,
            &shader_module,
        ));
