'use strict';
// 临时边界用例验证：真实 json3 形状 → parseJsonCaptions → groupWordsIntoPhrases
global.chrome = { storage: { local: { get: (k, cb) => cb({}), set() {}, remove() {} } } };
global.DOMParser = class {
  parseFromString() { return { querySelector: () => null, querySelectorAll: () => [] }; }
};
const fs = require('fs');
const src = fs.readFileSync('content.js', 'utf8');
const grab = (name) => {
  const m = src.match(new RegExp('function ' + name + '[\\s\\S]*?\\n  }'));
  if (!m) throw new Error('not found: ' + name);
  return eval('(' + m[0] + ')');
};
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const cleanCaptionText = grab('cleanCaptionText');
const captionJoiner = grab('captionJoiner');
const parseJsonCaptions = grab('parseJsonCaptions');
const groupWordsIntoPhrases = grab('groupWordsIntoPhrases');
const normalizeCues = grab('normalizeCues');

let failed = 0;
const check = (name, cond) => { console.log((cond ? 'PASS' : 'FAIL'), name); if (!cond) failed++; };

// case1: \n 分段 + >> 说话人标记 + 跨事件停顿（dDurationMs 存在的正常情形）
const case1 = { events: [
  { tStartMs: 1000, dDurationMs: 800, segs: [{ utf8: '\n' }, { utf8: '>>', tOffsetMs: 0 }, { utf8: 'Hi', tOffsetMs: 300 }, { utf8: 'there', tOffsetMs: 700 }] },
  { tStartMs: 4000, dDurationMs: 1500, segs: [{ utf8: 'friend', tOffsetMs: 0 }, { utf8: 'how', tOffsetMs: 500 }, { utf8: 'are', tOffsetMs: 900 }, { utf8: 'you', tOffsetMs: 1200 }] }
]};
const r1 = parseJsonCaptions(case1).segments;
check('case1 词级cue数量正确(7,\\n被跳过)', r1.length === 7);
check('case1 零时长词被兜底(>=0.15s)', r1.every((c) => c.end - c.start >= 0.149));
const p1 = groupWordsIntoPhrases(r1);
check('case1 停顿>0.6s 断短语(2条)', p1.length === 2);
check('case1 >>保留在短语内', p1[0].text === '>> Hi there');
check('case1 短语2完整', p1[1].text === 'friend how are you');

// case2: 缩写不提前断句
const r2 = parseJsonCaptions({ events: [
  { tStartMs: 0, dDurationMs: 2000, segs: [{ utf8: 'Mr.', tOffsetMs: 0 }, { utf8: 'Smith', tOffsetMs: 400 }, { utf8: 'is', tOffsetMs: 800 }, { utf8: 'here.', tOffsetMs: 1200 }] }
]});
const p2 = groupWordsIntoPhrases(r2.segments);
check('case2 Mr. 不单独断句', p2.length === 1 && p2[0].text === 'Mr. Smith is here.');

// case3: 撇号分词 "don" + "'t" 正确拼接
const r3 = parseJsonCaptions({ events: [
  { tStartMs: 0, dDurationMs: 2000, segs: [{ utf8: 'I', tOffsetMs: 0 }, { utf8: 'don', tOffsetMs: 300 }, { utf8: "'t", tOffsetMs: 600 }, { utf8: 'know.', tOffsetMs: 900 }] }
]});
const p3 = groupWordsIntoPhrases(r3.segments);
check('case3 缩写拼接 don\'t', p3.length === 1 && p3[0].text === "I don't know.");

// case4: 满12词切断
const words = Array.from({ length: 20 }, (_, i) => 'w' + i);
const r4 = parseJsonCaptions({ events: [ { tStartMs: 0, dDurationMs: 10000, segs: words.map((w, i) => ({ utf8: w, tOffsetMs: i * 500 })) } ]});
const p4 = groupWordsIntoPhrases(r4.segments);
check('case4 20词切成2条(12+8)', p4.length === 2 && p4[0].text.split(' ').length === 12);

console.log(failed ? `\n${failed} FAILED` : '\nALL EDGE CASES PASS');
process.exitCode = failed ? 1 : 0;
