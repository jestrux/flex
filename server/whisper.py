# Flex's one Whisper path (local mlx-whisper, Apple silicon), run with the mlx-whisper tool's own python. Used by
# `flex transcribe` (crates/flex-core/src/transcribe.rs) and `flex music` (server/music.mts).
# stdin: {"file": path, "model": repo, "chunks": [[from_s, to_s], …]} → stdout: one JSON line, the words (or
# {"jobs": [{"file", "chunks"?}, …]} → a list of word lists, one per file, the model loaded once):
#   [{"word", "start", "end", "line"}] in the file's seconds; "line" = the chunk the word came from.
# Each chunk is transcribed on its own (a whole long file in one pass skips loud sung stretches), padded 0.3 s each
# side; a word belongs to the chunk its start falls in. No prompt (a prompt of expected words makes Whisper repeat them).
# Greedy decoding, no sampling fallback: the same audio gives the same words every run (the fallback's random
# temperatures made sung stretches come back different each time).
import json, sys
import mlx_whisper
from mlx_whisper.audio import load_audio

req = json.load(sys.stdin)
SR = 16000

def words(file, chunks, language):
  audio = load_audio(file)
  dur = len(audio) / SR
  out = []
  for k, (a, b) in enumerate(chunks or [[0.0, dur]]):
      b = min(b, dur)
      if b - a < 0.15:
          continue
      pa, pb = max(0.0, a - 0.3), min(dur, b + 0.3)
      r = mlx_whisper.transcribe(audio[int(pa * SR):int(pb * SR)], path_or_hf_repo=req["model"], word_timestamps=True,
                                 condition_on_previous_text=False, no_speech_threshold=None,
                                 temperature=0.0, compression_ratio_threshold=None, logprob_threshold=None,
                                 language=language or None, verbose=None)
      for s in r.get("segments", []):
          for w in s.get("words", []):
              t = pa + w["start"]
              if a - 0.05 <= t < b:
                  out.append({"word": w["word"].strip(), "start": round(t, 2), "end": round(pa + w["end"], 2), "line": k})
  return out

# one file ({"file", "chunks"}) or several in one run ({"jobs": [{"file", "chunks"}]}: the model loads once)
if "jobs" in req:
    print(json.dumps([words(j["file"], j.get("chunks"), req.get("language")) for j in req["jobs"]]))
else:
    print(json.dumps(words(req["file"], req["chunks"], req.get("language"))))
