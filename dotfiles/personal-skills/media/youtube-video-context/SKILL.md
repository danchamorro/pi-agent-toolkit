---
name: youtube-video-context
description: "Use this skill whenever the user gives a YouTube URL and asks to summarize, digest, analyze, extract transcript/context, decide whether a video is worth watching, or understand what a video is about. Prefer the summarize CLI for YouTube/video context instead of web search. Use Codex as the default summarize backend when possible, and use the local Whisper large-v3 model for transcription fallback. Do not use this for ordinary web pages; the user prefers Exa for webpage research."
compatibility: "Requires the summarize CLI. Best local fallback requires yt-dlp, ffmpeg, tesseract, whisper-cpp, and SUMMARIZE_WHISPER_CPP_MODEL_PATH pointing to ggml-large-v3.bin."
---

# YouTube Video Context

Use this skill to turn YouTube videos into grounded, LLM-readable context. The preferred tool is the `summarize` CLI because it uses a transcript-first YouTube pipeline and can fall back to local audio transcription when captions are missing.

The user prefers this workflow for YouTube videos, but prefers Exa for ordinary webpages.

## Default assumptions

- Use `summarize`, not browser automation or generic web search, for YouTube video understanding.
- Prefer the user's Codex subscription as the model backend:

```bash
--cli codex
```

- Use the local Whisper large-v3 model for transcription fallback when needed:

```bash
SUMMARIZE_WHISPER_CPP_MODEL_PATH="$HOME/.local/share/whisper.cpp/models/ggml-large-v3.bin"
```

- If that environment variable is already set in the shell, do not repeat it unless needed for a one-off command.
- Do not use the browser extension or daemon flow. The user only wants the CLI workflow.

## How summarize handles YouTube

`summarize` is transcript-first:

1. Parse the YouTube URL.
2. Try YouTube transcript/caption sources first.
3. If captions exist, clean timed transcript segments and summarize them.
4. If captions are unavailable and fallback is needed, use `yt-dlp` to get audio, `ffmpeg` to prepare it, and `whisper.cpp` with local `ggml-large-v3.bin` to transcribe.
5. Send the extracted transcript/context to the selected LLM backend.

This means normal captioned videos usually do not require local Whisper. Whisper is the fallback for videos with missing or unusable captions, or when `--youtube yt-dlp` forces transcription.

## Common workflows

### Quick summary

For a normal YouTube summary request:

```bash
summarize "$URL" --youtube auto --cli codex --length medium --plain
```

Return the resulting summary, and mention whether the run used captions or appeared to require transcription if the output makes that clear.

### Grounding check or transcript extraction

When the user asks to inspect the source, verify grounding, extract the transcript, or diagnose summary quality:

```bash
summarize "$URL" --youtube auto --extract --timestamps
```

If the transcript is long, do not paste all of it. Summarize what was extracted and include representative timestamped excerpts.

For agent contexts where command output may be large, process or capture the output with context-aware tooling and return only the useful summary.

### Slide-heavy technical videos

For lectures, conference talks, demos, tutorials, or videos where visuals likely matter:

```bash
summarize "$URL" --youtube auto --cli codex --slides --slides-ocr --length long --plain
```

Use this when the user mentions slides, a lecture, a talk, a demo, charts, screen sharing, UI walkthroughs, or technical diagrams.

### Force local transcription path

If the user wants to test local Whisper fallback or captions are bad/unavailable:

```bash
SUMMARIZE_WHISPER_CPP_MODEL_PATH="$HOME/.local/share/whisper.cpp/models/ggml-large-v3.bin" \
  summarize "$URL" --youtube yt-dlp --cli codex --length medium --plain
```

This is slower than transcript-first mode because it downloads/extracts audio and transcribes locally.

## Mode selection

Use these `--youtube` modes intentionally:

- `auto`: default. Try YouTube transcript paths first, then fallbacks.
- `web`: only use YouTube web transcript/caption sources. Use this when the user wants no media download/transcription.
- `no-auto`: skip auto-generated captions and prefer creator/manual captions. Use when caption quality matters and auto captions may be misleading.
- `yt-dlp`: force audio download and transcription.
- `apify`: use Apify only, if configured.

## Output style

For user-facing answers:

1. State whether the command succeeded.
2. Give a concise summary first.
3. Include key takeaways or timeline if useful.
4. Include timestamped evidence when the user asks for grounding or when claims are specific.
5. Mention limitations clearly, such as missing captions, auto-generated transcript quality, or failed transcription fallback.

Avoid dumping huge transcripts into chat unless the user explicitly asks for the full transcript.

## Troubleshooting

If `summarize` does not find the local Whisper model, ensure this exists:

```bash
ls -lh "$HOME/.local/share/whisper.cpp/models/ggml-large-v3.bin"
```

Then run with the env var inline:

```bash
SUMMARIZE_WHISPER_CPP_MODEL_PATH="$HOME/.local/share/whisper.cpp/models/ggml-large-v3.bin" summarize "$URL" --youtube yt-dlp --cli codex
```

If `yt-dlp` gets a YouTube 403, the project docs suggest passing browser cookies through `yt-dlp`, for example by setting `SUMMARIZE_YT_DLP_COOKIES_FROM_BROWSER=chrome` or a profile-specific value. Only do this after explaining the privacy tradeoff to the user, because it grants the tool access to browser-authenticated YouTube state.

If Codex is unavailable or unauthenticated, ask before falling back to Claude or another paid backend unless the user has already allowed fallback.
