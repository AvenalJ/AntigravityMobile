/**
 * Antigravity DOM map + structured chat extractor.
 *
 * ── WHY THIS FILE EXISTS ────────────────────────────────────────────────────
 * Antigravity ships frequent UI updates. 1.x exposed `#cascade`; 2.0 dropped it
 * and switched to Tailwind atomic classes (which churn every release). Instead of
 * mirroring the IDE's raw HTML+CSS (fragile), we EXTRACT a clean structured model
 * of the conversation and render it ourselves on mobile.
 *
 * The extractor anchors on the DURABLE hooks Antigravity exposes for
 * accessibility / testing — ARIA roles, aria-labels, data-testid, and a couple
 * of stable element ids. Those survive restyles far better than CSS classes.
 *
 * ── WHEN AN UPDATE BREAKS IT ────────────────────────────────────────────────
 * 1. Run:  node scripts/cdp-probe.mjs <port> hooks        (lists current testids/aria)
 *          node scripts/cdp-probe.mjs <port> anchor        (locates the scroll area)
 *          node scripts/cdp-probe.mjs <port> survey        (agent-turn block layout)
 * 2. Update the SELECTORS object below to match. That's the only place to edit;
 *    the walk logic reads from it. Bump SELECTORS.version so the UI can show it.
 */

export const SELECTORS = {
    version: '2.1',

    // Most durable anchor: the chat panel itself (survives ask-prompts).
    conversationView: '[data-testid="conversation-view"]',

    // Stable element id of the composer/input box — secondary anchor.
    inputBoxId: 'antigravity.agentSidePanelInputBox',

    // Legacy 1.x anchors, tried as a fallback so older Antigravity still works.
    legacyContainerIds: ['cascade', 'conversation'],

    // A turn's message articles (ARIA — very stable).
    userMessage: '[role="article"][aria-label="User message"]',
    agentMessage: '[role="article"][aria-label="Agent response"]',

    // Inside an agent article.
    workedToggleText: /^Worked for/i,          // trajectory summary button text
    changeSummaryClass: 'gap-y-3',             // message-list marker (flex flex-col gap-y-3)
    answerProseClass: 'leading-relaxed',       // markdown answer container marker

    // Activity step verbs used to classify the trajectory timeline.
    stepVerbs: /^(Edited|Ran|Explored|Searched|Read|Viewed|Analyzed|Created|Wrote|Grep|Listed|Thought|Build|Browsed|Proposed|Generated)/i,

    // Live action buttons we forward to the IDE (permission / command prompts).
    acceptLabels: /^(run|accept|allow once|allow this conversation|yes|continue|approve|confirm|ok|proceed|apply|keep)\b/i,
    rejectLabels: /^(reject|deny|no|cancel|discard|undo)\b/i,

    // Model selector aria-label prefix ("Select model, current: <name>").
    modelLabelPrefix: 'Select model, current:',
};

/**
 * The browser-side extraction script. Returns a clean JSON conversation model.
 * Runs in the IDE's page context via CDP Runtime.evaluate (returnByValue).
 *
 * NOTE: this is a template string injected verbatim — it cannot reference any
 * Node-side variables except the SELECTORS we serialize into it below.
 */
function buildExtractionScript(sel) {
    return `(() => {
    const SEL = ${JSON.stringify({
        conversationView: sel.conversationView,
        inputBoxId: sel.inputBoxId,
        legacyContainerIds: sel.legacyContainerIds,
        userMessage: sel.userMessage,
        agentMessage: sel.agentMessage,
        changeSummaryClass: sel.changeSummaryClass,
        answerProseClass: sel.answerProseClass,
        modelLabelPrefix: sel.modelLabelPrefix,
    })};
    const workedRe = ${sel.workedToggleText.toString()};
    const stepRe = ${sel.stepVerbs.toString()};
    const acceptRe = ${sel.acceptLabels.toString()};
    const rejectRe = ${sel.rejectLabels.toString()};

    // ---- locate the scroll container + message list -----------------------
    // Walk up from a node to the nearest scrollable (overflow-y:auto) ancestor.
    function scrollAncestor(node) {
        let n = node;
        while (n && getComputedStyle(n).overflowY !== 'auto') n = n.parentElement;
        return n;
    }
    function findScroll() {
        // Primary anchor: the conversation panel (most durable; survives prompts).
        const conv = document.querySelector(SEL.conversationView);
        if (conv) {
            const s = scrollAncestor(conv) || conv.querySelector('[class*="overflow-y-auto"]');
            if (s) return s;
        }
        // Secondary anchor: the composer input box (present when idle).
        const input = document.getElementById(SEL.inputBoxId);
        if (input) { const s = scrollAncestor(input); if (s) return s; }
        // Anchor-independent fallback: during an ask-prompt the input box is
        // removed, but message articles / the radiogroup remain. Find the
        // scroll container from those instead.
        const anchor = document.querySelector(SEL.agentMessage) ||
                       document.querySelector(SEL.userMessage) ||
                       document.querySelector('[role="radiogroup"]');
        if (anchor) { const s = scrollAncestor(anchor); if (s) return s; }
        // legacy 1.x fallback
        for (const id of SEL.legacyContainerIds) {
            const el = document.getElementById(id);
            if (el) return el;
        }
        return null;
    }
    const scroll = findScroll();
    if (!scroll) return { found: false };

    // ---- xpath tagging so mobile can forward clicks to the real IDE -------
    function xpath(el) {
        if (!el || el === document.body) return '/html/body';
        const parts = [];
        let node = el;
        while (node && node.nodeType === 1 && node !== document.body) {
            let i = 1, sib = node.previousElementSibling;
            while (sib) { if (sib.tagName === node.tagName) i++; sib = sib.previousElementSibling; }
            parts.unshift(node.tagName.toLowerCase() + '[' + i + ']');
            node = node.parentElement;
        }
        return '/html/body/' + parts.join('/');
    }

    // ---- whitelist-simplify markdown so mobile styles it (no IDE classes) -
    const ALLOWED = { P:1, BR:1, UL:1, OL:1, LI:1, CODE:1, PRE:1, STRONG:1, B:1, EM:1, I:1, A:1, H1:1, H2:1, H3:1, H4:1, H5:1, H6:1, BLOCKQUOTE:1, HR:1, TABLE:1, THEAD:1, TBODY:1, TR:1, TD:1, TH:1, DEL:1, INPUT:1, IMG:1 };
    function clean(node) {
        if (node.nodeType === 3) return node.textContent.replace(/[<>&]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[c]));
        if (node.nodeType !== 1) return '';
        const tag = node.tagName;
        if (tag === 'STYLE' || tag === 'SCRIPT' || tag === 'BUTTON' || tag === 'SVG') return '';
        let inner = '';
        node.childNodes.forEach(c => { inner += clean(c); });
        if (!ALLOWED[tag]) return inner; // unwrap disallowed tags, keep contents
        const t = tag.toLowerCase();
        if (t === 'br' || t === 'hr') return '<' + t + '>';
        let attrs = '';
        if (t === 'a' && node.getAttribute('href')) attrs = ' href="' + node.getAttribute('href').replace(/"/g, '&quot;') + '" target="_blank" rel="noreferrer"';
        if (t === 'input' && node.type === 'checkbox') return '<input type="checkbox" disabled' + (node.checked ? ' checked' : '') + '>';
        if (t === 'img') {
            const src = node.getAttribute('src') || '';
            // only keep web-accessible images; local vscode-file:// won't load on the phone
            if (/^(https?:|data:|blob:)/.test(src)) return '<img src="' + src.replace(/"/g, '&quot;') + '" loading="lazy">';
            const alt = (node.getAttribute('alt') || 'image').replace(/[<>]/g, '');
            return '<span class="sc-img-missing">🖼️ ' + alt + '</span>';
        }
        return '<' + t + attrs + '>' + inner + '</' + t + '>';
    }

    // ---- classify one trajectory step row ---------------------------------
    function classifyStep(text) {
        const t = text.replace(/\\s+/g, ' ').trim();
        if (!t) return null;
        let kind = 'step';
        if (/^Edited/.test(t)) kind = 'edit';
        else if (/^(Ran|Build)/.test(t)) kind = 'run';
        else if (/^Thought/.test(t)) kind = 'thought';
        else if (/^(Explored|Searched|Read|Viewed|Grep|Listed|Browsed)/.test(t)) kind = 'explore';
        return { kind, text: t.slice(0, 200) };
    }

    // ---- extract one agent article ----------------------------------------
    function extractAgent(art) {
        const out = { role: 'agent', working: false, worked: '', activity: [], text: '', changes: null, actions: [] };

        // trajectory summary toggle ("Worked for Xs") + any expanded steps
        const buttons = [...art.querySelectorAll('button')];
        const workBtn = buttons.find(b => b.getAttribute('data-testid') === 'worked-for-collapsible' || workedRe.test((b.textContent || b.innerText || '').trim()));
        if (workBtn) {
            out.worked = (workBtn.textContent || workBtn.innerText || '').replace(/\\s+/g, ' ').trim();
            const region = workBtn.closest('div');
            // step rows only present if the user has the trajectory expanded
            if (region) {
                const seen = new Set();
                region.querySelectorAll('.min-w-0.grow').forEach(row => {
                    const s = classifyStep(row.textContent || row.innerText || '');
                    if (s && !seen.has(s.text)) { seen.add(s.text); out.activity.push(s); }
                });
            }
        }

        // in-progress tool execution group
        const activeTool = buttons.find(b => b.getAttribute('data-testid') === 'tool-group-collapsible');
        if (activeTool) {
            const toolName = (activeTool.textContent || activeTool.innerText || '').replace(/\\s+/g, ' ').trim();
            if (toolName) out.activity.push({ kind: 'run', text: toolName });
        }

        // answer prose (markdown) — simplified to whitelisted tags
        let prose = art.querySelector('[class*="' + SEL.answerProseClass + '"]');
        if (!prose) {
            const candidates = [...art.querySelectorAll('div.px-2.py-1, div.gap-2, div.markdown, [class*="markdown"]')];
            for (const c of candidates) {
                if (c.closest('[data-testid="worked-for-collapsible"]') || c.closest('[data-testid="tool-group-collapsible"]') || c.closest('[data-testid="turn-cards-container"]')) continue;
                if (c.querySelector('p, pre, ul, ol, h1, h2, h3, blockquote, code, table') || (c.textContent.trim().length > 0 && !c.querySelector('button'))) {
                    prose = c;
                    break;
                }
            }
        }
        if (!prose) {
            const p = [...art.querySelectorAll('p, pre')].find(el =>
                !el.closest('[data-testid="worked-for-collapsible"]') &&
                !el.closest('[data-testid="tool-group-collapsible"]') &&
                !el.closest('[data-testid="turn-cards-container"]')
            );
            if (p) prose = p.parentElement;
        }
        if (prose) out.text = clean(prose).trim();

        // change summary: "N files changed", +adds / -dels
        const txt = (art.innerText || art.textContent || '');
        const cm = txt.match(/(\\d+)\\s+files?\\s+changed/i);
        if (cm) {
            const adds = [...art.querySelectorAll('[class*="text-green-5"]')].map(e => e.innerText || e.textContent).join(' ');
            const dels = [...art.querySelectorAll('[class*="text-red-5"]')].map(e => e.innerText || e.textContent).join(' ');
            out.changes = {
                summary: cm[0],
                add: (adds.match(/\\d+/) || [''])[0],
                del: (dels.match(/\\d+/) || [''])[0],
            };
        }

        // live action buttons (Run / Accept / Reject / Subagent Approve / Deny) — forwarded via xpath
        buttons.forEach(b => {
            const testId = b.getAttribute('data-testid') || '';
            const label = (b.innerText || b.getAttribute('aria-label') || '').trim().slice(0, 40);
            if (testId === 'subagent-approve') {
                out.actions.push({ label: label || 'Approve', xpath: xpath(b), kind: 'accept' });
            } else if (testId === 'subagent-deny') {
                out.actions.push({ label: label || 'Deny', xpath: xpath(b), kind: 'reject' });
            } else if (label) {
                if (acceptRe.test(label)) out.actions.push({ label, xpath: xpath(b), kind: 'accept' });
                else if (rejectRe.test(label)) out.actions.push({ label, xpath: xpath(b), kind: 'reject' });
            }
        });

        // working = trajectory/tool active but no answer text yet
        out.working = (!!out.worked || !!activeTool) && !out.text && out.actions.length === 0;
        return out;
    }

    // ---- walk the message list in document order --------------------------
    const messages = [];
    const arts = [...scroll.querySelectorAll(SEL.userMessage + ',' + SEL.agentMessage)];
    arts.forEach(a => {
        const label = a.getAttribute('aria-label');
        if (label === 'User message') {
            let ut = (a.innerText || '').replace(/\\u00a0/g, ' ').trim();
            // strip a trailing hover timestamp the IDE appends, e.g.
            //   "6:21 PM" | "msg 6:21 PM" | "11:50 PM, 6/15/2026"
            ut = ut.replace(/\\s*(msg\\s*)?\\d{1,2}:\\d{2}\\s*(AM|PM)?\\s*(,?\\s*\\d{1,2}\\/\\d{1,2}\\/\\d{2,4})?\\s*$/i, '').trim();
            messages.push({ role: 'user', text: ut.slice(0, 8000) });
        } else {
            messages.push(extractAgent(a));
        }
    });

    // ---- pending multiple-choice prompt (ask-question questionnaire or legacy radiogroup) ---
    // Antigravity asks the user a question with radio options + an optional
    // free-text "Other" answer + Submit/Skip. We surface it so mobile can answer.
    let prompt = null;
    const askOptions = [...document.querySelectorAll('[data-testid="ask-question-option"]')];
    if (askOptions.length > 0) {
        let question = '';
        const headerEl = document.querySelector('[data-testid="ask-question-header-text"]');
        if (headerEl) {
            question = (headerEl.innerText || headerEl.textContent || '').replace(/\\s+/g, ' ').trim();
        }

        const options = [];
        askOptions.forEach(opt => {
            const textEl = opt.querySelector('[data-testid="ask-question-option-text"]');
            const label = (textEl ? textEl.innerText || textEl.textContent : opt.innerText || opt.textContent || '')
                .replace(/^\\s*\\d+\\s*/, '')
                .replace(/\\s+/g, ' ')
                .trim();
            const input = opt.querySelector('input');
            const targetEl = input || opt;
            if (label) options.push({ label, xpath: xpath(targetEl) });
        });

        let otherXpath = null;
        const writeIn = document.querySelector('[data-testid="ask-question-writein"]');
        if (writeIn) otherXpath = xpath(writeIn);

        let submitXpath = null;
        const submitBtn = document.querySelector('[data-testid="interaction-continue-button"]');
        if (submitBtn) submitXpath = xpath(submitBtn);

        let skipXpath = null;
        const skipBtn = document.querySelector('[data-testid="interaction-skip-button"], [data-testid="ask-question-dismiss-button"]');
        if (skipBtn) skipXpath = xpath(skipBtn);

        if (options.length || otherXpath) {
            prompt = { type: 'choice', question, options, otherXpath, submitXpath, skipXpath };
        }
    } else {
        const rg = document.querySelector('[role="radiogroup"]');
        if (rg) {
            let card = rg;
            for (let i = 0; i < 8 && card; i++) { if (/\\bSubmit\\b/.test(card.innerText || '')) break; card = card.parentElement; }
            card = card || rg.parentElement;

            let question = '';
            const proses = [...card.querySelectorAll('[class*="' + SEL.answerProseClass + '"]')];
            if (proses.length) question = (proses[0].innerText || '').replace(/\\s+/g, ' ').trim();

            const options = [];
            let otherXpath = null;
            rg.querySelectorAll('label').forEach(l => {
                const ta = l.querySelector('textarea, input[type="text"]');
                if (ta) { otherXpath = xpath(ta); return; }
                const label = (l.innerText || '').replace(/^\\s*\\d+\\s*/, '').replace(/\\s+/g, ' ').trim();
                if (label) options.push({ label, xpath: xpath(l) });
            });
            if (!otherXpath) {
                const ta = card.querySelector('textarea[placeholder*="Other"], textarea[placeholder*="write your answer"]');
                if (ta) otherXpath = xpath(ta);
            }

            let submitXpath = null, skipXpath = null;
            card.querySelectorAll('button').forEach(b => {
                const t = (b.innerText || '').trim();
                if (/^Submit/i.test(t)) submitXpath = xpath(b);
                else if (/^Skip/i.test(t)) skipXpath = xpath(b);
            });

            if (options.length || otherXpath) {
                prompt = { type: 'choice', question, options, otherXpath, submitXpath, skipXpath };
            }
        }
    }

    // ---- open artifact panel (walkthroughs, reports, docs) ----------------
    // Antigravity renders an opened artifact in an auxiliary pane whose content
    // scroller carries the class "jetski-scrollable-element". We simplify its
    // markdown to whitelisted tags and surface a title + Prev/Next navigation.
    let artifact = null;
    const artScroll = document.querySelector('.jetski-scrollable-element');
    if (artScroll && (artScroll.innerText || '').trim().length > 20) {
        // pane = a few levels up (holds Prev/Next + Copy buttons)
        let pane = artScroll;
        for (let i = 0; i < 6 && pane.parentElement; i++) pane = pane.parentElement;

        const heading = artScroll.querySelector('h1, h2');
        const title = heading ? (heading.innerText || '').trim().slice(0, 120) : 'Artifact';

        let prevXpath = null, nextXpath = null;
        pane.querySelectorAll('button').forEach(b => {
            const t = (b.innerText || '').trim();
            if (/^Previous$/i.test(t)) prevXpath = xpath(b);
            else if (/^Next$/i.test(t)) nextXpath = xpath(b);
        });

        artifact = {
            open: true,
            title,
            html: clean(artScroll).trim(),
            prevXpath,
            nextXpath,
        };
    }

    // ---- model name -------------------------------------------------------
    let model = '';
    const ml = document.querySelector('[aria-label^="' + SEL.modelLabelPrefix + '"]');
    if (ml) model = (ml.getAttribute('aria-label') || '').replace(SEL.modelLabelPrefix, '').trim();

    return { found: true, version: '${sel.version}', model, messages, prompt, artifact };
    })()`;
}

/**
 * Browser-side script: list the conversation pills (history) + the active id.
 * Each pill is `<span data-testid="convo-pill-<uuid>">Title</span>`. The active
 * conversation id is in the page URL (`/c/<uuid>`).
 */
const CONVERSATIONS_SCRIPT = `(() => {
    // Strategy 1: Modern 2.0 / IDE sidebar conversation rows
    const rows = [...document.querySelectorAll('[data-testid="conversation-row-sidebar"]')];
    if (rows.length > 0) {
        let activeId = null;
        const conversations = rows.map(r => {
            const id = r.getAttribute('data-cascade-id') ||
                       r.querySelector('a')?.getAttribute('href')?.match(/\\/c\\/([0-9a-f-]+)/i)?.[1] ||
                       '';
            const isSelected = r.getAttribute('data-selected') === 'true';
            if (isSelected && id) activeId = id;
            const title = r.querySelector('a')?.getAttribute('aria-label') ||
                          r.querySelector('span.truncate')?.textContent?.trim() ||
                          (r.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 80);
            const project = r.getAttribute('data-subtext') || '';
            return { id, title, project, active: isSelected };
        }).filter(c => c.id && c.title);
        return { found: true, activeId, conversations };
    }

    // Strategy 2: Legacy convo pills (web app)
    const m = location.pathname.match(/\\/c\\/([0-9a-f-]+)/i);
    const activeId = m ? m[1] : null;
    const pills = [...document.querySelectorAll('[data-testid^="convo-pill-"]')];
    const conversations = pills.map(p => {
        const id = p.getAttribute('data-testid').replace('convo-pill-', '');
        // textContent recovers letters that innerText drops due to per-char spans
        const title = (p.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 80);
        return { id, title, active: id === activeId };
    }).filter(c => c.title);
    return { found: pills.length > 0, activeId, conversations };
})()`;

export async function extractConversations(cdp, contextId) {
    try {
        const result = await cdp.call('Runtime.evaluate', {
            expression: CONVERSATIONS_SCRIPT, returnByValue: true, contextId,
        });
        const v = result.result?.value;
        if (v && v.found) return v;
    } catch (e) { /* not the right context */ }
    return null;
}

/**
 * Browser-side script template: click a conversation pill by id to switch to it.
 * Clicks the pill and walks up to a clickable ancestor (the row) to be safe.
 */
export function buildSwitchConversationScript(id) {
    return `(() => {
        // Modern sidebar row
        const row = document.querySelector('[data-testid="conversation-row-sidebar"][data-cascade-id="' + ${JSON.stringify(id)} + '"]');
        if (row) {
            const link = row.querySelector('a');
            if (link) { link.click(); return { found: true }; }
            row.click();
            return { found: true };
        }
        const link = document.querySelector('a[href*="' + ${JSON.stringify(id)} + '"]');
        if (link) { link.click(); return { found: true }; }

        // Legacy pill fallback
        const pill = document.querySelector('[data-testid="convo-pill-' + ${JSON.stringify(id)} + '"]');
        if (!pill) return { found: false };
        let target = pill;
        for (let i = 0; i < 5 && target; i++) {
            if (target.tagName === 'A' || target.tagName === 'BUTTON' || target.getAttribute('role') === 'button') break;
            if (target.parentElement && target.parentElement.querySelector('[data-testid^="convo-pill-"]')) { target = target.parentElement; continue; }
            target = target.parentElement || target;
            break;
        }
        (target || pill).click();
        return { found: true };
    })()`;
}

export async function switchConversation(cdp, contextId, id) {
    try {
        const result = await cdp.call('Runtime.evaluate', {
            expression: buildSwitchConversationScript(id), returnByValue: true, contextId,
        });
        return !!result.result?.value?.found;
    } catch (e) { return false; }
}

/** Click the IDE's "New Conversation" button (aria-label). */
const NEW_CONVERSATION_SCRIPT = `(() => {
    const btn = document.querySelector('[data-testid="extension-new-conversation"]')
        || document.querySelector('[data-testid="new-conversation-button"]')
        || document.querySelector('[aria-label="New Conversation"]')
        || [...document.querySelectorAll('button')].find(b => /new conversation/i.test((b.innerText || '').trim()));
    if (!btn) return { found: false };
    btn.click();
    return { found: true };
})()`;

export async function newConversation(cdp, contextId) {
    try {
        const result = await cdp.call('Runtime.evaluate', {
            expression: NEW_CONVERSATION_SCRIPT, returnByValue: true, contextId,
        });
        return !!result.result?.value?.found;
    } catch (e) { return false; }
}

/**
 * Run the structured extractor against a CDP context.
 * @param cdp   object with a .call(method, params) helper (see chat-stream.mjs)
 * @param contextId  execution context id containing the chat
 * @returns {Promise<object|null>} the conversation model, or null
 */
export async function extractStructured(cdp, contextId) {
    const script = buildExtractionScript(SELECTORS);
    try {
        const result = await cdp.call('Runtime.evaluate', {
            expression: script,
            returnByValue: true,
            awaitPromise: true,
            contextId,
        });
        const v = result.result?.value;
        if (v && v.found) return v;
    } catch (e) { /* context invalid / not the chat */ }
    return null;
}
