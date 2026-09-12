from pathlib import Path
p=Path(__file__).resolve().parent.parent
r=p/'.test'/'.browser-review';r.mkdir(parents=True,exist_ok=True)
s=(p/'content.js').read_text(encoding='utf-8')
s=s.replace('  loadSettings().then(() => {', '''  window.review = {
    prepare(text, width) {
      const player = document.querySelector('#movie_player');
      player.style.width = `${width}px`;
      video = player.querySelector('video');
      cues = [{ start: 0, end: 20, text }]; captionSegments = [];
      settings.overlay = true; panelOpen = true; activeCueIndex = 0;
      ensurePlayerOverlay(); updateOverlayFont(); buildOverlayChunks();
      renderTranscript();
      return overlayChunks.map((chunk, index) => {
        activeChunkIndex = index; renderOverlayChunk(index);
        const el = playerOverlay.text, style = getComputedStyle(el);
        const natural = el.cloneNode(true);
        natural.style.width = `${el.getBoundingClientRect().width}px`;
        natural.style.boxSizing = 'border-box'; natural.style.display = 'block';
        natural.style.webkitLineClamp = 'unset'; natural.style.position = 'absolute';
        player.appendChild(natural);
        const height = natural.getBoundingClientRect().height; natural.remove();
        const max = parseFloat(style.lineHeight) * 2 + parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
        if (height > max + 1 || el.scrollWidth > el.clientWidth + 1) throw Error(`Overflow ${width}: ${chunk.text}`);
        if (parseFloat(style.fontSize) !== overlayFontSize) throw Error('Font shrank');
        return chunk;
      });
    }
  };
  loadSettings().then(() => {''')
(r/'runtime.js').write_text(s,encoding='utf-8')
(r/'index.html').write_text('''<!doctype html><meta charset="utf-8"><title>Study v1.0.5 — local UI acceptance</title>
<link rel="stylesheet" href="../../styles.css">
<style>body{background:#111;color:#eee;font:16px Arial;margin:24px}main{display:flex;gap:20px;align-items:start}#movie_player{position:relative;background:linear-gradient(140deg,#283e42,#17222e);width:960px;height:540px;flex:none}#secondary-inner{width:400px;flex:none}video{width:100%;height:100%}.ytp-left-controls{position:absolute;bottom:12px;left:15px}#results{white-space:pre-wrap;color:#91dfb6;padding:12px 0}.ytp-progress-bar{width:90%;height:3px;position:absolute;bottom:50px}</style>
<h2>本地验收 · 使用正式代码与样式，字幕为测试数据</h2><div id="results">等待测试</div>
<main><div id="movie_player"><video class="html5-main-video"></video><div class="ytp-left-controls"></div><div class="ytp-progress-bar"></div></div><div id="secondary-inner"></div></main>
<script>window.chrome={storage:{local:{get:(k,cb)=>cb({youtubeStudySettings:{panelOpen:true}}),set:()=>{},remove:()=>{}}}};
document.addEventListener('youtube-study-request-tracks',()=>document.dispatchEvent(new CustomEvent('youtube-study-tracks-response',{detail:JSON.stringify({videoId:'review',title:'UI review',tracks:[]})})));
window.fetch=async()=>{throw Error('Offline fixture: no external requests')};
</script><script src="../../study-core.js"></script><script src="runtime.js"></script>
<script>
setTimeout(()=>{try{
const original='Um and so along the same veins of around ambitious as a term, I am curious when you figured out why a founder needs to be not just unusually talented in technical ability or something else, but they actually have to be really ambitious as well.';
const texts=[original,Array.from({length:80},(_,i)=>'word'+i).join(' '),'超长中文测试'.repeat(30),'W'.repeat(180)];
let cases=0,pages=0;for(const width of [360,640,960,1280])for(const text of texts){const parts=review.prepare(text,width);if(parts.map(p=>p.text).join('').replace(/\\s/g,'')!==text.replace(/\\s/g,''))throw Error('Lost content');cases++;pages+=parts.length;}
review.prepare(original,960);document.querySelector('#yt-study-status').hidden=true;
document.querySelector('#results').textContent=`PASS: ${cases} real-layout cases, ${pages} pages. Every page <=2 lines; full text retained; font unchanged. Width changed at constant player height.`;
}catch(e){document.querySelector('#results').textContent='FAIL: '+e.stack}},600);
</script>''',encoding='utf-8')
