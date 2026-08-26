'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');

const elements = new Map();
const documentListeners = new Map();
const windowListeners = new Map();
let mutationCallback = null;
let animationFrameCallback = null;

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
    getBoundingClientRect() { return { left: 0, width: 1280, height: 720 }; }
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
const progress = makeElement('div');
progress.getBoundingClientRect = () => ({ left: 0, width: 1000, height: 4 });
const panelHost = makeElement('div');
const body = makeElement('body');
let currentVideo = makeVideo();

global.document = {
  body,
  title: 'Smoke test - YouTube',
  getElementById(id) { return elements.get(id) || null; },
  createElement(tagName) { return makeElement(tagName); },
  createDocumentFragment() { return makeElement('fragment'); },
  addEventListener(type, listener) { listenerMapAdd(documentListeners, type, listener); },
  dispatchEvent(event) {
    for (const listener of documentListeners.get(event.type) || []) listener(event);
  },
  querySelector(selector) {
    if (selector === 'video.html5-main-video') return currentVideo;
    if (selector === '.ytp-left-controls') return controls;
    if (selector === '#movie_player') return player;
    if (selector === '.ytp-progress-bar') return progress;
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
global.requestAnimationFrame = (callback) => { animationFrameCallback = callback; return 1; };
global.cancelAnimationFrame = () => { animationFrameCallback = null; };

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

async function navigate(videoId) {
  location.search = `?v=${videoId}`;
  currentVideo = makeVideo();
  mutationCallback();
  await wait(340);
}

require(path.join(__dirname, '..', 'content.js'));

document.addEventListener('youtube-study-caption-request', (event) => {
  const request = JSON.parse(event.detail || '{}');
  const body = JSON.stringify({
    events: [
      { tStartMs: 30000, dDurationMs: 2200, segs: [{ utf8: 'Target subtitle.' }] },
      { tStartMs: 32200, dDurationMs: 1800, segs: [{ utf8: 'Following subtitle.' }] }
    ]
  });
  setTimeout(() => {
    document.dispatchEvent(new CustomEvent('youtube-study-caption-response', {
      detail: JSON.stringify({ requestId: request.requestId, ok: true, status: 200, body })
    }));
  }, 0);
});

(async () => {
  await wait(140);
  assert.ok(elements.get('ytl-loop-bar'), 'A-B controls are injected');
  assert.ok(elements.get('ytl-marker-A') && elements.get('ytl-marker-B'), 'progress markers are injected');

  currentVideo.currentTime = 10;
  elements.get('ytl-setA').click();
  currentVideo.currentTime = 20;
  elements.get('ytl-setB').click();
  assert.equal(elements.get('ytl-pillA').textContent, '0:10');
  assert.equal(elements.get('ytl-pillB').textContent, '0:20');
  assert.ok(elements.get('ytl-loop').classList.contains('active'), 'valid A/B points start looping');

  currentVideo.currentTime = 20.2;
  currentVideo.fire('timeupdate');
  assert.equal(currentVideo.currentTime, 10, 'playback jumps from B back to A');

  await wait(340);
  assert.deepEqual(storage['youtubeStudyRangeLoop:video-one'], { a: 10, b: 20, loop: true });

  pressShortcut('x');
  assert.equal(elements.get('ytl-pillA').hidden, true, 'Shift+X clears the range');
  await wait(340);
  assert.equal(storage['youtubeStudyRangeLoop:video-one'], undefined, 'clearing removes saved state');

  currentVideo.currentTime = 5;
  pressShortcut('a');
  currentVideo.currentTime = 8;
  pressShortcut('b');
  await wait(340);
  await navigate('video-two');
  assert.equal(elements.get('ytl-pillA').hidden, true, 'a new video starts without old points');
  await navigate('video-one');
  assert.equal(elements.get('ytl-pillA').textContent, '0:05');
  assert.equal(elements.get('ytl-pillB').textContent, '0:08');
  assert.ok(elements.get('ytl-loop').classList.contains('active'), 'saved loop state is restored per video');

  elements.get('yt-study-toggle').click();
  document.dispatchEvent(new CustomEvent('youtube-study-tracks-response', {
    detail: JSON.stringify({
      videoId: 'video-one',
      title: 'Smoke test',
      tracks: [{
        baseUrl: 'https://www.youtube.com/api/timedtext?v=video-one&lang=en',
        languageCode: 'en',
        name: 'English',
        kind: '',
        vssId: '.en'
      }]
    })
  }));
  await wait(30);
  const transcriptList = elements.get('yt-study-list');
  const firstCue = transcriptList.children[0];
  assert.ok(firstCue, 'test transcript is rendered');
  transcriptList.dispatch('click', { target: firstCue.children[1] || firstCue });
  assert.ok(!elements.get('ytl-loop').classList.contains('active'), 'clicking a subtitle stops A-B looping');
  const selectedTime = currentVideo.currentTime;
  currentVideo.fire('timeupdate');
  assert.equal(currentVideo.currentTime, selectedTime, 'A-B engine does not pull subtitle playback back to A');
  assert.ok(selectedTime > 29.8 && selectedTime <= 30, `subtitle seeks near its own start, got ${selectedTime}`);

  if (animationFrameCallback) animationFrameCallback = null;
  console.log('A-B LOOP SMOKE TEST PASSED');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
