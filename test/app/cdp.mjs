// A small client for the Chrome DevTools Protocol, to drive the desktop app in tests the way
// a person would: real mouse clicks and key presses, not JavaScript shortcuts.
// It uses Node's built-in fetch and WebSocket, so it needs no extra packages.

export class Cdp {
  #ws;
  #next = 0;
  #pending = new Map();
  #listeners = [];

  /** Connect to the app's window (the page at /app/) on the given debugging port. */
  static async connect(port, deadlineMs = 30_000) {
    const until = Date.now() + deadlineMs;
    for (;;) {
      try {
        const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
        const page = targets.find((t) => t.type === "page" && /\/app\//.test(t.url));
        if (page) {
          const cdp = new Cdp();
          await cdp.#open(page.webSocketDebuggerUrl);
          return cdp;
        }
      } catch {
        // Not up yet.
      }
      if (Date.now() > until) throw new Error(`The app's window didn't appear on port ${port}.`);
      await sleep(250);
    }
  }

  async #open(url) {
    this.#ws = new WebSocket(url);
    await new Promise((resolve, reject) => {
      this.#ws.onopen = resolve;
      this.#ws.onerror = () => reject(new Error("Couldn't connect to the app's window."));
    });
    this.#ws.onmessage = (m) => {
      const msg = JSON.parse(m.data);
      const waiting = msg.id && this.#pending.get(msg.id);
      if (waiting) {
        this.#pending.delete(msg.id);
        msg.error ? waiting.reject(new Error(msg.error.message)) : waiting.resolve(msg.result);
      } else if (msg.method) for (const l of this.#listeners) l(msg);
    };
    // A closed window ends every request that's still waiting.
    this.#ws.onclose = () => {
      for (const { reject } of this.#pending.values()) reject(new Error("The app's window closed."));
      this.#pending.clear();
    };
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.#next;
      this.#pending.set(id, { resolve, reject });
      this.#ws.send(JSON.stringify({ id, method, params }));
    });
  }

  /** Call `listener` for every event the window sends (console messages, errors…). */
  on(listener) {
    this.#listeners.push(listener);
  }

  /** Run JavaScript in the window and return its (JSON) value. */
  async eval(expression) {
    const r = await this.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value;
  }

  /** Ask again until `check` returns something truthy, or fail with `what` after the deadline. */
  async until(what, check, deadlineMs = 20_000) {
    const until = Date.now() + deadlineMs;
    let last;
    for (;;) {
      try {
        const value = await check();
        if (value) return value;
      } catch (err) {
        last = err; // e.g. the page is still loading: ask again
      }
      if (Date.now() > until) throw new Error(`Timed out waiting for: ${what}${last ? ` (last error: ${last.message})` : ""}`);
      await sleep(200);
    }
  }

  /** A real left click at a point in the window (CSS pixels), holding the button `holdMs` long. */
  async click(x, y, holdMs = 0) {
    await this.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, button: "none" });
    await this.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
    if (holdMs) await sleep(holdMs);
    await this.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
  }

  /**
   * Where a click on the element that `find` (JavaScript returning an element) finds would land:
   * its middle, if that point is really it (or something inside it). Throws, naming what's on
   * top, when something else covers it; null while it isn't there or has no size.
   */
  async spot(find) {
    const at = await this.eval(`(() => {
      const e = (${find})();
      if (!e) return null;
      const r = e.getBoundingClientRect();
      if (!r.width || !r.height) return null;
      const x = r.x + r.width / 2, y = r.y + r.height / 2;
      const hit = document.elementFromPoint(x, y);
      const name = (n) => n ? n.tagName.toLowerCase() + (n.id ? "#" + n.id : "") + (typeof n.className === "string" && n.className ? "." + n.className.trim().split(/\\s+/).join(".") : "") : "nothing";
      const top = hit && (e.contains(hit) || hit.contains(e)) ? null : name(hit?.closest("button, a, [role]") ?? hit);
      return { x, y, top };
    })()`);
    if (at?.top) throw new Error(`it's covered by ${at.top}`);
    return at;
  }

  /** Click the middle of the first visible element that `find` finds (see spot). */
  async clickOn(what, find, holdMs = 0) {
    const at = await this.until(`${what} on screen`, () => this.spot(find));
    await this.click(at.x, at.y, holdMs);
  }

  /** Type text into whatever has the keyboard. */
  type(text) {
    return this.send("Input.insertText", { text });
  }

  /** Press a key: "Enter" or "Escape". */
  async press(key) {
    const keys = { Enter: { code: "Enter", keyCode: 13, text: "\r" }, Escape: { code: "Escape", keyCode: 27 } };
    const k = keys[key];
    const base = { key, code: k.code, windowsVirtualKeyCode: k.keyCode, nativeVirtualKeyCode: k.keyCode };
    await this.send("Input.dispatchKeyEvent", { type: k.text ? "keyDown" : "rawKeyDown", ...base, ...(k.text ? { text: k.text } : {}) });
    await this.send("Input.dispatchKeyEvent", { type: "keyUp", ...base });
  }

  close() {
    this.#ws?.close();
  }
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
