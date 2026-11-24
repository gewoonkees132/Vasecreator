// The store and its history persistence, against the in-memory database
// (Node has no IndexedDB, so openDb() falls back to it). Two stores on one
// database stand for two tabs sharing storage.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../store/store.js';
import { openDb, mergeHistory, planHistorySave, MAX_STEPS } from '../store/db.js';

// openDb() says once per call that it fell back to memory; not news here.
console.info = () => {};

const base = { form: { height: 100 }, meta: { name: 'Pot' } };
const tick = (ms = 2) => new Promise((resolve) => setTimeout(resolve, ms));

/** A tab: a store on the shared db, started from what is stored. */
async function openTab(db, { channel = null } = {}) {
  const history = await db.loadHistory();
  return createStore({ design: base, history, db, channel, label: 'Start' });
}

function setHeight(store, height) {
  return store.apply(`Height ${height}`, (d) => { d.form.height = height; });
}

// Steps from two tabs are never made in the same millisecond by hand.
async function edit(store, height) {
  await tick();
  return setHeight(store, height);
}

async function storedIds(db) {
  const records = await db.all('history');
  return records.filter((r) => r && r.id).map((r) => r.id).sort();
}

const ids = (store) => store.history().map((s) => s.id).reverse();   // oldest first
const heights = (store) => store.history().map((s) => s.design.form.height).reverse();

// A pair of linked channels, like two tabs' BroadcastChannel('vc2-history').
function channelPair() {
  const make = () => ({ handlers: [], peer: null,
    addEventListener(type, fn) { if (type === 'message') this.handlers.push(fn); },
    postMessage(data) { const peer = this.peer; setTimeout(() => peer.handlers.forEach((fn) => fn({ data })), 0); } });
  const a = make();
  const b = make();
  a.peer = b;
  b.peer = a;
  return [a, b];
}

test('mergeHistory: union by id, ordered by time, this tab first on a tie', () => {
  const stored = [{ id: 'a', time: 1 }, { id: 'b', time: 3 }, { id: 'c', time: 5 }];
  const local = [{ id: 'a', time: 1, mine: true }, { id: 'x', time: 3 }, { id: 'y', time: 6 }];
  const { steps, dropped } = mergeHistory(stored, local);
  assert.deepEqual(steps.map((s) => s.id), ['a', 'x', 'b', 'c', 'y']);
  assert.equal(steps[0].mine, true, 'the local copy wins');
  assert.deepEqual(dropped, []);
});

test('mergeHistory: the cap drops the oldest, never a kept pointer', () => {
  const stored = Array.from({ length: 6 }, (_, i) => ({ id: `s${i}`, time: i }));
  const { steps, dropped } = mergeHistory(stored, [], { cap: 3, keep: ['s0', 's2'] });
  assert.deepEqual(steps.map((s) => s.id), ['s0', 's2', 's5']);
  assert.deepEqual(dropped, ['s1', 's3', 's4']);
  // More kept than the cap: all of them stay.
  assert.equal(mergeHistory(stored, [], { cap: 2, keep: ['s0', 's1', 's2'] }).steps.length, 3);
});

test('mergeHistory: keeps each list in its own order and drops duplicate ids', () => {
  const local = [{ id: 'p', time: 10 }, { id: 'q', time: 5 }, { id: 'p', time: 10 }];
  const stored = [{ id: 'z', time: 7 }];
  assert.deepEqual(mergeHistory(stored, local).steps.map((s) => s.id), ['z', 'p', 'q']);
});

test('planHistorySave: deletes what is not in the merged list, keeps another tab\'s pointer', () => {
  const step = (id, time) => ({ id, time, label: id, design: { n: time } });
  const stored = [step('old', 1), step('theirs', 2), step('mine', 3)];
  const keys = [...stored.map((s) => s.id), 'orphan-junk'];
  const meta = { order: ['old', 'theirs', 'mine'], pointers: { tB: { id: 'old', at: 5 } } };
  const records = new Map([['theirs', stored[1]], ['orphan-junk', 42], ['old', stored[0]]]);
  const plan = planHistorySave({ meta, keys, records }, {
    steps: [step('mine', 3), step('new', 4)], dirty: ['new'], pointer: 'new', tab: 'tA', cap: 3,
  }, 9);
  assert.deepEqual(plan.meta.order, ['old', 'mine', 'new']);
  assert.deepEqual(plan.deletes.sort(), ['orphan-junk', 'theirs']);
  assert.deepEqual(plan.puts.map(([id]) => id), ['new']);
  assert.equal(plan.result.grew, true);
  assert.deepEqual(plan.meta.pointers.tA, { id: 'new', at: 9 });
  assert.equal(plan.meta.pointers.tB.id, 'old');
});

test('two tabs: interleaved steps all survive, in both tabs and in storage', async () => {
  const db = await openDb();
  assert.equal(db.persistent, false);
  const a = await openTab(db);
  await a.flush();
  const b = await openTab(db);
  assert.deepEqual(ids(b), ids(a), 'B starts from what A saved');

  await edit(a, 110);
  await a.flush();
  await edit(b, 120);
  await edit(b, 125);
  await b.flush();
  await edit(a, 130);
  await a.flush();
  await b.flush();   // B picks up A's last step

  assert.deepEqual(heights(a), [100, 110, 120, 125, 130]);
  assert.deepEqual(heights(b), heights(a));
  assert.deepEqual(await storedIds(db), [...ids(a)].sort());
  // Neither tab's design or pointer moved for the other's steps.
  assert.equal(a.state.design.form.height, 130);
  assert.equal(b.state.design.form.height, 125);
  assert.equal(b.currentStep().design.form.height, 125);

  // A reload (a new tab from the saved data) lands on the newest step.
  const c = await openTab(db);
  assert.deepEqual(ids(c), ids(a));
  assert.equal(c.state.design.form.height, 130);
  assert.equal(c.currentStep().id, ids(a).at(-1));
});

test('two tabs: undo skips the other tab\'s steps; after a reload they are ordinary steps', async () => {
  const db = await openDb();
  const a = await openTab(db);
  await a.flush();
  const b = await openTab(db);
  await edit(a, 110);
  await a.flush();
  await edit(b, 150);
  await b.flush();
  await edit(a, 111);
  await a.flush();   // A now has B's 150 between its own 110 and 111

  assert.deepEqual(heights(a), [100, 110, 150, 111]);
  a.undo();
  assert.equal(a.state.design.form.height, 110, 'undo goes to A\'s own previous step');
  a.redo();
  assert.equal(a.state.design.form.height, 111);
  assert.equal(a.canRedo(), false);

  const reloaded = await openTab(db);
  reloaded.undo();
  assert.equal(reloaded.state.design.form.height, 150);
});

test('channel: a tab hears about the other tab\'s step without moving its pointer', async () => {
  const db = await openDb();
  const [ca, cb] = channelPair();
  const a = await openTab(db, { channel: ca });
  await a.flush();
  const b = await openTab(db, { channel: cb });
  let told = 0;
  b.subscribe((_, what) => { if (what.has('history')) told += 1; });
  const before = b.state.historyId;

  await edit(a, 140);
  await a.flush();   // posts on the channel; B merges about 100 ms later
  await tick(250);
  assert.deepEqual(heights(b), [100, 140]);
  assert.ok(told > 0, 'B re-renders its history column');
  assert.equal(b.state.historyId, before);
  assert.equal(b.state.design.form.height, 100);
  assert.equal(b.canRedo(), false, 'redo does not walk onto A\'s step');
});

test('cap: the oldest steps go and their records are deleted, but never a tab\'s pointer', async () => {
  const db = await openDb();
  const a = await openTab(db);
  await a.flush();
  const b = await openTab(db);
  await b.flush();   // B's pointer (the first step) is now on record
  const firstId = b.currentStep().id;

  for (let i = 1; i <= MAX_STEPS + 20; i += 1) setHeight(a, 100 + i);
  await a.flush();

  const stored = await storedIds(db);
  assert.ok(stored.includes(firstId), 'B\'s pointer step stays');
  assert.equal(stored.length, MAX_STEPS);
  assert.equal((await db.all('history')).length, MAX_STEPS + 1, 'no records left over besides meta');
  assert.deepEqual(stored, [...ids(a)].sort());
  assert.equal(a.state.design.form.height, 100 + MAX_STEPS + 20);

  // B saves: it keeps its own step and picks up A's, so nothing is lost for B.
  await b.flush();
  assert.equal(b.currentStep().id, firstId);
  assert.equal(b.state.design.form.height, 100);
  assert.equal(b.history()[0].design.form.height, 100 + MAX_STEPS + 20);
});

test('undo then commit appends on top; older steps all stay', async () => {
  const db = await openDb();
  const s = await openTab(db);
  setHeight(s, 110);
  setHeight(s, 120);
  s.undo();
  s.undo();
  assert.equal(s.state.design.form.height, 100);
  setHeight(s, 130);
  assert.deepEqual(heights(s), [100, 110, 120, 130]);
  assert.equal(s.state.historyIndex, 0);
  await s.flush();
  const reloaded = await openTab(db);
  assert.deepEqual(heights(reloaded), [100, 110, 120, 130]);
});

test('restore appends a "Restored" step with the old design and its thumbnail', async () => {
  const db = await openDb();
  const s = await openTab(db);
  setHeight(s, 110);
  setHeight(s, 120);
  const old = s.history().find((step) => step.design.form.height === 110);
  const thumb = new Blob(['png']);
  s.setThumb(old.id, thumb);
  s.restore(old.id);
  assert.deepEqual(heights(s), [100, 110, 120, 110]);
  assert.match(s.currentStep().label, /^Restored: /);
  assert.equal(s.currentStep().thumb, thumb);
  assert.equal(s.state.design.form.height, 110);
  await s.flush();
  const reloaded = await openTab(db);
  assert.deepEqual(heights(reloaded), [100, 110, 120, 110]);
  assert.equal(reloaded.state.design.form.height, 110);
});

test('reload lands on the newest step, also after undo', async () => {
  const db = await openDb();
  const s = await openTab(db);
  setHeight(s, 110);
  setHeight(s, 120);
  s.undo();
  await s.flush();
  const reloaded = await openTab(db);
  assert.equal(reloaded.state.design.form.height, 120);
  assert.equal(reloaded.state.historyIndex, 0);
});

test('corrupt records are skipped on load and cleaned up on the next save', async () => {
  const db = await openDb();
  const s = await openTab(db);
  setHeight(s, 110);
  await s.flush();
  await db.put('history', 'junk', 'not a step');
  await db.put('history', 'nodesign', { id: 'nodesign', time: 1 });
  await db.put('history', 'mismatch', { id: 'other', time: 1, design: {} });
  const loaded = await db.loadHistory();
  assert.deepEqual(loaded.steps.map((x) => x.design.form.height), [100, 110]);
  const reloaded = createStore({ design: base, history: loaded, db });
  await reloaded.flush();
  const keys = (await db.all('history')).length;
  assert.equal(keys, 3, 'two steps and the meta record');
});

test('steps an older build left out of the order come back', async () => {
  const db = await openDb();
  const step = (id, time, height) => ({ id, time, label: id, design: { form: { height } }, savedId: null, thumb: null });
  await db.put('history', 's1', step('s1', 1, 101));
  await db.put('history', 's2', step('s2', 2, 102));
  await db.put('history', 's3', step('s3', 3, 103));
  await db.put('history', 'meta', { order: ['s1', 's3'], pointer: 0 });
  const s = await openTab(db);
  assert.deepEqual(heights(s), [101, 102, 103]);
  assert.equal(s.state.design.form.height, 103);
});

test('a failed save keeps the steps for the next one', async () => {
  const db = await openDb();
  let fail = true;
  const flaky = { ...db, saveHistory: (save) => (fail ? Promise.resolve(false) : db.saveHistory(save)) };
  const s = createStore({ design: base, db: flaky });
  setHeight(s, 110);
  await s.flush();
  assert.equal((await db.loadHistory()), null);
  fail = false;
  await s.flush();
  assert.deepEqual((await db.loadHistory()).steps.map((x) => x.design.form.height), [100, 110]);
});

test('without a db the store still works and stays bounded', () => {
  const s = createStore({ design: base });
  for (let i = 1; i <= MAX_STEPS + 5; i += 1) setHeight(s, 100 + i);
  assert.equal(s.history().length, MAX_STEPS);
  assert.equal(s.state.design.form.height, 100 + MAX_STEPS + 5);
  s.undo();
  assert.equal(s.state.design.form.height, 100 + MAX_STEPS + 4);
});

test('the step drives the mode, and switching steps adds no history step', () => {
  const store = createStore({ design: base, label: 'Start' });
  assert.equal(store.state.view.step, 'shape');
  assert.equal(store.state.view.mode, 'design');
  const steps = store.history().length;
  store.setView({ step: 'print' });
  assert.equal(store.state.view.mode, 'print');
  // mode follows the step and can't be set on its own; an unknown step is ignored.
  store.setView({ mode: 'design' });
  assert.equal(store.state.view.mode, 'print');
  store.setView({ step: 'nowhere' });
  assert.equal(store.state.view.step, 'print');
  store.setView({ step: 'pattern' });
  assert.equal(store.state.view.mode, 'design');
  assert.equal(store.history().length, steps);
});
