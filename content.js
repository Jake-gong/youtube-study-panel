(function () {
  'use strict';

  const REQUEST_EVENT = 'youtube-study-request-tracks';
  const RESPONSE_EVENT = 'youtube-study-tracks-response';
  const CAPTION_REQUEST_EVENT = 'youtube-study-caption-request';
  const CAPTION_RESPONSE_EVENT = 'youtube-study-caption-response';
  const SETTINGS_KEY = 'youtubeStudySettings';
  const RATE_MIN = 0.25;
  const RATE_MAX = 2;
  const RATE_STEP = 0.05;
  const SEEK_PREROLL_SECONDS = 0.08;
  const CUE_HIGHLIGHT_LOCK_MS = 1200;
  const DEFAULT_SETTINGS = {
    panelOpen: false,
    rememberRate: true,
    rate: 1,
    preferredTrack: ''
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
  const captionCache = new Map();
  const pendingCaptionRequests = new Map();

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
        <label class="yt-study-remember"><input id="yt-study-remember" type="checkbox">记住速度</label>
        <div class="yt-study-download">
          <select id="yt-study-format" aria-label="字幕下载格式">
            <option value="srt">SRT</option>
            <option value="vtt">VTT</option>
            <option value="txt">TXT</option>
          </select>
          <button id="yt-study-download" type="button">下载</button>
        </div>
      </div>
      <div id="yt-study-loop-status" class="yt-study-loop-status" hidden>
        <span>正在循环当前句</span><button id="yt-study-stop-loop" type="button">停止</button>
      </div>
      <div id="yt-study-status" class="yt-study-status" role="status">打开面板后读取字幕</div>
      <div id="yt-study-list" class="yt-study-list" tabindex="0" aria-label="视频字幕"></div>
      <footer class="yt-study-footer">单击播放 · 双击循环</footer>
    `;

    byIdAfter(panel, 'yt-study-close').addEventListener('click', () => setPanelOpen(false));
    byIdAfter(panel, 'yt-study-follow').addEventListener('click', enableFollowing);
    byIdAfter(panel, 'yt-study-slower').addEventListener('click', () => stepRate(-RATE_STEP));
    byIdAfter(panel, 'yt-study-faster').addEventListener('click', () => stepRate(RATE_STEP));
    byIdAfter(panel, 'yt-study-rate').addEventListener('click', () => setPlaybackRate(1));
    byIdAfter(panel, 'yt-study-stop-loop').addEventListener('click', stopSentenceLoop);
    byIdAfter(panel, 'yt-study-download').addEventListener('click', downloadCurrentTrack);
    byIdAfter(panel, 'yt-study-track').addEventListener('change', (event) => {
      const index = Number(event.target.value);
      if (!Number.isInteger(index) || !tracks[index]) return;
      selectedTrackIndex = index;
      settings.preferredTrack = trackKey(tracks[index]);
      saveSettings();
      loadTrack(index);
    });
    byIdAfter(panel, 'yt-study-remember').addEventListener('change', (event) => {
      settings.rememberRate = event.target.checked;
      if (settings.rememberRate && video) settings.rate = normalizeRate(video.playbackRate);
      saveSettings();
    });

    const list = byIdAfter(panel, 'yt-study-list');
    list.addEventListener('wheel', disableFollowing, { passive: true });
    list.addEventListener('touchstart', disableFollowing, { passive: true });
    list.addEventListener('click', handleCueClick);
    list.addEventListener('dblclick', handleCueDoubleClick);
    list.addEventListener('keydown', handleCueKeydown);
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
    if (panelOpen) requestTracks(true);
    else clearTimeout(trackRequestTimer);
  }

  function syncPanelHeight() {
    const panel = byId('yt-study-panel');
    const player = document.querySelector('#movie_player');
    if (!panel || !player) return;
    const playerHeight = Math.round(player.getBoundingClientRect().height);
    if (playerHeight > 240) panel.style.setProperty('--yt-study-player-height', `${playerHeight}px`);
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
    if (remember) remember.checked = settings.rememberRate;
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
    if (videoAbortController) videoAbortController.abort();
    videoAbortController = new AbortController();
    video = nextVideo;
    const options = { signal: videoAbortController.signal };
    video.addEventListener('timeupdate', handleTimeUpdate, options);
    video.addEventListener('ratechange', handleRateChange, options);
    video.addEventListener('loadedmetadata', applyRememberedRate, options);
    applyRememberedRate();
    updateRateUI();
  }

  function handleRateChange() {
    updateRateUI();
    if (!settings.rememberRate || !video) return;
    settings.rate = normalizeRate(video.playbackRate);
    saveSettings();
  }

  function handleTimeUpdate() {
    if (!video) return;
    if (sentenceLoopIndex >= 0 && cues[sentenceLoopIndex]) {
      const cue = cues[sentenceLoopIndex];
      if (video.currentTime >= cue.end - 0.03) {
        video.currentTime = cue.start;
        video.play().catch(() => {});
      }
    }
    const lockedIndex = getCueHighlightLockIndex();
    updateActiveCue(lockedIndex >= 0 ? lockedIndex : findCueIndex(video.currentTime));
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
  }

  function scrollCueIntoView(element) {
    const list = byId('yt-study-list');
    if (!list) return;
    const target = element.offsetTop - (list.clientHeight / 2) + (element.offsetHeight / 2);
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
    playCue(match.index, false);
  }

  function handleCueDoubleClick(event) {
    const match = getCueRow(event.target);
    if (!match || event.target.closest('.yt-study-repeat')) return;
    event.preventDefault();
    toggleSentenceLoop(match.index);
  }

  function handleCueKeydown(event) {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const match = getCueRow(event.target);
    if (!match) return;
    event.preventDefault();
    if (event.shiftKey) toggleSentenceLoop(match.index);
    else playCue(match.index, false);
  }

  function playCue(index, keepLoop) {
    if (!video || !cues[index]) return;
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
    if (preferredIndex < 0) preferredIndex = tracks.findIndex((track) => /^en(?:-|$)/i.test(track.languageCode));
    if (preferredIndex < 0) preferredIndex = 0;
    selectedTrackIndex = preferredIndex;
    select.value = String(preferredIndex);
    settings.preferredTrack = trackKey(tracks[preferredIndex]);
    saveSettings();
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
      const loadedCues = captionCache.has(track.baseUrl)
        ? captionCache.get(track.baseUrl)
        : await fetchCaptionCues(track);
      if (token !== trackLoadToken) return;
      captionCache.set(track.baseUrl, loadedCues);
      cues = loadedCues;
      renderTranscript();
      setDownloadEnabled(cues.length > 0);
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
        if (parsed.length) return parsed;
        errors.push(`${attempt.label} 正文为空或无法识别`);
      } catch (error) {
        errors.push(error instanceof Error ? error.message : `${attempt.label} 请求失败`);
      }
    }
    throw new Error(errors.length ? errors.join('；') : '字幕读取失败');
  }

  function parseCaptionBody(body) {
    const text = String(body || '').replace(/^\uFEFF/, '').trim();
    if (!text) return [];
    if (text[0] === '{' || text[0] === '[') {
      try {
        const parsed = parseJsonCaptions(JSON.parse(text));
        if (parsed.length) return parsed;
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
    return [];
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
    return groupCuesIntoSentences(timelineCues);
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

  function segmentCaptionText(text) {
    const segments = [];
    let start = 0;
    for (let index = 0; index < text.length; index++) {
      if (!/[.!?。！？]/.test(text[index])) continue;
      if (!isSentenceBoundary(text, index)) continue;
      let end = index + 1;
      while (end < text.length && /[.!?。！？]/.test(text[end])) end++;
      while (end < text.length && /["'”’\)\]\}]/.test(text[end])) end++;
      segments.push({ text: text.slice(start, end), index: start });
      start = end;
      index = end - 1;
    }
    if (start < text.length) segments.push({ text: text.slice(start), index: start });
    return segments;
  }

  function isSentenceBoundary(text, index) {
    if (text[index] !== '.') return true;
    const previousCharacter = text[index - 1] || '';
    const nextCharacter = text[index + 1] || '';
    if (/\d/.test(previousCharacter) && /\d/.test(nextCharacter)) return false;
    if (nextCharacter === '.') return false;

    const before = text.slice(0, index);
    const wordMatch = /([A-Za-z]+)$/.exec(before);
    const word = wordMatch ? wordMatch[1].toLowerCase() : '';
    const titleAbbreviations = new Set(['mr', 'mrs', 'ms', 'dr', 'prof', 'sr', 'jr', 'st']);
    if (titleAbbreviations.has(word)) return false;

    const nextNonWhitespace = /\S/.exec(text.slice(index + 1));
    const nextTokenStart = nextNonWhitespace ? nextNonWhitespace[0] : '';
    const commonAbbreviations = new Set(['vs', 'fig', 'no', 'approx', 'dept', 'inc', 'ltd']);
    if (commonAbbreviations.has(word) && /^[a-z]/.test(nextTokenStart)) return false;
    if (word.length === 1 && before.slice(0, -1).endsWith('.')) return false;
    return true;
  }

  function timeAtTextPosition(position, spans) {
    if (!spans.length) return 0;
    for (let index = 0; index < spans.length; index++) {
      const span = spans[index];
      if (position < span.textStart) return span.start;
      if (position <= span.textEnd) {
        const length = Math.max(1, span.textEnd - span.textStart);
        const ratio = clamp((position - span.textStart) / length, 0, 1);
        return span.start + (span.end - span.start) * ratio;
      }
    }
    return spans[spans.length - 1].end;
  }

  function groupCuesIntoSentences(timelineCues) {
    if (!timelineCues.length) return [];
    let fullText = '';
    const spans = [];

    for (const cue of timelineCues) {
      const separator = captionJoiner(fullText, cue.text);
      fullText += separator;
      const textStart = fullText.length;
      fullText += cue.text;
      spans.push({
        textStart,
        textEnd: fullText.length,
        start: cue.start,
        end: cue.end
      });
    }

    const sentences = [];
    for (const segment of segmentCaptionText(fullText)) {
      const leadingWhitespace = segment.text.search(/\S/);
      if (leadingWhitespace < 0) continue;
      const trailingWhitespace = segment.text.length - segment.text.trimEnd().length;
      const textStart = segment.index + leadingWhitespace;
      const textEnd = segment.index + segment.text.length - trailingWhitespace;
      const sentenceText = cleanCaptionText(fullText.slice(textStart, textEnd));
      if (!sentenceText) continue;
      const start = timeAtTextPosition(textStart, spans);
      const end = timeAtTextPosition(textEnd, spans);
      sentences.push({
        start,
        end: Math.max(start + 0.15, end),
        text: sentenceText
      });
    }

    return sentences.length ? sentences : timelineCues;
  }

  function clearTranscript() {
    cues = [];
    cueElements = [];
    activeCueIndex = -1;
    sentenceLoopIndex = -1;
    cueHighlightLock = null;
    const list = byId('yt-study-list');
    if (list) list.replaceChildren();
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
      row.setAttribute('role', 'button');
      row.setAttribute('aria-label', `${formatClock(cue.start)} ${cue.text}`);

      const time = document.createElement('span');
      time.className = 'yt-study-cue-time';
      time.textContent = formatClock(cue.start);
      const text = document.createElement('span');
      text.className = 'yt-study-cue-text';
      text.textContent = cue.text;
      const repeat = document.createElement('button');
      repeat.className = 'yt-study-repeat';
      repeat.type = 'button';
      repeat.title = '循环播放这句话';
      repeat.setAttribute('aria-label', '循环播放这句话');
      repeat.textContent = '↻';

      row.append(time, text, repeat);
      fragment.appendChild(row);
      return row;
    });
    list.replaceChildren(fragment);
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
    const blobUrl = URL.createObjectURL(new Blob([content], { type: mimeType }));
    const link = document.createElement('a');
    link.href = blobUrl;
    link.download = `${safeTitle}.${language}.${format}`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
  }

  function resetForVideo(nextVideoId) {
    currentVideoId = nextVideoId;
    videoTitle = '';
    tracks = [];
    captionCache.clear();
    selectedTrackIndex = -1;
    trackLoadToken++;
    stopSentenceLoop();
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
    ensurePanel();
    observePlayerSize();
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

  document.addEventListener(RESPONSE_EVENT, handleTrackResponse);
  document.addEventListener(CAPTION_RESPONSE_EVENT, handleCaptionResponse);
  document.addEventListener('yt-navigate-finish', () => scheduleInject(0));

  loadSettings().then(() => {
    scheduleInject(100);
    new MutationObserver(() => scheduleInject(300)).observe(document.body, {
      childList: true,
      subtree: true
    });
  });
})();
