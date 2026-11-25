import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyPreferences } from "../lib/platform/agent-preferences";
import { initialPreferenceDraft, isDuplicateDraft, matchesDuplicateRequest, preferenceDraftTransition as step, reviewedPreferences, type PreferenceDraft } from "../lib/platform/agent-preference-draft";
import { ApiError, apiJson } from "../components/managed-agent/shared";

const review = (state:PreferenceDraft) => step(state,{type:"review",version:state.latest!.version});
const initial = () => step(initialPreferenceDraft, {type:"receive", epoch:0, snapshot:{settings:{...emptyPreferences,voice_gender:"female"},version:1}});
const edited = () => step(step(initial(), {type:"preferences",preferences:{...initial().preferences,greeting:"FICTIONAL my greeting"}}),{type:"notes",notes:"FICTIONAL keep this note"});

test("concurrent admin completion retains drafts and requires explicit three-way review", () => {
  const before=edited();
  const next=step(before,{type:"receive",epoch:0,snapshot:{settings:{...before.latest!.settings,voice_gender:"male",greeting:"Admin greeting"},version:2}});
  assert.throws(()=>step(next,{type:"review",version:1}),/再次更新/);
  assert.equal(next.baseline!.version,1);assert.equal(next.latest!.version,2);
  assert.deepEqual(next.preferences,before.preferences);assert.equal(next.notes,before.notes);assert.equal(next.reviewRequired,true);
  assert.throws(()=>step(next,{type:"prepare",key:"unsafe"}),/覆核/);
  assert.equal(reviewedPreferences(next).voice_gender,"male"); // untouched field adopts current active value
  assert.equal(reviewedPreferences(next).greeting,"FICTIONAL my greeting"); // overlapping field remains visible for review
  const reviewed=review(next);assert.equal(reviewed.baseline!.version,2);assert.equal(reviewed.attempt,null);
  assert.equal(reviewed.preferences.voice_gender,"male");assert.equal(reviewed.preferences.greeting,before.preferences.greeting);assert.equal(reviewed.notes,before.notes);
  const ready=step(reviewed,{type:"prepare",key:"fresh-after-review"});assert.equal(ready.attempt!.base_version,2);assert.equal(ready.attempt!.idempotency_key,"fresh-after-review");
});

test("terminal replay failed refresh is recoverable through a later poll without discarding the draft", () => {
  const before=step(edited(),{type:"prepare",key:"original"});
  const terminal=step(before,{type:"terminal"});const failed=step(terminal,{type:"refresh_failed"});
  assert.equal(failed.needsRefresh,true);assert.deepEqual(failed.preferences,before.preferences);assert.equal(failed.notes,before.notes);
  assert.throws(()=>review(failed),/取得最新/);
  const polled=step(failed,{type:"receive",epoch:failed.refreshEpoch,snapshot:{settings:{...emptyPreferences,voice_gender:"male"},version:3}});
  assert.equal(polled.needsRefresh,false);assert.equal(polled.reviewRequired,true);assert.equal(polled.baseline!.version,1);
  const prepared=step(review(polled),{type:"prepare",key:"new-intention"});
  assert.equal(prepared.attempt!.base_version,3);assert.equal(prepared.attempt!.idempotency_key,"new-intention");assert.equal(prepared.notes,before.notes);
});

test("409 recovery retains the submitted intent and handles another completion during review", () => {
  const attempted=step(edited(),{type:"prepare",key:"old-attempt"});
  let state=step(attempted,{type:"conflict"});state=step(state,{type:"refresh_failed"});
  assert.deepEqual(state.attempt,attempted.attempt);assert.deepEqual(state.preferences,attempted.preferences);
  state=step(state,{type:"receive",epoch:state.refreshEpoch,snapshot:{settings:{...emptyPreferences,voice_gender:"male"},version:2}});
  state=review(state);state=step(state,{type:"prepare",key:"reviewed-v2"});
  const second=step(state,{type:"receive",epoch:state.refreshEpoch,snapshot:{settings:{...state.latest!.settings,response_style:"professional"},version:3}});
  assert.equal(second.reviewRequired,true);assert.equal(second.attempt!.base_version,2);
  const final=step(review(second),{type:"prepare",key:"reviewed-v3"});
  assert.equal(final.attempt!.base_version,3);assert.equal(final.attempt!.preferences.response_style,"professional");assert.equal(final.attempt!.preferences.greeting,attempted.preferences.greeting);
});

test("transport retries keep the exact key/payload and stale fetch responses cannot undo a review", () => {
  const first=step(edited(),{type:"prepare",key:"network-retry"});
  const retry=step(first,{type:"prepare",key:"unused-key"});assert.deepEqual(retry.attempt,first.attempt);
  const changed=step(first,{type:"receive",epoch:0,snapshot:{settings:{...emptyPreferences,voice_gender:"male"},version:4}});
  const reviewed=review(changed);
  const stale=step(reviewed,{type:"receive",epoch:0,snapshot:{settings:emptyPreferences,version:1}});
  assert.deepEqual(stale,reviewed);assert.equal(stale.baseline!.version,4);
  const fresh=step(stale,{type:"prepare",key:"version-four"});assert.equal(fresh.attempt!.base_version,4);
});

test("API client preserves HTTP409 as a typed conflict for in-app recovery", async () => {
  const original=globalThis.fetch;
  try{globalThis.fetch=async()=>Response.json({error:"資料已更新"},{status:409});
    await assert.rejects(apiJson("https://orai.example.test/api/platform/customer/change-requests"),e=>e instanceof ApiError&&e.status===409);
  }finally{globalThis.fetch=original;}
});


test('pre-terminal in-flight refresh cannot satisfy the required fresh snapshot',()=>{
 const before=edited();const terminal=step(before,{type:'terminal'});
 const delayed=step(terminal,{type:'receive',epoch:before.refreshEpoch,snapshot:before.latest!});
 assert.deepEqual(delayed,terminal);assert.equal(delayed.needsRefresh,true);
 assert.throws(()=>review(delayed),/取得最新/);
 const fresh=step(delayed,{type:'receive',epoch:delayed.refreshEpoch,snapshot:delayed.latest!});
 assert.equal(fresh.needsRefresh,false);assert.equal(fresh.reviewRequired,true);
});

test('duplicate open request blocks identical resubmission without entering review or changing retry identity',()=>{
 const attempted=step(edited(),{type:'prepare',key:'frozen-key'});
 const duplicate=step(attempted,{type:'duplicate',existingRequest:{id:'own-request',reference:'REQ-42'}});
 assert.equal(duplicate.reviewRequired,false);assert.equal(duplicate.needsRefresh,false);assert.equal(isDuplicateDraft(duplicate),true);
 assert.deepEqual(duplicate.attempt,attempted.attempt);assert.deepEqual(duplicate.preferences,attempted.preferences);assert.equal(duplicate.notes,attempted.notes);
 assert.throws(()=>step(duplicate,{type:'prepare',key:'must-not-loop'}),/已有相同/);
 const changed=step(duplicate,{type:'notes',notes:'FICTIONAL different intent'});assert.equal(isDuplicateDraft(changed),false);
 const prepared=step(changed,{type:'prepare',key:'new-intent'});assert.equal(prepared.attempt!.idempotency_key,'new-intent');
 const resolved=step(duplicate,{type:'duplicate_resolved'});assert.equal(resolved.attempt,null);assert.equal(isDuplicateDraft(resolved),false);assert.equal(resolved.notes,duplicate.notes);
});

test('API client forwards structured duplicate metadata and stale conflict codes separately',async()=>{
 const original=globalThis.fetch;
 try{
  globalThis.fetch=async()=>Response.json({error:'duplicate',code:'DUPLICATE_OPEN_REQUEST',existing_request:{id:'own-request',reference:'REQ-42'}},{status:409});
  await assert.rejects(apiJson('https://orai.example.test/requests'),e=>e instanceof ApiError&&e.code==='DUPLICATE_OPEN_REQUEST'&&e.existingRequest?.id==='own-request');
  globalThis.fetch=async()=>Response.json({error:'stale',code:'STALE_ACTIVE_PREFERENCES'},{status:409});
  await assert.rejects(apiJson('https://orai.example.test/requests'),e=>e instanceof ApiError&&e.code==='STALE_ACTIVE_PREFERENCES'&&!e.existingRequest);
 }finally{globalThis.fetch=original;}
});

test('duplicate resolution matches terminal history after a missing lookup and preserves a newer retry attempt',()=>{
 const original=step(edited(),{type:'prepare',key:'old-duplicate'});
 const duplicate=step(original,{type:'duplicate'});
 const historical={id:'request-closed-before-lookup',requested_settings:original.attempt!.preferences,additional_notes:original.attempt!.additional_notes};
 assert.equal(matchesDuplicateRequest(duplicate,historical),true);
 assert.equal(matchesDuplicateRequest(duplicate,{...historical,additional_notes:'different request'}),false);
 const newIntent=step(step(duplicate,{type:'notes',notes:'FICTIONAL newer intent'}),{type:'prepare',key:'new-network-retry'});
 const resolved=step(newIntent,{type:'duplicate_resolved'});assert.deepEqual(resolved.attempt,newIntent.attempt);assert.equal(resolved.attempt!.idempotency_key,'new-network-retry');assert.equal(resolved.duplicateAttempt,null);
 const same=step(duplicate,{type:'duplicate_resolved'});assert.equal(same.attempt,null);assert.equal(same.notes,original.notes);
});
