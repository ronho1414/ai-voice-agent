import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyPreferences, type RequestStatus } from "../lib/platform/agent-preferences";
import {
  initialPreferenceDraft,
  isDuplicateDraft,
  matchesDuplicateRequest,
  preferenceDraftTransition as step,
  reconcileDuplicateLock,
  reviewedPreferences,
  type DuplicateStatusRecord,
  type PreferenceDraft,
} from "../lib/platform/agent-preference-draft";
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

test("background reconciliation unlocks closed duplicate across cancelled, rejected and completed even when unselected and off-page", async () => {
  for (const status of ["cancelled", "rejected", "completed"] as const) {
    let state = step(step(edited(), { type: "prepare", key: `dup-key-${status}` }), {
      type: "duplicate",
      existingRequest: { id: `req-${status}`, reference: `REQ-${status}` },
    });
    // Customer edits temporarily without submitting, while detail panel is closed/unselected.
    state = step(state, { type: "notes", notes: "FICTIONAL temporary note" });
    assert.equal(isDuplicateDraft(state), false);
    assert.ok(state.duplicateAttempt);

    let fetchCalls = 0;
    const otherPageHistory: DuplicateStatusRecord[] = [{ id: "unrelated-req", reference: "REQ-999", status: "pending" }];
    const result = await reconcileDuplicateLock({
      epoch: state.duplicateEpoch,
      getState: () => state,
      dispatch: (event) => {
        state = step(state, event);
      },
      fetchById: async (id) => {
        fetchCalls += 1;
        assert.equal(id, `req-${status}`);
        return { request: { id, reference: `REQ-${status}`, status } };
      },
      lookupByAttempt: async () => {
        throw new Error("lookupByAttempt should not run when ID is known");
      },
      historyRows: otherPageHistory,
      detailResult: { id: "different-selected-row", reference: "REQ-OTHER", status: "pending" },
    });

    assert.equal(fetchCalls, 1);
    assert.equal(result.outcome, "resolved");
    assert.equal(result.shouldRefreshAgent, status === "completed");
    assert.equal(state.duplicateAttempt, null);
    assert.equal(state.duplicateRequest, null);
    assert.equal(state.attempt, null);
    assert.equal(state.notes, "FICTIONAL temporary note");

    // Reverting temporary edit back to original draft must NOT re-lock.
    state = step(state, { type: "notes", notes: "FICTIONAL keep this note" });
    assert.equal(isDuplicateDraft(state), false);
    assert.deepEqual(state.preferences, edited().preferences);

    if (status === "completed") {
      // Completed request advances active baseline and preserves unsaved draft via stale-version review.
      state = step(state, {
        type: "receive",
        epoch: state.refreshEpoch,
        snapshot: { settings: { ...emptyPreferences, voice_gender: "male" }, version: 2 },
      });
      assert.equal(state.reviewRequired, true);
      assert.equal(state.notes, "FICTIONAL keep this note");
      const ready = step(review(state), { type: "prepare", key: "fresh-after-completed-unlock" });
      assert.equal(ready.attempt!.base_version, 2);
      assert.equal(ready.attempt!.idempotency_key, "fresh-after-completed-unlock");
    } else {
      const ready = step(state, { type: "prepare", key: `resubmit-${status}` });
      assert.equal(ready.attempt!.idempotency_key, `resubmit-${status}`);
    }
  }
});

test("absence from paginated history never releases an open or unverified duplicate lock", async () => {
  for (const openStatus of ["pending", "in_progress", "needs_information"] as RequestStatus[]) {
    let state = step(step(edited(), { type: "prepare", key: `open-${openStatus}` }), {
      type: "duplicate",
      existingRequest: { id: "req-offpage", reference: "REQ-OFFPAGE" },
    });
    const res = await reconcileDuplicateLock({
      epoch: state.duplicateEpoch,
      getState: () => state,
      dispatch: (event) => {
        state = step(state, event);
      },
      fetchById: async (id) => ({ request: { id, reference: "REQ-OFFPAGE", status: openStatus } }),
      lookupByAttempt: async () => {
        throw new Error("should not run");
      },
      historyRows: [], // Page 2 empty or request paged out.
    });
    assert.equal(res.outcome, "still_open");
    assert.equal(isDuplicateDraft(state), true);
    assert.equal(state.duplicateRequest?.id, "req-offpage");
  }

  // Transient fetch errors keep the lock safely intact.
  let erroredState = step(step(edited(), { type: "prepare", key: "err-key" }), {
    type: "duplicate",
    existingRequest: { id: "req-err", reference: "REQ-ERR" },
  });
  const errRes = await reconcileDuplicateLock({
    epoch: erroredState.duplicateEpoch,
    getState: () => erroredState,
    dispatch: (event) => {
      erroredState = step(erroredState, event);
    },
    fetchById: async () => {
      throw new Error("network unavailable");
    },
    lookupByAttempt: async () => {
      throw new Error("should not run");
    },
    historyRows: [],
  });
  assert.equal(errRes.outcome, "error");
  assert.equal(isDuplicateDraft(erroredState), true);

  // Missing-ID race ignores empty history page and checks authorized lookup instead.
  let missingIdState = step(step(edited(), { type: "prepare", key: "missing-id-open" }), {
    type: "duplicate",
  });
  let lookupCount = 0;
  const matched = await reconcileDuplicateLock({
    epoch: missingIdState.duplicateEpoch,
    getState: () => missingIdState,
    dispatch: (event) => {
      missingIdState = step(missingIdState, event);
    },
    fetchById: async () => {
      throw new Error("should not fetch by ID yet");
    },
    lookupByAttempt: async () => {
      lookupCount += 1;
      return { open: true, request: { id: "discovered-id", reference: "REQ-DISC", status: "in_progress" } };
    },
    historyRows: [],
  });
  assert.equal(lookupCount, 1);
  assert.equal(matched.outcome, "still_open");
  assert.equal(isDuplicateDraft(missingIdState), true);
  assert.deepEqual(missingIdState.duplicateRequest, { id: "discovered-id", reference: "REQ-DISC" });

  // Missing-ID race unlocks once authorized lookup confirms zero open matching requests remain.
  let missingClosedState = step(step(edited(), { type: "prepare", key: "missing-id-closed" }), {
    type: "duplicate",
  });
  const closed = await reconcileDuplicateLock({
    epoch: missingClosedState.duplicateEpoch,
    getState: () => missingClosedState,
    dispatch: (event) => {
      missingClosedState = step(missingClosedState, event);
    },
    fetchById: async () => {
      throw new Error("should not fetch by ID");
    },
    lookupByAttempt: async () => ({ open: false, request: { id: "closed-match", reference: "REQ-CL", status: "completed" } }),
    historyRows: [],
  });
  assert.equal(closed.outcome, "resolved");
  assert.equal(closed.shouldRefreshAgent, true);
  assert.equal(isDuplicateDraft(missingClosedState), false);
});

test("delayed polling responses cannot unlock a newer duplicate or discard a newer retry key", async () => {
  let state = step(step(edited(), { type: "prepare", key: "key-1" }), {
    type: "duplicate",
    existingRequest: { id: "req-1", reference: "REQ-0001" },
  });
  const staleEpoch = state.duplicateEpoch;

  let releaseDelayedFetch!: (value: { request: DuplicateStatusRecord }) => void;
  const delayedPollPromise = reconcileDuplicateLock({
    epoch: staleEpoch,
    getState: () => state,
    dispatch: (event) => {
      state = step(state, event);
    },
    fetchById: () =>
      new Promise((resolve) => {
        releaseDelayedFetch = resolve;
      }),
    lookupByAttempt: async () => {
      throw new Error("should not run");
    },
    historyRows: [],
  });

  // Before delayed poll settles, lock 1 resolves and customer hits a duplicate on a newer request req-2.
  state = step(state, { type: "duplicate_resolved", epoch: staleEpoch, requestId: "req-1" });
  state = step(step(state, { type: "notes", notes: "FICTIONAL second duplicate" }), { type: "prepare", key: "key-2" });
  state = step(state, { type: "duplicate", existingRequest: { id: "req-2", reference: "REQ-0002" } });
  const req2Epoch = state.duplicateEpoch;

  // Delayed poll from req-1 returns cancelled; must be ignored cleanly.
  releaseDelayedFetch({ request: { id: "req-1", reference: "REQ-0001", status: "cancelled" } });
  const delayedOutcome = await delayedPollPromise;
  assert.equal(delayedOutcome.outcome, "noop");
  assert.equal(state.duplicateEpoch, req2Epoch);
  assert.equal(state.duplicateRequest?.id, "req-2");
  assert.equal(isDuplicateDraft(state), true);

  // Delayed poll returning pending after lock resolution must also remain a noop.
  let releasePending!: (value: { request: DuplicateStatusRecord }) => void;
  const delayedPendingPoll = reconcileDuplicateLock({
    epoch: req2Epoch,
    getState: () => state,
    dispatch: (event) => {
      state = step(state, event);
    },
    fetchById: () =>
      new Promise((resolve) => {
        releasePending = resolve;
      }),
    lookupByAttempt: async () => {
      throw new Error("should not run");
    },
    historyRows: [],
  });
  state = step(state, { type: "duplicate_resolved", epoch: req2Epoch, requestId: "req-2" });
  releasePending({ request: { id: "req-2", reference: "REQ-0002", status: "pending" } });
  assert.equal((await delayedPendingPoll).outcome, "noop");
  assert.equal(state.duplicateAttempt, null);

  // New attempt with retry key is preserved when an older duplicate lock resolves in the background.
  let stateWithNewRetry = step(step(edited(), { type: "prepare", key: "old-dup-key" }), {
    type: "duplicate",
    existingRequest: { id: "req-old", reference: "REQ-OLD" },
  });
  const oldEpoch = stateWithNewRetry.duplicateEpoch;
  stateWithNewRetry = step(step(stateWithNewRetry, { type: "notes", notes: "FICTIONAL modified intent" }), {
    type: "prepare",
    key: "preserve-retry-key",
  });
  const retryUnlock = await reconcileDuplicateLock({
    epoch: oldEpoch,
    getState: () => stateWithNewRetry,
    dispatch: (event) => {
      stateWithNewRetry = step(stateWithNewRetry, event);
    },
    fetchById: async (id) => ({ request: { id, reference: "REQ-OLD", status: "rejected" } }),
    lookupByAttempt: async () => {
      throw new Error("should not run");
    },
    historyRows: [],
  });
  assert.equal(retryUnlock.outcome, "resolved");
  assert.equal(stateWithNewRetry.duplicateAttempt, null);
  assert.equal(stateWithNewRetry.attempt?.idempotency_key, "preserve-retry-key");
  assert.equal(stateWithNewRetry.notes, "FICTIONAL modified intent");
});
