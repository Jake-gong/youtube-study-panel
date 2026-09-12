'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { paginateCue, createAiClient } = require('../study-core.js');
const source = fs.readFileSync(path.join(__dirname, '../content.js'), 'utf8');
const grab = name => source.match(new RegExp('  (?:async )?function ' + name + '\\([^]*?\\n  }'))[0];
const words = Array.from({ length: 80 }, (_, i) => `word${i}`).join(' ');
for (const text of [words, '超长中文'.repeat(30), 'W'.repeat(160)]) {
  const cue = { start: 4, end: 28, text };
  const pages = paginateCue(cue, text => text.length <= 30);
  assert.ok(pages.length > 1);
  assert.equal(pages.map(p => p.text).join('').replace(/\s/g, ''), text.replace(/\s/g, ''));
  assert.ok(pages.every(p => p.text.length <= 30 && p.end > p.start));
  assert.equal(pages[0].start, 4);
  assert.equal(pages.at(-1).end, 28);
  pages.slice(1).forEach((p, i) => assert.equal(p.start, pages[i].end));
}
const anchored = paginateCue({ start: 0, end: 10, text: 'one two three four' }, t => t.length <= 7,
  [{ start: 0, text: 'one' }, { start: 1, text: 'two' }, { start: 7, text: 'three' }, { start: 9, text: 'four' }]);
assert.equal(anchored[1].start, 7, 'use native timing at page boundary');
let played = 0;
const keyContext = { getCueRow: () => ({ index: 0 }), playCue: () => played++, toggleSentenceLoop() {} };
vm.createContext(keyContext); vm.runInContext(grab('handleCueKeydown'), keyContext);
keyContext.handleCueKeydown({ key: 'Enter', target: { closest: () => ({}) }, preventDefault() { throw Error('button intercepted'); } });
assert.equal(played, 0);
keyContext.handleCueKeydown({ key: 'Enter', target: { closest: () => null }, preventDefault() {} });
assert.equal(played, 1);

(async () => {
  let finish;
  const wait = new Promise(resolve => { finish = resolve; });
  const ctx = { settings: { ai: { model: 'old' } }, aiTestRunning: false,
    collectAiSettings: () => ({ baseUrl: 'https://example.invalid', apiKey: 'dummy', model: 'draft' }),
    byId: () => null, showToast() {}, fetchAiChat: () => wait };
  vm.createContext(ctx); vm.runInContext(grab('testAiConnection'), ctx);
  const job = ctx.testAiConnection(); ctx.settings.ai = { model: 'new' }; finish('ok'); await job;
  assert.equal(ctx.settings.ai.model, 'new', 'test cannot restore old settings');
  let calls = 0;
  const hanging = (_url, { signal }) => new Promise((resolve, reject) => {
    calls++; signal.addEventListener('abort', () => reject(Object.assign(new Error('cancelled'), { name: 'AbortError' })));
  });
  const config = { baseUrl: 'https://example.invalid/v1', apiKey: 'dummy', model: 'model' };
  const client = createAiClient(hanging, 20);
  const a = client.request(config, [], 8, 'hover');
  const b = client.request(config, [], 8, 'hover');
  assert.equal(a, b); assert.equal(calls, 1, 'deduplicate concurrent requests');
  await assert.rejects(a, /超时/);
  const c = client.request(config, [], 8, 'detail');
  client.cancel('detail'); await assert.rejects(c, { name: 'AbortError' });
  await assert.rejects(client.request({ ...config, baseUrl: 'http://example.invalid' }, [], 8), /HTTPS/);
  console.log('RELIABILITY REGRESSIONS PASSED');
})().catch(error => { console.error(error); process.exitCode = 1; });
