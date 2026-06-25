/** Test src/antigravity-dom.mjs extractor against the live IDE. */
import WebSocket from 'ws';
import { extractStructured } from '../src/antigravity-dom.mjs';

const PORT = process.argv[2] || '9333';
const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const t = list.find(x => x.type === 'page');
const ws = new WebSocket(t.webSocketDebuggerUrl);
let idc = 1; const contexts = [];
const call = (m, p) => new Promise((res, rej) => {
    const id = idc++;
    const h = x => { const d = JSON.parse(x); if (d.id === id) { ws.off('message', h); d.error ? rej(new Error(d.error.message)) : res(d.result); } };
    ws.on('message', h); ws.send(JSON.stringify({ id, method: m, params: p }));
});
ws.on('message', x => { try { const d = JSON.parse(x); if (d.method === 'Runtime.executionContextCreated') contexts.push(d.params.context); } catch {} });
await new Promise(r => ws.on('open', r));
await call('Runtime.enable', {}); await new Promise(r => setTimeout(r, 700));

for (const ctx of contexts) {
    const model = await extractStructured({ call }, ctx.id);
    if (model) {
        console.log(`\n=== context ${ctx.id} | model: ${model.model} | v${model.version} | ${model.messages.length} msgs ===`);
        model.messages.forEach((m, i) => {
            if (m.role === 'user') console.log(`  [${i}] USER: ${m.text.slice(0, 70).replace(/\s+/g, ' ')}`);
            else console.log(`  [${i}] AGENT working=${m.working} worked="${m.worked}" acts=${m.activity.length} changes=${m.changes ? m.changes.summary + ' +' + m.changes.add + '/-' + m.changes.del : '-'} actions=[${m.actions.map(a => a.label).join(',')}]\n        text: ${(m.text || '').replace(/<[^>]+>/g, '').slice(0, 80).replace(/\s+/g, ' ')}`);
            if (m.activity?.length) m.activity.forEach(a => console.log(`           · ${a.kind}: ${a.text}`));
        });
        break;
    }
}
ws.close(); process.exit(0);
