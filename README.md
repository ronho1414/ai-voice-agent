# AI Voice Agent

VoicePilot AI（領聲智導）marketing site with a trilingual voice agent (Cantonese, Mandarin, English). The spec is in `SPEC.md`.

The company shell is `app/page.tsx`. Voice behavior lives in `components/voice-widget/` and `lib/voice-engine/`. The page passes the knowledge base path, site map, voice id, and clip files into the widget.

A short opener plays from memory while the answer is generated, then the spoken reply starts as soon as that opener ends.

## Develop

```bash
npm install
npm run dev
```

Keys live in the environment: `DEEPGRAM_API_KEY`, `JEV_API_KEY`, `OPENROUTER_API_KEY`, and `ELEVENLABS_API_KEY`. Names are listed in `.env.example`.

```bash
npm run lint
npm run typecheck
```

## Clips

`config/clips-config.json` holds the opener lines and a `voiceSettings` entry per language (`voiceId`, `stability`, `similarity_boost`). The clip script and the live reply both read the voice for that language from this file.

```bash
npm run generate:clips
```

The script writes `public/clips/{intent}_{lang}.mp3`. It tries ElevenLabs `eleven_turbo_v4`, then `eleven_v4_turbo`, then `eleven_flash_v2_5`. It does not run on install or on `npm run dev`.

## Talk

Open the voice panel from **立即語音體驗** (`#open-voice-demo-btn`) or the bottom-right assistant. Speech is transcribed with Deepgram (`nova-3`, then `nova-2`). `/api/fast-decision` and `/api/chat-relay` run together. The opener plays from the preloaded buffer. If navigation confidence is at least 0.75, the page changes and shows the destination. The reply is spoken with ElevenLabs when the opener ends. Clicking the microphone again stops the audio.
