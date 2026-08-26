'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');

const listeners = new Map();
const requests = [];
const staleUrl = 'https://www.youtube.com/api/timedtext?v=video-one&lang=en&expire=old';
const freshUrl = 'https://www.youtube.com/api/timedtext?v=video-one&lang=en&expire=fresh';
const captionBody = JSON.stringify({
  events: [{ tStartMs: 1000, dDurationMs: 1000, segs: [{ utf8: 'Fresh caption.' }] }]
});

function addListener(type, listener) {
  const handlers = listeners.get(type) || [];
  handlers.push(listener);
  listeners.set(type, handlers);
}

class CustomEvent {
  constructor(type, options) {
    this.type = type;
    this.detail = options && options.detail;
  }
}

const player = {
  getPlayerResponse() {
    return {
      videoDetails: { videoId: 'video-one', title: 'Bridge smoke test' },
      captions: {
        playerCaptionsTracklistRenderer: {
          captionTracks: [{
            baseUrl: freshUrl,
            languageCode: 'en',
            name: { simpleText: 'English' },
            kind: '',
            vssId: '.en'
          }]
        }
      }
    };
  }
};

global.location = {
  origin: 'https://www.youtube.com',
  pathname: '/watch',
  search: '?v=video-one'
};
global.CustomEvent = CustomEvent;
global.document = {
  title: 'Bridge smoke test - YouTube',
  querySelector(selector) { return selector === '#movie_player' ? player : null; },
  addEventListener: addListener,
  dispatchEvent(event) {
    for (const listener of listeners.get(event.type) || []) listener(event);
  }
};
global.performance = { getEntriesByType() { return []; } };
global.PerformanceObserver = class PerformanceObserver {
  constructor() {}
  observe() {}
};

async function nativeFetch(url, options) {
  requests.push({ url: String(url), options });
  const isFresh = String(url).includes('expire=fresh');
  const body = isFresh ? captionBody : '';
  return {
    url: String(url),
    ok: true,
    status: 200,
    async text() { return body; },
    clone() { return { text: async () => body }; }
  };
}

global.window = {
  fetch: nativeFetch,
  ytInitialPlayerResponse: null
};

require(path.join(__dirname, '..', 'page-bridge.js'));

const responsePromise = new Promise((resolve) => {
  document.addEventListener('youtube-study-caption-response', (event) => {
    resolve(JSON.parse(event.detail || '{}'));
  });
});

document.dispatchEvent(new CustomEvent('youtube-study-caption-request', {
  detail: JSON.stringify({
    requestId: 'request-1',
    url: `${staleUrl}&fmt=json3`,
    videoId: 'video-one',
    languageCode: 'en',
    kind: '',
    vssId: '.en'
  })
}));

responsePromise.then((response) => {
  assert.equal(response.ok, true, 'caption request succeeds');
  assert.equal(response.body, captionBody, 'fresh player URL supplies caption body');
  assert.ok(requests[0].url.includes('expire=fresh'), 'fresh URL is tried before stale URL');
  assert.ok(requests[0].url.includes('fmt=json3'), 'requested caption format is preserved');
  assert.equal(requests[0].options.cache, 'no-store', 'direct fallback bypasses stale HTTP cache');
  console.log('CAPTION BRIDGE SMOKE TEST PASSED');
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
