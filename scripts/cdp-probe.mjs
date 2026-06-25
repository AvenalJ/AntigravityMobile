/**
 * One-shot CDP DOM probe for Antigravity 2.0.
 * Connects to every execution context, runs an injected expression,
 * and prints results so we can map the (hashed) chat DOM.
 *
 * Usage: node scripts/cdp-probe.mjs [port] [probeName]
 *   probeName: find-chat | dump-tree | sample-messages  (default: find-chat)
 */
import WebSocket from 'ws';

const PORT = process.argv[2] || '9333';
const PROBE = process.argv[3] || 'find-chat';

async function listTargets(port) {
  const res = await fetch(`http://127.0.0.1:${port}/json/list`);
  const list = await res.json();
  return list.filter(t => t.type === 'page');
}

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let idc = 1;
    const contexts = [];
    const call = (method, params) => new Promise((res, rej) => {
      const id = idc++;
      const h = (m) => {
        const d = JSON.parse(m.toString());
        if (d.id === id) { ws.off('message', h); d.error ? rej(new Error(d.error.message)) : res(d.result); }
      };
      ws.on('message', h);
      ws.send(JSON.stringify({ id, method, params }));
    });
    ws.on('message', (m) => {
      try {
        const d = JSON.parse(m.toString());
        if (d.method === 'Runtime.executionContextCreated') contexts.push(d.params.context);
      } catch {}
    });
    ws.on('open', async () => {
      await call('Runtime.enable', {});
      await new Promise(r => setTimeout(r, 600));
      resolve({ ws, call, contexts });
    });
    ws.on('error', reject);
    setTimeout(() => reject(new Error('timeout')), 6000);
  });
}

// ---- Probe expressions -----------------------------------------------------
const PROBES = {
  // Locate likely chat containers without relying on #cascade
  'find-chat': `(() => {
    const out = {};
    out.cascadeById = !!document.getElementById('cascade');
    out.conversationById = !!document.getElementById('conversation');
    out.url = location.href.slice(0,80);
    out.bodyClass = (document.body.className||'').slice(0,120);
    // Heuristic: find the scroll container holding many repeated message-like rows
    const cands = [];
    document.querySelectorAll('div').forEach(el => {
      const kids = el.children.length;
      if (kids < 3) return;
      const txt = (el.innerText||'').trim();
      if (txt.length < 40) return;
      // scrollable?
      const cs = getComputedStyle(el);
      const scrollable = /(auto|scroll)/.test(cs.overflowY);
      const score = (scrollable?5:0) + Math.min(kids,20);
      cands.push({
        score, kids, scrollable,
        id: el.id || null,
        cls: (el.className||'').toString().slice(0,80),
        dataAttrs: [...el.attributes].filter(a=>a.name.startsWith('data-')).map(a=>a.name).slice(0,6),
        textHead: txt.slice(0,60).replace(/\\s+/g,' ')
      });
    });
    cands.sort((a,b)=>b.score-a.score);
    out.topContainers = cands.slice(0,12);
    // any element with id containing chat/cascade/conversation/agent
    out.idMatches = [...document.querySelectorAll('[id]')]
      .map(e=>e.id).filter(id=>/cascade|chat|convo|conversation|agent|message|cascade/i.test(id)).slice(0,20);
    return out;
  })()`,

  // Enumerate stable ids (antigravity.* and chat-related)
  'ids': `(() => {
    const ids = [...document.querySelectorAll('[id]')].map(e=>e.id)
      .filter(id=>/antigravity|agent|cascade|conversation|trajectory|message|chat/i.test(id));
    const agIds = [...document.querySelectorAll('[id^="antigravity"]')]
      .map(e=>({id:e.id, tag:e.tagName.toLowerCase(), cls:(e.className||'').toString().slice(0,50)}));
    return { ids:[...new Set(ids)].slice(0,50), agIds:agIds.slice(0,50) };
  })()`,

  // Anchor on the input box, walk up to find the message scroll container
  'anchor': `(() => {
    const input = document.getElementById('antigravity.agentSidePanelInputBox');
    if (!input) return { error: 'no input box id' };
    // Walk up, recording each ancestor + its previous siblings (where messages live)
    const chain = [];
    let node = input;
    for (let d=0; d<8 && node; d++) {
      const cs = getComputedStyle(node);
      chain.push({
        depth: d,
        tag: node.tagName.toLowerCase(),
        id: node.id||undefined,
        cls: (node.className||'').toString().slice(0,90),
        overflowY: cs.overflowY,
        scrollH: node.scrollHeight, clientH: node.clientHeight,
        prevSibs: [...(node.parentElement?.children||[])]
          .filter(c=>c!==node)
          .map(c=>({tag:c.tagName.toLowerCase(), cls:(c.className||'').toString().slice(0,70),
                    kids:c.children.length, txt:(c.innerText||'').trim().slice(0,50).replace(/\\s+/g,' ')}))
          .slice(0,6)
      });
      node = node.parentElement;
    }
    return { chain };
  })()`,

  // Find the scroll area via the input-box anchor, dump message-turn children
  'messages': `(() => {
    const input = document.getElementById('antigravity.agentSidePanelInputBox');
    if (!input) return { error: 'no input box' };
    // Walk up to the overflow-y-auto scroll container
    let scroll = input;
    while (scroll && getComputedStyle(scroll).overflowY !== 'auto') scroll = scroll.parentElement;
    if (!scroll) return { error: 'no scroll container found' };
    // The message list: descendant with the most direct children carrying text
    let best=null, bestScore=-1;
    scroll.querySelectorAll('div').forEach(el=>{
      const kids=[...el.children];
      if (kids.length < 2) return;
      const withText = kids.filter(k=>(k.innerText||'').trim().length>10).length;
      if (withText > bestScore) { bestScore=withText; best=el; }
    });
    if (!best) return { error: 'no message list' };
    const desc = (e)=>({
      tag:e.tagName.toLowerCase(),
      cls:(e.className||'').toString().slice(0,110),
      data:[...e.attributes].filter(a=>a.name.startsWith('data-')||a.name==='role'||a.name==='aria-label').map(a=>a.name+'='+a.value.slice(0,30)),
      txt:(e.innerText||'').trim().slice(0,70).replace(/\\s+/g,' ')
    });
    return {
      scrollCls:(scroll.className||'').toString().slice(0,90),
      listCls:(best.className||'').toString().slice(0,90),
      turns: [...best.children].map(t=>({
        ...desc(t),
        children:[...t.children].map(desc).slice(0,10)
      })).slice(0,30)
    };
  })()`,

  // Deep-dump the LAST turn that contains agent activity ("Worked for")
  'turn-deep': `(() => {
    const input = document.getElementById('antigravity.agentSidePanelInputBox');
    let scroll = input;
    while (scroll && getComputedStyle(scroll).overflowY !== 'auto') scroll = scroll.parentElement;
    const list = [...scroll.querySelectorAll('div')].find(el=>/gap-y-3/.test(el.className||''));
    if (!list) return { error:'no list' };
    const turns = [...list.children];
    // pick last turn mentioning "Worked for"
    const turn = [...turns].reverse().find(t=>/Worked for/.test(t.innerText||'')) || turns[turns.length-1];
    function dump(e, depth) {
      if (depth > 8) return { tag:e.tagName.toLowerCase(), trunc:true };
      const o = {
        tag:e.tagName.toLowerCase(),
        cls:(e.className||'').toString().slice(0,80)||undefined,
        data:[...e.attributes].filter(a=>a.name.startsWith('data-')||['role','aria-label','aria-expanded','contenteditable'].includes(a.name)).map(a=>a.name+'='+(a.value||'').slice(0,24)),
      };
      if (o.data.length===0) delete o.data;
      const directText = [...e.childNodes].filter(n=>n.nodeType===3).map(n=>n.textContent.trim()).filter(Boolean).join(' ');
      if (directText) o.t = directText.slice(0,50);
      if (e.tagName==='BUTTON') o.BTN = (e.innerText||'').trim().slice(0,30);
      if (e.tagName==='IMG') o.IMG = (e.getAttribute('src')||'').slice(0,30);
      const codicon = [...e.classList].find(c=>c.startsWith('codicon-'));
      if (codicon) o.icon = codicon;
      if (e.children.length) o.kids = [...e.children].slice(0,12).map(c=>dump(c,depth+1));
      return o;
    }
    return dump(turn, 0);
  })()`,

  // Enumerate all stable hooks (data-testid + aria-label) in the chat scroll area
  'hooks': `(() => {
    const input = document.getElementById('antigravity.agentSidePanelInputBox');
    let scroll = input;
    while (scroll && getComputedStyle(scroll).overflowY !== 'auto') scroll = scroll.parentElement;
    if (!scroll) scroll = document.body;
    const testids = {}, arias = {};
    scroll.querySelectorAll('[data-testid]').forEach(e=>{ const k=e.getAttribute('data-testid'); testids[k]=(testids[k]||0)+1; });
    scroll.querySelectorAll('[aria-label]').forEach(e=>{ const k=e.getAttribute('aria-label'); arias[k]=(arias[k]||0)+1; });
    return { testids, arias };
  })()`,

  // Expand the first collapsed "Worked for" trajectory, then dump its step structure
  'expand-dump': `(() => {
    const input = document.getElementById('antigravity.agentSidePanelInputBox');
    let scroll = input;
    while (scroll && getComputedStyle(scroll).overflowY !== 'auto') scroll = scroll.parentElement;
    if (window.__agExpanded) return { skipped:true };  // guard: only one context acts
    window.__agExpanded = true;
    const btns = [...scroll.querySelectorAll('button')].filter(b=>/^Worked for/.test((b.innerText||'').trim()));
    btns.forEach(b=>b.click());
    return { clicked: btns.length };
  })()`,

  // Survey every agent article: report immediate block children + activity markers
  'survey': `(() => {
    const arts = [...document.querySelectorAll('[role=article][aria-label="Agent response"]')];
    return arts.map((art,i)=>{
      const blocks = [...art.children].map(c=>({
        cls:(c.className||'').toString().slice(0,50),
        kids:c.children.length,
        txt:(c.innerText||'').trim().slice(0,55).replace(/\\s+/g,' ')
      }));
      // hunt for tool/command/file markers anywhere inside
      const markers = [];
      art.querySelectorAll('[data-testid],pre,code,[aria-label]').forEach(e=>{
        const tid=e.getAttribute('data-testid'); if(tid) markers.push('testid:'+tid);
        const al=e.getAttribute('aria-label'); if(al&&al.length<40) markers.push('aria:'+al);
        if(e.tagName==='PRE') markers.push('PRE:'+(e.innerText||'').trim().slice(0,30));
      });
      return { i, len:(art.innerText||'').length, blocks, markers:[...new Set(markers)].slice(0,15) };
    });
  })()`,

  // After expand: dump the agent-response article's trajectory steps deeply
  'steps': `(() => {
    const arts = [...document.querySelectorAll('[role=article][aria-label="Agent response"]')];
    // pick the article with the most text (most likely to have a trajectory)
    const art = arts.sort((a,b)=>(b.innerText||'').length-(a.innerText||'').length)[0];
    if (!art) return { error:'no agent article' };
    function dump(e, depth) {
      if (depth>7) return { tag:e.tagName.toLowerCase(), trunc:true };
      const o = { tag:e.tagName.toLowerCase() };
      const cls=(e.className||'').toString(); if(cls&&typeof cls==='string') o.cls=cls.slice(0,70);
      const data=[...e.attributes].filter(a=>a.name.startsWith('data-')||['role','aria-label'].includes(a.name)).map(a=>a.name+'='+(a.value||'').slice(0,28));
      if(data.length) o.data=data;
      const dt=[...e.childNodes].filter(n=>n.nodeType===3).map(n=>n.textContent.trim()).filter(Boolean).join(' ');
      if(dt) o.t=dt.slice(0,45);
      if(e.tagName==='BUTTON') o.BTN=(e.innerText||'').trim().slice(0,35);
      const ico=[...(e.classList||[])].find(c=>c.startsWith('codicon-')); if(ico)o.icon=ico;
      if(e.children.length) o.kids=[...e.children].slice(0,14).map(c=>dump(c,depth+1));
      return o;
    }
    return dump(art, 0);
  })()`,

  // Click a "Worked for" toggle, wait, then dump its expanded trajectory in one shot
  'trajectory': `(async () => {
    const arts=[...document.querySelectorAll('[role=article][aria-label="Agent response"]')];
    const art=arts.sort((a,b)=>(b.innerText||'').length-(a.innerText||'').length)[0];
    const btn=[...art.querySelectorAll('button')].find(b=>/^Worked for/.test((b.innerText||'').trim()));
    if(!btn) return {error:'no toggle'};
    btn.click();
    await new Promise(r=>setTimeout(r,700));
    const block=btn.closest('div.relative')||btn.parentElement.parentElement;
    function dump(e,d){
      if(d>7)return{tag:e.tagName.toLowerCase(),trunc:true};
      const o={tag:e.tagName.toLowerCase()};
      const c=(e.className||'').toString(); if(typeof c==='string'&&c)o.cls=c.slice(0,60);
      const da=[...e.attributes].filter(a=>a.name.startsWith('data-')||['role','aria-label','href'].includes(a.name)).map(a=>a.name+'='+(a.value||'').slice(0,26));
      if(da.length)o.data=da;
      const t=[...e.childNodes].filter(n=>n.nodeType===3).map(n=>n.textContent.trim()).filter(Boolean).join(' ');
      if(t)o.t=t.slice(0,50);
      if(e.tagName==='BUTTON')o.BTN=(e.innerText||'').trim().slice(0,40);
      if(e.tagName==='PRE')o.PRE=(e.innerText||'').trim().slice(0,60);
      const ic=[...(e.classList||[])].find(x=>x.startsWith('codicon-'));if(ic)o.icon=ic;
      if(e.children.length)o.kids=[...e.children].slice(0,16).map(c=>dump(c,d+1));
      return o;
    }
    return { btnText:(btn.innerText||'').trim(), block: dump(block,0) };
  })()`,

  // Expand the richest trajectory and list its step labels in document order
  'step-labels': `(async () => {
    const arts=[...document.querySelectorAll('[role=article][aria-label="Agent response"]')];
    const art=arts.sort((a,b)=>(b.innerText||'').length-(a.innerText||'').length)[0];
    const top=[...art.querySelectorAll('button')].find(b=>/^Worked for/.test((b.innerText||'').trim()));
    top.click();
    await new Promise(r=>setTimeout(r,500));
    // expand any nested step toggles too
    const region=top.closest('div.relative');
    region.querySelectorAll('button').forEach(b=>{ if(b!==top && /^(Explored|Edited|Searched|Ran|Read|Analyzed|Viewed|Created|Wrote|Grep|Listed)/.test((b.innerText||'').trim())) {} });
    // collect step rows: buttons + the leaf text rows
    const steps=[];
    region.querySelectorAll('button').forEach(b=>{
      const t=(b.innerText||'').replace(/\\s+/g,' ').trim();
      if(t && t!==('Worked for '+top.innerText.replace(/Worked for /,'').trim()) && !/^Worked for/.test(t)) steps.push({btn:t.slice(0,60)});
    });
    // also leaf text nodes inside step rows (file names, commands)
    const leaves=[];
    region.querySelectorAll('.min-w-0.grow').forEach(row=>{
      const t=(row.innerText||'').replace(/\\s+/g,' ').trim();
      if(t) leaves.push(t.slice(0,80));
    });
    return { worked: top.innerText.trim(), stepButtons: steps.slice(0,25), leafRows:[...new Set(leaves)].slice(0,25) };
  })()`,

  // Dump a shallow attribute tree of the best chat container
  'dump-tree': `(() => {
    const el = document.getElementById('cascade') || document.getElementById('conversation');
    if (!el) return { error: 'no #cascade/#conversation; run find-chat first' };
    function node(e, depth) {
      if (depth > 4) return null;
      return {
        tag: e.tagName.toLowerCase(),
        id: e.id||undefined,
        cls: (e.className||'').toString().slice(0,60)||undefined,
        data: [...e.attributes].filter(a=>a.name.startsWith('data-')).map(a=>a.name+'='+a.value).slice(0,4),
        role: e.getAttribute('role')||undefined,
        kids: [...e.children].slice(0,8).map(c=>node(c,depth+1)).filter(Boolean)
      };
    }
    return node(el, 0);
  })()`,
};

(async () => {
  const targets = await listTargets(PORT);
  if (!targets.length) { console.log('No Antigravity page targets'); process.exit(1); }
  for (const t of targets) {
    console.log(`\n=== TARGET: ${t.title} (${t.url?.slice(0,40)}) ===`);
    let cdp;
    try { cdp = await connect(t.webSocketDebuggerUrl); }
    catch (e) { console.log('  connect failed:', e.message); continue; }
    for (const ctx of cdp.contexts) {
      try {
        const r = await cdp.call('Runtime.evaluate', {
          expression: PROBES[PROBE], returnByValue: true, awaitPromise: true, contextId: ctx.id
        });
        const v = r.result?.value;
        if (v && !(v.topContainers && v.topContainers.length === 0 && !v.cascadeById && !v.conversationById && v.idMatches?.length === 0)) {
          console.log(`  --- context ${ctx.id} (origin ${ctx.origin||'?'}) ---`);
          console.log(JSON.stringify(v, null, 2));
        }
      } catch {}
    }
    cdp.ws.close();
  }
  process.exit(0);
})();
