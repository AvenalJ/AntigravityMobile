# Changelog

All notable changes to the Antigravity Mobile bridge and dashboard.

## [Unreleased] - 2026-11-04

### 🚀 Antigravity 2.x Architecture Support
- **CDP Webview Target Discovery**: Antigravity IDE 2.x relocated the chat interface from the Electron root DOM (`workbench.html`) into an isolated iframe webview (`extensionView=true`). Updated CDP target resolution to inspect `type: "iframe"` targets alongside `"page"`, prioritizing the chat extension view.
- **Dynamic Port Resolution**: Integrated dynamic `DevToolsActivePort` inspection to discover active CDP debugging instances even when default static ports change.
- **Structured Stream Fallback**: Added `findStructuredContext()` to stream real-time chat updates directly from the webview context when `#cascade` is not present in the root frame.

### 🧩 DOM Selectors & Message Extraction (v2.1)
- **Sidebar Conversations**: Updated `CONVERSATIONS_SCRIPT` to query modern `[data-testid="conversation-row-sidebar"]` elements with `data-cascade-id` and `data-selected`, while maintaining fallback for legacy `convo-pill-*` elements.
- **Conversation Switching & Creation**: Updated `switchConversation` to click sidebar links by cascade ID, and `newConversation` to target `[data-testid="extension-new-conversation"]`.
- **Response Prose Container Discovery**: Replaced reliance on deprecated Tailwind prose classes with semantic container matching (`div.px-2.py-1`, `.gap-2`, `.markdown`, direct markdown tags) to reliably extract agent prose.
- **Collapsible Tool Group Tracking**: Updated trajectory tracking to read `textContent` on hidden `[data-testid="worked-for-collapsible"]` and detect in-progress `[data-testid="tool-group-collapsible"]` blocks so `working: true` status remains accurate.

### ❓ Interactive Prompts & Multiple-Choice Questionnaires
- **Modern Questionnaire Extraction**: Added full support for Antigravity 2.x `ask_question` and `ask_permission` questionnaire cards:
  - Header text: `[data-testid="ask-question-header-text"]`
  - Choice options: `[data-testid="ask-question-option"]` and `[data-testid="ask-question-option-text"]`
  - Continue / Submit button: `[data-testid="interaction-continue-button"]`
  - Skip / Dismiss button: `[data-testid="interaction-skip-button"]`, `[data-testid="ask-question-dismiss-button"]`
  - Free-text write-in: `[data-testid="ask-question-writein"]`
- **React Input Dispatch**: Enhanced `clickElementByXPath` to dispatch native `input` and `change` events on `<input type="radio">`, `<input type="checkbox">`, and `<label>` elements so React state updates reliably.
- **Cross-Context Text Fill**: Updated `fillAndSubmitByXPath` to search across iframe targets (`extensionView=true`) so "Other" write-in prompt responses submit properly.
- **Subagent Actions**: Added detection and forwarding for subagent approval and rejection (`data-testid="subagent-approve"`, `data-testid="subagent-deny"`).

### 🕹️ Smart Quick-Response Chips & Agent Abort
- **Smart Quick Actions**: Upgraded the quick response buttons ('Yes', 'No', 'Continue', 'Stop') in both the mobile dashboard and `minimal.html`:
  - **'Yes' / 'Continue'**: Interactively selects the affirmative / recommended questionnaire option or clicks the pending IDE approval button (Run, Accept, Allow) instead of sending the word as a raw text prompt.
  - **'No'**: Selects the negative questionnaire option or clicks the pending rejection button (Reject, Deny, Cancel).
  - **'Stop'**: Calls the new `/api/chat/stop-agent` endpoint to abort the active generation / task in the IDE.
  - **Fallback**: Only falls back to typing plain text into the chat prompt if no interactive prompt or approval button is pending.
- **Stop Agent API**: Added `CDP.stopAgent()` and `POST /api/chat/stop-agent` targeting cursor stop triggers (`webview-agent-cursor-stop-button`, `running-selection-stop`, `subagent-stop`).

### 📊 Model Quota & Language Server Fix
- **Process Detection for Antigravity 2.x**: Fixed process discovery in `src/quota-service.mjs` to recognize the `agy.exe` hub process, handling `--hub-port`, `--hub`, and `--app_data_dir=antigravity` (with `=` parameter syntax).
- **Multi-Model Quota Parsing**: Restored live quota polling across all available models (Gemini Argon, Gemini Flash, Claude Opus/Sonnet, GPT-OSS) and weekly usage summaries.

### 🛠️ UI & Process Supervisor (Pre-existing on branch)
- **Collapsible Quota Monitor**: Compact, collapsible, and dismissible quota hero section for mobile viewports.
- **Supervisor Stability**: Prevented supervisor crash loops and unwanted console popups on Windows.
- **Launcher Auto-Start**: Automated starting Antigravity IDE with remote debugging enabled.

