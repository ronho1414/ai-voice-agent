import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { receiveWebhook } from '../lib/platform/elevenlabs-webhook';
const secret='fictional-test-secret';
const event={type:'post_call_transcription',data:{agent_id:'agent_A',conversation_id:'conv_A',organization_id:'forged_B',metadata:{start_time_unix_secs:1700000000,call_duration_secs:30},transcript:[{role:'user',message:'fictional hello'},{role:'agent',message:'welcome'}],analysis:{transcript_summary:'fictional test',call_successful:'success',data_collection_results:{sensitive:'excluded'}},conversation_initiation_client_data:{dynamic_variables:{organization_id:'forged_B'}}}};
function request(value:unknown=event, timestamp=Math.floor(Date.now()/1000), invalid=false){const raw=JSON.stringify(value);const signature=createHmac('sha256',secret).update(`${timestamp}.${raw}`).digest('hex');return new Request('http://localhost/api/webhooks/elevenlabs',{method:'POST',headers:{'elevenlabs-signature':`t=${timestamp},v0=${invalid?'bad':signature}`},body:raw});}
test('official SDK validates raw-body HMAC and discards unapproved fields',async()=>{let saved=false;const response=await receiveWebhook(request(),secret,async call=>{saved=true;assert.equal(call.provider_agent_id,'agent_A');assert.ok(!('organization_id' in call));assert.deepEqual(call.analysis,{call_successful:'success'});assert.equal(call.transcript.length,2);return 'synced';});assert.equal(response.status,200);assert.ok(saved);});
test('invalid, missing, old and tampered signatures never persist',async()=>{for(const req of [request(event,Math.floor(Date.now()/1000),true),request(event,1),new Request('http://localhost',{method:'POST',body:'{}'}),(()=>{const r=request();return new Request(r.url,{method:'POST',headers:r.headers,body:'{}'});})()]){assert.equal((await receiveWebhook(req,secret,async()=>{throw new Error('must not save');})).status,401);}});
test('malformed signed payloads rejected; unrelated events ignored',async()=>{for(const value of [{type:'post_call_transcription',data:{}},{...event,data:{...event.data,transcript:[{role:'attacker',message:'bad'}]}}])assert.equal((await receiveWebhook(request(value),secret,async()=>assert.fail())).status,400);assert.equal((await receiveWebhook(request({type:'post_call_audio'}),secret,async()=>assert.fail())).status,200);});
test('database errors return retryable failure and missing config fails closed',async()=>{assert.equal((await receiveWebhook(request(),secret,async()=>{throw new Error('db failure');})).status,503);assert.equal((await receiveWebhook(request(),undefined,async()=>assert.fail())).status,503);});

test('permanent ownership rejections are acknowledged, transient failures remain retryable',async()=>{
  const response=await receiveWebhook(request(),secret,async()=> 'ownership_conflict');
  assert.equal(response.status,200);
  assert.deepEqual(await response.json(),{status:'ownership_conflict'});
});
