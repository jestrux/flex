use flex_core::paint::{paint, Layer, Rect};

/// a 400×200 test image: left half red, right half blue
fn sample_png(dir: &std::path::Path) -> String {
    let mut im = image::RgbaImage::new(400, 200);
    for (x, _, p) in im.enumerate_pixels_mut() { *p = if x < 200 { image::Rgba([255, 0, 0, 255]) } else { image::Rgba([0, 0, 255, 255]) }; }
    let f = dir.join("s.png"); im.save(&f).unwrap(); f.to_string_lossy().into_owned()
}

fn px(p: &flex_core::paint::Painted, x: u32, y: u32) -> [u8; 3] {
    let c = p.pixmap.pixel(x, y).unwrap().demultiply(); [c.red(), c.green(), c.blue()]
}

/// An image layer lands in the same place, at the same size, whatever width the frame is painted at.
#[test]
fn image_layers_scale_with_the_frame() {
    let d = tempfile::tempdir().unwrap();
    let file = sample_png(d.path());
    // the right half of the image (crop) stretched over the frame's left half
    let layers = vec![Layer::Image { image: file, rect: Rect { x: 0., y: 0., w: 960., h: 1080. }, crop: Some(Rect { x: 0.5, y: 0., w: 0.5, h: 1. }), radius: None, opacity: None, alpha: None, rotate: None }];
    for width in [1920, 960, 480] {
        let p = paint(&layers, width).unwrap();
        let (w, h) = (p.pixmap.width(), p.pixmap.height());
        assert_eq!(px(&p, w / 4, h / 2), [0, 0, 255], "{width}: the crop shows blue in the left half");
        assert_eq!(px(&p, w * 3 / 4, h / 2), [0, 0, 0], "{width}: the right half stays black");
    }
}

#[test]
fn svg_layers_paint() {
    let svg = r##"<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080"><rect x="960" y="0" width="960" height="1080" fill="#00ff00"/></svg>"##;
    let p = paint(&[Layer::Svg { svg: svg.into() }], 960).unwrap();
    assert_eq!(px(&p, 100, 270), [0, 0, 0]);
    assert_eq!(px(&p, 700, 270), [0, 255, 0]);
}
