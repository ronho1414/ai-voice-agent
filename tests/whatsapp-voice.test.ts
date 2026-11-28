import { test } from "node:test";
import assert from "node:assert/strict";
import {
  decideReplyKind,
  existingVoiceTranscript,
  isWhatsAppVoiceNote,
  MAX_WHATSAPP_VOICE_BYTES,
  scribeLanguageForAgent,
  synthesizeAgentVoiceNote,
  uploadWhatsAppVoiceNote,
} from "../lib/platform/whatsapp-voice";

function monoVoiceNote(channels = 1): Uint8Array {
  const bytes = new Uint8Array(64);
  bytes.set([0x4f, 0x67, 0x67, 0x53], 0);
  bytes.set(Buffer.from("OpusHead"), 28);
  bytes[36] = 1;
  bytes[37] = channels;
  return bytes;
}

test("reply preference matches the incoming type unless the tenant overrides it", () => {
  assert.equal(decideReplyKind("auto", "text"), "text");
  assert.equal(decideReplyKind("auto", "audio"), "voice");
  assert.equal(decideReplyKind("text", "audio"), "text");
  assert.equal(decideReplyKind("voice", "text"), "voice");
  assert.equal(scribeLanguageForAgent("cantonese"), "yue");
  assert.equal(scribeLanguageForAgent("mandarin"), "zh");
  assert.equal(scribeLanguageForAgent("english"), "en");
  assert.equal(scribeLanguageForAgent("trilingual"), null);
  assert.equal(existingVoiceTranscript({ body_text: "已轉寫", media_metadata: { stt: { status: "done" } } }), "已轉寫");
  assert.equal(existingVoiceTranscript({ body_text: "", media_metadata: { stt: { status: "done" } } }), null);
  assert.equal(isWhatsAppVoiceNote(monoVoiceNote()), true);
  assert.equal(isWhatsAppVoiceNote(monoVoiceNote(2)), false);
  assert.equal(isWhatsAppVoiceNote(new Uint8Array(MAX_WHATSAPP_VOICE_BYTES + 1)), false);
});

test("TTS uses the tenant agent voice from ElevenLabs and uploads Ogg Opus", async () => {
  const calls: Array<{ url: string; body: string | null; form: boolean }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    const form = typeof FormData !== "undefined" && init?.body instanceof FormData;
    calls.push({ url, body: form ? null : typeof init?.body === "string" ? init.body : null, form });
    if (url.includes("/convai/agents/")) {
      return Response.json({
        conversation_config: { tts: { voice_id: "voice_from_agent_config", model_id: "eleven_model_from_agent" } },
      });
    }
    if (url.includes("/text-to-speech/")) {
      assert.equal(url.includes("voice_from_agent_config"), true);
      assert.equal(url.includes("opus_48000_64"), true);
      const request = JSON.parse(String(init?.body)) as { model_id?: string };
      assert.equal(request.model_id, "eleven_model_from_agent");
      const note = monoVoiceNote();
      const copy = new ArrayBuffer(note.byteLength);
      new Uint8Array(copy).set(note);
      return new Response(copy);
    }
    if (url.endsWith("/media")) {
      assert.equal(form, true);
      return Response.json({ id: "meta-media-1" });
    }
    return Response.json({ error: "unexpected" }, { status: 500 });
  };

  const spoken = await synthesizeAgentVoiceNote({
    agentId: "agent_test",
    text: "你好",
    apiKey: "test-key",
    fetchImpl,
  });
  assert.equal(spoken.ok, true);
  if (!spoken.ok) return;
  const uploaded = await uploadWhatsAppVoiceNote({
    phoneNumberId: "1465505606651153",
    accessToken: "test-token",
    graphVersion: "v25.0",
    audio: spoken.audio,
    fetchImpl,
  });
  assert.deepEqual(uploaded, { ok: true, mediaId: "meta-media-1" });

  const missingVoice = await synthesizeAgentVoiceNote({
    agentId: "agent_test",
    text: "你好",
    apiKey: "test-key",
    fetchImpl: async () => Response.json({ conversation_config: { tts: {} } }),
  });
  assert.deepEqual(missingVoice, { ok: false });
  assert.equal(calls.some((call) => call.url.includes("voice_hardcoded")), false);
});
