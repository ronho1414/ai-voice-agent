// Execute only after approval against a provisioned isolated staging environment.
import { createHmac, randomUUID } from 'node:crypto';
const { STAGING_BASE_URL, STAGING_AGENT_ID, ELEVENLABS_WEBHOOK_SECRET, STAGING_TEST_APPROVED } = process.env;
if (STAGING_TEST_APPROVED !== 'fictional-data-only' || !STAGING_BASE_URL || !STAGING_AGENT_ID || !ELEVENLABS_WEBHOOK_SECRET) {
  throw new Error('Provide staging URL, agent, signing secret and explicit fictional-data test approval');
}
const base = new URL(STAGING_BASE_URL);
if (base.protocol !== 'https:' || base.hostname === 'ai-voice-agent-five-tau.vercel.app' || !base.hostname.includes('staging')) {
  throw new Error('Use an explicitly named HTTPS staging host, never the existing production domain');
}
const conversation = `staging_${randomUUID().replaceAll('-', '')}`;
const payload = { type: 'post_call_transcription', data: {
  agent_id: STAGING_AGENT_ID, conversation_id: conversation,
  metadata: { start_time_unix_secs: Math.floor(Date.now()/1000), call_duration_secs: 30 },
  transcript: [{ role: 'user', message: 'STAGING FICTIONAL: 想了解示範護理。', time_in_call_secs: 0 },
    { role: 'agent', message: 'STAGING FICTIONAL: 此通話只供驗收。', time_in_call_secs: 2 }],
  analysis: { transcript_summary: '', call_successful: 'success' },
  conversation_initiation_client_data: { dynamic_variables: { organization_id: 'forged-tenant-must-be-ignored' } }
}};
const raw = JSON.stringify(payload);
const timestamp = Math.floor(Date.now()/1000);
const signature = createHmac('sha256', ELEVENLABS_WEBHOOK_SECRET).update(`${timestamp}.${raw}`).digest('hex');
for (const invalid of [true, false, false]) {
  const result = await fetch(new URL('/api/webhooks/elevenlabs', base), { method: 'POST',
    signal: AbortSignal.timeout(15000),
    headers: { 'Content-Type': 'application/json', 'ElevenLabs-Signature': `t=${timestamp},v0=${invalid ? 'invalid' : signature}` }, body: raw });
  const body = await result.json();
  if (result.status !== (invalid ? 401 : 200) || (!invalid && body.status !== 'synced')) throw new Error('Staging delivery assertion failed');
  console.log(JSON.stringify({ step: invalid ? 'invalid-signature' : 'valid-or-duplicate', http: result.status }));
}
console.log(JSON.stringify({ conversation, next: 'Verify exactly one row in tenant A, absent from B; check transcript-only excerpt and relogin persistence. Keep fictional fixture ID for approved cleanup.' }));
