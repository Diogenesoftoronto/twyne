    /// Rasterize exact-size SVG group pixels as premultiplied BGRA.
    ///
    /// Only for the explicit destination-multiply image API: ordinary
    /// `paint_image`/`img` expects straight-alpha BGRA. Retaining raw resvg
    /// premultiplication avoids a lossy unpremultiply/premultiply round-trip.
    /// Preparation happens outside paint, input and per-frame render.
    pub fn render_parsed_premultiplied(
        &self,
        svg: &ParsedSvg,
        size: Size<DevicePixels>,
    ) -> Result<Arc<RenderImage>, usvg::Error> {
        let pixmap = rasterize_tree(&svg.0, SvgSize::ExactSize(size))?;
        let mut buffer =
            image::ImageBuffer::from_raw(pixmap.width(), pixmap.height(), pixmap.take()).unwrap();
        for pixel in buffer.chunks_exact_mut(4) {
            pixel.swap(0, 2); // RGBA premultiplied -> BGRA premultiplied, no demultiply.
        }
        Ok(Arc::new(RenderImage::new(SmallVec::from_const([Frame::new(buffer)]))))
    }
