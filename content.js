(function () {
  'use strict';

  const REQUEST_EVENT = 'youtube-study-request-tracks';
  const RESPONSE_EVENT = 'youtube-study-tracks-response';
  const CAPTION_REQUEST_EVENT = 'youtube-study-caption-request';
  const CAPTION_RESPONSE_EVENT = 'youtube-study-caption-response';
  const SETTINGS_KEY = 'youtubeStudySettings';
  const VOCAB_KEY = 'youtubeStudyVocab';
  const RANGE_LOOP_STORAGE_PREFIX = 'youtubeStudyRangeLoop:';
  const RATE_MIN = 0.25;
  const RATE_MAX = 2;
  const RATE_STEP = 0.05;
  const SEEK_PREROLL_SECONDS = 0.08;
  const CUE_HIGHLIGHT_LOCK_MS = 1200;
  const AUTO_PAUSE_MAX_STEP_SECONDS = 2.5;
  const DICT_API_PREFIX = 'https://api.dictionaryapi.dev/api/v2/entries/en/';
  const WORD_TIP_DELAY_MS = 150;
  const { paginateCue, createAiClient } = globalThis.YouTubeStudyCore;
  const aiClient = createAiClient((...args) => fetch(...args));
  const DICT_FETCH_TIMEOUT_MS = 5000;
  const DICT_CACHE_STORAGE_KEY = 'youtubeStudyDictCache';
  const DICT_CACHE_MAX_PERSISTED = 800;
  const VOCAB_MAX_ENTRIES = 5000;
  const AI_GLOSS_CACHE_KEY = 'youtubeStudyAiGlossCache';
  const AI_DETAIL_CACHE_KEY = 'youtubeStudyAiDetailCache';
  const AI_GLOSS_CACHE_MAX = 2000;
  const AI_DETAIL_CACHE_MAX = 1000;
  const LOCAL_DICT_STORAGE_KEY = 'youtubeStudyLocalDict';
  const LOCAL_DICT_BUNDLED_PATH = 'dict/zh-gloss.json';
  const LOCAL_DICT_REMOTE_URL = 'https://raw.githubusercontent.com/Jake-gong/youtube-study-panel/main/dict/zh-gloss.json';
  const AI_PROVIDERS = {
    zhipu: { label: '智谱 GLM（glm-4-flash 免费）', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash', keyHint: 'open.bigmodel.cn 获取' },
    deepseek: { label: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', keyHint: 'platform.deepseek.com 获取' },
    moonshot: { label: 'Kimi（月之暗面）', baseUrl: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k', keyHint: 'platform.moonshot.cn 获取' },
    openai: { label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', keyHint: 'platform.openai.com 获取' },
    dashscope: { label: '通义千问', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-turbo', keyHint: 'dashscope.console.aliyun.com 获取' },
    custom: { label: '自定义（OpenAI 兼容）', baseUrl: '', model: '', keyHint: '填写任意 OpenAI 兼容接口' }
  };
  const DEFAULT_SETTINGS = {
    panelOpen: false,
    rememberRate: true,
    rate: 1,
    preferredTrack: '',
    autoPause: false,
    hideMode: false,
    overlay: true,
    lookupMode: 'dict',
    ai: {
      enabled: false,
      provider: 'zhipu',
      baseUrl: AI_PROVIDERS.zhipu.baseUrl,
      apiKey: '',
      model: AI_PROVIDERS.zhipu.model
    }
  };

  let settings = { ...DEFAULT_SETTINGS };
  let video = null;
  let videoAbortController = null;
  let currentVideoId = null;
  let videoTitle = '';
  let tracks = [];
  let cues = [];
  let cueElements = [];
  let selectedTrackIndex = -1;
  let activeCueIndex = -1;
  let sentenceLoopIndex = -1;
  let cueHighlightLock = null;
  let panelOpen = false;
  let followEnabled = true;
  let injectTimer = 0;
  let saveTimer = 0;
  let trackLoadToken = 0;
  let trackRequestTimer = 0;
  let trackRequestAttempts = 0;
  let playerResizeObserver = null;
  let observedPlayer = null;
  let captionRequestSequence = 0;
  let rangeLoopA = null;
  let rangeLoopB = null;
  let rangeLooping = false;
  let rangeLoopTickId = 0;
  let rangeLoopTickVideo = null;
  let rangeLoopSaveTimer = 0;
  let rangeLoopLoadToken = 0;
  let rangeLoopPreviousState = false;
  let rangeLoopResizeObserver = null;
  let rangeLoopDragPoint = null;
  let rangeLoopDragWasPlaying = false;
  let vocabEntries = [];
  let vocabOpen = false;
  let settingsOpen = false;
  let aiGlossCache = new Map();
  let aiDetailCache = new Map();
  let aiCachePersistTimer = 0;
  let localDictMap = new Map();
  let localDictWordCount = 0;
  let overlayChunks = [];
  let activeChunkIndex = -1;
  let overlayLayoutKey = '';
  let captionSegments = [];
  let aiTestRunning = false;
  let overlayFontSize = 0;
  let autoPauseLastIndex = -1;
  let autoPauseLastTime = -Infinity;
  let dictRequestToken = 0;
  let dictPopupState = { word: '', cueIndex: -1 };
  let wordTipTimer = 0;
  let wordTipActive = { word: '', anchor: null };
  let dictPersistTimer = 0;
  let playerOverlay = null;
  let playerDictPopup = null;
  let overlayRafId = 0;
  let toastTimer = 0;
  const captionCache = new Map();
  const pendingCaptionRequests = new Map();
  const dictCache = new Map();

  function byId(id) {
    return document.getElementById(id);
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function normalizeRate(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return 1;
    return Math.round(clamp(number, RATE_MIN, RATE_MAX) * 100) / 100;
  }

  function getVideoId() {
    const match = location.pathname.match(/^\/(?:shorts|live|embed)\/([\w-]{5,})/);
    if (match) return match[1];
    try {
      return new URLSearchParams(location.search).get('v');
    } catch (error) {
      return null;
    }
  }

  function formatClock(seconds) {
    const value = Math.max(0, Number(seconds) || 0);
    const hours = Math.floor(value / 3600);
    const minutes = Math.floor((value % 3600) / 60);
    const secs = Math.floor(value % 60);
    if (hours) {
      return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    }
    return `${minutes}:${String(secs).padStart(2, '0')}`;
  }

  function formatTimestamp(seconds, separator) {
    const milliseconds = Math.max(0, Math.round((Number(seconds) || 0) * 1000));
    const hours = Math.floor(milliseconds / 3600000);
    const minutes = Math.floor((milliseconds % 3600000) / 60000);
    const secs = Math.floor((milliseconds % 60000) / 1000);
    const millis = milliseconds % 1000;
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}${separator}${String(millis).padStart(3, '0')}`;
  }

  function cleanCaptionText(text) {
    return String(text || '')
      .replace(/[\u200B-\u200D\uFEFF]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function rangeLoopStorageKey(videoId) {
    return `${RANGE_LOOP_STORAGE_PREFIX}${videoId}`;
  }

  function knownVideoDuration() {
    return video && Number.isFinite(video.duration) && video.duration > 0 ? video.duration : null;
  }

  function normalizeRangePoint(value, duration) {
    return Number.isFinite(value) && value >= 0 && (duration === null || value <= duration) ? value : null;
  }

  function validateRangeLoop() {
    const previousA = rangeLoopA;
    const previousB = rangeLoopB;
    const previousLooping = rangeLooping;
    const duration = knownVideoDuration();
    rangeLoopA = normalizeRangePoint(rangeLoopA, duration);
    rangeLoopB = normalizeRangePoint(rangeLoopB, duration);
    if (rangeLoopA !== null && rangeLoopB !== null && rangeLoopB <= rangeLoopA) rangeLoopB = null;
    if (rangeLoopA === null || rangeLoopB === null) rangeLooping = false;
    return !Object.is(previousA, rangeLoopA)
      || !Object.is(previousB, rangeLoopB)
      || previousLooping !== rangeLooping;
  }

  function saveRangeLoop() {
    if (!currentVideoId) return;
    const videoId = currentVideoId;
    const key = rangeLoopStorageKey(videoId);
    clearTimeout(rangeLoopSaveTimer);
    rangeLoopSaveTimer = setTimeout(() => {
      if (videoId !== currentVideoId) return;
      if (rangeLoopA === null && rangeLoopB === null) {
        chrome.storage.local.remove(key);
      } else {
        chrome.storage.local.set({
          [key]: { a: rangeLoopA, b: rangeLoopB, loop: rangeLooping }
        });
      }
    }, 300);
  }

  function loadRangeLoop(videoId) {
    if (!videoId) return;
    const token = ++rangeLoopLoadToken;
    const key = rangeLoopStorageKey(videoId);
    chrome.storage.local.get(key, (result) => {
      if (token !== rangeLoopLoadToken || videoId !== currentVideoId) return;
      const stored = result && result[key];
      if (!stored || typeof stored !== 'object') return;
      const duration = knownVideoDuration();
      rangeLoopA = normalizeRangePoint(stored.a, duration);
      rangeLoopB = normalizeRangePoint(stored.b, duration);
      if (rangeLoopA !== null && rangeLoopB !== null && rangeLoopB <= rangeLoopA) rangeLoopB = null;
      rangeLooping = !!stored.loop && rangeLoopA !== null && rangeLoopB !== null;
      if (rangeLooping) startRangeLoopTick();
      refreshRangeLoopUI();
      if (!Object.is(rangeLoopA, stored.a)
          || !Object.is(rangeLoopB, stored.b)
          || rangeLooping !== !!stored.loop) saveRangeLoop();
    });
  }

  function setRangeLoopVisibility(id, visible) {
    const element = byId(id);
    if (element) element.hidden = !visible;
  }

  function pulseRangeLoopElement(element, className) {
    if (!element) return;
    element.classList.remove(className);
    void element.offsetWidth;
    element.classList.add(className);
  }

  function refreshRangeLoopUI() {
    const hasA = rangeLoopA !== null;
    const hasB = rangeLoopB !== null;
    setRangeLoopVisibility('ytl-pillA', hasA);
    setRangeLoopVisibility('ytl-undoA', hasA);
    setRangeLoopVisibility('ytl-pillB', hasB);
    setRangeLoopVisibility('ytl-undoB', hasB);
    if (hasA && byId('ytl-pillA')) byId('ytl-pillA').textContent = formatClock(rangeLoopA);
    if (hasB && byId('ytl-pillB')) byId('ytl-pillB').textContent = formatClock(rangeLoopB);
    const toggle = byId('ytl-loop');
    if (toggle) {
      toggle.classList.toggle('active', rangeLooping);
      toggle.setAttribute('aria-pressed', String(rangeLooping));
    }
    if (rangeLooping !== rangeLoopPreviousState) {
      rangeLoopPreviousState = rangeLooping;
      pulseRangeLoopElement(byId('ytl-knobface'), 'squash');
    }
    const setA = byId('ytl-setA');
    const setB = byId('ytl-setB');
    if (setA) setA.classList.toggle('set', hasA);
    if (setB) setB.classList.toggle('set', hasB);
    setRangeLoopVisibility('ytl-clear', hasA || hasB);
    updateRangeLoopMarkers();
  }

  function cancelRangeLoopTick() {
    if (!rangeLoopTickId) return;
    if (rangeLoopTickVideo && typeof rangeLoopTickVideo.cancelVideoFrameCallback === 'function') {
      rangeLoopTickVideo.cancelVideoFrameCallback(rangeLoopTickId);
    } else {
      cancelAnimationFrame(rangeLoopTickId);
    }
    rangeLoopTickId = 0;
    rangeLoopTickVideo = null;
  }

  function startRangeLoopTick() {
    if (rangeLoopTickId || !rangeLooping || !video || video.paused || video.ended) return;
    rangeLoopTickVideo = video;
    rangeLoopTickId = typeof video.requestVideoFrameCallback === 'function'
      ? video.requestVideoFrameCallback(runRangeLoopTick)
      : requestAnimationFrame(runRangeLoopTick);
  }

  function runRangeLoopTick() {
    rangeLoopTickId = 0;
    rangeLoopTickVideo = null;
    checkRangeLoopPoint();
    startRangeLoopTick();
  }

  function checkRangeLoopPoint() {
    if (!rangeLooping || !video || rangeLoopA === null || rangeLoopB === null) return;
    if (video.currentTime >= rangeLoopB - 0.05) video.currentTime = rangeLoopA;
  }

  function startRangeLoop() {
    if (rangeLoopA === null || rangeLoopB === null || rangeLoopB <= rangeLoopA) return;
    stopSentenceLoop();
    rangeLooping = true;
    startRangeLoopTick();
    refreshRangeLoopUI();
    saveRangeLoop();
  }

  function stopRangeLoop(save = true) {
    rangeLooping = false;
    cancelRangeLoopTick();
    refreshRangeLoopUI();
    if (save) saveRangeLoop();
  }

  function toggleRangeLoop() {
    if (rangeLooping) stopRangeLoop();
    else startRangeLoop();
  }

  function setRangeLoopPoint(letter) {
    if (!video) return;
    const point = video.currentTime;
    if (letter === 'A') {
      if (rangeLoopB !== null && point >= rangeLoopB) rangeLoopB = null;
      rangeLoopA = point;
    } else {
      if (rangeLoopA !== null && point <= rangeLoopA) rangeLoopA = null;
      rangeLoopB = point;
    }
    pulseRangeLoopElement(byId(`ytl-set${letter}`), 'flash');
    if (rangeLoopA !== null && rangeLoopB !== null && rangeLoopB > rangeLoopA) startRangeLoop();
    else {
      stopRangeLoop(false);
      saveRangeLoop();
    }
  }

  function removeRangeLoopPoint(letter) {
    if (letter === 'A') rangeLoopA = null;
    else rangeLoopB = null;
    stopRangeLoop(false);
    saveRangeLoop();
  }

  function clearRangeLoop() {
    rangeLoopA = null;
    rangeLoopB = null;
    stopRangeLoop(false);
    saveRangeLoop();
  }

  function resetRangeLoop() {
    rangeLoopLoadToken++;
    cancelRangeLoopTick();
    rangeLoopA = null;
    rangeLoopB = null;
    rangeLooping = false;
    refreshRangeLoopUI();
  }

  function ensureRangeLoopBar() {
    const existing = byId('ytl-loop-bar');
    if (existing) {
      updateRangeLoopBarDensity();
      return;
    }
    const controls = document.querySelector('.ytp-left-controls');
    if (!controls) return;
    const bar = document.createElement('div');
    bar.id = 'ytl-loop-bar';
    bar.className = 'yt-loop-bar in-player';
    bar.innerHTML = `
      <button class="yt-loop-btn btn-a" id="ytl-setA" type="button" title="设置循环起点（Shift+A）">A</button>
      <button class="yt-loop-btn undo-btn" id="ytl-undoA" type="button" title="删除 A 点" hidden>×</button>
      <span class="yt-loop-pill pill-a" id="ytl-pillA" hidden></span>
      <span class="yt-loop-sep"></span>
      <button class="yt-loop-btn btn-b" id="ytl-setB" type="button" title="设置循环终点（Shift+B）">B</button>
      <button class="yt-loop-btn undo-btn" id="ytl-undoB" type="button" title="删除 B 点" hidden>×</button>
      <span class="yt-loop-pill pill-b" id="ytl-pillB" hidden></span>
      <span class="yt-loop-sep"></span>
      <button class="yt-loop-toggle" id="ytl-loop" type="button" title="开启或暂停 A-B 循环（Shift+L）" aria-label="开启或暂停 A-B 循环" aria-pressed="false">
        <span class="yt-loop-knob"><span class="knob-face" id="ytl-knobface"><span class="ic ic-on">✓</span><span class="ic ic-off">×</span></span></span>
      </button>
      <span class="yt-loop-label">AB</span>
      <button class="yt-loop-btn clear-btn" id="ytl-clear" type="button" title="清除循环点（Shift+X）" hidden>清除</button>`;
    controls.appendChild(bar);
    byId('ytl-setA').addEventListener('click', () => setRangeLoopPoint('A'));
    byId('ytl-setB').addEventListener('click', () => setRangeLoopPoint('B'));
    byId('ytl-undoA').addEventListener('click', () => removeRangeLoopPoint('A'));
    byId('ytl-undoB').addEventListener('click', () => removeRangeLoopPoint('B'));
    byId('ytl-loop').addEventListener('click', toggleRangeLoop);
    byId('ytl-clear').addEventListener('click', clearRangeLoop);
    bar.addEventListener('click', (event) => {
      const button = event.target.closest('.yt-loop-btn');
      if (button) pulseRangeLoopElement(button, 'pressed');
    });
    refreshRangeLoopUI();
    updateRangeLoopBarDensity();
    if (typeof ResizeObserver === 'function') {
      if (rangeLoopResizeObserver) rangeLoopResizeObserver.disconnect();
      rangeLoopResizeObserver = new ResizeObserver(updateRangeLoopBarDensity);
      const player = document.querySelector('#movie_player');
      if (player) rangeLoopResizeObserver.observe(player);
    }
  }

  function updateRangeLoopBarDensity() {
    const bar = byId('ytl-loop-bar');
    const player = document.querySelector('#movie_player');
    if (!bar || !player) return;
    const width = player.getBoundingClientRect().width;
    bar.classList.toggle('compact', width > 0 && width < 920);
    bar.classList.toggle('ultra-compact', width > 0 && width < 620);
  }

  function ensureRangeLoopMarkers() {
    const progressBar = document.querySelector('.ytp-progress-bar');
    if (!progressBar) return;
    ['A', 'B'].forEach((letter) => {
      if (byId(`ytl-marker-${letter}`)) return;
      const marker = document.createElement('div');
      marker.id = `ytl-marker-${letter}`;
      marker.className = `ytp-loop-marker ytp-loop-marker-${letter.toLowerCase()}`;
      marker.setAttribute('aria-label', letter === 'A' ? 'A-B 循环起点' : 'A-B 循环终点');
      marker.title = `${letter} 点：拖动微调`;
      progressBar.appendChild(marker);
      marker.addEventListener('mousedown', (event) => {
        event.preventDefault();
        event.stopPropagation();
        rangeLoopDragPoint = letter;
        marker.classList.add('dragging');
        if (video) {
          rangeLoopDragWasPlaying = !video.paused;
          video.pause();
        }
      });
    });
    updateRangeLoopMarkers();
  }

  function updateRangeLoopMarkers() {
    const duration = knownVideoDuration();
    if (!duration) return;
    const markerA = byId('ytl-marker-A');
    const markerB = byId('ytl-marker-B');
    if (markerA) {
      markerA.hidden = rangeLoopA === null;
      if (rangeLoopA !== null) markerA.style.left = `${rangeLoopA / duration * 100}%`;
      markerA.classList.toggle('pulsing', rangeLooping);
    }
    if (markerB) {
      markerB.hidden = rangeLoopB === null;
      if (rangeLoopB !== null) markerB.style.left = `${rangeLoopB / duration * 100}%`;
      markerB.classList.toggle('pulsing', rangeLooping);
    }
  }

  function loadSettings() {
    return new Promise((resolve) => {
      chrome.storage.local.get(SETTINGS_KEY, (result) => {
        const stored = result && result[SETTINGS_KEY];
        settings = {
          ...DEFAULT_SETTINGS,
          ...(stored && typeof stored === 'object' ? stored : {})
        };
        settings.panelOpen = !!settings.panelOpen;
        settings.rememberRate = settings.rememberRate !== false;
        settings.rate = normalizeRate(settings.rate);
        settings.preferredTrack = typeof settings.preferredTrack === 'string' ? settings.preferredTrack : '';
        settings.autoPause = settings.autoPause === true;
        settings.hideMode = settings.hideMode === true;
        settings.overlay = settings.overlay !== false;
        const storedAi = stored && typeof stored.ai === 'object' && stored.ai ? stored.ai : {};
        const provider = AI_PROVIDERS[storedAi.provider] ? storedAi.provider : 'zhipu';
        settings.ai = {
          enabled: storedAi.enabled === true,
          provider,
          baseUrl: typeof storedAi.baseUrl === 'string' && storedAi.baseUrl ? storedAi.baseUrl : AI_PROVIDERS[provider].baseUrl,
          apiKey: typeof storedAi.apiKey === 'string' ? storedAi.apiKey : '',
          model: typeof storedAi.model === 'string' && storedAi.model ? storedAi.model : AI_PROVIDERS[provider].model
        };
        const storedMode = stored && typeof stored.lookupMode === 'string'
          ? stored.lookupMode
          : (settings.ai.enabled ? 'ai' : 'dict');
        settings.lookupMode = ['dict', 'ai', 'local'].includes(storedMode) ? storedMode : 'dict';
        settings.ai.enabled = settings.lookupMode === 'ai';
        if (settings.trackPrefCleaned !== true) {
          if (settings.preferredTrack && !/^en[a-z-]*\|/i.test(settings.preferredTrack)) {
            settings.preferredTrack = '';
          }
          settings.trackPrefCleaned = true;
          saveSettings();
        }
        panelOpen = settings.panelOpen;
        resolve();
      });
    });
  }

  function saveSettings() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      chrome.storage.local.set({ [SETTINGS_KEY]: settings });
    }, 150);
  }

  function trackKey(track) {
    return [track.languageCode, track.kind, track.vssId].join('|');
  }

  function normalizeTrack(track, index) {
    if (!track || typeof track.baseUrl !== 'string') return null;
    let url;
    try {
      url = new URL(track.baseUrl, location.origin);
    } catch (error) {
      return null;
    }
    const hostname = url.hostname.toLowerCase();
    if (url.protocol !== 'https:' || (hostname !== 'youtube.com' && !hostname.endsWith('.youtube.com'))) return null;
    return {
      index,
      baseUrl: url.toString(),
      languageCode: typeof track.languageCode === 'string' ? track.languageCode : '',
      name: typeof track.name === 'string' ? track.name : `Track ${index + 1}`,
      kind: typeof track.kind === 'string' ? track.kind : '',
      vssId: typeof track.vssId === 'string' ? track.vssId : '',
      isTranslatable: !!track.isTranslatable
    };
  }

  function getPanelHost() {
    return document.querySelector('#secondary-inner') || document.querySelector('#secondary');
  }

  function ensureToggle() {
    const controls = document.querySelector('.ytp-left-controls');
    if (!controls) return;
    let button = byId('yt-study-toggle');
    if (!button) {
      button = document.createElement('button');
      button.id = 'yt-study-toggle';
      button.className = 'ytp-button yt-study-toggle';
      button.type = 'button';
      button.title = '打开英语学习字幕面板';
      button.setAttribute('aria-label', '打开英语学习字幕面板');
      button.innerHTML = '<span class="yt-study-toggle-icon">S</span><span class="yt-study-toggle-label">Study</span>';
      button.addEventListener('click', () => setPanelOpen(!panelOpen));
      controls.appendChild(button);
    }
    button.classList.toggle('active', panelOpen);
    button.setAttribute('aria-pressed', String(panelOpen));
  }

  function createPanel() {
    const panel = document.createElement('section');
    panel.id = 'yt-study-panel';
    panel.hidden = !panelOpen;
    panel.innerHTML = `
      <header class="yt-study-header">
        <div class="yt-study-brand">
          <span class="yt-study-logo">S</span>
          <div><strong>Study</strong><span>互动字幕学习</span></div>
        </div>
        <div class="yt-study-header-actions">
          <button id="yt-study-follow" type="button" hidden>跟随当前</button>
          <button id="yt-study-close" type="button" title="收起面板" aria-label="收起面板">×</button>
        </div>
      </header>
      <div class="yt-study-toolbar">
        <label class="yt-study-field yt-study-track-field">
          <span>字幕</span>
          <select id="yt-study-track" aria-label="选择字幕语言"><option>正在读取…</option></select>
        </label>
        <div class="yt-study-speed" aria-label="播放速度">
          <button id="yt-study-slower" type="button" title="减慢 0.05">−</button>
          <button id="yt-study-rate" type="button" title="恢复正常速度">1.00×</button>
          <button id="yt-study-faster" type="button" title="加快 0.05">+</button>
        </div>

      </div>
      <div class="yt-study-tools">
        <button id="yt-study-overlay" type="button" aria-pressed="false" title="在视频画面上显示可点词查义的字幕，并隐藏 YouTube 原生字幕">视频字幕</button>
        <button id="yt-study-autopause" type="button" aria-pressed="false" title="每段播完自动暂停（Q）">自动暂停</button>
        <button id="yt-study-hide" type="button" aria-pressed="false" title="模糊字幕练听力，悬停显示（E）">隐藏字幕</button>

        <button id="yt-study-vocab-toggle" type="button" title="生词本与导出">生词本<span id="yt-study-vocab-count" class="yt-study-vocab-count" hidden>0</span></button>
        <button id="yt-study-settings-btn" type="button" title="词典与 AI 设置">⚙ 设置</button>
        <details class="yt-study-more"><summary>更多</summary><div class="yt-study-more-content">
        <div class="yt-study-download">
          <select id="yt-study-format" aria-label="字幕下载格式">
            <option value="srt">SRT</option>
            <option value="vtt">VTT</option>
            <option value="txt">TXT</option>
          </select>
          <button id="yt-study-download" type="button">下载</button>
        </div>
        <button id="yt-study-copy" type="button" title="复制当前段（Shift+C）">复制本段</button>
        </div></details>
      </div>
      <div id="yt-study-loop-status" class="yt-study-loop-status" hidden>
        <span>正在循环当前段</span><button id="yt-study-stop-loop" type="button">停止</button>
      </div>
      <div id="yt-study-status" class="yt-study-status" role="status">打开面板后读取字幕</div>
      <div id="yt-study-list" class="yt-study-list" tabindex="0" aria-label="视频字幕"></div>
      <div id="yt-study-vocab" class="yt-study-vocab" hidden>
        <div class="yt-study-vocab-actions">
          <button id="yt-study-vocab-csv" type="button">导出 CSV</button>
          <button id="yt-study-vocab-anki" type="button">导出 Anki</button>
          <button id="yt-study-vocab-clear" type="button">清空</button>
        </div>
        <div id="yt-study-vocab-list" class="yt-study-vocab-list"></div>
      </div>
      <div id="yt-study-settings" class="yt-study-settings" hidden>
        <label class="yt-study-remember"><input id="yt-study-remember" type="checkbox">记住速度</label>

        <div class="yt-study-field"><span>查词方式</span>
          <select id="yt-study-ai-enabled" aria-label="查词方式"></select>
        </div>
        <div id="yt-study-mode-hint" class="yt-study-settings-note"></div>
        <div id="yt-study-ai-fields" hidden>
          <div class="yt-study-field"><span>服务商</span>
            <select id="yt-study-ai-provider" aria-label="AI 服务商"></select>
          </div>
          <div class="yt-study-field"><span>接口地址</span>
            <input id="yt-study-ai-url" type="text" placeholder="https://…/v1" autocomplete="off">
          </div>
          <div class="yt-study-field"><span>API Key</span>
            <input id="yt-study-ai-key" type="password" placeholder="sk-…" autocomplete="off">
          </div>
          <div class="yt-study-field"><span>模型</span>
            <input id="yt-study-ai-model" type="text" placeholder="model-name" autocomplete="off">
          </div>
          <div class="yt-study-settings-actions">
            <button id="yt-study-ai-test" type="button">测试连接</button>
          </div>
          <div class="yt-study-settings-note">API Key 保存在本机，仅随请求发送到所选接口。悬停查词只发送单词，点击查词会附带所在字幕段。查询结果本地缓存，相同模型与上下文命中缓存时无需重复请求；AI 超时或失败后回退免费词典。自定义接口需支持 CORS。</div>
        </div>
        <div id="yt-study-local-dict" class="yt-study-local-dict" hidden>
          <div class="yt-study-settings-actions">
            <button id="yt-study-dict-download" type="button">下载本地词典（约 2.2MB）</button>
            <button id="yt-study-dict-import" type="button">从文件导入</button>
            <button id="yt-study-dict-remove" type="button" hidden>删除</button>
          </div>
          <span id="yt-study-dict-status" class="yt-study-settings-note">未安装</span>
          <input id="yt-study-dict-file" type="file" accept=".json,application/json" hidden>
        </div>
        <div class="yt-study-settings-actions"><button id="yt-study-ai-save" type="button">保存设置</button><span id="yt-study-settings-status" role="status">设置已保存</span></div>
      </div>
      <div id="yt-study-toast" class="yt-study-toast" hidden></div>
      <footer class="yt-study-footer">点时间播放 · 点词查义 · ↻ 循环 · ☆ 收藏</footer>
    `;

    const dictPopup = document.createElement('div');
    dictPopup.id = 'yt-study-dict';
    dictPopup.className = 'yt-study-dict';
    dictPopup.hidden = true;
    panel.appendChild(dictPopup);

    byIdAfter(panel, 'yt-study-close').addEventListener('click', () => setPanelOpen(false));
    byIdAfter(panel, 'yt-study-follow').addEventListener('click', enableFollowing);
    byIdAfter(panel, 'yt-study-slower').addEventListener('click', () => stepRate(-RATE_STEP));
    byIdAfter(panel, 'yt-study-faster').addEventListener('click', () => stepRate(RATE_STEP));
    byIdAfter(panel, 'yt-study-rate').addEventListener('click', () => setPlaybackRate(1));
    byIdAfter(panel, 'yt-study-stop-loop').addEventListener('click', stopSentenceLoop);
    byIdAfter(panel, 'yt-study-download').addEventListener('click', downloadCurrentTrack);
    byIdAfter(panel, 'yt-study-autopause').addEventListener('click', () => setAutoPause(!settings.autoPause));
    byIdAfter(panel, 'yt-study-overlay').addEventListener('click', () => setOverlaySubtitles(!settings.overlay));
    byIdAfter(panel, 'yt-study-hide').addEventListener('click', () => setHideMode(!settings.hideMode));
    byIdAfter(panel, 'yt-study-copy').addEventListener('click', () => { copyCurrentSentence(); });
    byIdAfter(panel, 'yt-study-vocab-toggle').addEventListener('click', () => toggleVocabView(!vocabOpen));
    byIdAfter(panel, 'yt-study-vocab-csv').addEventListener('click', () => exportVocab('csv'));
    byIdAfter(panel, 'yt-study-vocab-anki').addEventListener('click', () => exportVocab('anki'));
    byIdAfter(panel, 'yt-study-vocab-clear').addEventListener('click', clearVocab);
    byIdAfter(panel, 'yt-study-settings-btn').addEventListener('click', () => toggleSettingsView(!settingsOpen));
    byIdAfter(panel, 'yt-study-ai-save').addEventListener('click', saveAiSettings);
    byIdAfter(panel, 'yt-study-ai-test').addEventListener('click', () => { testAiConnection(); });
    byIdAfter(panel, 'yt-study-ai-provider').addEventListener('change', handleAiProviderChange);
    byIdAfter(panel, 'yt-study-ai-enabled').addEventListener('change', handleLookupModeChange);
    byIdAfter(panel, 'yt-study-dict-download').addEventListener('click', installLocalDictNow);
    byIdAfter(panel, 'yt-study-dict-import').addEventListener('click', () => {
      const file = byId('yt-study-dict-file');
      if (file) file.click();
    });
    byIdAfter(panel, 'yt-study-dict-file').addEventListener('change', handleDictFileImport);
    byIdAfter(panel, 'yt-study-dict-remove').addEventListener('click', removeLocalDict);
    byIdAfter(panel, 'yt-study-track').addEventListener('change', (event) => {
      const index = Number(event.target.value);
      if (!Number.isInteger(index) || !tracks[index]) return;
      selectedTrackIndex = index;
      settings.preferredTrack = trackKey(tracks[index]);
      saveSettings();
      loadTrack(index);
    });
    byIdAfter(panel, 'yt-study-settings').addEventListener('input', markSettingsDirty);
    byIdAfter(panel, 'yt-study-remember').addEventListener('change', markSettingsDirty);

    const list = byIdAfter(panel, 'yt-study-list');
    list.addEventListener('wheel', disableFollowing, { passive: true });
    list.addEventListener('touchstart', disableFollowing, { passive: true });
    list.addEventListener('click', handleCueClick);
    list.addEventListener('dblclick', handleCueDoubleClick);
    list.addEventListener('keydown', handleCueKeydown);
    list.addEventListener('contextmenu', handleCueContextMenu);
    list.addEventListener('mouseover', handleWordHoverStart);
    list.addEventListener('mouseout', handleWordHoverEnd);
    list.addEventListener('scroll', () => {
      closeDictPopup();
      refreshWordTooltip();
    }, { passive: true, capture: true });
    panel.querySelector('#yt-study-vocab-list').addEventListener('click', handleVocabListClick);
    return panel;
  }

  function byIdAfter(root, id) {
    return root.querySelector(`#${id}`);
  }

  function ensurePanel() {
    let panel = byId('yt-study-panel');
    if (!panel) panel = createPanel();
    const host = getPanelHost();
    if (host) {
      if (panel.parentElement !== host) host.prepend(panel);
      panel.classList.remove('floating');
    } else {
      if (panel.parentElement !== document.body) document.body.appendChild(panel);
      panel.classList.add('floating');
    }
    panel.hidden = !panelOpen;
    updateSettingsUI();
    updateStudyModesUI();
    updateVocabBadge();
    syncPanelHeight();
    return panel;
  }

  function setPanelOpen(open) {
    panelOpen = !!open;
    settings.panelOpen = panelOpen;
    saveSettings();
    ensureToggle();
    const panel = ensurePanel();
    panel.hidden = !panelOpen;
    if (panelOpen) {
      requestTracks(true);
      updateOverlayUI();
    } else {
      clearTimeout(trackRequestTimer);
      closeDictPopup();
      closeWordTooltip();
      if (vocabOpen) toggleVocabView(false);
      if (settingsOpen) toggleSettingsView(false);
      updateOverlayUI();
    }
  }

  function syncPanelHeight() {
    const panel = byId('yt-study-panel');
    const player = document.querySelector('#movie_player');
    if (!panel || !player) return;
    const playerHeight = Math.round(player.getBoundingClientRect().height);
    if (playerHeight > 240) panel.style.setProperty('--yt-study-player-height', `${playerHeight}px`);
    updateOverlayFont();
  }

  function observePlayerSize() {
    const player = document.querySelector('#movie_player');
    if (!player || typeof ResizeObserver !== 'function') return;
    if (player === observedPlayer) return;
    if (playerResizeObserver) playerResizeObserver.disconnect();
    observedPlayer = player;
    playerResizeObserver = new ResizeObserver(syncPanelHeight);
    playerResizeObserver.observe(player);
  }

  function setStatus(message, state) {
    const status = byId('yt-study-status');
    if (!status) return;
    status.textContent = message;
    status.dataset.state = state || '';
    status.hidden = !message;
  }

  function updateSettingsUI() {
    const remember = byId('yt-study-remember');
    if (remember && !settingsOpen) remember.checked = settings.rememberRate;
    updateRateUI();
  }

  function updateRateUI() {
    const rate = video ? normalizeRate(video.playbackRate) : settings.rate;
    const output = byId('yt-study-rate');
    if (output) output.textContent = `${rate.toFixed(2)}×`;
  }

  function setPlaybackRate(rate) {
    const normalized = normalizeRate(rate);
    if (video) {
      try {
        video.playbackRate = normalized;
      } catch (error) {
        setStatus('浏览器不支持这个播放速度', 'error');
        return;
      }
    }
    if (settings.rememberRate) {
      settings.rate = normalized;
      saveSettings();
    }
    updateRateUI();
  }

  function stepRate(delta) {
    const current = video ? video.playbackRate : settings.rate;
    setPlaybackRate(current + delta);
  }

  function applyRememberedRate() {
    if (!settings.rememberRate || !video) return;
    const rate = normalizeRate(settings.rate);
    if (Math.abs(video.playbackRate - rate) > 0.001) video.playbackRate = rate;
  }

  function bindVideo(nextVideo) {
    if (nextVideo === video) return;
    cancelRangeLoopTick();
    if (videoAbortController) videoAbortController.abort();
    videoAbortController = new AbortController();
    video = nextVideo;
    const options = { signal: videoAbortController.signal };
    video.addEventListener('timeupdate', handleTimeUpdate, options);
    video.addEventListener('ratechange', handleRateChange, options);
    video.addEventListener('loadedmetadata', applyRememberedRate, options);
    video.addEventListener('play', startRangeLoopTick, options);
    video.addEventListener('pause', cancelRangeLoopTick, options);
    video.addEventListener('ended', cancelRangeLoopTick, options);
    video.addEventListener('durationchange', handleRangeLoopDurationChange, options);
    video.addEventListener('seeking', resetAutoPauseTracker, options);
    video.addEventListener('seeking', updateOverlayChunk, options);
    video.addEventListener('play', startOverlayTick, options);
    video.addEventListener('pause', stopOverlayTick, options);
    video.addEventListener('ended', stopOverlayTick, options);
    applyRememberedRate();
    updateRateUI();
  }

  function handleRateChange() {
    updateRateUI();
    if (!settings.rememberRate || !video) return;
    settings.rate = normalizeRate(video.playbackRate);
    saveSettings();
  }

  function handleRangeLoopDurationChange() {
    if (validateRangeLoop()) {
      refreshRangeLoopUI();
      saveRangeLoop();
    } else {
      updateRangeLoopMarkers();
    }
  }

  function handleTimeUpdate() {
    if (!video) return;
    checkRangeLoopPoint();
    updateRangeLoopMarkers();
    if (sentenceLoopIndex >= 0 && cues[sentenceLoopIndex]) {
      const cue = cues[sentenceLoopIndex];
      if (video.currentTime >= cue.end - 0.03) {
        video.currentTime = cue.start;
        video.play().catch(() => {});
      }
    }
    handleAutoPause();
    const lockedIndex = getCueHighlightLockIndex();
    updateActiveCue(lockedIndex >= 0 ? lockedIndex : findCueIndex(video.currentTime));
    updateOverlayChunk();
  }

  function resetAutoPauseTracker() {
    autoPauseLastIndex = video && cues.length ? findCueIndex(video.currentTime) : -1;
    autoPauseLastTime = -Infinity;
  }

  function handleAutoPause() {
    if (!settings.autoPause || !video) return;
    const time = video.currentTime;
    if (video.paused || sentenceLoopIndex >= 0 || rangeLooping) {
      autoPauseLastIndex = cues.length ? findCueIndex(time) : -1;
      autoPauseLastTime = time;
      return;
    }
    const index = findCueIndex(time);
    const naturalStep = time > autoPauseLastTime && time - autoPauseLastTime <= AUTO_PAUSE_MAX_STEP_SECONDS;
    const enteredNewSentence = index >= 0 && index !== autoPauseLastIndex
      && cues[index].start >= autoPauseLastTime - 0.05;
    if (naturalStep && enteredNewSentence) video.pause();
    autoPauseLastIndex = index;
    autoPauseLastTime = time;
  }

  function getCueHighlightLockIndex() {
    if (!cueHighlightLock || !video) return -1;
    const cue = cues[cueHighlightLock.index];
    const tooEarly = cue && video.currentTime < cue.start - SEEK_PREROLL_SECONDS - 0.25;
    const enteredCue = cue && video.currentTime >= cue.start;
    const expired = Date.now() >= cueHighlightLock.expiresAt;
    if (!cue || tooEarly || enteredCue || expired) {
      cueHighlightLock = null;
      return -1;
    }
    return cueHighlightLock.index;
  }

  function findCueIndex(time) {
    let low = 0;
    let high = cues.length - 1;
    while (low <= high) {
      const middle = (low + high) >> 1;
      const cue = cues[middle];
      if (time < cue.start) high = middle - 1;
      else if (time >= cue.end) low = middle + 1;
      else return middle;
    }
    return -1;
  }

  function updateActiveCue(index) {
    if (index === activeCueIndex) return;
    if (cueElements[activeCueIndex]) cueElements[activeCueIndex].classList.remove('active');
    activeCueIndex = index;
    const current = cueElements[index];
    if (!current) return;
    current.classList.add('active');
    if (followEnabled) scrollCueIntoView(current);
    updateOverlayContent(index);
  }

  function scrollCueIntoView(element) {
    const list = byId('yt-study-list');
    if (!list || !element) return;
    const listRect = list.getBoundingClientRect();
    const elementRect = element.getBoundingClientRect();
    const target = list.scrollTop + elementRect.top - listRect.top
      - (list.clientHeight - elementRect.height) / 2;
    list.scrollTo({ top: Math.max(0, target), behavior: 'smooth' });
  }

  function disableFollowing() {
    if (!followEnabled) return;
    followEnabled = false;
    const button = byId('yt-study-follow');
    if (button) button.hidden = false;
  }

  function enableFollowing() {
    followEnabled = true;
    const button = byId('yt-study-follow');
    if (button) button.hidden = true;
    if (cueElements[activeCueIndex]) scrollCueIntoView(cueElements[activeCueIndex]);
  }

  function getCueRow(target) {
    if (!(target instanceof Element)) return null;
    const row = target.closest('.yt-study-cue');
    if (!row) return null;
    const index = Number(row.dataset.index);
    return Number.isInteger(index) && cues[index] ? { row, index } : null;
  }

  function handleCueClick(event) {
    const match = getCueRow(event.target);
    if (!match) return;
    if (event.target.closest('.yt-study-repeat')) {
      event.stopPropagation();
      toggleSentenceLoop(match.index);
      return;
    }
    if (event.target.closest('.yt-study-save')) {
      event.stopPropagation();
      saveSentenceByIndex(match.index);
      return;
    }
    const wordTarget = event.target.closest('.yt-study-word');
    if (wordTarget) {
      event.preventDefault();
      event.stopPropagation();
      const key = wordTarget.dataset.word || wordLookupKey(wordTarget.textContent);
      if (!key) return;
      if (isDictPopupOpenFor(key)) {
        closeDictPopup();
        return;
      }
      openDictPopup(key, match.index, wordTarget);
      return;
    }
    closeDictPopup();
    playCue(match.index, false);
  }

  function handleCueContextMenu(event) {
    const match = getCueRow(event.target);
    if (!match) return;
    event.preventDefault();
    saveSentenceByIndex(match.index);
  }

  function handleCueDoubleClick(event) {
    const match = getCueRow(event.target);
    if (!match || event.target.closest('button, .yt-study-word')) return;
    event.preventDefault();
    toggleSentenceLoop(match.index);
  }

  function handleCueKeydown(event) {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    if (event.target.closest('button, input, select, a')) return;
    const match = getCueRow(event.target);
    if (!match) return;
    event.preventDefault();
    if (event.shiftKey) toggleSentenceLoop(match.index);
    else playCue(match.index, false);
  }

  function playCue(index, keepLoop) {
    if (!video || !cues[index]) return;
    if (rangeLooping) stopRangeLoop();
    if (!keepLoop) stopSentenceLoop();
    cueHighlightLock = {
      index,
      expiresAt: Date.now() + CUE_HIGHLIGHT_LOCK_MS
    };
    video.currentTime = Math.max(0, cues[index].start - SEEK_PREROLL_SECONDS);
    video.play().catch(() => {});
    updateActiveCue(index);
  }

  function toggleSentenceLoop(index) {
    if (sentenceLoopIndex === index) {
      stopSentenceLoop();
      return;
    }
    stopSentenceLoop();
    if (rangeLooping) stopRangeLoop();
    sentenceLoopIndex = index;
    if (cueElements[index]) cueElements[index].classList.add('looping');
    const status = byId('yt-study-loop-status');
    if (status) status.hidden = false;
    playCue(index, true);
  }

  function stopSentenceLoop() {
    if (cueElements[sentenceLoopIndex]) cueElements[sentenceLoopIndex].classList.remove('looping');
    sentenceLoopIndex = -1;
    const status = byId('yt-study-loop-status');
    if (status) status.hidden = true;
  }

  function setAutoPause(enabled) {
    settings.autoPause = !!enabled;
    saveSettings();
    resetAutoPauseTracker();
    updateStudyModesUI();
    showToast(enabled ? '自动暂停已开启（Q 切换）' : '自动暂停已关闭');
  }

  function setHideMode(enabled) {
    settings.hideMode = !!enabled;
    saveSettings();
    updateStudyModesUI();
    updateOverlayUI();
    showToast(enabled ? '字幕已隐藏，悬停句子可显示' : '字幕已恢复显示');
  }

  function updateStudyModesUI() {
    const autoPause = byId('yt-study-autopause');
    if (autoPause) {
      autoPause.classList.toggle('active', settings.autoPause);
      autoPause.setAttribute('aria-pressed', String(settings.autoPause));
    }
    const hide = byId('yt-study-hide');
    if (hide) {
      hide.classList.toggle('active', settings.hideMode);
      hide.setAttribute('aria-pressed', String(settings.hideMode));
    }
    const overlay = byId('yt-study-overlay');
    if (overlay) {
      overlay.classList.toggle('active', settings.overlay);
      overlay.setAttribute('aria-pressed', String(settings.overlay));
    }
    const list = byId('yt-study-list');
    if (list) list.classList.toggle('yt-study-hidden-mode', settings.hideMode);
  }

  function setOverlaySubtitles(enabled) {
    settings.overlay = !!enabled;
    saveSettings();
    updateOverlayUI();
    if (!enabled) closeDictPopup();
    showToast(enabled ? '视频字幕已开启：点击单词查义' : '视频字幕已关闭');
  }

  function ensurePlayerOverlay() {
    const player = document.querySelector('#movie_player');
    if (!player) return null;
    if (playerOverlay && playerOverlay.root.parentElement === player) return playerOverlay;
    const root = document.createElement('div');
    root.id = 'yt-study-player-overlay';
    root.className = 'yt-study-overlay';
    const text = document.createElement('div');
    text.className = 'yt-study-overlay-text';
    const actions = document.createElement('div');
    actions.className = 'yt-study-overlay-actions';
    const replay = document.createElement('button');
    replay.type = 'button';
    replay.className = 'yt-study-overlay-replay';
    replay.title = '重播本段';
    replay.setAttribute('aria-label', '重播本段');
    replay.textContent = '↻';
    const save = document.createElement('button');
    save.type = 'button';
    save.className = 'yt-study-overlay-save';
    save.title = '收藏本段';
    save.setAttribute('aria-label', '收藏本段');
    save.textContent = '☆';
    actions.append(replay, save);
    root.append(text, actions);
    root.addEventListener('click', handleOverlayClick);
    root.addEventListener('mouseover', handleWordHoverStart);
    root.addEventListener('mouseout', handleWordHoverEnd);
    player.appendChild(root);
    playerOverlay = { root, text };
    overlayLayoutKey = '';
    return playerOverlay;
  }

  function updateOverlayUI() {
    const player = document.querySelector('#movie_player');
    const active = settings.overlay && panelOpen;
    if (player) player.classList.toggle('yt-study-overlay-on', active);
    if (!active) {
      if (playerOverlay) playerOverlay.root.hidden = true;
      return;
    }
    const overlay = ensurePlayerOverlay();
    if (!overlay) return;
    overlay.root.classList.toggle('blur', settings.hideMode);
    updateOverlayFont();
    startOverlayTick();
    updateOverlayContent(activeCueIndex);
  }

  function updateOverlayContent(index) {
    if (!settings.overlay || !panelOpen) {
      if (playerOverlay) playerOverlay.root.hidden = true;
      return;
    }
    if (index < 0 || !cues[index]) {
      activeChunkIndex = -1;
      if (playerOverlay) playerOverlay.root.hidden = true;
      return;
    }
    const overlay = ensurePlayerOverlay();
    if (!overlay) return;
    overlay.root.classList.toggle('blur', settings.hideMode);
    const time = video ? video.currentTime : cues[index].start;
    let chunkIndex = findChunkIndexAt(time);
    if (chunkIndex < 0 || overlayChunks[chunkIndex].sentenceIndex !== index) {
      chunkIndex = firstChunkOfSentence(index, time);
    }
    if (chunkIndex < 0) {
      activeChunkIndex = -1;
      overlay.root.hidden = true;
      return;
    }
    if (chunkIndex === activeChunkIndex && !overlay.root.hidden) return;
    activeChunkIndex = chunkIndex;
    renderOverlayChunk(chunkIndex);
  }

  function overlayMeasure() {
    if (!playerOverlay || typeof getComputedStyle !== 'function') return null;
    const player = playerOverlay.root.parentElement;
    if (!player) return null;
    const width = player.getBoundingClientRect().width;
    if (!width) return null;
    // Measure a hidden copy in the same player, with the real flex/actions layout.
    const shell = playerOverlay.root.cloneNode(true);
    shell.removeAttribute('id');
    shell.hidden = false;
    shell.style.visibility = 'hidden';
    shell.style.pointerEvents = 'none';
    shell.setAttribute('aria-hidden', 'true');
    const probe = shell.querySelector('.yt-study-overlay-text');
    probe.style.fontSize = `${overlayFontSize || 20}px`;
    probe.style.display = 'block';
    probe.style.webkitLineClamp = 'unset';
    probe.style.overflow = 'visible';
    player.appendChild(shell);
    const style = getComputedStyle(probe);
    const limit = parseFloat(style.lineHeight) * 2 + parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
    const fits = text => {
      probe.replaceChildren();
      appendCueWords(probe, text);
      return probe.getBoundingClientRect().height <= limit + 0.5
        && probe.scrollWidth <= probe.clientWidth + 1;
    };
    return { fits, dispose: () => shell.remove() };
  }

  function buildOverlayChunks() {
    const measurement = overlayMeasure();
    // Only used before layout exists (or in DOM stubs); remeasure on first display.
    const fits = measurement ? measurement.fits : text => text.split(/\s+/).length <= 12;
    try {
      overlayChunks = cues.flatMap((cue, sentenceIndex) =>
        paginateCue(cue, fits, captionSegments).map(part => ({ ...part, sentenceIndex })));
    } finally {
      if (measurement) measurement.dispose();
    }
    // cue.end 继承自显示停留时长，可能与下一条 cue 的开始重叠；钳制保证时间轴单调，
    // 否则重叠区内 findChunkIndexAt 会停留在上一条短语（字幕迟到）。
    for (let index = 0; index + 1 < overlayChunks.length; index++) {
      const nextChunk = overlayChunks[index + 1];
      if (overlayChunks[index].end > nextChunk.start) {
        overlayChunks[index].end = Math.max(overlayChunks[index].start + 0.05, nextChunk.start);
      }
    }
    activeChunkIndex = -1;
  }

  function findChunkIndexAt(time) {
    let low = 0;
    let high = overlayChunks.length - 1;
    while (low <= high) {
      const middle = (low + high) >> 1;
      const chunk = overlayChunks[middle];
      if (time < chunk.start) high = middle - 1;
      else if (time >= chunk.end) low = middle + 1;
      else return middle;
    }
    return -1;
  }

  function firstChunkOfSentence(sentenceIndex, time) {
    let first = -1;
    let best = -1;
    for (let index = 0; index < overlayChunks.length; index++) {
      if (overlayChunks[index].sentenceIndex !== sentenceIndex) continue;
      if (first < 0) first = index;
      if (time >= overlayChunks[index].start - 0.1) best = index;
      else break;
    }
    return best >= 0 ? best : first;
  }

  function renderOverlayChunk(index) {
    if (!playerOverlay) return;
    const chunk = overlayChunks[index];
    if (!chunk) {
      activeChunkIndex = -1;
      playerOverlay.root.hidden = true;
      return;
    }
    playerOverlay.text.style.setProperty('font-size', `${overlayFontSize || 20}px`);
    playerOverlay.text.replaceChildren();
    appendCueWords(playerOverlay.text, chunk.text);
    playerOverlay.root.hidden = false;
    dropStaleWordTooltip();
  }

  function startOverlayTick() {
    if (overlayRafId || typeof requestAnimationFrame !== 'function') return;
    const tick = () => {
      overlayRafId = 0;
      if (!video || video.paused) return;
      updateOverlayChunk();
      if (typeof requestAnimationFrame === 'function') {
        overlayRafId = requestAnimationFrame(tick);
      }
    };
    overlayRafId = requestAnimationFrame(tick);
  }

  function stopOverlayTick() {
    if (overlayRafId && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(overlayRafId);
    }
    overlayRafId = 0;
  }

  function updateOverlayChunk() {
    if (!settings.overlay || !panelOpen || !video) {
      if (playerOverlay) playerOverlay.root.hidden = true;
      return;
    }
    const index = findChunkIndexAt(video.currentTime);
    if (index === activeChunkIndex) return;
    if (index < 0) {
      activeChunkIndex = -1;
      if (playerOverlay) playerOverlay.root.hidden = true;
      return;
    }
    activeChunkIndex = index;
    renderOverlayChunk(index);
  }

  function updateOverlayFont() {
    if (!playerOverlay || !playerOverlay.root.parentElement) return;
    const bounds = playerOverlay.root.parentElement.getBoundingClientRect();
    if (!bounds.height || !bounds.width) return;
    const size = Math.round(clamp(bounds.height * 0.038, 15, 30));
    const key = `${bounds.width}:${size}`;
    if (key === overlayLayoutKey) return;
    overlayLayoutKey = key;
    overlayFontSize = size;
    if (cues.length) {
      buildOverlayChunks();
      updateOverlayChunk();
    }
  }

  function overlaySentenceIndex() {
    const chunk = overlayChunks[activeChunkIndex];
    if (chunk) return chunk.sentenceIndex;
    return activeCueIndex >= 0 ? activeCueIndex : nearestCueIndex(video ? video.currentTime : 0);
  }

  function handleOverlayClick(event) {
    if (!(event.target instanceof Element)) return;
    event.preventDefault();
    event.stopPropagation();
    const wordTarget = event.target.closest('.yt-study-word');
    if (wordTarget) {
      const key = wordTarget.dataset.word || wordLookupKey(wordTarget.textContent);
      if (!key) return;
      if (isDictPopupOpenFor(key)) {
        closeDictPopup();
        return;
      }
      openDictPopup(key, overlaySentenceIndex(), wordTarget, { player: true });
      return;
    }
    if (event.target.closest('.yt-study-overlay-replay')) {
      playCue(overlaySentenceIndex(), false);
      return;
    }
    if (event.target.closest('.yt-study-overlay-save')) {
      saveSentenceByIndex(overlaySentenceIndex());
      return;
    }
    closeDictPopup();
  }

  function isDictPopupOpenFor(word) {
    const openPopups = [byId('yt-study-dict'), playerDictPopup]
      .filter((popup) => popup && !popup.hidden);
    return openPopups.length > 0 && dictPopupState.word === word;
  }

  function nearestCueIndex(time) {
    const exact = findCueIndex(time);
    if (exact >= 0) return exact;
    for (let index = 0; index < cues.length; index++) {
      if (cues[index].start > time) return index;
    }
    return cues.length - 1;
  }

  function stepSentence(delta) {
    if (!cues.length || !video) return;
    const base = activeCueIndex >= 0 ? activeCueIndex : nearestCueIndex(video.currentTime);
    playCue(clamp(base + delta, 0, cues.length - 1), false);
  }

  function togglePlayPause() {
    if (!video) return;
    if (video.paused) video.play().catch(() => {});
    else video.pause();
  }

  function currentSentenceCue() {
    if (!cues.length) return null;
    const index = activeCueIndex >= 0 ? activeCueIndex : nearestCueIndex(video ? video.currentTime : 0);
    return cues[index] || null;
  }

  function saveSentenceByIndex(index) {
    const cue = cues[index];
    if (!cue) return;
    addVocabEntry({ kind: 'sentence', sentence: cue.text, time: cue.start });
  }

  function saveCurrentSentence() {
    const cue = currentSentenceCue();
    if (!cue) {
      showToast('当前没有可收藏的字幕');
      return;
    }
    addVocabEntry({ kind: 'sentence', sentence: cue.text, time: cue.start });
  }

  function currentVideoTitle() {
    return videoTitle || document.title.replace(/\s*-\s*YouTube\s*$/, '');
  }

  function videoLink(videoId, time) {
    if (!videoId) return '';
    return `https://youtu.be/${videoId}?t=${Math.max(0, Math.floor(Number(time) || 0))}`;
  }

  async function copyCurrentSentence() {
    const cue = currentSentenceCue();
    if (!cue) {
      showToast('还没有可复制的字幕');
      return;
    }
    const link = videoLink(currentVideoId, cue.start);
    const payload = link
      ? `${cue.text}\n[${currentVideoTitle()} · ${formatClock(cue.start)}](${link})`
      : cue.text;
    const ok = await copyTextToClipboard(payload);
    showToast(ok ? '已复制当前段' : '复制失败，请重试');
  }

  function copyTextToClipboard(text) {
    if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(() => true).catch(() => legacyCopyToClipboard(text));
    }
    return Promise.resolve(legacyCopyToClipboard(text));
  }

  function legacyCopyToClipboard(text) {
    try {
      const area = document.createElement('textarea');
      area.value = text;
      area.style.setProperty('position', 'fixed');
      area.style.setProperty('opacity', '0');
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand('copy');
      area.remove();
      return ok;
    } catch (error) {
      return false;
    }
  }

  function showToast(message) {
    const toast = byId('yt-study-toast');
    if (!toast) return;
    toast.textContent = message;
    toast.hidden = false;
    toast.classList.remove('show');
    void toast.offsetWidth;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toast.hidden = true;
      toast.classList.remove('show');
    }, 1600);
  }

  function openDictPopup(word, cueIndex, anchor, options = {}) {
    let popup;
    let container;
    if (options.player) {
      popup = ensurePlayerDict();
      container = popup ? popup.parentElement : null;
    } else {
      popup = byId('yt-study-dict');
      container = byId('yt-study-panel');
    }
    if (!popup || !container) return;
    closeWordTooltip();
    if (video && !video.paused) video.pause();
    closeDictPopup();
    dictPopupState = { word, cueIndex };
    const place = () => positionDictPopup(popup, container, anchor);
    popup.hidden = false;
    popup.dataset.state = 'loading';
    popup.replaceChildren(buildDictHeader(word));
    place();
    const token = ++dictRequestToken;
    (async () => {
      if (settings.lookupMode === 'local' && localDictReady()) {
        const local = localDictLookup(word);
        if (local) {
          const cue = cues[cueIndex];
          renderDictLocalResult(popup, word, cue ? cue.text : '', local);
          place();
          return;
        }
        if (token === dictRequestToken && !popup.hidden) {
          appendDictMessage(popup, '本地词典没有收录，改用在线词典…');
          place();
        }
      }
      if (aiConfigured()) {
        try {
          const cue = cues[cueIndex];
          const sentence = cue ? cue.text : '';
          const key = aiDetailKey(word, sentence);
          let detail = aiDetailCache.get(key);
          if (detail === undefined) {
            detail = await fetchAiDetail(word, sentence);
            aiDetailCache.set(key, detail);
            scheduleAiCachePersist();
          }
          if (token !== dictRequestToken || popup.hidden) return;
          renderDictAiResult(popup, word, sentence, detail);
          place();
          return;
        } catch (error) {
          if (token !== dictRequestToken || popup.hidden) return;
          if (token === dictRequestToken && !popup.hidden) {
            appendDictMessage(popup, `AI 查询失败：${error instanceof Error ? error.message : '未知错误'}，改用免费词典`);
            place();
          }
        }
      }
      const cached = dictCache.get(word);
      if (cached !== undefined) {
        renderDictResult(popup, word, cached);
        place();
        return;
      }
      try {
        const data = await lookupWord(word);
        if (token !== dictRequestToken || popup.hidden) return;
        renderDictResult(popup, word, data);
        place();
      } catch (error) {
        if (token !== dictRequestToken || popup.hidden) return;
        popup.dataset.state = 'error';
        appendDictMessage(popup, '词典查询失败，可能是网络问题');
        appendDictSaveButton(popup);
      }
    })();
  }

  function ensurePlayerDict() {
    const player = document.querySelector('#movie_player');
    if (!player) return null;
    if (playerDictPopup && playerDictPopup.parentElement === player) return playerDictPopup;
    playerDictPopup = document.createElement('div');
    playerDictPopup.id = 'yt-study-player-dict';
    playerDictPopup.className = 'yt-study-dict yt-study-player-dict';
    player.appendChild(playerDictPopup);
    return playerDictPopup;
  }

  function closeDictPopup() {
    let closed = false;
    for (const popup of [byId('yt-study-dict'), playerDictPopup]) {
      if (popup && !popup.hidden) {
        popup.hidden = true;
        popup.replaceChildren();
        closed = true;
      }
    }
    if (closed) {
      aiClient.cancel('detail');
      dictRequestToken++;
      dictPopupState = { word: '', cueIndex: -1 };
    }
    return closed;
  }

  function buildDictHeader(word) {
    const header = document.createElement('div');
    header.className = 'yt-study-dict-header';
    const title = document.createElement('strong');
    title.textContent = word;
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'yt-study-dict-close';
    close.setAttribute('aria-label', '关闭词典');
    close.textContent = '×';
    close.addEventListener('click', closeDictPopup);
    header.append(title, close);
    return header;
  }

  function appendDictMessage(popup, message) {
    const block = document.createElement('div');
    block.className = 'yt-study-dict-message';
    block.textContent = message;
    popup.appendChild(block);
  }

  function appendDictSaveButton(popup) {
    const save = document.createElement('button');
    save.type = 'button';
    save.className = 'yt-study-dict-save';
    save.textContent = '收藏这个单词';
    save.addEventListener('click', saveWordFromDict);
    popup.appendChild(save);
  }

  function renderDictResult(popup, word, data) {
    popup.replaceChildren(buildDictHeader(word));
    const entries = Array.isArray(data) ? data.filter((entry) => entry && Array.isArray(entry.meanings)) : [];
    if (!entries.length) {
      popup.dataset.state = 'empty';
      appendDictMessage(popup, '没有找到释义，仍然可以收藏后自行查证');
      appendDictSaveButton(popup);
      return;
    }
    popup.dataset.state = 'ready';
    const contextCue = cues[dictPopupState.cueIndex];
    const contextWords = contextCue ? contextSentenceWords(contextCue.text, word) : [];
    const phonetic = entries.find((entry) => entry.phonetic);
    if (phonetic) {
      const sound = document.createElement('div');
      sound.className = 'yt-study-dict-phonetic';
      sound.textContent = phonetic.phonetic;
      popup.appendChild(sound);
    }
    const scored = entries[0].meanings
      .map((meaning, order) => ({ meaning, order, score: scoreMeaningForContext(meaning, contextWords) }))
      .sort((left, right) => right.score - left.score || left.order - right.order);
    if (scored.length && scored[0].score > 0) scored[0].contextMatch = true;
    for (const { meaning, contextMatch } of scored.slice(0, 4)) {
      const block = document.createElement('div');
      block.className = 'yt-study-dict-meaning';
      if (contextMatch) block.classList.add('context-first');
      const pos = document.createElement('span');
      pos.className = 'yt-study-dict-pos';
      pos.textContent = meaning.partOfSpeech || '';
      block.appendChild(pos);
      if (contextMatch) {
        const chip = document.createElement('span');
        chip.className = 'yt-study-dict-context-chip';
        chip.title = '该义项与当前段子词语重合度最高，仅供参考';
        chip.textContent = '结合上下文';
        block.appendChild(chip);
      }
      const definitions = (meaning.definitions || []).slice(0, 2);
      for (const definition of definitions) {
        const line = document.createElement('div');
        line.className = 'yt-study-dict-def';
        line.textContent = definition.definition || '';
        block.appendChild(line);
      }
      const example = (meaning.definitions || []).find((item) => item.example);
      if (example) {
        const usage = document.createElement('div');
        usage.className = 'yt-study-dict-example';
        usage.textContent = example.example;
        block.appendChild(usage);
      }
      popup.appendChild(block);
    }
    appendDictSaveButton(popup);
  }

  function positionDictPopup(popup, container, anchor) {
    const containerRect = container.getBoundingClientRect();
    const rect = anchor.getBoundingClientRect();
    const width = 288;
    const popupHeight = popup.offsetHeight || 0;
    const anchorTop = rect.top - containerRect.top;
    const anchorBottom = rect.bottom - containerRect.top;
    const spaceBelow = containerRect.height - anchorBottom;
    let top;
    if (popupHeight && popupHeight + 10 <= spaceBelow) {
      top = anchorBottom + 8;
    } else if (popupHeight) {
      top = anchorTop - popupHeight - 8;
    } else {
      top = anchorBottom + 8;
    }
    const left = clamp(rect.left - containerRect.left, 8, Math.max(8, containerRect.width - width - 8));
    popup.style.setProperty('top', `${Math.round(Math.max(8, top))}px`);
    popup.style.setProperty('left', `${Math.round(left)}px`);
  }

  function saveWordFromDict() {
    const { word, cueIndex } = dictPopupState;
    if (!word) return;
    const cue = cues[cueIndex];
    addVocabEntry({
      kind: 'word',
      word,
      sentence: cue ? cue.text : '',
      time: cue ? cue.start : (video ? video.currentTime : 0)
    });
    closeDictPopup();
  }

  function handleWordHoverStart(event) {
    if (!(event.target instanceof Element)) return;
    const wordTarget = event.target.closest('.yt-study-word');
    if (!wordTarget) return;
    const key = wordTarget.dataset.word || wordLookupKey(wordTarget.textContent);
    if (!key) return;
    clearTimeout(wordTipTimer);
    wordTipActive = { word: key, anchor: wordTarget };
    wordTipTimer = setTimeout(() => { showWordTooltip(key, wordTarget); }, WORD_TIP_DELAY_MS);
  }

  function handleWordHoverEnd(event) {
    if (!(event.target instanceof Element)) return;
    if (!event.target.closest('.yt-study-word')) return;
    closeWordTooltip();
  }

  function closeWordTooltip() {
    aiClient.cancel('hover');
    clearTimeout(wordTipTimer);
    wordTipActive = { word: '', anchor: null };
    const tip = byId('yt-study-word-tip');
    if (tip) tip.hidden = true;
  }

  function dropStaleWordTooltip() {
    if (wordTipActive.anchor && wordTipActive.anchor.isConnected === false) {
      closeWordTooltip();
    }
  }

  function refreshWordTooltip() {
    if (!wordTipActive.anchor) return;
    if (wordTipActive.anchor.isConnected === false) {
      closeWordTooltip();
      return;
    }
    const tip = byId('yt-study-word-tip');
    if (tip && !tip.hidden) positionWordTooltip(tip, wordTipActive.anchor);
  }

  function ensureWordTooltip() {
    let tip = byId('yt-study-word-tip');
    if (!tip) {
      tip = document.createElement('div');
      tip.id = 'yt-study-word-tip';
      tip.className = 'yt-study-word-tip';
      tip.hidden = true;
      document.body.appendChild(tip);
    }
    return tip;
  }

  async function showWordTooltip(word, anchor) {
    if (wordTipActive.word !== word) return;
    const tip = ensureWordTooltip();
    renderWordTooltipLoading(tip, word);
    tip.hidden = false;
    positionWordTooltip(tip, anchor);
    const payload = await resolveWordGloss(word);
    if (!payload || wordTipActive.word !== word || wordTipActive.anchor !== anchor) return;
    renderWordTooltip(tip, word, payload);
    positionWordTooltip(tip, anchor);
  }

  function renderWordTooltipLoading(tip, word) {
    tip.replaceChildren();
    const header = document.createElement('div');
    header.className = 'yt-study-word-tip-header';
    const title = document.createElement('strong');
    title.textContent = word;
    header.appendChild(title);
    const loading = document.createElement('div');
    loading.className = 'yt-study-word-tip-loading';
    loading.textContent = '查询中…';
    tip.append(header, loading);
  }

  function renderWordTooltip(tip, word, payload) {
    tip.replaceChildren();
    const header = document.createElement('div');
    header.className = 'yt-study-word-tip-header';
    const title = document.createElement('strong');
    title.textContent = word;
    header.appendChild(title);
    if (payload && payload.local) {
      const source = document.createElement('span');
      source.className = 'yt-study-word-tip-source';
      source.textContent = '本地';
      header.appendChild(source);
      if (payload.local[0]) {
        const sound = document.createElement('span');
        sound.className = 'yt-study-word-tip-phonetic';
        sound.textContent = payload.local[0];
        header.appendChild(sound);
      }
    } else if (payload && payload.gloss) {
      const source = document.createElement('span');
      source.className = 'yt-study-word-tip-source';
      source.textContent = 'AI';
      header.appendChild(source);
    }
    tip.appendChild(header);
    if (payload && payload.local) {
      const lines = splitDictTranslation(payload.local[1]);
      const line = document.createElement('div');
      line.className = 'yt-study-word-tip-line yt-study-word-tip-gloss';
      line.textContent = truncateText(lines[0] || '（本词暂无释义）', 90);
      tip.appendChild(line);
      const hint = document.createElement('div');
      hint.className = 'yt-study-word-tip-hint';
      hint.textContent = '点击单词：完整释义 · 自动暂停';
      tip.appendChild(hint);
      return;
    }
    if (payload && payload.gloss) {
      const line = document.createElement('div');
      line.className = 'yt-study-word-tip-line yt-study-word-tip-gloss';
      line.textContent = payload.gloss;
      tip.appendChild(line);
      const hint = document.createElement('div');
      hint.className = 'yt-study-word-tip-hint';
      hint.textContent = '点击单词：详细讲解 · 自动暂停';
      tip.appendChild(hint);
      return;
    }
    const data = payload ? payload.data : null;
    const entries = Array.isArray(data) ? data.filter((entry) => entry && Array.isArray(entry.meanings)) : [];
    const phonetic = entries.find((entry) => entry.phonetic);
    if (phonetic) {
      const sound = document.createElement('span');
      sound.className = 'yt-study-word-tip-phonetic';
      sound.textContent = phonetic.phonetic;
      header.appendChild(sound);
    }
    const definitions = [];
    for (const entry of entries) {
      for (const meaning of entry.meanings || []) {
        if (!meaning.definitions || !meaning.definitions.length) continue;
        definitions.push({
          pos: meaning.partOfSpeech || '',
          text: meaning.definitions[0].definition || ''
        });
        if (definitions.length >= 2) break;
      }
      if (definitions.length >= 2) break;
    }
    if (!definitions.length) {
      const empty = document.createElement('div');
      empty.className = 'yt-study-word-tip-empty';
      empty.textContent = '没有找到简明释义，点击查看详情';
      tip.appendChild(empty);
    } else {
      for (const definition of definitions) {
        const line = document.createElement('div');
        line.className = 'yt-study-word-tip-line';
        if (definition.pos) {
          const pos = document.createElement('span');
          pos.className = 'yt-study-word-tip-pos';
          pos.textContent = definition.pos;
          line.appendChild(pos);
        }
        const text = document.createElement('span');
        text.textContent = truncateText(definition.text, 90);
        line.appendChild(text);
        tip.appendChild(line);
      }
    }
    const hint = document.createElement('div');
    hint.className = 'yt-study-word-tip-hint';
    hint.textContent = '点击单词：详细释义 · 自动暂停';
    tip.appendChild(hint);
  }

  function positionWordTooltip(tip, anchor) {
    const rect = anchor.getBoundingClientRect();
    const root = document.documentElement;
    const viewWidth = (window && window.innerWidth) || (root && root.clientWidth) || (rect.left + rect.width);
    const viewHeight = (window && window.innerHeight) || (root && root.clientHeight) || (rect.bottom + 200);
    const width = 268;
    const height = tip.offsetHeight || 90;
    const left = clamp(rect.left + rect.width / 2 - width / 2, 8, Math.max(8, viewWidth - width - 8));
    const preferAbove = rect.top - height - 10 >= 0;
    const top = preferAbove ? rect.top - height - 10 : rect.bottom + 10;
    tip.style.setProperty('left', `${Math.round(left)}px`);
    tip.style.setProperty('top', `${Math.round(top)}px`);
  }

  function truncateText(text, limit) {
    const value = String(text || '');
    return value.length > limit ? `${value.slice(0, limit - 1).trimEnd()}…` : value;
  }

  function dictionaryWordCandidates(word) {
    const list = [word];
    const stemFromIng = (stem) => {
      list.push(stem);
      list.push(`${stem}e`);
      if (/([bcdfgklmnprstvz])\1$/.test(stem)) list.push(stem.slice(0, -1));
    };
    const stemFromEd = (stem) => {
      list.push(stem);
      list.push(`${stem}e`);
      if (/([bcdfgklmnprstvz])\1$/.test(stem)) list.push(stem.slice(0, -1));
    };
    if (/ies$/.test(word) && word.length > 4) list.push(`${word.slice(0, -3)}y`);
    if (/(ches|shes|sses|xes)$/.test(word)) list.push(word.slice(0, -2));
    if (/s$/.test(word) && !/(ss|us|is)$/.test(word) && word.length > 3) list.push(word.slice(0, -1));
    if (/ing$/.test(word) && word.length > 5) stemFromIng(word.slice(0, -3));
    if (/ed$/.test(word) && word.length > 4) stemFromEd(word.slice(0, -2));
    return [...new Set(list)];
  }

  function fetchDictEntry(candidate, signal) {
    return fetch(`${DICT_API_PREFIX}${encodeURIComponent(candidate)}`, { signal })
      .then((response) => (response.ok ? response.json() : null));
  }

  async function lookupWord(word) {
    const cached = dictCache.get(word);
    if (cached !== undefined) return cached;
    const candidates = dictionaryWordCandidates(word);
    for (const candidate of candidates) {
      const cachedCandidate = dictCache.get(candidate);
      if (cachedCandidate) return cachedCandidate;
    }
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timeoutId = controller ? setTimeout(() => controller.abort(), DICT_FETCH_TIMEOUT_MS) : 0;
    let outcomes;
    try {
      outcomes = await Promise.allSettled(candidates.map((candidate) => fetchDictEntry(candidate, controller ? controller.signal : undefined)));
    } catch (error) {
      outcomes = [];
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
    let result = null;
    for (let index = 0; index < candidates.length; index++) {
      const outcome = outcomes[index];
      const data = outcome && outcome.status === 'fulfilled' ? outcome.value : null;
      const usable = !!(data && data.length);
      if (!dictCache.has(candidates[index])) dictCache.set(candidates[index], usable ? data : null);
      if (usable && !result) result = data;
    }
    scheduleDictCachePersist();
    return result;
  }

  function slimDictEntry(data) {
    const entries = Array.isArray(data) ? data.filter((entry) => entry && Array.isArray(entry.meanings)) : [];
    if (!entries.length) return null;
    return [{
      word: entries[0].word,
      phonetic: entries[0].phonetic || '',
      meanings: entries[0].meanings.slice(0, 4).map((meaning) => ({
        partOfSpeech: meaning.partOfSpeech || '',
        definitions: (meaning.definitions || []).slice(0, 3).map((definition) => ({
          definition: definition.definition || '',
          example: definition.example || ''
        }))
      }))
    }];
  }

  function scheduleDictCachePersist() {
    clearTimeout(dictPersistTimer);
    dictPersistTimer = setTimeout(() => {
      try {
        const hits = [];
        for (const [key, value] of dictCache.entries()) {
          if (!value) continue;
          const slim = slimDictEntry(value);
          if (slim) hits.push([key, slim]);
        }
        const trimmed = hits.length > DICT_CACHE_MAX_PERSISTED ? hits.slice(hits.length - DICT_CACHE_MAX_PERSISTED) : hits;
        chrome.storage.local.set({ [DICT_CACHE_STORAGE_KEY]: trimmed });
      } catch (error) {
        console.debug('[YouTube Study] Failed to persist dictionary cache', error);
      }
    }, 1200);
  }

  function loadDictCache() {
    chrome.storage.local.get(DICT_CACHE_STORAGE_KEY, (result) => {
      const stored = result && result[DICT_CACHE_STORAGE_KEY];
      if (!Array.isArray(stored)) return;
      for (const entry of stored) {
        if (Array.isArray(entry) && entry[0] && Array.isArray(entry[1]) && !dictCache.has(entry[0])) {
          dictCache.set(entry[0], entry[1]);
        }
      }
    });
  }

  function aiConfigured() {
    return !!(settings.lookupMode === 'ai' && settings.ai
      && settings.ai.baseUrl && settings.ai.apiKey && settings.ai.model);
  }

  async function fetchAiChat(messages, maxTokens, config = settings.ai, scope = 'detail') {
    if (!config || !config.baseUrl || !config.apiKey || !config.model) throw new Error('AI 未配置完整');
    return aiClient.request({ ...config }, messages, maxTokens, scope);
  }

  async function askAiGloss(word) {
    const cacheKey = `${settings.ai.baseUrl}|${settings.ai.model}|${word}`;
    const cached = aiGlossCache.get(cacheKey);
    if (cached !== undefined) return cached;
    const text = await fetchAiChat([
      {
        role: 'system',
        content: '你是英汉词典。对用户给出的英文单词输出一行简明中文释义，格式如“v. 跳跃；跨越”或“n. 狐狸；狡猾的人”。只输出释义这一行，不要任何解释。'
      },
      { role: 'user', content: word }
    ], 60, settings.ai, 'hover');
    const gloss = text.split(/\r?\n/)[0].slice(0, 80);
    aiGlossCache.set(cacheKey, gloss);
    scheduleAiCachePersist();
    return gloss;
  }

  async function fetchAiDetail(word, sentence) {
    return fetchAiChat([
      {
        role: 'system',
        content: '你是英语学习助教。根据给出的单词和原句，用中文严格按以下三行格式回答，每行不超过60字，不要输出其他内容：\n在本段中：<该词在这个句子里的确切含义>\n其他含义：<1-2个其他常见含义>\n例句：<一个简短英文例句>'
      },
      { role: 'user', content: `单词：${word}\n原句：${sentence || '（无）'}` }
    ], 220);
  }

  function renderDictLocalResult(popup, word, sentence, entry) {
    popup.replaceChildren(buildDictHeader(word));
    popup.dataset.state = 'local';
    if (entry[0]) {
      const sound = document.createElement('div');
      sound.className = 'yt-study-dict-phonetic';
      sound.textContent = entry[0];
      popup.appendChild(sound);
    }
    const lines = splitDictTranslation(entry[1]);
    lines.forEach((line, index) => {
      const row = document.createElement('div');
      row.className = index === 0 ? 'yt-study-dict-ai-row yt-study-dict-ai-primary' : 'yt-study-dict-ai-row';
      row.textContent = line;
      popup.appendChild(row);
    });
    const badge = document.createElement('div');
    badge.className = 'yt-study-word-tip-hint';
    badge.textContent = '本地词典（离线）';
    popup.appendChild(badge);
    appendDictSaveButton(popup);
  }

  function aiDetailKey(word, sentence) {
    return `${settings.ai.baseUrl}|${settings.ai.model}|${word}\u0001${String(sentence || '').toLowerCase().replace(/\s+/g, ' ').trim()}`;
  }

  async function resolveWordGloss(word) {
    if (settings.lookupMode === 'local' && localDictReady()) {
      const local = localDictLookup(word);
      if (local) return { local };
    }
    if (aiConfigured()) {
      try {
        const gloss = await askAiGloss(word);
        if (gloss) return { gloss };
      } catch (error) {
        if (error.name === 'AbortError') return null;
      }
    }
    const data = await lookupWord(word);
    return { data };
  }

  function renderDictAiResult(popup, word, sentence, detail) {
    popup.replaceChildren(buildDictHeader(word));
    popup.dataset.state = 'ai';
    const labels = [
      { prefix: '在本段中：', className: 'yt-study-dict-ai-primary' },
      { prefix: '其他含义：', className: '' },
      { prefix: '例句：', className: 'yt-study-dict-example' }
    ];
    const lines = String(detail || '').split(/\r?\n/).filter((line) => line.trim());
    for (const line of lines) {
      const matched = labels.find((item) => line.startsWith(item.prefix));
      const row = document.createElement('div');
      row.className = `yt-study-dict-ai-row${matched && matched.className ? ` ${matched.className}` : ''}`;
      if (matched) {
        const label = document.createElement('span');
        label.className = 'yt-study-dict-ai-label';
        label.textContent = matched.prefix.replace(/：$/, '');
        row.appendChild(label);
        row.appendChild(document.createTextNode(line.slice(matched.prefix.length).trim()));
      } else {
        row.textContent = line;
      }
      popup.appendChild(row);
    }
    appendDictSaveButton(popup);
  }

  function scheduleAiCachePersist() {
    clearTimeout(aiCachePersistTimer);
    aiCachePersistTimer = setTimeout(() => {
      try {
        chrome.storage.local.set({
          [AI_GLOSS_CACHE_KEY]: trimCacheEntries(aiGlossCache, AI_GLOSS_CACHE_MAX),
          [AI_DETAIL_CACHE_KEY]: trimCacheEntries(aiDetailCache, AI_DETAIL_CACHE_MAX)
        });
      } catch (error) {
        console.debug('[YouTube Study] Failed to persist AI caches', error);
      }
    }, 1500);
  }

  function trimCacheEntries(map, max) {
    const entries = [];
    for (const [key, value] of map.entries()) {
      if (value) entries.push([key, value]);
    }
    return entries.length > max ? entries.slice(entries.length - max) : entries;
  }

  function loadAiCaches() {
    chrome.storage.local.get(AI_GLOSS_CACHE_KEY, (result) => {
      const stored = result && result[AI_GLOSS_CACHE_KEY];
      if (Array.isArray(stored)) {
        for (const entry of stored) {
          if (Array.isArray(entry) && entry[0] && entry[1] && !aiGlossCache.has(entry[0])) {
            aiGlossCache.set(entry[0], entry[1]);
          }
        }
      }
    });
    chrome.storage.local.get(AI_DETAIL_CACHE_KEY, (result) => {
      const stored = result && result[AI_DETAIL_CACHE_KEY];
      if (Array.isArray(stored)) {
        for (const entry of stored) {
          if (Array.isArray(entry) && entry[0] && entry[1] && !aiDetailCache.has(entry[0])) {
            aiDetailCache.set(entry[0], entry[1]);
          }
        }
      }
    });
  }

  function toggleSettingsView(open) {
    settingsOpen = !!open;
    if (!settingsOpen) aiClient.cancel('test');
    if (settingsOpen && vocabOpen) toggleVocabView(false);
    const list = byId('yt-study-list');
    const settingsView = byId('yt-study-settings');
    const button = byId('yt-study-settings-btn');
    if (list) list.hidden = settingsOpen;
    if (settingsView) settingsView.hidden = !settingsOpen;
    if (button) button.classList.toggle('active', settingsOpen);
    if (settingsOpen) {
      closeDictPopup();
      closeWordTooltip();
      populateAiSettingsUI();
    }
  }

  function populateAiSettingsUI() {
    const enabledSelect = byId('yt-study-ai-enabled');
    const providerSelect = byId('yt-study-ai-provider');
    if (!enabledSelect || !providerSelect) return;
    enabledSelect.replaceChildren(
      new Option('免费词典（默认）', 'dict'),
      new Option('AI 大模型（需 API Key）', 'ai'),
      new Option('本地词典（离线秒查）', 'local')
    );
    if (!providerSelect.options || !providerSelect.options.length) {
      for (const [key, preset] of Object.entries(AI_PROVIDERS)) {
        providerSelect.appendChild(new Option(preset.label, key));
      }
    }
    const mode = ['dict', 'ai', 'local'].includes(settings.lookupMode) ? settings.lookupMode : 'dict';
    enabledSelect.value = mode;
    providerSelect.value = settings.ai && AI_PROVIDERS[settings.ai.provider] ? settings.ai.provider : 'zhipu';
    const urlInput = byId('yt-study-ai-url');
    const keyInput = byId('yt-study-ai-key');
    const modelInput = byId('yt-study-ai-model');
    if (urlInput) urlInput.value = settings.ai ? settings.ai.baseUrl : '';
    if (keyInput) keyInput.value = settings.ai ? settings.ai.apiKey : '';
    if (modelInput) modelInput.value = settings.ai ? settings.ai.model : '';
    const remember = byId('yt-study-remember');
    if (remember) remember.checked = settings.rememberRate;
    const status = byId('yt-study-settings-status');
    if (status) status.textContent = '设置已保存';
    updateAiKeyHint();
    updateLocalDictUI();
    updateLookupModeSections(mode);
  }

  function updateLookupModeSections(mode) {
    const hint = byId('yt-study-mode-hint');
    const aiFields = byId('yt-study-ai-fields');
    const localDict = byId('yt-study-local-dict');
    if (hint) {
      hint.hidden = mode !== 'dict';
      hint.textContent = '使用免费的在线英英词典（dictionaryapi.dev）：悬停显示英文简明释义，点击显示原句上下文和词义排序。查过的词会缓存到本地。不需要任何配置。';
    }
    if (aiFields) aiFields.hidden = mode !== 'ai';
    if (localDict) localDict.hidden = mode !== 'local';
  }

  function handleLookupModeChange(event) {
    const mode = event.target.value;
    updateLookupModeSections(mode);
    markSettingsDirty();
  }

  function markSettingsDirty() {
    const status = byId('yt-study-settings-status');
    if (status) status.textContent = '有未保存的修改';
  }

  function handleAiProviderChange() {
    const providerSelect = byId('yt-study-ai-provider');
    const preset = providerSelect && AI_PROVIDERS[providerSelect.value];
    if (!preset) return;
    const urlInput = byId('yt-study-ai-url');
    const modelInput = byId('yt-study-ai-model');
    if (urlInput) urlInput.value = preset.baseUrl;
    if (modelInput) modelInput.value = preset.model;
    const keyInput = byId('yt-study-ai-key');
    if (keyInput) keyInput.value = '';
    markSettingsDirty();
    updateAiKeyHint();
  }

  function updateAiKeyHint() {
    const providerSelect = byId('yt-study-ai-provider');
    const keyInput = byId('yt-study-ai-key');
    const preset = providerSelect && AI_PROVIDERS[providerSelect.value];
    if (keyInput && preset) keyInput.placeholder = `${preset.keyHint}，形如 sk-…`;
  }

  function collectAiSettings() {
    const enabledSelect = byId('yt-study-ai-enabled');
    const providerSelect = byId('yt-study-ai-provider');
    const urlInput = byId('yt-study-ai-url');
    const keyInput = byId('yt-study-ai-key');
    const modelInput = byId('yt-study-ai-model');
    const rawMode = enabledSelect ? enabledSelect.value : 'dict';
    const lookupMode = ['dict', 'ai', 'local'].includes(rawMode) ? rawMode : 'dict';
    const provider = providerSelect && AI_PROVIDERS[providerSelect.value] ? providerSelect.value : 'custom';
    const baseUrl = String(urlInput ? urlInput.value : '').trim().replace(/\/+$/, '');
    const apiKey = String(keyInput ? keyInput.value : '').trim();
    const model = String(modelInput ? modelInput.value : '').trim();
    return { lookupMode, provider, baseUrl, apiKey, model };
  }

  function saveAiSettings() {
    const collected = collectAiSettings();
    if (collected.lookupMode === 'ai' && (!collected.baseUrl || !collected.apiKey || !collected.model)) {
      showToast('启用 AI 需要填写接口地址、API Key 和模型名');
      return;
    }
    if (collected.lookupMode === 'ai') {
      try {
        const url = new URL(collected.baseUrl);
        if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error();
      } catch { showToast('请填写不含凭据或查询参数的 HTTPS 接口地址'); return; }
    }
    aiClient.cancel('detail');
    aiClient.cancel('hover');
    settings.rememberRate = !!byId('yt-study-remember').checked;
    settings.lookupMode = collected.lookupMode;
    settings.ai = {
      enabled: collected.lookupMode === 'ai',
      provider: collected.provider,
      baseUrl: collected.baseUrl,
      apiKey: collected.apiKey,
      model: collected.model
    };
    saveSettings();
    const status = byId('yt-study-settings-status');
    if (status) status.textContent = '设置已保存';
    if (collected.lookupMode === 'ai') showToast('AI 词典已启用');
    else if (collected.lookupMode === 'local') {
      showToast(localDictReady() ? '本地词典模式已启用' : '本地词典模式已启用（未安装，暂用在线词典）');
    } else showToast('已改用免费词典');
  }

  async function testAiConnection() {
    if (aiTestRunning) return;
    const collected = collectAiSettings();
    if (!collected.baseUrl || !collected.apiKey || !collected.model) {
      showToast('请先填写接口地址、API Key 和模型名');
      return;
    }
    const button = byId('yt-study-ai-test');
    aiTestRunning = true;
    if (button) button.disabled = true;
    showToast('正在测试当前草稿…');
    try {
      await fetchAiChat([{ role: 'user', content: '请直接回复 ok' }], 8, collected, 'test');
      showToast('草稿连接成功；点击保存设置后生效');
    } catch (error) {
      showToast(`连接失败：${error instanceof Error ? error.message : '未知错误'}`);
    } finally {
      aiTestRunning = false;
      if (button) button.disabled = false;
    }
  }

  function localDictReady() {
    return localDictMap.size > 0;
  }

  function localDictLookup(word) {
    const direct = localDictMap.get(word);
    if (direct) return direct;
    for (const candidate of dictionaryWordCandidates(word)) {
      if (candidate === word) continue;
      const hit = localDictMap.get(candidate);
      if (hit) return hit;
    }
    return null;
  }

  function splitDictTranslation(translation) {
    return String(translation || '')
      .split(/\\n|\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  }

  function applyLocalDictData(data) {
    const map = new Map();
    if (data && typeof data === 'object') {
      for (const [key, value] of Object.entries(data)) {
        if (key === '__meta__') continue;
        if (!/^[a-z][a-z' -]*$/.test(key)) continue;
        if (!Array.isArray(value) || typeof value[1] !== 'string' || !value[1].trim()) continue;
        map.set(key, [String(value[0] || ''), value[1]]);
      }
    }
    localDictMap = map;
    localDictWordCount = map.size;
    updateLocalDictUI();
    return map.size;
  }

  function updateLocalDictUI() {
    const status = byId('yt-study-dict-status');
    if (status) {
      status.textContent = localDictReady()
        ? `已安装：${localDictWordCount} 词（离线秒查，无网络请求）`
        : '未安装。下载约 2.2MB 的高频词英汉词典，安装后悬停/点击立即离线显示释义。';
    }
    const remove = byId('yt-study-dict-remove');
    if (remove) remove.hidden = !localDictReady();
  }

  function loadLocalDict() {
    chrome.storage.local.get(LOCAL_DICT_STORAGE_KEY, (result) => {
      const stored = result && result[LOCAL_DICT_STORAGE_KEY];
      if (stored && typeof stored === 'object') applyLocalDictData(stored);
      else updateLocalDictUI();
    });
  }

  async function installLocalDictFromUrl(url) {
    const button = byId('yt-study-dict-download');
    if (button) button.disabled = true;
    const status = byId('yt-study-dict-status');
    if (status) status.textContent = '正在下载词典…';
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const text = await response.text();
      const data = JSON.parse(text);
      const count = applyLocalDictData(data);
      if (!count) throw new Error('词典文件内容无效');
      chrome.storage.local.set({ [LOCAL_DICT_STORAGE_KEY]: data });
      showToast(`本地词典已安装（${count} 词）`);
    } catch (error) {
      showToast(`安装失败：${error instanceof Error ? error.message : '未知错误'}`);
      updateLocalDictUI();
    }
    if (button) button.disabled = false;
  }

  function installLocalDictNow() {
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL) {
      const bundled = chrome.runtime.getURL(LOCAL_DICT_BUNDLED_PATH);
      fetch(bundled)
        .then((response) => installLocalDictFromUrl(response.ok ? bundled : LOCAL_DICT_REMOTE_URL))
        .catch(() => installLocalDictFromUrl(LOCAL_DICT_REMOTE_URL));
      return;
    }
    installLocalDictFromUrl(LOCAL_DICT_REMOTE_URL);
  }

  function handleDictFileImport(event) {
    const file = event.target && event.target.files && event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(String(reader.result));
        const count = applyLocalDictData(data);
        if (!count) throw new Error('文件里没有可用词条');
        chrome.storage.local.set({ [LOCAL_DICT_STORAGE_KEY]: data });
        showToast(`本地词典已导入（${count} 词）`);
      } catch (error) {
        showToast(`导入失败：${error instanceof Error ? error.message : '文件格式错误'}`);
      }
    };
    reader.readAsText(file);
  }

  function removeLocalDict() {
    localDictMap = new Map();
    localDictWordCount = 0;
    chrome.storage.local.remove(LOCAL_DICT_STORAGE_KEY);
    if (settings.lookupMode === 'local') {
      settings.lookupMode = 'dict';
      settings.ai.enabled = false;
      saveSettings();
      populateAiSettingsUI();
    }
    updateLocalDictUI();
    showToast('本地词典已删除');
  }


  function contextSentenceWords(sentence, word) {
    const ignored = new Set(['the', 'a', 'an', 'of', 'to', 'in', 'on', 'for', 'and', 'or', 'is', 'are', 'was', 'were', 'be', 'been', 'it', 'its', 'this', 'that', 'with', 'as', 'at', 'by', 'from', 'he', 'she', 'they', 'we', 'you', 'i', 'his', 'her', 'their', 'our', 'my', 'your', 'not', 'but', 'if', 'then', 'than', 'so', 'do', 'does', 'did', 'have', 'has', 'had', 'will', 'would', 'can', 'could', 'about', 'into', 'over', 'under', 'up', 'down', 'out', 'who', 'which', 'what', 'when', 'where', 'how', 'there', 'here']);
    return String(sentence || '')
      .toLowerCase()
      .split(/[^a-z']+/)
      .filter((token) => token.length > 2 && token !== word && !ignored.has(token));
  }

  function scoreMeaningForContext(meaning, contextWords) {
    let best = 0;
    for (const definition of meaning.definitions || []) {
      const text = `${definition.definition || ''} ${definition.example || ''}`.toLowerCase();
      let score = 0;
      for (const token of contextWords) {
        if (text.includes(token)) score++;
      }
      best = Math.max(best, score);
    }
    return best;
  }

  function loadVocab() {
    chrome.storage.local.get(VOCAB_KEY, (result) => {
      const stored = result && result[VOCAB_KEY];
      vocabEntries = Array.isArray(stored)
        ? stored.filter((entry) => entry && typeof entry === 'object')
        : [];
      updateVocabBadge();
      if (vocabOpen) renderVocabList();
    });
  }

  function persistVocab() {
    chrome.storage.local.set({ [VOCAB_KEY]: vocabEntries.slice(0, VOCAB_MAX_ENTRIES) });
  }

  function addVocabEntry(partial) {
    const videoId = currentVideoId || getVideoId() || '';
    const time = Number.isFinite(partial.time) ? partial.time : (video ? video.currentTime : 0);
    const id = [videoId, partial.kind, partial.word || '', Math.round(time)].join('|');
    if (vocabEntries.some((entry) => entry.id === id)) {
      showToast('这条已经收藏过了');
      return;
    }
    vocabEntries.unshift({
      id,
      kind: partial.kind === 'word' ? 'word' : 'sentence',
      word: partial.word || '',
      sentence: partial.sentence || '',
      videoId,
      videoTitle: currentVideoTitle(),
      time: Math.max(0, time),
      addedAt: Date.now()
    });
    if (vocabEntries.length > VOCAB_MAX_ENTRIES) vocabEntries.length = VOCAB_MAX_ENTRIES;
    persistVocab();
    updateVocabBadge();
    if (vocabOpen) renderVocabList();
    showToast(partial.kind === 'word' ? `已收藏单词 ${partial.word}` : '已收藏本段');
  }

  function updateVocabBadge() {
    const badge = byId('yt-study-vocab-count');
    if (!badge) return;
    badge.textContent = String(vocabEntries.length);
    badge.hidden = vocabEntries.length === 0;
  }

  function toggleVocabView(open) {
    vocabOpen = !!open;
    if (vocabOpen && settingsOpen) toggleSettingsView(false);
    const list = byId('yt-study-list');
    const vocab = byId('yt-study-vocab');
    const toggle = byId('yt-study-vocab-toggle');
    const panel = byId('yt-study-panel');
    if (list) list.hidden = vocabOpen;
    if (vocab) vocab.hidden = !vocabOpen;
    if (toggle) toggle.classList.toggle('active', vocabOpen);
    if (panel) panel.classList.toggle('vocab-open', vocabOpen);
    if (vocabOpen) {
      closeDictPopup();
      renderVocabList();
    }
  }

  function renderVocabList() {
    const container = byId('yt-study-vocab-list');
    if (!container) return;
    if (!vocabEntries.length) {
      const empty = document.createElement('div');
      empty.className = 'yt-study-vocab-empty';
      empty.textContent = '还没有收藏。右键字幕句子，或点击单词后收藏。';
      container.replaceChildren(empty);
      return;
    }
    const fragment = document.createDocumentFragment();
    for (const entry of vocabEntries) {
      const item = document.createElement('div');
      item.className = 'yt-study-vocab-item';
      item.dataset.id = entry.id;

      const main = document.createElement('div');
      main.className = 'yt-study-vocab-main';
      const kind = document.createElement('span');
      kind.className = `yt-study-vocab-kind ${entry.kind === 'word' ? 'word' : 'sentence'}`;
      kind.textContent = entry.kind === 'word' ? '词' : '句';
      const text = document.createElement('span');
      text.className = 'yt-study-vocab-text';
      text.textContent = entry.kind === 'word' ? entry.word : entry.sentence;
      main.append(kind, text);

      const body = document.createElement('div');
      body.className = 'yt-study-vocab-body';
      body.append(main);
      if (entry.kind === 'word' && entry.sentence) {
        const context = document.createElement('div');
        context.className = 'yt-study-vocab-sentence';
        context.textContent = entry.sentence;
        body.appendChild(context);
      }

      const meta = document.createElement('div');
      meta.className = 'yt-study-vocab-meta';
      const link = document.createElement('button');
      link.type = 'button';
      link.className = 'yt-study-vocab-link';
      link.title = '回到这个时间点';
      link.textContent = `${entry.videoTitle || 'YouTube'} · ${formatClock(entry.time)}`;
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'yt-study-vocab-remove';
      remove.setAttribute('aria-label', '删除这条收藏');
      remove.textContent = '×';
      meta.append(link, remove);

      item.append(body, meta);
      fragment.appendChild(item);
    }
    container.replaceChildren(fragment);
  }

  function handleVocabListClick(event) {
    if (!(event.target instanceof Element)) return;
    const item = event.target.closest('.yt-study-vocab-item');
    if (!item) return;
    const entry = vocabEntries.find((candidate) => candidate.id === item.dataset.id);
    if (!entry) return;
    if (event.target.closest('.yt-study-vocab-remove')) {
      vocabEntries = vocabEntries.filter((candidate) => candidate.id !== entry.id);
      persistVocab();
      updateVocabBadge();
      renderVocabList();
      showToast('已删除');
      return;
    }
    const link = videoLink(entry.videoId, entry.time);
    if (link) {
      try {
        window.open(link, '_blank', 'noopener');
      } catch (error) {
        showToast('无法打开链接');
      }
    }
  }

  function clearVocab() {
    if (!vocabEntries.length) {
      showToast('生词本已经是空的');
      return;
    }
    let confirmed = true;
    try {
      confirmed = window.confirm('确定清空全部收藏吗？此操作不可撤销。');
    } catch (error) {
      confirmed = true;
    }
    if (!confirmed) return;
    vocabEntries = [];
    persistVocab();
    updateVocabBadge();
    renderVocabList();
    showToast('生词本已清空');
  }

  function csvEscape(value) {
    const text = String(value === null || value === undefined ? '' : value);
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }

  function buildVocabCsv() {
    const header = ['收藏时间', '类型', '单词', '句子', '视频', '时间点', '链接'];
    const rows = vocabEntries.map((entry) => [
      new Date(entry.addedAt).toLocaleString(),
      entry.kind === 'word' ? '单词' : '句子',
      entry.word,
      entry.sentence,
      entry.videoTitle,
      formatClock(entry.time),
      videoLink(entry.videoId, entry.time)
    ]);
    return `\uFEFF${[header, ...rows].map((row) => row.map(csvEscape).join(',')).join('\r\n')}\r\n`;
  }

  function ankiEscape(value) {
    return String(value === null || value === undefined ? '' : value)
      .replace(/\t/g, ' ')
      .replace(/\r?\n/g, '<br>');
  }

  function buildVocabAnki() {
    const rows = vocabEntries.map((entry) => {
      const source = `<a href="${videoLink(entry.videoId, entry.time)}">${ankiEscape(entry.videoTitle)} · ${formatClock(entry.time)}</a>`;
      if (entry.kind === 'word') {
        return `${ankiEscape(entry.word)}\t${ankiEscape(entry.sentence)}<br>${source}`;
      }
      return `${ankiEscape(entry.sentence)}\t${source}`;
    });
    return `${rows.join('\n')}\n`;
  }

  function exportVocab(format) {
    if (!vocabEntries.length) {
      showToast('生词本还是空的');
      return;
    }
    const date = new Date().toISOString().slice(0, 10);
    if (format === 'anki') {
      downloadTextFile(buildVocabAnki(), `youtube-vocab-${date}.txt`, 'text/plain;charset=utf-8');
    } else {
      downloadTextFile(buildVocabCsv(), `youtube-vocab-${date}.csv`, 'text/csv;charset=utf-8');
    }
  }

  function downloadTextFile(content, filename, mimeType) {
    const blobUrl = URL.createObjectURL(new Blob([content], { type: mimeType }));
    const link = document.createElement('a');
    link.href = blobUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
  }

  function requestTracks(resetAttempts) {
    if (!panelOpen) return;
    if (resetAttempts) trackRequestAttempts = 0;
    clearTimeout(trackRequestTimer);
    setStatus('正在读取这个视频的字幕…', 'loading');
    trackRequestAttempts++;
    if (trackRequestAttempts < 4) {
      trackRequestTimer = setTimeout(() => requestTracks(false), 600);
    } else {
      trackRequestTimer = setTimeout(() => {
        if (!tracks.length) setStatus('暂时无法读取字幕，请稍后重新打开面板', 'error');
      }, 800);
    }
    document.dispatchEvent(new CustomEvent(REQUEST_EVENT));
  }

  function handleTrackResponse(event) {
    let payload;
    try {
      payload = JSON.parse(event.detail || '{}');
    } catch (error) {
      setStatus('字幕数据格式无效', 'error');
      return;
    }
    if (payload.videoId && currentVideoId && payload.videoId !== currentVideoId) return;
    clearTimeout(trackRequestTimer);
    trackRequestAttempts = 0;
    videoTitle = typeof payload.title === 'string'
      ? payload.title
      : document.title.replace(/\s*-\s*YouTube\s*$/, '');
    tracks = Array.isArray(payload.tracks)
      ? payload.tracks.map(normalizeTrack).filter(Boolean)
      : [];
    populateTrackSelect();
  }

  function populateTrackSelect() {
    const select = byId('yt-study-track');
    if (!select) return;
    select.replaceChildren();
    if (!tracks.length) {
      const option = document.createElement('option');
      option.textContent = '没有可用字幕';
      option.value = '-1';
      select.appendChild(option);
      select.disabled = true;
      clearTranscript();
      setStatus('这个视频没有可读取的字幕', 'empty');
      return;
    }

    select.disabled = false;
    tracks.forEach((track, index) => {
      const option = document.createElement('option');
      option.value = String(index);
      option.textContent = `${track.name}${track.kind === 'asr' ? '（自动生成）' : ''}`;
      select.appendChild(option);
    });

    let preferredIndex = tracks.findIndex((track) => trackKey(track) === settings.preferredTrack);
    if (preferredIndex < 0) {
      const manualEnglish = tracks.findIndex((track) => /^en(?:-|$)/i.test(track.languageCode) && track.kind !== 'asr');
      const anyEnglish = tracks.findIndex((track) => /^en(?:-|$)/i.test(track.languageCode));
      const manual = tracks.findIndex((track) => track.kind !== 'asr');
      preferredIndex = manualEnglish >= 0 ? manualEnglish : anyEnglish;
      if (preferredIndex < 0) preferredIndex = manual >= 0 ? manual : 0;
    }
    selectedTrackIndex = preferredIndex;
    select.value = String(preferredIndex);
    loadTrack(preferredIndex);
  }

  async function loadTrack(index) {
    const track = tracks[index];
    if (!track) return;
    const token = ++trackLoadToken;
    stopSentenceLoop();
    clearTranscript();
    setStatus(`正在加载${track.name}字幕…`, 'loading');
    setDownloadEnabled(false);
    try {
      const loaded = captionCache.has(track.baseUrl)
        ? captionCache.get(track.baseUrl)
        : await fetchCaptionCues(track);
      if (token !== trackLoadToken) return;
      captionCache.set(track.baseUrl, loaded);
      cues = loaded.cues;
      captionSegments = loaded.segments || [];
      renderTranscript();
      buildOverlayChunks();
      setDownloadEnabled(cues.length > 0);
      resetAutoPauseTracker();
      if (!cues.length) setStatus('字幕轨道存在，但没有可显示的内容', 'empty');
      else setStatus('', '');
      if (video) updateActiveCue(findCueIndex(video.currentTime));
    } catch (error) {
      if (token !== trackLoadToken) return;
      console.error('[YouTube Study] Failed to load captions', error);
      const detail = error instanceof Error && error.message ? error.message : '未知错误';
      setStatus(`字幕读取失败：${detail}`, 'error');
      setDownloadEnabled(false);
    }
  }

  async function fetchCaptionCues(track) {
    const jsonUrl = new URL(track.baseUrl, location.origin);
    jsonUrl.searchParams.set('fmt', 'json3');
    const attempts = [
      { label: 'JSON3', url: jsonUrl.toString() },
      { label: 'XML', url: track.baseUrl }
    ];
    const errors = [];
    for (const attempt of attempts) {
      try {
        const text = await fetchCaptionThroughPage(attempt.url, track);
        const parsed = parseCaptionBody(text);
        if (parsed.cues.length) return parsed;
        errors.push(`${attempt.label} 正文为空或无法识别`);
      } catch (error) {
        errors.push(error instanceof Error ? error.message : `${attempt.label} 请求失败`);
      }
    }
    throw new Error(errors.length ? errors.join('；') : '字幕读取失败');
  }

  function parseCaptionBody(body) {
    const text = String(body || '').replace(/^\uFEFF/, '').trim();
    if (!text) return { cues: [], segments: [] };
    if (text[0] === '{' || text[0] === '[') {
      try {
        const parsed = parseJsonCaptions(JSON.parse(text));
        if (parsed.cues.length) return parsed;
      } catch (error) {
        console.debug('[YouTube Study] Caption body is not valid JSON3', error);
      }
    }
    if (/^WEBVTT/m.test(text)) return parseVttCaptions(text);
    try {
      return parseXmlCaptions(text);
    } catch (error) {
      console.debug('[YouTube Study] Caption body is not valid XML', error);
    }
    return { cues: [], segments: [] };
  }

  function parseVttTimestamp(value) {
    const match = /^(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{3})$/.exec(String(value || '').trim());
    if (!match) return NaN;
    const hours = Number(match[1] || 0);
    return hours * 3600 + Number(match[2]) * 60 + Number(match[3]) + Number(match[4]) / 1000;
  }

  function parseVttCaptions(vttText) {
    const lines = String(vttText || '').replace(/\r/g, '').split('\n');
    const raw = [];
    let index = 0;
    while (index < lines.length) {
      const timing = lines[index].match(/^\s*((?:\d+:)?\d{2}:\d{2}[.,]\d{3})\s*-->\s*((?:\d+:)?\d{2}:\d{2}[.,]\d{3})/);
      if (!timing) {
        index++;
        continue;
      }
      const start = parseVttTimestamp(timing[1]);
      const end = parseVttTimestamp(timing[2]);
      const textLines = [];
      index++;
      while (index < lines.length && lines[index].trim() !== '') {
        if (lines[index].trim()) textLines.push(lines[index]);
        index++;
      }
      index++;
      raw.push(...parseVttCueFragments(textLines.join(' '), start, end));
    }
    return normalizeCues(raw);
  }

  function parseVttCueFragments(payload, cueStart, cueEnd) {
    const timestampPattern = /<((?:\d+:)?\d{2}:\d{2}[.,]\d{3})>/g;
    const markers = Array.from(payload.matchAll(timestampPattern));
    if (!markers.length) {
      return [{
        start: cueStart,
        end: cueEnd,
        text: cleanCaptionText(payload.replace(/<[^>]+>/g, ''))
      }];
    }

    const fragments = [];
    let cursor = 0;
    let fragmentStart = cueStart;
    for (const marker of markers) {
      const markerTime = parseVttTimestamp(marker[1]);
      const text = cleanCaptionText(payload.slice(cursor, marker.index).replace(/<[^>]+>/g, ''));
      if (text) fragments.push({ start: fragmentStart, end: markerTime, text });
      fragmentStart = Number.isFinite(markerTime) ? markerTime : fragmentStart;
      cursor = marker.index + marker[0].length;
    }
    const remaining = cleanCaptionText(payload.slice(cursor).replace(/<[^>]+>/g, ''));
    if (remaining) fragments.push({ start: fragmentStart, end: cueEnd, text: remaining });
    return fragments;
  }

  function fetchCaptionThroughPage(url, track) {
    return new Promise((resolve, reject) => {
      const requestId = `${Date.now()}-${++captionRequestSequence}`;
      const timeoutId = setTimeout(() => {
        pendingCaptionRequests.delete(requestId);
        reject(new Error('字幕请求超时'));
      }, 20000);
      pendingCaptionRequests.set(requestId, { resolve, reject, timeoutId });
      document.dispatchEvent(new CustomEvent(CAPTION_REQUEST_EVENT, {
        detail: JSON.stringify({
          requestId,
          url,
          videoId: currentVideoId,
          languageCode: track.languageCode,
          kind: track.kind,
          vssId: track.vssId
        })
      }));
    });
  }

  function handleCaptionResponse(event) {
    let response;
    try {
      response = JSON.parse(event.detail || '{}');
    } catch (error) {
      return;
    }
    const pending = pendingCaptionRequests.get(response.requestId);
    if (!pending) return;
    pendingCaptionRequests.delete(response.requestId);
    clearTimeout(pending.timeoutId);
    if (response.ok) {
      pending.resolve(typeof response.body === 'string' ? response.body : '');
      return;
    }
    const status = Number(response.status);
    const message = response.error || (status ? `YouTube 返回 HTTP ${status}` : '字幕网络请求失败');
    pending.reject(new Error(message));
  }

  function parseJsonCaptions(data) {
    const events = data && Array.isArray(data.events) ? data.events : [];
    const raw = [];
    for (const event of events) {
      const eventStartMs = Number(event.tStartMs);
      const eventDurationMs = Number(event.dDurationMs || 0);
      const segments = Array.isArray(event.segs) ? event.segs : [];
      let previousOffsetMs = 0;
      const offsets = segments.map((segment) => {
        const candidate = Number(segment.tOffsetMs);
        if (Number.isFinite(candidate)) previousOffsetMs = candidate;
        return previousOffsetMs;
      });
      const hasWordTiming = new Set(offsets).size > 1;
      if (!hasWordTiming) {
        raw.push({
          start: eventStartMs / 1000,
          end: (eventStartMs + eventDurationMs) / 1000,
          text: cleanCaptionText(segments.map((segment) => segment.utf8 || '').join(''))
        });
        continue;
      }

      for (let index = 0; index < segments.length; index++) {
        const segment = segments[index];
        const text = cleanCaptionText(segment.utf8 || '');
        if (!text) continue;
        const offsetMs = offsets[index];
        let nextOffsetMs = eventDurationMs;
        for (let nextIndex = index + 1; nextIndex < segments.length; nextIndex++) {
          if (offsets[nextIndex] > offsetMs) {
            nextOffsetMs = offsets[nextIndex];
            break;
          }
        }
        raw.push({
          start: (eventStartMs + offsetMs) / 1000,
          end: (eventStartMs + Math.max(offsetMs, nextOffsetMs)) / 1000,
          text
        });
      }
    }
    return normalizeCues(raw);
  }

  function parseXmlCaptions(xmlText) {
    const documentNode = new DOMParser().parseFromString(xmlText, 'text/xml');
    if (documentNode.querySelector('parsererror')) throw new Error('Invalid caption XML');
    const nodes = Array.from(documentNode.querySelectorAll('text, p'));
    const raw = [];
    for (const node of nodes) {
      const millisecondStart = node.getAttribute('t');
      const start = millisecondStart !== null
        ? Number(millisecondStart) / 1000
        : parseTimeValue(node.getAttribute('start') || node.getAttribute('begin'));
      const millisecondDuration = node.getAttribute('d');
      const duration = millisecondDuration !== null
        ? Number(millisecondDuration) / 1000
        : parseTimeValue(node.getAttribute('dur'));
      const explicitEnd = parseTimeValue(node.getAttribute('end'));
      const end = Number.isFinite(explicitEnd) ? explicitEnd : start + (Number.isFinite(duration) ? duration : 0);
      const segments = Array.from(node.children || []).filter((child) => child.localName === 's');
      const offsets = segments.map((segment) => Number(segment.getAttribute('t') || 0) / 1000);
      if (!segments.length || new Set(offsets).size <= 1) {
        raw.push({ start, end, text: cleanCaptionText(node.textContent) });
        continue;
      }

      for (let index = 0; index < segments.length; index++) {
        const segment = segments[index];
        const offset = offsets[index];
        const nextOffset = offsets.find((candidate, candidateIndex) => candidateIndex > index && candidate > offset);
        raw.push({
          start: start + offset,
          end: start + (Number.isFinite(nextOffset) ? nextOffset : duration),
          text: cleanCaptionText(segment.textContent)
        });
      }
    }
    return normalizeCues(raw);
  }

  function parseTimeValue(value) {
    if (typeof value !== 'string' || !value) return NaN;
    if (/^\d+(?:\.\d+)?$/.test(value)) return Number(value);
    const parts = value.split(':').map(Number);
    if (parts.some((part) => !Number.isFinite(part))) return NaN;
    return parts.reduce((total, part) => total * 60 + part, 0);
  }

  function normalizeCues(rawCues) {
    const valid = rawCues
      .filter((cue) => Number.isFinite(cue.start) && cue.start >= 0 && cue.text)
      .sort((left, right) => left.start - right.start);
    const timelineCues = valid.map((cue, index) => {
      const nextStart = valid[index + 1] ? valid[index + 1].start : cue.start + 3;
      const end = Number.isFinite(cue.end) && cue.end > cue.start ? cue.end : nextStart;
      return {
        start: cue.start,
        end: Math.max(cue.start + 0.15, end),
        text: cue.text
      };
    });
    // dDurationMs 是"显示停留时长"，会拖到下一词开始之后；把词结束时间钳制到后继开始，
    // 让短语结束时间对齐真实语音，避免相邻短语时间区间重叠。
    for (let index = 0; index + 1 < timelineCues.length; index++) {
      const nextCue = timelineCues[index + 1];
      if (timelineCues[index].end > nextCue.start) {
        timelineCues[index].end = Math.max(timelineCues[index].start + 0.05, nextCue.start);
      }
    }
    return {
      cues: groupWordsIntoPhrases(timelineCues),
      segments: timelineCues
    };
  }

  function captionJoiner(leftText, rightText) {
    const left = String(leftText || '');
    const right = String(rightText || '');
    if (!left || !right) return '';
    const leftCharacter = left.slice(-1);
    const rightCharacter = right[0];
    if (/^[,.;:!?，。！？；：、%\)\]\}”’]/.test(right)) return '';
    if (/[\(\[\{“‘]$/.test(left) || /[-‐‑–—]$/.test(left)) return '';
    if (/^[’'][A-Za-z]/.test(right)) return '';
    const compactScript = /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/;
    if (compactScript.test(leftCharacter) && compactScript.test(rightCharacter)) return '';
    return ' ';
  }

  function groupWordsIntoPhrases(timelineCues) {
    const phrases = [];
    let current = null;
    const wordsOf = (text) => String(text || '').split(/\s+/).filter(Boolean).length;
    const endsSentence = (text) => /[.!?。！？]["'”’)]*$/.test(String(text || '').trim());

    const flush = () => {
      if (current && current.text) phrases.push({ ...current });
      current = null;
    };

    for (let index = 0; index < timelineCues.length; index++) {
      const cue = timelineCues[index];
      const text = String(cue.text || '').trim();
      if (!text) continue;
      const cueWords = wordsOf(text);
      const gap = current ? cue.start - current.end : Infinity;
      if (!current || gap > 0.6 || cueWords > 1
          || wordsOf(current.text) >= 12
          || (endsSentence(current.text) && wordsOf(current.text) >= 2)) {
        flush();
        current = { start: cue.start, end: cue.end, text };
      } else {
        current.text += captionJoiner(current.text, text) + text;
        current.end = cue.end;
      }
      const next = timelineCues[index + 1];
      const nextGap = next ? next.start - current.end : Infinity;
      if (wordsOf(current.text) >= 12
          || (endsSentence(current.text) && wordsOf(current.text) >= 2)
          || nextGap > 0.6) {
        flush();
      }
    }
    flush();
    return phrases.length ? phrases : timelineCues;
  }

  function clearTranscript() {
    captionSegments = [];
    overlayLayoutKey = '';
    cues = [];
    cueElements = [];
    activeCueIndex = -1;
    sentenceLoopIndex = -1;
    cueHighlightLock = null;
    overlayChunks = [];
    activeChunkIndex = -1;
    const list = byId('yt-study-list');
    if (list) list.replaceChildren();
    updateOverlayContent(-1);
  }

  function renderTranscript() {
    const list = byId('yt-study-list');
    if (!list) return;
    const fragment = document.createDocumentFragment();
    cueElements = cues.map((cue, index) => {
      const row = document.createElement('div');
      row.className = 'yt-study-cue';
      row.dataset.index = String(index);
      row.tabIndex = 0;
      row.setAttribute('role', 'group');
      row.setAttribute('aria-label', `${formatClock(cue.start)} ${cue.text}`);

      const time = document.createElement('button');
      time.type = 'button';
      time.title = '播放这一段';
      time.setAttribute('aria-label', `播放 ${formatClock(cue.start)} 这一段`);
      time.className = 'yt-study-cue-time';
      time.textContent = formatClock(cue.start);
      const text = document.createElement('span');
      text.className = 'yt-study-cue-text';
      appendCueWords(text, cue.text);
      const repeat = document.createElement('button');
      repeat.className = 'yt-study-repeat';
      repeat.type = 'button';
      repeat.title = '循环播放这一段';
      repeat.setAttribute('aria-label', '循环播放这一段');
      repeat.textContent = '↻';
      const save = document.createElement('button');
      save.className = 'yt-study-save';
      save.type = 'button';
      save.title = '收藏这一段';
      save.setAttribute('aria-label', '收藏这一段');
      save.textContent = '☆';

      row.append(time, text, repeat, save);
      fragment.appendChild(row);
      return row;
    });
    list.replaceChildren(fragment);
    dropStaleWordTooltip();
  }

  function appendCueWords(container, text) {
    const parts = String(text || '').split(/(\s+)/);
    for (const part of parts) {
      if (!part) continue;
      const span = document.createElement('span');
      if (/[A-Za-z]/.test(part)) {
        span.className = 'yt-study-word';
        span.dataset.word = wordLookupKey(part);
      } else {
        span.className = 'yt-study-punct';
      }
      span.textContent = part;
      container.appendChild(span);
    }
  }

  function wordLookupKey(token) {
    return String(token || '')
      .replace(/^[^A-Za-z]+/, '')
      .replace(/[^A-Za-z]+$/, '')
      .replace(/[’‘]/g, "'")
      .toLowerCase();
  }

  function setDownloadEnabled(enabled) {
    const button = byId('yt-study-download');
    if (button) button.disabled = !enabled;
  }

  function downloadCurrentTrack() {
    const track = tracks[selectedTrackIndex];
    if (!track || !cues.length) return;
    const formatSelect = byId('yt-study-format');
    const format = formatSelect ? formatSelect.value : 'srt';
    let content;
    let mimeType;
    if (format === 'vtt') {
      content = `WEBVTT\n\n${cues.map((cue) => `${formatTimestamp(cue.start, '.')} --> ${formatTimestamp(cue.end, '.')}\n${cue.text}`).join('\n\n')}\n`;
      mimeType = 'text/vtt;charset=utf-8';
    } else if (format === 'txt') {
      content = `${cues.map((cue) => cue.text).join('\n')}\n`;
      mimeType = 'text/plain;charset=utf-8';
    } else {
      content = `${cues.map((cue, index) => `${index + 1}\n${formatTimestamp(cue.start, ',')} --> ${formatTimestamp(cue.end, ',')}\n${cue.text}`).join('\n\n')}\n`;
      mimeType = 'application/x-subrip;charset=utf-8';
    }

    const safeTitle = (videoTitle || currentVideoId || 'youtube-subtitles')
      .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 120) || 'youtube-subtitles';
    const language = track.languageCode || 'subtitles';
    downloadTextFile(content, `${safeTitle}.${language}.${format}`, mimeType);
  }

  function resetForVideo(nextVideoId) {
    aiClient.cancel();
    currentVideoId = nextVideoId;
    resetRangeLoop();
    loadRangeLoop(nextVideoId);
    videoTitle = '';
    tracks = [];
    captionCache.clear();
    selectedTrackIndex = -1;
    trackLoadToken++;
    stopSentenceLoop();
    resetAutoPauseTracker();
    closeDictPopup();
    clearTranscript();
    const select = byId('yt-study-track');
    if (select) {
      select.disabled = true;
      select.replaceChildren(new Option('正在读取…', '-1'));
    }
    setDownloadEnabled(false);
    if (panelOpen) requestTracks(true);
  }

  function inject() {
    const nextVideo = document.querySelector('video.html5-main-video');
    if (!nextVideo) return;
    bindVideo(nextVideo);
    ensureToggle();
    ensureRangeLoopBar();
    ensureRangeLoopMarkers();
    ensurePanel();
    observePlayerSize();
    updateOverlayUI();
    const nextVideoId = getVideoId();
    if (nextVideoId !== currentVideoId) resetForVideo(nextVideoId);
  }

  function scheduleInject(delay) {
    if (injectTimer) return;
    injectTimer = setTimeout(() => {
      injectTimer = 0;
      inject();
    }, delay);
  }

  document.addEventListener('mousemove', (event) => {
    const duration = knownVideoDuration();
    if (!rangeLoopDragPoint || !video || !duration) return;
    const progressBar = document.querySelector('.ytp-progress-bar');
    if (!progressBar) return;
    const bounds = progressBar.getBoundingClientRect();
    if (!bounds.width) return;
    const ratio = clamp((event.clientX - bounds.left) / bounds.width, 0.005, 0.995);
    const point = ratio * duration;
    if (rangeLoopDragPoint === 'A' && rangeLoopB !== null && point >= rangeLoopB) return;
    if (rangeLoopDragPoint === 'B' && rangeLoopA !== null && point <= rangeLoopA) return;
    if (rangeLoopDragPoint === 'A') rangeLoopA = point;
    else rangeLoopB = point;
    if (rangeLoopA !== null && rangeLoopB !== null && rangeLoopB > rangeLoopA && !rangeLooping) {
      stopSentenceLoop();
      rangeLooping = true;
      startRangeLoopTick();
    }
    refreshRangeLoopUI();
  });

  document.addEventListener('mouseup', () => {
    if (!rangeLoopDragPoint) return;
    const marker = byId(`ytl-marker-${rangeLoopDragPoint}`);
    if (marker) marker.classList.remove('dragging');
    if (rangeLoopDragWasPlaying && video) video.play().catch(() => {});
    rangeLoopDragPoint = null;
    rangeLoopDragWasPlaying = false;
    refreshRangeLoopUI();
    saveRangeLoop();
  });

  window.addEventListener('keydown', (event) => {
    if (event.defaultPrevented || event.repeat || !event.shiftKey
        || event.ctrlKey || event.metaKey || event.altKey) return;
    const target = event.target;
    if (target && (target.tagName === 'INPUT'
        || target.tagName === 'TEXTAREA'
        || target.tagName === 'SELECT'
        || target.isContentEditable)) return;
    if (!video) return;
    let handled = true;
    switch (event.key.toLowerCase()) {
      case 'a': setRangeLoopPoint('A'); break;
      case 'b': setRangeLoopPoint('B'); break;
      case 'l': toggleRangeLoop(); break;
      case 'x': clearRangeLoop(); break;
      case 'c': copyCurrentSentence(); break;
      default: handled = false;
    }
    if (handled) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }, true);

  window.addEventListener('keydown', (event) => {
    if (event.defaultPrevented || event.repeat) return;
    if (event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === 'Escape') {
      if (closeDictPopup()) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
      return;
    }
    if (!panelOpen || vocabOpen || settingsOpen) return;
    const target = event.target;
    if (target && (target.tagName === 'INPUT'
        || target.tagName === 'TEXTAREA'
        || target.tagName === 'SELECT'
        || target.isContentEditable)) return;
    if (!video) return;
    let handled = true;
    switch (event.key.toLowerCase()) {
      case 'a': stepSentence(-1); break;
      case 's': stepSentence(0); break;
      case 'd': stepSentence(1); break;
      case 'w': togglePlayPause(); break;
      case 'q': setAutoPause(!settings.autoPause); break;
      case 'e': setHideMode(!settings.hideMode); break;
      case 'r': saveCurrentSentence(); break;
      default: handled = false;
    }
    if (handled) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }, true);

  document.addEventListener(RESPONSE_EVENT, handleTrackResponse);
  document.addEventListener(CAPTION_RESPONSE_EVENT, handleCaptionResponse);
  document.addEventListener('yt-navigate-finish', () => scheduleInject(0));

  loadSettings().then(() => {
    if (document.fonts && document.fonts.addEventListener) {
      document.fonts.addEventListener('loadingdone', () => { overlayLayoutKey = ''; updateOverlayFont(); });
    }
    loadVocab();
    loadDictCache();
    loadAiCaches();
    loadLocalDict();
    scheduleInject(100);
    new MutationObserver(() => scheduleInject(300)).observe(document.body, {
      childList: true,
      subtree: true
    });
  });
})();
