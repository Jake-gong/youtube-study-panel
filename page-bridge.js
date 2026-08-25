(function () {
  'use strict';

  if (window.__youtubeStudyBridgeInstalled) return;
  window.__youtubeStudyBridgeInstalled = true;

  const REQUEST_EVENT = 'youtube-study-request-tracks';
  const RESPONSE_EVENT = 'youtube-study-tracks-response';
  const CAPTION_REQUEST_EVENT = 'youtube-study-caption-request';
  const CAPTION_RESPONSE_EVENT = 'youtube-study-caption-response';
  const captionResourceUrls = [];
  const captionResponses = [];
  const nativeFetch = window.fetch.bind(window);

  function textFromRuns(value) {
    if (!value) return '';
    if (typeof value.simpleText === 'string') return value.simpleText;
    if (Array.isArray(value.runs)) return value.runs.map((run) => run.text || '').join('');
    return '';
  }

  function getPlayerResponse() {
    const player = document.querySelector('#movie_player');
    if (player && typeof player.getPlayerResponse === 'function') {
      try {
        const response = player.getPlayerResponse();
        if (response) return typeof response === 'string' ? JSON.parse(response) : response;
      } catch (error) {
        console.debug('[YouTube Study] Unable to read player response', error);
      }
    }
    return window.ytInitialPlayerResponse || null;
  }

  function getVideoId() {
    const match = location.pathname.match(/^\/(?:shorts|live|embed)\/([\w-]{5,})/);
    if (match) return match[1];
    return new URLSearchParams(location.search).get('v');
  }

  function collectTracks() {
    const response = getPlayerResponse();
    const renderer = response && response.captions && response.captions.playerCaptionsTracklistRenderer;
    const captionTracks = renderer && Array.isArray(renderer.captionTracks) ? renderer.captionTracks : [];
    const videoDetails = response && response.videoDetails;

    return {
      videoId: (videoDetails && videoDetails.videoId) || getVideoId(),
      title: (videoDetails && videoDetails.title) || document.title.replace(/\s*-\s*YouTube\s*$/, ''),
      tracks: captionTracks.map((track, index) => ({
        index,
        baseUrl: track.baseUrl || '',
        languageCode: track.languageCode || '',
        name: textFromRuns(track.name) || track.languageCode || `Track ${index + 1}`,
        kind: track.kind || '',
        vssId: track.vssId || '',
        isTranslatable: !!track.isTranslatable
      })).filter((track) => track.baseUrl)
    };
  }

  document.addEventListener(REQUEST_EVENT, () => {
    document.dispatchEvent(new CustomEvent(RESPONSE_EVENT, {
      detail: JSON.stringify(collectTracks())
    }));
  });

  function sendCaptionResponse(payload) {
    document.dispatchEvent(new CustomEvent(CAPTION_RESPONSE_EVENT, {
      detail: JSON.stringify(payload)
    }));
  }

  function isAllowedCaptionUrl(value) {
    try {
      const url = new URL(value, location.origin);
      const hostname = url.hostname.toLowerCase();
      return url.protocol === 'https:' && (hostname === 'youtube.com' || hostname.endsWith('.youtube.com'));
    } catch (error) {
      return false;
    }
  }

  function rememberCaptionResource(value) {
    if (!isAllowedCaptionUrl(value)) return;
    const url = new URL(value, location.origin);
    if (!url.pathname.includes('/api/timedtext')) return;
    const normalized = url.toString();
    const previousIndex = captionResourceUrls.indexOf(normalized);
    if (previousIndex >= 0) captionResourceUrls.splice(previousIndex, 1);
    captionResourceUrls.unshift(normalized);
    if (captionResourceUrls.length > 30) captionResourceUrls.length = 30;
  }

  function rememberCaptionResponse(value, body) {
    if (typeof body !== 'string' || !body.trim() || !isAllowedCaptionUrl(value)) return;
    const url = new URL(value, location.origin);
    if (!url.pathname.includes('/api/timedtext')) return;
    const normalized = url.toString();
    rememberCaptionResource(normalized);
    const previousIndex = captionResponses.findIndex((entry) => entry.url === normalized);
    if (previousIndex >= 0) captionResponses.splice(previousIndex, 1);
    captionResponses.unshift({ url: normalized, body, capturedAt: Date.now() });
    if (captionResponses.length > 20) captionResponses.length = 20;
  }

  function matchesCaptionRequest(value, request) {
    let requestedUrl;
    try {
      requestedUrl = new URL(request.url, location.origin);
    } catch (error) {
      return false;
    }
    const candidate = new URL(value, location.origin);
    const videoId = request.videoId || requestedUrl.searchParams.get('v') || '';
    const languageCode = request.languageCode || requestedUrl.searchParams.get('lang') || '';
    const candidateVideoId = candidate.searchParams.get('v') || '';
    const candidateLanguage = candidate.searchParams.get('tlang') || candidate.searchParams.get('lang') || '';
    return (!videoId || candidateVideoId === videoId) && (!languageCode || candidateLanguage === languageCode);
  }

  function findCapturedCaption(request) {
    const matching = captionResponses.filter((entry) => matchesCaptionRequest(entry.url, request));
    return matching.find((entry) => {
      const candidate = new URL(entry.url);
      return candidate.searchParams.has('pot') || candidate.searchParams.has('potc');
    }) || matching[0] || null;
  }

  function waitForCapturedCaption(request, timeoutMs) {
    return new Promise((resolve) => {
      const startedAt = Date.now();
      const check = () => {
        const entry = findCapturedCaption(request);
        if (entry || Date.now() - startedAt >= timeoutMs) {
          resolve(entry);
          return;
        }
        setTimeout(check, 80);
      };
      check();
    });
  }

  function collectCaptionResources(entries) {
    for (const entry of entries) rememberCaptionResource(entry && entry.name);
  }

  function findRecordedCaptionUrls(request, limit) {
    const matching = captionResourceUrls.filter((value) => matchesCaptionRequest(value, request));
    const preferred = [];
    const fallback = [];
    for (const value of matching) {
      let candidate;
      try {
        candidate = new URL(value);
      } catch (error) {
        continue;
      }
      if (candidate.searchParams.has('pot') || candidate.searchParams.has('potc')) preferred.push(value);
      else fallback.push(value);
    }
    return preferred.concat(fallback).slice(0, Number.isFinite(limit) ? limit : 4);
  }

  async function askPlayerForCaptionBody(request) {
    const existing = findCapturedCaption(request);
    if (existing) return existing.body;
    const player = document.querySelector('#movie_player');
    if (!player || typeof player.getOption !== 'function' || typeof player.setOption !== 'function') return '';

    let originalTrack = null;
    try {
      if (typeof player.loadModule === 'function') player.loadModule('captions');
      originalTrack = player.getOption('captions', 'track') || null;
      const trackList = player.getOption('captions', 'tracklist');
      const availableTracks = Array.isArray(trackList) ? trackList : [];
      const targetTrack = availableTracks.find((track) => request.vssId && track.vssId === request.vssId)
        || availableTracks.find((track) => track.languageCode === request.languageCode && (!request.kind || track.kind === request.kind))
        || { languageCode: request.languageCode, kind: request.kind || '' };
      player.setOption('captions', 'track', {});
      await new Promise((resolve) => setTimeout(resolve, 250));
      player.setOption('captions', 'track', targetTrack);
      const captured = await waitForCapturedCaption(request, 6000);
      return captured ? captured.body : '';
    } catch (error) {
      console.debug('[YouTube Study] Player caption activation failed', error);
      return '';
    } finally {
      try {
        if (originalTrack && originalTrack.languageCode) player.setOption('captions', 'track', originalTrack);
        else player.setOption('captions', 'track', {});
      } catch (error) {
        console.debug('[YouTube Study] Unable to restore caption state', error);
      }
    }
  }

  function installCaptionInterceptors() {
    window.fetch = function (...args) {
      const requestUrl = typeof args[0] === 'string' ? args[0] : args[0] && args[0].url;
      const promise = nativeFetch(...args);
      promise.then((response) => {
        const responseUrl = response.url || requestUrl;
        if (!responseUrl || !String(responseUrl).includes('/api/timedtext')) return;
        response.clone().text()
          .then((body) => rememberCaptionResponse(responseUrl, body))
          .catch(() => {});
      }).catch(() => {});
      return promise;
    };

    if (typeof XMLHttpRequest !== 'function') return;
    const nativeOpen = XMLHttpRequest.prototype.open;
    const nativeSend = XMLHttpRequest.prototype.send;
    const requestUrls = new WeakMap();

    XMLHttpRequest.prototype.open = function (method, url, ...rest) {
      requestUrls.set(this, String(url || ''));
      return nativeOpen.call(this, method, url, ...rest);
    };

    XMLHttpRequest.prototype.send = function (...args) {
      const requestUrl = requestUrls.get(this) || '';
      if (requestUrl.includes('/api/timedtext')) {
        this.addEventListener('load', () => {
          try {
            const body = !this.responseType || this.responseType === 'text'
              ? this.responseText
              : this.responseType === 'json' && this.response
                ? JSON.stringify(this.response)
                : '';
            rememberCaptionResponse(this.responseURL || requestUrl, body);
          } catch (error) {
            console.debug('[YouTube Study] Unable to capture XHR caption body', error);
          }
        }, { once: true });
      }
      return nativeSend.apply(this, args);
    };
  }

  installCaptionInterceptors();

  try {
    collectCaptionResources(performance.getEntriesByType('resource'));
    const resourceObserver = new PerformanceObserver((list) => collectCaptionResources(list.getEntries()));
    resourceObserver.observe({ type: 'resource', buffered: true });
  } catch (error) {
    console.debug('[YouTube Study] Resource monitoring unavailable', error);
  }

  document.addEventListener(CAPTION_REQUEST_EVENT, async (event) => {
    let request;
    try {
      request = JSON.parse(event.detail || '{}');
    } catch (error) {
      return;
    }
    const requestId = typeof request.requestId === 'string' ? request.requestId : '';
    const url = typeof request.url === 'string' ? request.url : '';
    if (!requestId) return;
    if (!isAllowedCaptionUrl(url)) {
      sendCaptionResponse({ requestId, ok: false, error: '字幕地址未通过安全校验' });
      return;
    }

    try {
      const capturedBody = await askPlayerForCaptionBody(request);
      if (capturedBody.trim()) {
        sendCaptionResponse({ requestId, ok: true, status: 200, body: capturedBody });
        return;
      }

      const recordedUrls = findRecordedCaptionUrls(request);
      const candidateUrls = recordedUrls.slice();
      if (!candidateUrls.includes(url)) candidateUrls.push(url);
      let lastError = '';
      for (const candidateUrl of candidateUrls) {
        try {
          const response = await nativeFetch(candidateUrl, { credentials: 'include' });
          const body = await response.text();
          if (response.ok && body.trim()) {
            sendCaptionResponse({ requestId, ok: true, status: response.status, body });
            return;
          }
          lastError = response.ok
            ? (recordedUrls.length ? '播放器字幕请求已发出，但未能截获正文' : '播放器未生成可用的字幕请求')
            : `YouTube 返回 HTTP ${response.status}`;
        } catch (error) {
          lastError = error instanceof Error ? error.message : '字幕网络请求失败';
        }
      }
      sendCaptionResponse({ requestId, ok: false, error: lastError || '未找到可用的字幕地址' });
    } catch (error) {
      sendCaptionResponse({
        requestId,
        ok: false,
        error: error instanceof Error ? error.message : '字幕网络请求失败'
      });
    }
  });
})();
