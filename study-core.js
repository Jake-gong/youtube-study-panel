(function (root) {
  'use strict';
  // Pure pagination: preserve every character, with optional native token timings.
  function paginateCue(cue, fits, segments = []) {
    const tokens = String(cue.text || '').match(/\S+\s*/gu) || [];
    const units = [];
    for (const token of tokens) {
      if (fits(token.trim())) units.push(token);
      else units.push(...Array.from(token));
    }
    const pages = [];
    let part = '';
    for (const unit of units) {
      if (part && !fits((part + unit).trim())) {
        pages.push(part);
        part = '';
      }
      part += unit;
    }
    if (part) pages.push(part);
    const full = units.join('');
    const anchors = [];
    let offset = 0;
    for (const segment of segments) {
      if (segment.start < cue.start || segment.start >= cue.end) continue;
      const text = String(segment.text || '').trim();
      const at = text ? full.indexOf(text, offset) : -1;
      if (at < 0) continue;
      anchors.push({ offset: at, time: segment.start });
      offset = at + text.length;
    }
    offset = 0;
    const starts = pages.map((page, index) => {
      const boundary = offset + (page.length - page.trimStart().length);
      offset += page.length;
      const anchor = anchors.find(item => item.offset === boundary);
      return index === 0 ? cue.start : anchor ? anchor.time
        : cue.start + (cue.end - cue.start) * boundary / Math.max(1, full.length);
    });
    // Native anchors are used only when they keep the complete timeline ordered.
    if (starts.some((time, index) => index && time <= starts[index - 1])) {
      offset = 0;
      pages.forEach((page, index) => {
        starts[index] = cue.start + (cue.end - cue.start) * offset / full.length;
        offset += page.length;
      });
    }
    return pages.map((text, index) => ({ text: text.trim(), start: starts[index],
      end: index + 1 < pages.length ? starts[index + 1] : cue.end }));
  }

  function createAiClient(fetchImpl, timeoutMs = 10000) {
    const pending = new Map();
    function cancel(scope) {
      for (const [key, item] of pending) {
        if (!scope || item.scope === scope) {
          item.controller.abort();
          pending.delete(key);
        }
      }
    }
    function request(config, messages, maxTokens, scope = 'lookup') {
      const url = new URL(config.baseUrl);
      if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
        return Promise.reject(new Error('接口地址必须为不含凭据、查询参数的 HTTPS 地址'));
      }
      const key = JSON.stringify([scope, config.baseUrl, config.model, config.apiKey, messages, maxTokens]);
      if (pending.has(key)) return pending.get(key).promise;
      const controller = new AbortController();
      const item = { scope, controller };
      let timedOut = false;
      const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
      item.promise = (async () => {
        try {
          const response = await fetchImpl(`${config.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
            method: 'POST', signal: controller.signal,
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
            body: JSON.stringify({ model: config.model, messages, temperature: 0.3, max_tokens: maxTokens })
          });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const payload = await response.json();
          const text = payload?.choices?.[0]?.message?.content;
          if (typeof text !== 'string' || !text.trim()) throw new Error('AI 返回为空');
          return text.trim();
        } catch (error) {
          if (timedOut) throw new Error('AI 请求超时，请重试');
          throw error;
        } finally {
          clearTimeout(timer);
          if (pending.get(key) === item) pending.delete(key);
        }
      })();
      pending.set(key, item);
      return item.promise;
    }
    return { request, cancel };
  }
  const api = { paginateCue, createAiClient };
  root.YouTubeStudyCore = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(globalThis);
