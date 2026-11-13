/**
 * Host half of the "web companion" bundle.
 *
 * Responsibilities
 *  1. Own ONE persistent Chromium (Edge/Chrome) process whose profile directory lives under
 *     ~/.dsh/web-companion/profile, so a login performed once (DeepSeek / Doubao) survives
 *     restarts of DSH itself.
 *  2. Drive the Doubao web app over the Chrome DevTools Protocol (CDP): paste an image into the
 *     ProseMirror composer, submit a prompt, then read the assistant reply from the message list.
 *  3. Expose that capability to the harness as two tools:
 *       - `doubao_vision`     image -> Doubao -> recognised text
 *       - `web_companion`     status / open page / open login window
 *
 * No Electron API is required: the host plugin runs in the DSH host process (a plain Node
 * process) and talks to the browser exclusively over HTTP (127.0.0.1) + WebSocket.
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'

export const name = 'web-companion'
export const inject = ['tools']

const DEFAULTS = {
  /** Explicit browser executable. Empty means auto-detect Edge, then Chrome. */
  browserPath: '',
  /** Local CDP port; bound to 127.0.0.1 by the browser. */
  port: 9333,
  /** Persistent profile: cookies/localStorage live here and survive restarts. */
  profileDir: path.join(homedir(), '.dsh', 'web-companion', 'profile'),
  doubaoUrl: 'https://www.doubao.com/chat/',
  deepseekUrl: 'https://chat.deepseek.com/',
  /** Reply timeout for one Doubao answer. */
  replyTimeoutMs: 180_000,
  /** Keep the automation window off-screen instead of visible. Login needs a visible window. */
  hidden: true,
}

const CANDIDATE_BROWSERS = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  path.join(process.env.LOCALAPPDATA ?? '', 'Google/Chrome/Application/chrome.exe'),
]

/** Resolve the browser executable: config first, then env, then well-known Windows paths. */
function resolveBrowser (configured) {
  const candidates = [configured, process.env.DSH_COMPANION_BROWSER, ...CANDIDATE_BROWSERS]
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.length > 0 && existsSync(candidate)) return candidate
  }
  throw new Error(
    'web-companion: no Chromium-based browser found. Set "browserPath" in the plugin config ' +
    '(Edge or Chrome executable), or the DSH_COMPANION_BROWSER environment variable.',
  )
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** Minimal CDP client over the browser's per-target WebSocket. */
class CdpConnection {
  constructor (socket) {
    this.socket = socket
    this.nextId = 0
    this.pending = new Map()
    socket.addEventListener('message', (event) => {
      let message
      try { message = JSON.parse(event.data) } catch { return }
      const entry = this.pending.get(message.id)
      if (entry === undefined) return
      this.pending.delete(message.id)
      if (message.error !== undefined) entry.reject(new Error(JSON.stringify(message.error)))
      else entry.resolve(message.result)
    })
    socket.addEventListener('close', () => {
      for (const entry of this.pending.values()) entry.reject(new Error('CDP socket closed'))
      this.pending.clear()
    })
  }

  static async open (wsUrl) {
    const socket = new WebSocket(wsUrl)
    await new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve, { once: true })
      socket.addEventListener('error', () => reject(new Error(`cannot connect to ${wsUrl}`)), { once: true })
    })
    return new CdpConnection(socket)
  }

  send (method, params = {}) {
    const id = ++this.nextId
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.socket.send(JSON.stringify({ id, method, params }))
    })
  }

  /** Evaluate an expression in the page and return its JSON value. */
  async evaluate (expression, awaitPromise = false) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise,
      userGesture: true,
    })
    if (result.exceptionDetails !== undefined) {
      const detail = result.exceptionDetails.exception?.description ?? result.exceptionDetails.text
      throw new Error(`page script failed: ${detail}`)
    }
    return result.result?.value
  }

  close () {
    try { this.socket.close() } catch { /* already closed */ }
  }
}

/** One persistent browser instance shared by every tool call. */
class CompanionBrowser {
  constructor (config) {
    // Empty strings in the patch mean "use the default", not "override with nothing".
    const given = Object.fromEntries(Object.entries(config ?? {}).filter(([, value]) => value !== '' && value !== undefined))
    this.config = { ...DEFAULTS, ...given }
    this.child = undefined
    this.origin = `http://127.0.0.1:${this.config.port}`
  }

  async httpJson (route, init) {
    const response = await fetch(`${this.origin}${route}`, init)
    return response.json()
  }

  /** Minimise the automation window so it never competes with the user's foreground app. */
  async minimize () {
    const version = await this.probe()
    if (version === undefined) return
    const targets = await this.httpJson('/json/list')
    const page = targets.find((target) => target.type === 'page')
    if (page === undefined) return
    const cdp = await CdpConnection.open(version.webSocketDebuggerUrl)
    try {
      const { windowId } = await cdp.send('Browser.getWindowForTarget', { targetId: page.id })
      await cdp.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'minimized' } })
    } finally {
      cdp.close()
    }
  }

  /** The browser's version payload when its debug port answers, otherwise undefined. */
  async probe () {
    try { return await this.httpJson('/json/version') } catch { return undefined }
  }

  /** Close the whole browser through CDP (writes the profile back to disk on the way out). */
  async shutdown () {
    const version = await this.probe()
    if (version !== undefined) {
      try {
        const cdp = await CdpConnection.open(version.webSocketDebuggerUrl)
        await cdp.send('Browser.close').catch(() => {})
        cdp.close()
      } catch { /* already gone */ }
    }
    this.child = undefined
    this.visible = undefined
    await sleep(1200)
  }

  /**
   * Reuse a live browser when its debug port answers; otherwise launch a new one.
   * `{ visible: true }` guarantees a window the user can sign in on, relaunching an
   * off-screen instance when needed (the persistent profile survives the relaunch).
   */
  async ensure (options = {}) {
    const wantVisible = options.visible === true
    const running = await this.probe()
    if (running !== undefined) {
      if (!wantVisible || this.visible === true) return running
      await this.shutdown()
    }

    const executable = resolveBrowser(this.config.browserPath)
    mkdirSync(this.config.profileDir, { recursive: true })
    const args = [
      `--remote-debugging-port=${this.config.port}`,
      `--remote-debugging-address=127.0.0.1`,
      `--user-data-dir=${this.config.profileDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-blink-features=AutomationControlled',
      '--window-size=1180,900',
      'about:blank',
    ]
    const hidden = wantVisible ? false : this.config.hidden
    if (hidden) args.unshift('--window-position=-32000,-32000')

    this.child = spawn(executable, args, { detached: true, stdio: 'ignore', windowsHide: hidden })
    this.child.unref()
    this.visible = !hidden

    const deadline = Date.now() + 30_000
    while (Date.now() < deadline) {
      const version = await this.probe()
      if (version !== undefined) {
        if (hidden) await this.minimize().catch(() => {})
        return version
      }
      await sleep(400)
    }
    throw new Error(
      `web-companion: the browser did not expose its debug port ${this.config.port}. ` +
      'Another instance may be using that profile/port; close it and retry.',
    )
  }

  /** Find an existing page for an origin, else create one. Returns its CDP WebSocket URL. */
  async pageFor (url) {
    const origin = new URL(url).origin
    const targets = await this.httpJson('/json/list')
    const existing = targets.find((target) => target.type === 'page' && target.url.startsWith(origin))
    if (existing !== undefined) return existing.webSocketDebuggerUrl
    const created = await this.httpJson(`/json/new?${encodeURIComponent(url)}`, { method: 'PUT' })
    return created.webSocketDebuggerUrl
  }

  /** Wait until `probe` (page expression) returns truthy. */
  async waitFor (cdp, probe, timeoutMs, label) {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      try {
        if (await cdp.evaluate(probe) === true) return
      } catch { /* page still navigating */ }
      await sleep(500)
    }
    throw new Error(`web-companion: timed out waiting for ${label}`)
  }

  /**
   * Send one image to Doubao web and return the assistant's answer text.
   * @param {string} imageBase64 raw base64 (no data: prefix)
   * @param {string} mime e.g. image/png
   * @param {string} prompt instruction sent together with the image
   */
  async recognize (imageBase64, mime, prompt) {
    await this.ensure()
    const wsUrl = await this.pageFor(this.config.doubaoUrl)
    const cdp = await CdpConnection.open(wsUrl)
    try {
      await cdp.send('Page.enable')
      await cdp.send('Page.bringToFront')
      const current = await cdp.evaluate('location.href')
      // Always land on the canonical chat entry: a restored conversation would make the
      // pre-send baseline stale (its last answer is still on screen).
      if (current !== this.config.doubaoUrl) {
        await cdp.send('Page.navigate', { url: this.config.doubaoUrl })
      }
      await this.waitFor(cdp, `document.querySelector('[contenteditable="true"]') !== null`, 45_000, 'the Doubao composer')

      // Let the turn list settle before measuring it, so late-restored messages are not
      // mistaken for the answer to the message we are about to send.
      const baselineProbe = `(() => {
        const replyText = ${REPLY_TEXT_FN};
        const turns = [...document.querySelectorAll('[data-testid=union_message]')];
        const last = turns[turns.length - 1];
        const reply = last ? last.querySelector('[data-testid=receive_message]') : null;
        return { count: turns.length, text: replyText(reply) };
      })()`
      let settled = await cdp.evaluate(baselineProbe)
      for (let i = 0; i < 12; i++) {
        await sleep(400)
        const next = await cdp.evaluate(baselineProbe)
        if (next.count === settled.count && next.text === settled.text) { settled = next; break }
        settled = next
      }
      const turnsBefore = settled.count
      const baselineText = settled.text

      // The composer is a ProseMirror editor; a synthetic paste carrying a File is the
      // supported way to attach an image without a native file chooser.
      await cdp.evaluate(`(() => { globalThis.__wcChunks = []; return true })()`)
      for (let offset = 0; offset < imageBase64.length; offset += 200_000) {
        const chunk = imageBase64.slice(offset, offset + 200_000)
        await cdp.evaluate(`globalThis.__wcChunks.push(${JSON.stringify(chunk)})`)
      }
      const pasted = await cdp.evaluate(`(async () => {
        const editor = document.querySelector('[contenteditable="true"]');
        editor.focus();
        const base64 = globalThis.__wcChunks.join('');
        globalThis.__wcChunks = [];
        const blob = await (await fetch('data:${mime};base64,' + base64)).blob();
        const file = new File([blob], 'image.${mime.split('/')[1] ?? 'png'}', { type: '${mime}' });
        const data = new DataTransfer();
        data.items.add(file);
        editor.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
        return data.files.length;
      })()`, true)
      if (pasted !== 1) throw new Error('web-companion: the browser refused the synthetic paste payload')

      await sleep(1500)
      await cdp.evaluate(`document.querySelector('[contenteditable="true"]').focus()`)
      await cdp.send('Input.insertText', { text: prompt })
      await sleep(300)
      for (const type of ['keyDown', 'keyUp']) {
        await cdp.send('Input.dispatchKeyEvent', {
          type, key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13,
        })
      }

      // Wait for the turn list to grow and the newest assistant bubble to stop changing.
      const deadline = Date.now() + this.config.replyTimeoutMs
      let previous = ''
      let stable = 0
      while (Date.now() < deadline) {
        await sleep(1200)
        const snapshot = await cdp.evaluate(`(() => {
          const replyText = ${REPLY_TEXT_FN};
          const turns = [...document.querySelectorAll('[data-testid=union_message]')];
          if (turns.length <= ${turnsBefore}) return { grew: false, text: '', login: /扫码登录|请先登录|登录后即可/.test(document.body.innerText) };
          const turn = turns[turns.length - 1];
          return { grew: true, text: replyText(turn.querySelector('[data-testid=receive_message]')), login: false };
        })()`)
        if (snapshot?.login === true) {
          throw new Error('web-companion: Doubao asks for a login. Open the `web_companion` tool with action "login" and sign in once.')
        }
        if (snapshot?.grew !== true || snapshot.text.length === 0) continue
        // Same text as before the send means this is still the previous answer on screen.
        if (snapshot.text === baselineText) continue
        if (snapshot.text === previous) {
          stable += 1
          if (stable >= 1) return snapshot.text
        } else {
          previous = snapshot.text
          stable = 0
        }
      }
      throw new Error('web-companion: Doubao did not finish answering before the timeout')
    } finally {
      cdp.close()
    }
  }

  /** Open (or focus) a page and return the URL that is now loaded. */
  async openPage (url) {
    await this.ensure()
    const wsUrl = await this.pageFor(url)
    const cdp = await CdpConnection.open(wsUrl)
    try {
      await cdp.send('Page.enable')
      await cdp.send('Page.bringToFront')
      const current = await cdp.evaluate('location.href')
      if (current !== url) await cdp.send('Page.navigate', { url })
      return url
    } finally {
      cdp.close()
    }
  }

  async status () {
    try {
      const version = await this.httpJson('/json/version')
      const pages = await this.httpJson('/json/list')
      return {
        running: true,
        browser: version.Browser,
        profileDir: this.config.profileDir,
        profileExists: existsSync(this.config.profileDir),
        pages: pages.filter((page) => page.type === 'page').map((page) => page.url),
      }
    } catch {
      return { running: false, profileDir: this.config.profileDir, profileExists: existsSync(this.config.profileDir), pages: [] }
    }
  }
}

/**
 * Page-side helper embedded into two probes: the reply bubble's own text, excluding the
 * code-card header ("已生成代码") and any nested code block chrome.
 */
const REPLY_TEXT_FN = `(root) => {
  if (!root) return '';
  return [...root.querySelectorAll('[data-testid=message_text_content]')]
    .filter((node) => node.closest('[data-testid=code-bar]') === null)
    .map((node) => (node.innerText || '').trim())
    .filter(Boolean)
    .join('\\n\\n');
}`

/** Read an image from disk or accept inline base64, and normalise both to base64 + mime. */
function readImage (args) {
  if (typeof args.imageBase64 === 'string' && args.imageBase64.length > 0) {
    const match = /^data:([^;]+);base64,(.*)$/s.exec(args.imageBase64)
    if (match !== null) return { base64: match[2], mime: match[1] }
    return { base64: args.imageBase64, mime: args.mime ?? 'image/png' }
  }
  if (typeof args.image_path === 'string' && args.image_path.length > 0) {
    const file = path.resolve(args.image_path)
    if (!existsSync(file)) throw new Error(`web-companion: image not found: ${file}`)
    const bytes = readFileSync(file)
    const ext = path.extname(file).toLowerCase()
    const mime = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : ext === '.webp' ? 'image/webp' : 'image/png'
    return { base64: bytes.toString('base64'), mime }
  }
  throw new Error('web-companion: pass either image_path or imageBase64')
}

const DEFAULT_PROMPT =
  '请仔细识别这张图片：先逐字抄录图中所有可读文字，再用中文简要描述关键视觉信息（对象、颜色、布局）。'

export function apply (ctx, config = {}) {
  const browser = new CompanionBrowser(config)

  // Close our CDP sockets when the plugin row is disposed. The browser process itself keeps
  // running so the persisted profile (and therefore the login) is not disturbed.
  ctx.on('dispose', () => { browser.child = undefined })

  // A tiny loopback HTTP face so the Web UI can drive the persistent browser directly.
  // The sidebar panel cannot reach Host tools, but it can reach the same origin it is served from.
  // `inject` waits for the carrier to exist, so the route also appears when this plugin loads
  // before the web server (a restart otherwise silently loses it).
  ctx.inject(['webServer'], (scope) => {
    const webServer = scope.webServer
    const originAllowed = (req) => {
      const origin = req.headers.origin
      // Same-origin fetches send no Origin; file:// pages send "null".
      if (origin === undefined || origin === 'null') return true
      try {
        const { hostname } = new URL(origin)
        return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '::1'
      } catch { return false }
    }
    const reply = (req, res, status, body) => {
      res.writeHead(status, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
        'access-control-allow-origin': req.headers.origin ?? '*',
        'access-control-allow-methods': 'GET, OPTIONS',
      })
      res.end(JSON.stringify(body))
    }
    ctx.effect(() => webServer.register({
      kind: 'prefix',
      path: '/dsh-companion',
      handler: async (req, res) => {
        if (!originAllowed(req)) return reply(req, res, 403, { ok: false, error: 'origin not allowed' })
        if (req.method === 'OPTIONS') return reply(req, res, 204, {})
        const url = new URL(req.url ?? '/', 'http://127.0.0.1')
        try {
          if (url.pathname === '/dsh-companion/status') {
            return reply(req, res, 200, { ok: true, ...(await browser.status()) })
          }
          if (url.pathname === '/dsh-companion/open') {
            const target = url.searchParams.get('target') === 'deepseek' ? 'deepseek' : 'doubao'
            const explicit = url.searchParams.get('url')
            const page = explicit !== null && explicit.length > 0
              ? explicit
              : target === 'deepseek' ? browser.config.deepseekUrl : browser.config.doubaoUrl
            await browser.ensure()
            await browser.openPage(page)
            return reply(req, res, 200, { ok: true, url: page })
          }
          return reply(req, res, 404, { ok: false, error: 'unknown companion route' })
        } catch (error) {
          return reply(req, res, 502, { ok: false, error: String(error?.message ?? error) })
        }
      },
    }), 'web-companion: loopback route')
  })

  ctx.tools.register({
    name: 'doubao_vision',
    description:
      'Recognise an image with the signed-in Doubao web app (网页版豆包) and return its answer text. ' +
      'Use it when the user uploads a picture and asks what it contains, or when reading text inside an image ' +
      'requires a strong vision model. The browser profile is persistent, so one manual login lasts.',
    parameters: {
      type: 'object',
      properties: {
        image_path: {
          type: 'string',
          description: 'Absolute path of a local image file (png/jpg/webp).',
        },
        imageBase64: {
          type: 'string',
          description: 'Raw base64 or a full data: URL of the image, when no file path is available.',
        },
        mime: {
          type: 'string',
          description: 'Media type for imageBase64, default image/png.',
        },
        prompt: {
          type: 'string',
          description: 'Instruction sent with the image. Defaults to a transcription + description prompt.',
        },
      },
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          text: { type: 'string' },
          source: { type: 'string' },
        },
        required: ['text', 'source'],
      },
      render: (args, value) => [{ type: 'text', text: value.text }],
    },
    presentCall: (args) => ({
      card: 'generic',
      title: 'Recognise image with Doubao',
      kind: 'other',
      rawInput: args.image_path ?? '(inline image)',
    }),
    async execute (args) {
      const image = readImage(args)
      const prompt = typeof args.prompt === 'string' && args.prompt.length > 0 ? args.prompt : DEFAULT_PROMPT
      const text = await browser.recognize(image.base64, image.mime, prompt)
      return { text, source: 'doubao-web' }
    },
  })

  ctx.tools.register({
    name: 'web_companion',
    description:
      'Manage the shared persistent browser used for the DeepSeek and Doubao web apps. ' +
      'action="status" reports the browser and profile; action="open" opens a URL in that browser; ' +
      'action="login" opens the Doubao (or DeepSeek) sign-in page so the user can log in once.',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', description: 'status | open | login' },
        target: { type: 'string', description: 'doubao (default) or deepseek' },
        url: { type: 'string', description: 'Explicit URL for action="open".' },
      },
      required: ['action'],
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          summary: { type: 'string' },
          detail: { type: 'object' },
        },
        required: ['summary'],
      },
      render: (args, value) => [{ type: 'text', text: value.summary }],
    },
    presentCall: (args) => ({
      card: 'generic',
      title: 'Web companion',
      kind: 'other',
      rawInput: args.action,
    }),
    async execute (args) {
      const target = args.target === 'deepseek' ? 'deepseek' : 'doubao'
      if (args.action === 'status') {
        const detail = await browser.status()
        const mode = browser.config.hidden === true ? 'off-screen' : 'visible'
        const summary = detail.running === true
          ? `Persistent browser is running (${detail.browser}, ${mode} window); profile: ${detail.profileDir}. Open pages: ${detail.pages.join(', ') || 'none'}.`
          : `Persistent browser is not running yet (${mode} window when started); profile: ${detail.profileDir}.`
        return { summary, detail }
      }
      if (args.action === 'open') {
        const url = typeof args.url === 'string' && args.url.length > 0
          ? args.url
          : target === 'deepseek' ? browser.config.deepseekUrl : browser.config.doubaoUrl
        await browser.openPage(url)
        return { summary: `Opened ${url} in the persistent browser.`, detail: { url } }
      }
      if (args.action === 'login') {
        const url = target === 'deepseek' ? browser.config.deepseekUrl : browser.config.doubaoUrl
        // Signing in needs a real window, so this action deliberately relaunches it visibly.
        await browser.ensure({ visible: true })
        await browser.openPage(url)
        return {
          summary: `Opened ${url} in a visible window. Sign in there once — the profile at ${browser.config.profileDir} keeps the session for later calls, which then run off-screen again.`,
          detail: { url },
        }
      }
      throw new Error(`web-companion: unknown action "${args.action}"`)
    },
  })
}
