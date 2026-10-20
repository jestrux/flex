//! The pipeline's own libvips (sharp's bundled build: libvips 8.17 with librsvg 2.61, cairo 1.18, pango 1.57), loaded
//! from Flex's copy of the pipeline, for the two things the painter can't reproduce by porting: SVG layers (text is
//! shaped and rasterised by pango/harfbuzz/freetype) and arbitrary-angle rotation (libvips's affine). Called the way
//! sharp calls them, so those layers come out byte for byte as the pipeline's. Absent the library (a pipeline without
//! node_modules), `get()` is None and the painter falls back to resvg and tiny-skia.

use std::ffi::{c_char, c_int, c_void, CStr};
use std::sync::OnceLock;

type Img = *mut c_void;

pub(crate) struct Vips {
    _lib: libloading::Library,
    svgload_buffer: unsafe extern "C" fn(*const c_void, usize, *mut Img, ...) -> c_int,
    rotate: unsafe extern "C" fn(Img, *mut Img, f64, ...) -> c_int,
    copy: unsafe extern "C" fn(Img, *mut Img, ...) -> c_int,
    new_from_memory: unsafe extern "C" fn(*const c_void, usize, c_int, c_int, c_int, c_int) -> Img,
    write_to_memory: unsafe extern "C" fn(Img, *mut usize) -> *mut c_void,
    width: unsafe extern "C" fn(Img) -> c_int,
    height: unsafe extern "C" fn(Img) -> c_int,
    bands: unsafe extern "C" fn(Img) -> c_int,
    array_double_new: unsafe extern "C" fn(*const f64, c_int) -> *mut c_void,
    area_unref: unsafe extern "C" fn(*mut c_void),
    object_unref: unsafe extern "C" fn(*mut c_void),
    g_free: unsafe extern "C" fn(*mut c_void),
    error_buffer: unsafe extern "C" fn() -> *const c_char,
    error_clear: unsafe extern "C" fn(),
}

// SAFETY: libvips is thread-safe once initialised; the function pointers are plain C entry points
unsafe impl Send for Vips {}
unsafe impl Sync for Vips {}

/// The library, loaded and initialised once (None when the pipeline's libvips isn't there, or FLEX_NO_VIPS is set).
pub(crate) fn get() -> Option<&'static Vips> {
    static V: OnceLock<Option<Vips>> = OnceLock::new();
    V.get_or_init(|| {
        if std::env::var_os("FLEX_NO_VIPS").is_some() { return None; }
        let dir = crate::project::bundled_pipeline().ok()?.join("node_modules/@img/sharp-libvips-darwin-arm64/lib");
        let file = std::fs::read_dir(&dir).ok()?.flatten().map(|e| e.path())
            .find(|p| p.file_name().and_then(|n| n.to_str()).is_some_and(|n| n.starts_with("libvips-cpp.") && n.ends_with(".dylib")))?;
        // SAFETY: loading a C library and resolving symbols with the signatures libvips 8.17 declares
        unsafe {
            let lib = libloading::Library::new(&file).ok()?;
            macro_rules! sym { ($n:literal) => { *lib.get(concat!($n, "\0").as_bytes()).ok()? } }
            let init: unsafe extern "C" fn(*const c_char) -> c_int = sym!("vips_init");
            if init(c"flex".as_ptr()) != 0 { return None; }
            // one thread per call (Flex paints frames in parallel itself) and no operation cache (every frame differs)
            let concurrency: unsafe extern "C" fn(c_int) = sym!("vips_concurrency_set");
            concurrency(1);
            let cache_max: unsafe extern "C" fn(c_int) = sym!("vips_cache_set_max");
            cache_max(0);
            let v = Vips {
                svgload_buffer: sym!("vips_svgload_buffer"),
                rotate: sym!("vips_rotate"),
                copy: sym!("vips_copy"),
                new_from_memory: sym!("vips_image_new_from_memory"),
                write_to_memory: sym!("vips_image_write_to_memory"),
                width: sym!("vips_image_get_width"),
                height: sym!("vips_image_get_height"),
                bands: sym!("vips_image_get_bands"),
                array_double_new: sym!("vips_array_double_new"),
                area_unref: sym!("vips_area_unref"),
                object_unref: sym!("g_object_unref"),
                g_free: sym!("g_free"),
                error_buffer: sym!("vips_error_buffer"),
                error_clear: sym!("vips_error_clear"),
                _lib: lib,
            };
            Some(v)
        }
    }).as_ref()
}

impl Vips {
    fn error(&self) -> String {
        // SAFETY: libvips's error buffer is a NUL-terminated string it owns
        unsafe { let s = CStr::from_ptr((self.error_buffer)()).to_string_lossy().into_owned(); (self.error_clear)(); s }
    }

    /// An image's pixels as RGBA (4-band uchar), consuming the image.
    unsafe fn take_rgba(&self, im: Img) -> Result<image::RgbaImage, String> {
        let (w, h, b) = ((self.width)(im), (self.height)(im), (self.bands)(im));
        let mut size = 0usize;
        let p = (self.write_to_memory)(im, &mut size);
        (self.object_unref)(im);
        if p.is_null() { return Err(self.error()); }
        let bytes = std::slice::from_raw_parts(p as *const u8, size).to_vec();
        (self.g_free)(p);
        if b != 4 || bytes.len() != (w * h * 4) as usize { return Err(format!("unexpected {w}×{h}×{b} image")); }
        image::RgbaImage::from_raw(w as u32, h as u32, bytes).ok_or_else(|| "bad size".into())
    }

    /// An SVG layer as sharp loads a composite input: svgload at 72 dpi, straight RGBA.
    pub(crate) fn svg(&self, svg: &str) -> Result<image::RgbaImage, String> {
        // SAFETY: the buffer outlives the call (svgload copies what it keeps); the varargs list ends with NULL
        unsafe {
            let mut out: Img = std::ptr::null_mut();
            if (self.svgload_buffer)(svg.as_ptr() as *const c_void, svg.len(), &mut out, std::ptr::null::<c_char>()) != 0 { return Err(self.error()); }
            self.take_rgba(out)
        }
    }

    /// sharp's `rotate(angle, { background: transparent })` of a straight-alpha RGBA image: libvips's rotate (its
    /// affine, bilinear), new pixels transparent black.
    pub(crate) fn rotate(&self, src: &image::RgbaImage, angle: f64) -> Result<image::RgbaImage, String> {
        // SAFETY: new_from_memory reads `src` only while the pipeline runs, which ends in take_rgba below
        unsafe {
            let im = (self.new_from_memory)(src.as_raw().as_ptr() as *const c_void, src.as_raw().len(), src.width() as c_int, src.height() as c_int, 4, 0 /* VIPS_FORMAT_UCHAR */);
            if im.is_null() { return Err(self.error()); }
            // tagged sRGB, as a loaded PNG is: libvips premultiplies around the turn only for an image it knows has alpha
            let mut tagged: Img = std::ptr::null_mut();
            let r = (self.copy)(im, &mut tagged, c"interpretation".as_ptr(), 22 as c_int /* VIPS_INTERPRETATION_sRGB */, std::ptr::null::<c_char>());
            (self.object_unref)(im);
            if r != 0 { return Err(self.error()); }
            let im = tagged;
            let bg = (self.array_double_new)([0f64; 4].as_ptr(), 4);
            let mut out: Img = std::ptr::null_mut();
            let r = (self.rotate)(im, &mut out, angle, c"background".as_ptr(), bg, std::ptr::null::<c_char>());
            (self.area_unref)(bg);
            (self.object_unref)(im);
            if r != 0 { return Err(self.error()); }
            self.take_rgba(out)
        }
    }
}
