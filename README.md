# AI Voice Agent

Phase 1 of a trilingual (Cantonese, Mandarin, English) low-latency voice agent. The spec is in `SPEC.md`.

This repo holds the filler-clip config, the site map, a placeholder clinic knowledge base, and an offline script that generates the short opener MP3s. Starting the app does not call a speech API.

## Develop

```bash
npm install
npm run dev
```

## Clips

Generate the filler clips offline once `ELEVENLABS_API_KEY` is set in the environment:

```bash
npm run generate:clips
```

The script reads `config/clips-config.json` and writes `public/clips/{intent}_{lang}.mp3` with ElevenLabs `eleven_turbo_v4`, and falls back to `eleven_flash_v2_5` if that request fails. It reads the key only from `process.env.ELEVENLABS_API_KEY`. It does not run on install or on `npm run dev`.
