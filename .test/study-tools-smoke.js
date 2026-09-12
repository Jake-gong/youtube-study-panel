'use strict';
require('../study-core.js');

const assert = require('node:assert/strict');
const path = require('node:path');

const elements = new Map();
const documentListeners = new Map();
const windowListeners = new Map();
let mutationCallback = null;

function listenerMapAdd(map, type, listener) {
  const listeners = map.get(type) || [];
  listeners.push(listener);
  map.set(type, listeners);
}

function createClassList(element) {
  const names = new Set();
  return {
    add(...values) { values.forEach((value) => names.add(value)); },
    remove(...values) { values.forEach((value) => names.delete(value)); },
    toggle(value, force) {
      const enabled = force === undefined ? !names.has(value) : !!force;
      if (enabled) names.add(value);
      else names.delete(value);
      return enabled;
    },
    contains(value) { return names.has(value); },
    setFromString(value) {
      names.clear();
      String(value || '').split(/\s+/).filter(Boolean).forEach((name) => names.add(name));
    }
  };
}

function makeElement(tagName = 'div') {
  const listeners = new Map();
  let elementId = '';
  let elementClassName = '';
  const element = {
    __isElement: true,
    tagName: tagName.toUpperCase(),
    hidden: false,
    checked: false,
    disabled: false,
    textContent: '',
    title: '',
    value: '',
    parentElement: null,
    children: [],
    firstChild: null,
    offsetWidth: 100,
    offsetTop: 0,
    offsetHeight: 20,
    clientHeight: 400,
    dataset: {},
    style: {
      setProperty(name, value) { this[name] = value; }
    },
    classList: null,
    addEventListener(type, listener) { listenerMapAdd(listeners, type, listener); },
    dispatch(type, event = {}) {
      for (const listener of listeners.get(type) || []) {
        listener({ target: element, preventDefault() {}, stopPropagation() {}, ...event });
      }
    },
    click() { element.dispatch('click'); },
    setAttribute(name, value) { element[name] = String(value); },
    appendChild(child) {
      if (child.tagName === 'FRAGMENT') {
        child.children.slice().forEach((fragmentChild) => element.appendChild(fragmentChild));
        child.children = [];
        return child;
      }
      child.parentElement = element;
      element.children.push(child);
      if (child.id) elements.set(child.id, child);
      return child;
    },
    append(...children) { children.forEach((child) => element.appendChild(child)); },
    prepend(child) { element.appendChild(child); },
    replaceChildren(...children) {
      element.children = [];
      children.forEach((child) => element.appendChild(child));
    },
    remove() {},
    scrollTo() {},
    querySelector(selector) {
      return selector.startsWith('#') ? elements.get(selector.slice(1)) || null : null;
    },
    closest(selector) {
      let current = element;
      while (current) {
        if (selector.startsWith('.') && current.classList.contains(selector.slice(1))) return current;
        current = current.parentElement;
      }
      return null;
    },
    getBoundingClientRect() { return { left: 0, top: 0, bottom: 20, width: 1280, height: 720 }; }
  };
  element.classList = createClassList(element);
  Object.defineProperty(element, 'id', {
    get() { return elementId; },
    set(value) {
      elementId = value;
      if (value) elements.set(value, element);
    }
  });
  Object.defineProperty(element, 'className', {
    get() { return elementClassName; },
    set(value) {
      elementClassName = value;
      element.classList.setFromString(value);
    }
  });
  Object.defineProperty(element, 'innerHTML', {
    get() { return element._html || ''; },
    set(value) {
      element._html = value;
      const pattern = /<(button|span|select|input|div)[^>]*\sid="([^"]+)"[^>]*>/gi;
      let match;
      while ((match = pattern.exec(value))) {
        const child = makeElement(match[1]);
        child.id = match[2];
        const classMatch = /class="([^"]+)"/.exec(match[0]);
        if (classMatch) child.className = classMatch[1];
      }
    }
  });
  return element;
}

function makeVideo() {
  const listeners = new Map();
  return {
    currentTime: 0,
    duration: 120,
    playbackRate: 1,
    paused: false,
    ended: false,
    addEventListener(type, listener) { listenerMapAdd(listeners, type, listener); },
    fire(type) { for (const listener of listeners.get(type) || []) listener(); },
    play() { this.paused = false; return Promise.resolve(); },
    pause() { this.paused = true; }
  };
}

const controls = makeElement('div');
const player = makeElement('div');
const panelHost = makeElement('div');
const body = makeElement('body');
let currentVideo = makeVideo();

global.document = {
  body,
  title: 'Study tools test - YouTube',
  getElementById(id) { return elements.get(id) || null; },
  createElement(tagName) { return makeElement(tagName); },
  createDocumentFragment() { return makeElement('fragment'); },
  createTextNode(text) {
    return { __isText: true, textContent: String(text), parentElement: null, children: [] };
  },
  addEventListener(type, listener) { listenerMapAdd(documentListeners, type, listener); },
  dispatchEvent(event) {
    for (const listener of documentListeners.get(event.type) || []) listener(event);
  },
  querySelector(selector) {
    if (selector === 'video.html5-main-video') return currentVideo;
    if (selector === '.ytp-left-controls') return controls;
    if (selector === '#movie_player') return player;
    if (selector === '#secondary-inner') return panelHost;
    return null;
  }
};

global.window = {
  addEventListener(type, listener) { listenerMapAdd(windowListeners, type, listener); }
};
global.location = { pathname: '/watch', search: '?v=video-one' };
global.Element = class Element {
  static [Symbol.hasInstance](instance) { return !!instance && instance.__isElement === true; }
};
global.CustomEvent = class CustomEvent { constructor(type, options) { this.type = type; this.detail = options && options.detail; } };
global.Option = function Option(text, value) { const option = makeElement('option'); option.textContent = text; option.value = value; return option; };
global.MutationObserver = class MutationObserver {
  constructor(callback) { mutationCallback = callback; }
  observe() {}
};
global.ResizeObserver = class ResizeObserver { observe() {} disconnect() {} };
global.requestAnimationFrame = () => 1;
global.cancelAnimationFrame = () => {};
global.fetch = () => Promise.resolve({
  ok: true,
  json: () => Promise.resolve([{
    word: 'fox',
    phonetic: '/fɒks/',
    meanings: [{
      partOfSpeech: 'noun',
      definitions: [
        { definition: 'A red-colored wild canine.' },
        { definition: 'A cunning person.' }
      ]
    }]
  }])
});

const storage = {};
global.chrome = {
  storage: {
    local: {
      get(key, callback) { setTimeout(() => callback({ [key]: storage[key] }), 0); },
      set(values) { Object.assign(storage, values); },
      remove(key) { delete storage[key]; }
    }
  }
};

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function pressShortcut(key) {
  for (const listener of windowListeners.get('keydown') || []) {
    listener({
      key,
      shiftKey: true,
      ctrlKey: false,
      metaKey: false,
      altKey: false,
      defaultPrevented: false,
      repeat: false,
      target: null,
      preventDefault() {},
      stopImmediatePropagation() {}
    });
  }
}

function pressKey(key) {
  for (const listener of windowListeners.get('keydown') || []) {
    listener({
      key,
      shiftKey: false,
      ctrlKey: false,
      metaKey: false,
      altKey: false,
      defaultPrevented: false,
      repeat: false,
      target: null,
      preventDefault() {},
      stopImmediatePropagation() {}
    });
  }
}

storage.youtubeStudySettings = { preferredTrack: 'zh-Hans||.zh-Hans' };

require(path.join(__dirname, '..', 'content.js'));

document.addEventListener('youtube-study-caption-request', (event) => {
  const request = JSON.parse(event.detail || '{}');
  let events;
  if (String(request.url).includes('v=video-three')) {
    // Simulate real YouTube ASR: one word-level event per word, 300ms apart.
    const words = Array.from({ length: 40 }, (_, i) => `word${String(i).padStart(2, '0')}`);
    words[9] += ',';
    words[19] += ',';
    events = words.map((word, index) => ({
      tStartMs: 1000 + index * 300,
      dDurationMs: 300,
      segs: [{ utf8: word }]
    }));
  } else {
    events = [
      { tStartMs: 10000, dDurationMs: 2200, segs: [{ utf8: 'The quick brown fox.' }] },
      { tStartMs: 12200, dDurationMs: 1800, segs: [{ utf8: 'Jumps over the lazy dog.' }] },
      { tStartMs: 14200, dDurationMs: 1800, segs: [{ utf8: 'Then it runs away.' }] }
    ];
  }
  const body = JSON.stringify({ events });
  setTimeout(() => {
    document.dispatchEvent(new CustomEvent('youtube-study-caption-response', {
      detail: JSON.stringify({ requestId: request.requestId, ok: true, status: 200, body })
    }));
  }, 0);
});

function deepText(node) {
  if (!node) return '';
  let out = node.__isText ? String(node.textContent || '') : String(node.textContent || '');
  for (const child of node.children || []) out += deepText(child);
  return out;
}

(async () => {
  await wait(140);
  await wait(120);
  assert.equal(storage.youtubeStudySettings.preferredTrack, '', 'polluted non-English track preference is cleared once on load');
  elements.get('yt-study-toggle').click();
  assert.ok(!elements.get('yt-study-panel').hidden, 'panel opens');

  document.dispatchEvent(new CustomEvent('youtube-study-tracks-response', {
    detail: JSON.stringify({
      videoId: 'video-one',
      title: 'Study tools',
      tracks: [{
        baseUrl: 'https://www.youtube.com/api/timedtext?v=video-one&lang=en',
        languageCode: 'en',
        name: 'English',
        kind: '',
        vssId: '.en'
      }]
    })
  }));
  await wait(60);

  const list = elements.get('yt-study-list');
  assert.equal(list.children.length, 3, 'three sentences are rendered');
  const firstText = list.children[0].children[1];
  const firstWord = firstText.children[0];
  assert.equal(firstWord.className, 'yt-study-word', 'first token becomes a word span');
  assert.equal(firstWord.dataset.word, 'the', 'lookup key strips case');
  assert.equal(firstWord.textContent, 'The', 'display text is preserved');

  // Auto-pause: entering a new sentence during natural playback pauses the video.
  elements.get('yt-study-autopause').click();
  assert.ok(elements.get('yt-study-autopause').classList.contains('active'), 'toggle shows active state');
  currentVideo.paused = false;
  currentVideo.currentTime = 11;
  currentVideo.fire('timeupdate');
  assert.equal(currentVideo.paused, false, 'no pause inside the same sentence');
  currentVideo.currentTime = 12.3;
  currentVideo.fire('timeupdate');
  assert.equal(currentVideo.paused, true, 'pauses after crossing into the next sentence');

  // Resuming inside the same sentence must not immediately pause again.
  currentVideo.play();
  currentVideo.currentTime = 13.5;
  currentVideo.fire('timeupdate');
  assert.equal(currentVideo.paused, false, 'resume plays on without pausing');

  // A big seek must not trigger a pause.
  currentVideo.currentTime = 30;
  currentVideo.fire('timeupdate');
  assert.equal(currentVideo.paused, false, 'large seek does not pause');

  // Hide mode blurs the transcript list.
  elements.get('yt-study-hide').click();
  assert.ok(list.classList.contains('yt-study-hidden-mode'), 'hide mode adds blur class');
  elements.get('yt-study-hide').click();
  assert.ok(!list.classList.contains('yt-study-hidden-mode'), 'hide mode toggles off');

  // Sentence stepping with plain D/A keys.
  pressKey('d');
  assert.ok(Math.abs(currentVideo.currentTime - (14.2 - 0.08)) < 0.01, `D plays the next sentence, got ${currentVideo.currentTime}`);
  pressKey('a');
  assert.ok(Math.abs(currentVideo.currentTime - (12.2 - 0.08)) < 0.01, `A plays the previous sentence, got ${currentVideo.currentTime}`);

  // R saves the current sentence; pressing it again does not duplicate.
  pressKey('r');
  const badge = elements.get('yt-study-vocab-count');
  assert.equal(badge.textContent, '1', 'badge counts the saved sentence');
  assert.equal(badge.hidden, false, 'badge becomes visible');
  pressKey('r');
  assert.equal(badge.textContent, '1', 'duplicate sentence is rejected');

  // Right-click on another row saves that sentence.
  list.dispatch('contextmenu', { target: list.children[0] });
  assert.equal(badge.textContent, '2', 'context menu saves the clicked sentence');
  const storedVocab = storage.youtubeStudyVocab;
  assert.equal(storedVocab.length, 2, 'two entries are persisted');
  assert.equal(storedVocab[0].sentence, 'The quick brown fox.', 'newest entry first');
  assert.equal(storedVocab[0].videoId, 'video-one', 'entry keeps the video id');
  assert.equal(storedVocab[0].time, 10, 'entry keeps the sentence start time');
  await wait(340);
  assert.equal(storage.youtubeStudySettings.autoPause, true, 'auto-pause setting is persisted');

  // Word lookup opens the dictionary popup and pauses playback (no original-sentence excerpt).
  currentVideo.play();
  list.dispatch('click', { target: firstWord });
  const popup = elements.get('yt-study-dict');
  assert.equal(popup.hidden, false, 'popup opens on word click');
  assert.equal(currentVideo.paused, true, 'clicking a word pauses playback');
  await wait(20);
  assert.equal(popup.dataset.state, 'ready', 'popup renders the fetched definition');
  assert.ok(!popup.children.some((child) => String(child.className || '').includes('yt-study-dict-context')),
    'no original-sentence excerpt block is rendered');
  assert.equal(popup.children[1].textContent, '/fɒks/', 'phonetic line follows the header');
  const saveWordButton = popup.children[popup.children.length - 1];
  assert.equal(saveWordButton.textContent, '收藏这个单词', 'save button is offered');
  saveWordButton.click();
  assert.equal(popup.hidden, true, 'saving closes the popup');
  assert.equal(badge.textContent, '3', 'word entry is saved');

  // Saving the same word again is rejected (cache hit path).
  list.dispatch('click', { target: firstWord });
  await wait(20);
  elements.get('yt-study-dict').children[elements.get('yt-study-dict').children.length - 1].click();
  assert.equal(badge.textContent, '3', 'duplicate word is rejected');

  // Vocab view lists entries and supports removal.
  elements.get('yt-study-vocab-toggle').click();
  assert.equal(elements.get('yt-study-vocab').hidden, false, 'vocab view opens');
  assert.equal(list.hidden, true, 'transcript is hidden while vocab view is open');
  const vocabList = elements.get('yt-study-vocab-list');
  assert.equal(vocabList.children.length, 3, 'all entries are listed');
  const removeButton = vocabList.children[0].children[1].children[1];
  vocabList.dispatch('click', { target: removeButton });
  assert.equal(elements.get('yt-study-vocab-count').textContent, '2', 'removal updates the badge');
  assert.equal(vocabList.children.length, 2, 'removal re-renders the list');

  // Plain keys are ignored while the vocab view is open.
  pressKey('d');
  assert.ok(Math.abs(currentVideo.currentTime - (12.2 - 0.08)) < 0.01, 'sentence keys are inert in vocab view');
  elements.get('yt-study-vocab-toggle').click();
  assert.equal(list.hidden, false, 'transcript returns after closing vocab view');

  // Shift+C copy falls back safely without clipboard support.
  pressShortcut('c');
  await wait(10);
  assert.equal(elements.get('yt-study-toast').hidden, false, 'copy shows feedback');
  assert.equal(elements.get('yt-study-toast').textContent, '复制失败，请重试', 'clipboard fallback reports failure safely');

  // On-video overlay subtitle follows the active sentence.
  const overlayRoot = elements.get('yt-study-player-overlay');
  assert.ok(overlayRoot, 'overlay is injected into the player');
  assert.equal(overlayRoot.hidden, false, 'overlay is visible for the active sentence');
  const overlayText = overlayRoot.children[0];
  assert.ok(overlayText.className.includes('yt-study-overlay-text'), 'overlay text container renders');
  const overlayWord = overlayText.children[0];
  assert.equal(overlayWord.className, 'yt-study-word', 'overlay sentence is split into word spans');
  assert.equal(overlayWord.dataset.word, 'jumps', `overlay shows the current sentence, got ${overlayWord.textContent}`);

  // Clicking an overlay word opens the dictionary on the video and pauses playback.
  currentVideo.play();
  const timeBeforeLookup = currentVideo.currentTime;
  overlayRoot.dispatch('click', { target: overlayWord });
  const playerDict = elements.get('yt-study-player-dict');
  assert.equal(playerDict.hidden, false, 'player dictionary popup opens');
  await wait(20);
  assert.equal(playerDict.dataset.state, 'ready', 'player popup renders the fetched definition');
  assert.equal(currentVideo.currentTime, timeBeforeLookup, 'word lookup does not seek or replay');
  assert.equal(currentVideo.paused, true, 'overlay word click pauses playback');
  const saveOverlayWord = playerDict.children[playerDict.children.length - 1];
  saveOverlayWord.click();
  assert.equal(playerDict.hidden, true, 'saving closes the player popup');
  assert.equal(elements.get('yt-study-vocab-count').textContent, '3', 'overlay word is saved with context');

  // Clicking the same word again toggles the popup closed.
  overlayRoot.dispatch('click', { target: overlayWord });
  assert.equal(playerDict.hidden, false, 'popup reopens for the same word');
  overlayRoot.dispatch('click', { target: overlayWord });
  assert.equal(playerDict.hidden, true, 'second click on the same word closes the popup');

  // Overlay save button stores the current sentence (dedupe rejects a sentence saved earlier).
  overlayRoot.dispatch('click', { target: overlayRoot.children[1].children[1] });
  assert.equal(elements.get('yt-study-vocab-count').textContent, '3', 'saving a sentence twice is deduped');
  pressKey('d');
  assert.equal(overlayText.children[0].dataset.word, 'then', 'overlay follows the next sentence');
  overlayRoot.dispatch('click', { target: overlayRoot.children[1].children[1] });
  assert.equal(elements.get('yt-study-vocab-count').textContent, '4', 'overlay save button stores the sentence');

  // Toggling the overlay off hides it and restores YouTube captions.
  elements.get('yt-study-overlay').click();
  assert.equal(overlayRoot.hidden, true, 'overlay hides when disabled');
  assert.ok(!player.classList.contains('yt-study-overlay-on'), 'native captions are no longer suppressed');
  elements.get('yt-study-overlay').click();
  assert.ok(player.classList.contains('yt-study-overlay-on'), 'overlay re-enables native caption suppression');
  assert.equal(overlayRoot.hidden, false, 'overlay content returns after re-enabling');

  // The tooltip card appears immediately with a loading state, before the network answers.
  const originalFetch = global.fetch;
  let resolvePendingFetch = null;
  global.fetch = () => new Promise((resolve) => { resolvePendingFetch = resolve; });
  currentVideo.play();
  const slowWord = overlayText.children[2];
  assert.equal(slowWord.dataset.word, 'it', 'hover target is a real word span');
  overlayRoot.dispatch('mouseover', { target: slowWord });
  await wait(220);
  const pendingTip = elements.get('yt-study-word-tip');
  assert.equal(pendingTip.hidden, false, 'tooltip shows immediately after the hover delay');
  assert.ok(deepText(pendingTip).includes('查询中'), 'tooltip shows a loading state while fetching');
  assert.equal(currentVideo.paused, false, 'hovering never pauses playback');
  overlayRoot.dispatch('mouseout', { target: slowWord });
  assert.equal(pendingTip.hidden, true, 'tooltip hides when the pointer leaves during loading');
  global.fetch = originalFetch;
  if (resolvePendingFetch) resolvePendingFetch({ ok: false });

  // Hovering a word shows a brief tooltip without interrupting playback.
  currentVideo.play();
  const hoverWord = overlayText.children[0];
  overlayRoot.dispatch('mouseover', { target: hoverWord });
  await wait(340);
  const tip = elements.get('yt-study-word-tip');
  assert.ok(tip, 'tooltip element is created on first hover');
  assert.equal(tip.hidden, false, 'tooltip becomes visible after the hover delay');
  assert.ok(deepText(tip).includes('canine'), 'tooltip shows a short definition');
  assert.equal(currentVideo.paused, false, 'hovering does not pause playback');
  // Scrolling (auto-follow) must reposition the tooltip, not kill it while its word is still rendered.
  list.dispatch('scroll');
  assert.equal(tip.hidden, false, 'tooltip survives list scrolling while its word stays rendered');
  // A cue change (updateActiveCue) must not blanket-close the tooltip either.
  currentVideo.currentTime = 14.3;
  currentVideo.fire('timeupdate');
  assert.equal(tip.hidden, false, 'tooltip survives a phrase boundary while hovering');
  overlayRoot.dispatch('mouseout', { target: hoverWord });
  assert.equal(tip.hidden, true, 'tooltip hides when the pointer leaves the word');

  // Closing the Study panel hides the overlay and restores native captions.
  elements.get('yt-study-toggle').click();
  assert.equal(overlayRoot.hidden, true, 'closing the Study panel hides the overlay');
  assert.ok(!player.classList.contains('yt-study-overlay-on'), 'native captions are no longer suppressed');
  elements.get('yt-study-toggle').click();
  assert.equal(overlayRoot.hidden, false, 'overlay returns when the panel reopens');
  assert.ok(player.classList.contains('yt-study-overlay-on'), 'caption suppression returns with the panel');

  // Shift+A/B/L/X still control the A-B loop after the new shortcuts.
  currentVideo.currentTime = 40;
  pressShortcut('a');
  currentVideo.currentTime = 50;
  pressShortcut('b');
  assert.ok(elements.get('ytl-loop').classList.contains('active'), 'range loop shortcuts still work');

  // AI dictionary mode: configure through the settings view, then hover and click route to the AI endpoint.
  elements.get('yt-study-settings-btn').click();
  assert.equal(elements.get('yt-study-settings').hidden, false, 'settings view opens');
  assert.equal(list.hidden, true, 'transcript is hidden while settings view is open');
  const modeSelect = elements.get('yt-study-ai-enabled');
  assert.equal(modeSelect.children.length, 3, 'lookup mode select offers three options');
  assert.equal(elements.get('yt-study-ai-fields').hidden, true, 'AI fields are hidden in dict mode');
  assert.equal(elements.get('yt-study-local-dict').hidden, true, 'local dict section is hidden in dict mode');
  assert.equal(elements.get('yt-study-mode-hint').hidden, false, 'dict hint is visible in dict mode');
  modeSelect.value = 'local';
  modeSelect.dispatch('change');
  assert.equal(elements.get('yt-study-local-dict').hidden, false, 'local dict section shows after selecting local');
  assert.equal(elements.get('yt-study-mode-hint').hidden, true, 'dict hint hides after selecting local');
  await wait(220);
  assert.equal(storage.youtubeStudySettings.lookupMode, 'dict', 'mode draft must not persist before Save');
  modeSelect.value = 'ai';
  modeSelect.dispatch('change');
  assert.equal(elements.get('yt-study-ai-fields').hidden, false, 'AI fields show after selecting AI mode');
  await wait(220);
  assert.equal(storage.youtubeStudySettings.lookupMode, 'dict', 'AI mode draft must not persist before Save');
  elements.get('yt-study-ai-provider').value = 'custom';
  elements.get('yt-study-ai-url').value = 'https://ai.test/v1';
  elements.get('yt-study-ai-key').value = 'test-key';
  elements.get('yt-study-ai-model').value = 'test-model';
  elements.get('yt-study-ai-save').click();
  await wait(220);
  assert.equal(storage.youtubeStudySettings.ai.enabled, true, 'AI settings are persisted');
  assert.equal(storage.youtubeStudySettings.ai.baseUrl, 'https://ai.test/v1', 'custom endpoint is stored');
  elements.get('yt-study-settings-btn').click();
  assert.equal(elements.get('yt-study-settings').hidden, true, 'settings view closes');

  // Hover routes through the AI endpoint and renders the Chinese gloss.
  const aiRequests = [];
  global.fetch = (url, options) => {
    aiRequests.push({ url, options });
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ choices: [{ message: { content: 'adv. 离开；远离' } }] }) });
  };
  currentVideo.play();
  let awaySpan = null;
  for (const child of overlayText.children) {
    if (child.dataset && child.dataset.word === 'away') { awaySpan = child; break; }
  }
  assert.ok(awaySpan, 'found the word span for the AI hover test');
  overlayRoot.dispatch('mouseover', { target: awaySpan });
  await wait(220);
  const aiTip = elements.get('yt-study-word-tip');
  assert.equal(aiTip.hidden, false, 'AI tooltip is visible');
  assert.ok(deepText(aiTip).includes('离开'), 'AI gloss is rendered');
  assert.equal(aiRequests[0].url, 'https://ai.test/v1/chat/completions', 'request targets the configured endpoint');
  assert.ok(String(aiRequests[0].options.body).includes('"away"'), 'request body carries the word');
  assert.ok(String(aiRequests[0].options.headers.Authorization).includes('test-key'), 'API key is sent as bearer');

  // Cached AI gloss resolves without a second request.
  const aiRequestCount = aiRequests.length;
  overlayRoot.dispatch('mouseout', { target: awaySpan });
  overlayRoot.dispatch('mouseover', { target: awaySpan });
  await wait(220);
  assert.equal(aiRequests.length, aiRequestCount, 'AI gloss cache prevents repeat requests');
  overlayRoot.dispatch('mouseout', { target: awaySpan });

  // Click uses the AI detail answer with the sentence context.
  global.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve({ choices: [{ message: { content: '在本句中：离开；往别处\n其他含义：作形容词表示离开的\n例句：He walked away slowly.' } }] }) });
  currentVideo.play();
  list.dispatch('click', { target: firstWord });
  await wait(30);
  const aiPopup = elements.get('yt-study-dict');
  assert.equal(aiPopup.hidden, false, 'AI detail popup opens');
  const aiPopupText = deepText(aiPopup);
  assert.ok(aiPopupText.includes('在本句中'), 'contextual meaning row is rendered');
  assert.ok(aiPopupText.includes('He walked away slowly.'), 'example row is rendered');
  assert.equal(currentVideo.paused, true, 'AI lookup still pauses playback');

  // Local dictionary mode: install via the download button, then lookups resolve offline.
  const dictFetchUrls = [];
  global.fetch = (url) => {
    const urlText = String(url);
    dictFetchUrls.push(urlText);
    if (urlText.includes('zh-gloss.json')) {
      return Promise.resolve({
        ok: true,
        text: () => Promise.resolve(JSON.stringify({
          __meta__: { words: 2 },
          fox: ['fɒks', 'n. 狐狸, 狡猾的人\\nvi. 欺骗'],
          quick: ['kwik', 'a. 快的, 迅速的']
        }))
      });
    }
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve([{ meanings: [{ partOfSpeech: 'adv', definitions: [{ definition: 'online fallback result' }] }] }])
    });
  };
  elements.get('yt-study-settings-btn').click();
  elements.get('yt-study-dict-download').click();
  await wait(60);
  assert.ok(storage.youtubeStudyLocalDict && storage.youtubeStudyLocalDict.fox, 'local dictionary is persisted');
  assert.ok(String(elements.get('yt-study-dict-status').textContent).includes('2 词'), 'status shows the installed word count');
  elements.get('yt-study-ai-enabled').value = 'local';
  elements.get('yt-study-ai-save').click();
  await wait(220);
  assert.equal(storage.youtubeStudySettings.lookupMode, 'local', 'local lookup mode is persisted');
  elements.get('yt-study-settings-btn').click();

  // Hovering a locally known word resolves instantly with no network request.
  const row0Text = list.children[0].children[1];
  let foxSpan = null;
  for (const child of row0Text.children) {
    if (child.dataset && child.dataset.word === 'fox') { foxSpan = child; break; }
  }
  assert.ok(foxSpan, 'fox word span exists');
  const dictCallsBefore = dictFetchUrls.length;
  list.dispatch('mouseover', { target: foxSpan });
  await wait(220);
  const localTip = elements.get('yt-study-word-tip');
  assert.equal(localTip.hidden, false, 'local tooltip is visible');
  assert.ok(deepText(localTip).includes('狐狸'), 'local gloss is rendered');
  assert.equal(dictFetchUrls.length, dictCallsBefore, 'local hit makes no network request');
  list.dispatch('mouseout', { target: foxSpan });

  // Hovering an unknown word falls back to the online dictionary.
  list.dispatch('mouseover', { target: row0Text.children[0] });
  await wait(220);
  assert.equal(localTip.hidden, false, 'miss fallback tooltip stays visible');
  assert.ok(!deepText(localTip).includes('查询中'), 'miss fallback resolves with content');
  list.dispatch('mouseout', { target: row0Text.children[0] });

  // Clicking a locally known word shows the full translation with context and pauses.
  currentVideo.play();
  list.dispatch('click', { target: foxSpan });
  await wait(30);
  const localPopup = elements.get('yt-study-dict');
  assert.equal(localPopup.hidden, false, 'local detail popup opens');
  const localPopupText = deepText(localPopup);
  assert.ok(localPopupText.includes('狐狸'), 'local detail shows the translation');
  assert.ok(localPopupText.includes('欺骗'), 'secondary translation line is rendered');
  assert.ok(!localPopupText.includes('原句'), 'no original-sentence excerpt is shown');
  assert.ok(localPopupText.includes('本地词典'), 'local badge is shown');
  assert.equal(currentVideo.paused, true, 'local lookup still pauses playback');

  // Fallback track selection prefers manual English over Chinese/auto tracks and is not persisted.
  location.search = '?v=video-two';
  currentVideo = makeVideo();
  mutationCallback();
  await wait(340);
  document.dispatchEvent(new CustomEvent('youtube-study-tracks-response', {
    detail: JSON.stringify({
      videoId: 'video-two',
      title: 'Mixed tracks',
      tracks: [
        { baseUrl: 'https://www.youtube.com/api/timedtext?v=video-two&lang=zh-Hans', languageCode: 'zh-Hans', name: 'Chinese', kind: '', vssId: '.zh-Hans' },
        { baseUrl: 'https://www.youtube.com/api/timedtext?v=video-two&lang=en&kind=asr', languageCode: 'en', name: 'English (auto)', kind: 'asr', vssId: 'a.en' },
        { baseUrl: 'https://www.youtube.com/api/timedtext?v=video-two&lang=en', languageCode: 'en', name: 'English', kind: '', vssId: '.en' }
      ]
    })
  }));
  await wait(60);
  assert.equal(elements.get('yt-study-track').value, '2', 'manual English track wins over Chinese and auto English');
  await wait(340);
  const storedSettings = storage.youtubeStudySettings || {};
  assert.notEqual(storedSettings.preferredTrack, 'zh-Hans||.zh-Hans', 'fallback selection is not persisted as a preference');

  // Long sentences render as a sliding window (~14 words) around the spoken word, not the full text.
  location.search = '?v=video-three';
  currentVideo = makeVideo();
  mutationCallback();
  await wait(340);
  document.dispatchEvent(new CustomEvent('youtube-study-tracks-response', {
    detail: JSON.stringify({
      videoId: 'video-three',
      title: 'Long line',
      tracks: [{ baseUrl: 'https://www.youtube.com/api/timedtext?v=video-three&lang=en&kind=asr', languageCode: 'en', name: 'English', kind: 'asr', vssId: 'a.en' }]
    })
  }));
  await wait(80);
  currentVideo.currentTime = 12.5;
  currentVideo.fire('timeupdate');
  await wait(20);
  const longOverlay = elements.get('yt-study-player-overlay');
  assert.equal(longOverlay.hidden, false, 'overlay shows the long sentence');
  // LR-style: a long native segment is displayed in full (font shrinks in real browsers).
  const windowText = deepText(longOverlay.children[0]);
  const windowWords = windowText.trim().split(/\s+/).filter(Boolean);
  assert.ok(windowWords.length <= 12, `phrase keeps at most 12 words, got ${windowWords.length}`);
  assert.ok(windowText.includes('word39'), 'the playing phrase reaches the sentence tail');
  assert.ok(windowText.trim().startsWith('word36'), 'phrase advances to the final segment');
  assert.ok(!windowText.includes('word00'), 'earlier phrases are not mixed into the current one');
  assert.ok(String(longOverlay.children[0].style['font-size'] || '').length > 0, 'font size is applied to the overlay text');
  currentVideo.currentTime = 1.2;
  currentVideo.fire('seeking');
  currentVideo.fire('timeupdate');
  await wait(20);
  const startText = deepText(longOverlay.children[0]);
  assert.ok(startText.includes('word00') && startText.includes('word09,'), 'seeking back shows the first phrase');
  assert.ok(!startText.includes('word12'), 'first phrase stops before the next one');

  console.log('STUDY TOOLS SMOKE TEST PASSED');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
