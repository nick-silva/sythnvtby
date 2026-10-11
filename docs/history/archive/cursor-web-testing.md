# Cursor web development testing on this project

This doc explains how Cursor can **check its own work** when developing the Virtual Boy emulator UI and runtime, so you rely less on manual testing and avoid getting stuck in a repeat-test loop.

---

## What Cursor can do (overview)

| Method | What it does | Best for |
|--------|----------------|----------|
| **Agent browser** | Cursor opens a browser, navigates to URLs, clicks, fills forms, takes screenshots | Testing UI and flows on `localhost:5173` after `npm run dev` |
| **Simple Browser (in-IDE)** | You open a panel inside Cursor that shows a URL (e.g. `http://localhost:5173`) | Quick visual check without leaving the IDE; agent cannot drive it |
| **Chrome DevTools MCP** | Cursor connects to Chrome via MCP and can read console, DOM, network, run Lighthouse | Letting the agent see console logs and runtime state when you have the app open in Chrome |
| **ConsoleSpy (MCP)** | Chrome extension + MCP server streams console logs into Cursor | Lighter option if you only need console output in Cursor |

---

## 1. Agent browser (no extra setup)

Cursor’s Agent can **open a browser**, go to a page, interact with it, and take screenshots. For this project that means:

1. **Start the dev server** (you or the agent): `npm run dev`
2. **Ask the agent** to open the app and verify something, e.g.:
   - “Open http://localhost:5173 and confirm the page loads and the display toggle is visible.”
   - “Open the app, load a ROM, switch to Palette, click Run diagnostics, and take a screenshot of the result.”

The agent will launch a browser, navigate, and can read content and capture screenshots. Use this to **verify UI and flows** without you re-testing every time.

**Limitation:** The agent cannot see your **browser DevTools console** (e.g. “Step 0–3 pass/fail” from runtime diagnostics) unless you add one of the MCP options below.

---

## 2. Simple Browser (in-IDE panel)

- **Open:** `Cmd+Shift+P` (Mac) or `Ctrl+Shift+P` (Windows/Linux) → type **“Simple Browser: Show”**.
- Enter URL: `http://localhost:5173` (with `npm run dev` running).

You get a live view inside Cursor. The agent does **not** control this panel; it’s for your own quick visual checks. Useful to keep the app visible while you work.

---

## 3. Chrome DevTools MCP (agent can see console + DOM)

This gives Cursor **real browser debugging**: console logs, DOM, network, Lighthouse. The agent can then “check its own work” by inspecting the running app.

### One-time setup

1. **Install the MCP server** (globally or in project):
   ```bash
   npm install -g chrome-devtools-mcp
   chrome-devtools-mcp --version
   ```

2. **Configure Cursor** to use it. Edit Cursor’s `settings.json`:
   - **Linux:** `~/.config/Cursor/User/settings.json`
   - **macOS:** `~/Library/Application Support/Cursor/User/settings.json`
   - **Windows:** `%APPDATA%\Cursor\User\settings.json`

   Add (or merge in) the MCP config:
   ```json
   {
     "mcpServers": {
       "chrome-devtools": {
         "command": "chrome-devtools-mcp",
         "args": []
       }
     }
   }
   ```
   Alternative (auto-updating): use `"command": "npx", "args": ["-y", "chrome-devtools-mcp@latest"]`.

3. **Restart Cursor.**

4. **Use Chrome with remote debugging** when you want the agent to see that browser:
   - **Linux:** `google-chrome --remote-debugging-port=9222`
   - **macOS:** `/Applications/Google Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222`
   - **Windows:** `"C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222`

   Then open `http://localhost:5173` in that Chrome window (with `npm run dev` running).

### How to use it in this project

- Run `npm run dev`, open the app in the debugging Chrome window, load a ROM, run **Run diagnostics**.
- Ask Cursor things like:
  - “Check the browser console for this tab and tell me if the diagnostics (Step 0–3) passed or failed.”
  - “Inspect the DOM for the emulator container and list its structure.”

The agent uses the Chrome DevTools MCP tools to query that browser and report back, so it can **verify runtime behavior** (including diagnostics) instead of you re-running and pasting console output.

---

## 4. ConsoleSpy (console-only MCP)

If you only need **console logs** in Cursor (e.g. diagnostics Step 0–3):

- Install the **ConsoleSpy** Chrome extension and its MCP server (see [ConsoleSpy MCP](https://github.com/mgsrevolver/consolespy)).
- Configure that MCP server in Cursor’s `settings.json` under `mcpServers`.
- With the app open in Chrome and ConsoleSpy connected, the agent can read console output from Cursor.

Lighter than full Chrome DevTools MCP; use when console visibility is enough.

---

## Running tests automatically

### From the IDE (tasks)

- **Ctrl+Shift+P** (or Cmd+Shift+P) → **"Tasks: Run Task"** → choose:
  - **Run unit tests** — runs `npm test` once (Vitest).
  - **Run unit tests (watch)** — runs `npm run test:watch`; tests re-run when you save relevant files.

You can bind a key to "Run unit tests" via **Preferences: Open Keyboard Shortcuts (JSON)** by adding a keybinding that runs the task "Run unit tests".

### Via the agent

Ask Cursor to run tests and (optionally) check the browser:

- **Unit tests only:** "Run the unit tests" or "Run `npm test` and tell me if anything failed."
- **Unit tests + browser diagnostics:** With Chrome DevTools MCP attached and the app open in Chrome (with a ROM loaded and diagnostics run), you can say: "Run the unit tests, then check the browser console for the tab on localhost:5173 and tell me the diagnostics Step 0–3 pass/fail."

The agent will run the command and, if MCP is connected, can query the console and summarize results.

---

## Recommended workflow to avoid the "death loop"

1. **Always run unit tests after code changes**  
   For `src/palette-layer.js`, `src/palette-diagnostics.js`, and related tests: run `npm test` and fix any failures before considering the change done. The `.cursor/rules/testing.mdc` rule reminds the agent to do this.

2. **Use the Agent browser for UI checks**  
   After changes that affect the UI or flow, ask the agent to open `http://localhost:5173` and verify (e.g. “Open the app and confirm the display toggle and Run diagnostics button work and the page doesn’t error.”). The agent can take screenshots and describe what it sees.

3. **Optional: add Chrome DevTools MCP for runtime diagnostics**  
   When you need the agent to **see** “Step 0–3 pass/fail” (or other console output) without you copying it:
   - Set up Chrome DevTools MCP once (steps above).
   - When testing diagnostics, open the app in Chrome with remote debugging, run diagnostics, then ask: “Check the console for the diagnostics results and tell me pass/fail.” The agent can then base follow-up fixes on real console output.

4. **Keep Simple Browser as a quick visual aid**  
   Use “Simple Browser: Show” with `http://localhost:5173` when you want a persistent in-IDE view; use the Agent browser when you want the agent to actively verify something.

---

## Summary

- **No extra setup:** Use **Agent browser** + `npm test` so Cursor can run tests and hit `localhost:5173` to check UI and flows.
- **In-IDE view only:** Use **Simple Browser** for your own eyes.
- **Agent sees console / DOM:** Set up **Chrome DevTools MCP** (or ConsoleSpy) so Cursor can check runtime diagnostics and DOM without you re-pasting the console.

Combining **unit tests**, **Agent browser** for UI, and optionally **Chrome DevTools MCP** for console/DOM gives Cursor the ability to check its own work as often as possible and reduces the manual repeat-test loop.
