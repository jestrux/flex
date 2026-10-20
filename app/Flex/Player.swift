import AppKit
import AVFoundation
import Combine

/// Playback for one project: the playhead, play / pause, a looped range, and the music edit
/// under it. The engine (Rust) paints and caches; this only shows frames and tells the engine
/// where the playhead is, so it paints there first.
///
/// While the music plays, its clock is the film's clock (as in any player, picture follows
/// sound). Without music a display timer runs the clock.
@MainActor
final class Player: ObservableObject {
    @Published private(set) var frame: Int = 0
    @Published private(set) var playing = false
    /// the frame range that loops, when a scene is looped
    @Published var loop: ClosedRange<Int>?
    @Published private(set) var image: NSImage?
    /// the shown image is an older frame (the playhead's isn't painted yet)
    @Published private(set) var holding = false
    @Published private(set) var musicReady = false
    /// what the viewer shows instead of a frame: a storyboard panel, where the film isn't built yet (Storyboard.swift)
    @Published private(set) var sketch: StorySketch?
    /// the storyboard's panel for a frame, if the film isn't built there (set by the project's store)
    var sketchAt: ((Int) -> StorySketch?)?

    let engine: ProjectEngine
    private(set) var fps = 30
    /// the film's frames (painted by the engine)
    private(set) var frames = 0
    /// the plan's frames: past the film's end when the script plans beats beyond it
    var plannedFrames = 0 { didSet { if plannedFrames != oldValue { objectWillChange.send() } } }
    /// how far the playhead goes: the film, or the plan when it is longer
    var total: Int { max(frames, plannedFrames) }
    private var shownPath: String?
    private var timer: Timer?
    private var startedAt: CFTimeInterval = 0
    private var startedFrame = 0
    private var audio: AVPlayer?

    init(engine: ProjectEngine) { self.engine = engine }

    func configure(fps: Int, frames: Int) {
        self.fps = max(1, fps)
        self.frames = frames
        if frame >= total { seek(0) } else { refresh() }
    }

    var seconds: Double { Double(frame) / Double(fps) }

    // MARK: music

    /// Build the edited track (stretches of the song back to back) as one composition.
    func loadMusic(file: String?, segments: [[Double]]) {
        guard let file else { return }
        let asset = AVURLAsset(url: URL(fileURLWithPath: file))
        Task {
            guard let track = try? await asset.loadTracks(withMediaType: .audio).first else { return }
            let comp = AVMutableComposition()
            guard let out = comp.addMutableTrack(withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid) else { return }
            let segs = segments.isEmpty ? [[0, (try? await asset.load(.duration).seconds) ?? 0]] : segments
            var at = CMTime.zero
            for s in segs where s.count == 2 && s[1] > s[0] {
                let range = CMTimeRange(start: CMTime(seconds: s[0], preferredTimescale: 48000), end: CMTime(seconds: s[1], preferredTimescale: 48000))
                try? out.insertTimeRange(range, of: track, at: at)
                at = at + range.duration
            }
            if self.mixPath != nil { return } // the full mix arrived first
            let p = AVPlayer(playerItem: AVPlayerItem(asset: comp))
            p.automaticallyWaitsToMinimizeStalling = false
            if UserDefaults.standard.bool(forKey: "mute") { p.isMuted = true }
            self.audio = p
            self.musicReady = true
        }
    }

    /// what's playing under the picture
    @Published private(set) var sound: String = "music"
    private var mixPath: String?

    /// Switch to the film's full mix (voice, effects, music) once the engine has made it. Keeps
    /// the playhead, and keeps playing if it was.
    func useMix(_ path: String) {
        guard path != mixPath else { return }
        mixPath = path
        let p = AVPlayer(url: URL(fileURLWithPath: path))
        p.automaticallyWaitsToMinimizeStalling = false
        if UserDefaults.standard.bool(forKey: "mute") { p.isMuted = true }
        let wasPlaying = playing
        audio?.pause()
        audio = p
        musicReady = true
        sound = "mix"
        if wasPlaying {
            p.seek(to: CMTime(seconds: seconds, preferredTimescale: 600), toleranceBefore: .zero, toleranceAfter: .zero)
            p.play()
        }
    }

    // MARK: transport

    func toggle() { playing ? pause() : play() }

    func play() {
        guard total > 0 else { return }
        if let loop, !loop.contains(frame) { setFrame(loop.lowerBound) }
        if frame >= total - 1 { setFrame(0) }
        playing = true
        startedAt = CACurrentMediaTime()
        startedFrame = frame
        if let audio {
            audio.seek(to: CMTime(seconds: seconds, preferredTimescale: 600), toleranceBefore: .zero, toleranceAfter: .zero)
            audio.play()
        }
        timer?.invalidate()
        timer = Timer.scheduledTimer(withTimeInterval: 1.0 / 60.0, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated { self?.tick() }
        }
        RunLoop.main.add(timer!, forMode: .common)
    }

    func pause() {
        playing = false
        timer?.invalidate(); timer = nil
        audio?.pause()
    }

    func seek(_ f: Int) {
        setFrame(f)
        if playing {
            startedAt = CACurrentMediaTime(); startedFrame = frame
            audio?.seek(to: CMTime(seconds: seconds, preferredTimescale: 600), toleranceBefore: .zero, toleranceAfter: .zero)
        }
    }

    func step(_ d: Int) { pause(); seek(frame + d) }

    private func tick() {
        let t: Double
        if let audio, audio.timeControlStatus == .playing { t = audio.currentTime().seconds }
        else { t = Double(startedFrame) / Double(fps) + (CACurrentMediaTime() - startedAt) }
        var f = Int((t * Double(fps)).rounded(.down))
        if let loop, f > loop.upperBound {
            f = loop.lowerBound
            seek(f)
            return
        }
        // past the track's end (beats planned beyond the film) the display clock runs on, over silence
        if f >= total { setFrame(total - 1); pause(); return }
        if f != frame { setFrame(f) }
    }

    private func setFrame(_ f: Int) {
        frame = min(max(0, f), max(0, total - 1))
        engine.setPlayhead(frame: UInt32(min(frame, max(0, frames - 1))))
        refresh()
    }

    /// Show the playhead's frame if it's painted; otherwise keep the last one and say so. Where the film isn't built (a
    /// beat the script marks a sketch, or past the film's end), its storyboard panel instead.
    func refresh() {
        guard total > 0 else { return }
        if let sk = sketchAt?(frame) {
            if sk != sketch { sketch = sk }
            holding = false
            if let img = sk.image, sk.file != shownPath { image = img; shownPath = sk.file }
            return
        }
        if sketch != nil { sketch = nil }
        if frame >= frames { holding = false; image = nil; shownPath = nil; return }  // planned, with no panel: black
        if let path = engine.framePath(frame: UInt32(frame)) {
            holding = false
            if path != shownPath, let img = NSImage(contentsOfFile: path) { image = img; shownPath = path }
        } else {
            holding = true
        }
    }
}
