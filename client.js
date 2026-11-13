/**
 * Client half of the "web companion" bundle.
 *
 * Registers a right-sidebar tab type `web-companion` plus a small entry button under the
 * composer, so the panel is reachable without a command palette entry.
 *
 * The panel itself is a launch board: DeepSeek and Doubao are embedded through the shipped
 * Browser tab type, because chat.deepseek.com sends `frame-ancestors 'none'` and therefore
 * refuses a plain <iframe>; the Browser tab uses an Electron <webview> (Desktop) or a sandboxed
 * iframe (Web) which bypasses that refusal on Desktop.
 */
window.__ModuleLoader__.load({
  id: '@local/dsh-web-companion',
  factory (require) {
    const React = require('react')
    const h = React.createElement

    const TAB_KIND = 'web-companion'
    const DEEPSEEK_URL = 'https://chat.deepseek.com/'
    const DOUBAO_URL = 'https://www.doubao.com/chat/'

    /** Official brand marks: each site's own published favicon asset, inlined as a data URI. */
    const LOGOS = {
      deepseek: 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNTAuMDAwMDAwIiBoZWlnaHQ9IjUwLjAwMDAwMCIgdmlld0JveD0iMCAwIDUwIDUwIiBmaWxsPSJub25lIiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciCgl4bWxuczp4bGluaz0iaHR0cDovL3d3dy53My5vcmcvMTk5OS94bGluayI+Cgk8cGF0aCBpZD0icGF0aCIKCQlkPSJNNDguODM1NCAxMC4wNDc5QzQ4LjMyMzIgOS43OTE5OSA0OC4xMDI1IDEwLjI3OTggNDcuODAzMiAxMC41Mjc4QzQ3LjcwMDcgMTAuNjA3OSA0Ny42MTQzIDEwLjcxMTkgNDcuNTI3MyAxMC44MDc2QzQ2Ljc3OTMgMTEuNjI0IDQ1LjkwNDggMTIuMTU5NyA0NC43NjIyIDEyLjA5NTdDNDMuMDkyMyAxMiA0MS42NjYgMTIuNTM1NiA0MC40MDU4IDEzLjgzOThDNDAuMTM3NyAxMi4yMzE5IDM5LjI0NzYgMTEuMjcyIDM3Ljg5MjYgMTAuNjU1OEMzNy4xODM2IDEwLjMzNTkgMzYuNDY2OCAxMC4wMTU2IDM1Ljk3MDIgOS4zMTk4MkMzNS42MjM1IDguODIzNzMgMzUuNTI5MyA4LjI3MTk3IDM1LjM1NiA3LjcyNzU0QzM1LjI0NTYgNy4zOTk5IDM1LjEzNTMgNy4wNjM5NiAzNC43NjUxIDcuMDA3ODFDMzQuMzYzMyA2Ljk0Mzg1IDM0LjIwNTYgNy4yODc2IDM0LjA0NzkgNy41NzU2OEMzMy40MTggOC43NTE5NSAzMy4xNzMzIDEwLjA0NzkgMzMuMTk3MyAxMS4zNTk5QzMzLjI1MjQgMTQuMzEyIDM0LjQ3MzYgMTYuNjY0MSAzNi44OTk5IDE4LjMzNTlDMzcuMTc1OCAxOC41Mjc4IDM3LjI0NjYgMTguNzE5NyAzNy4xNTk3IDE5QzM2Ljk5NDYgMTkuNTc1NyAzNi43OTc0IDIwLjEzNTcgMzYuNjI0IDIwLjcxMTlDMzYuNTEzNyAyMS4wODAxIDM2LjM0ODYgMjEuMTU5NyAzNS45NjI0IDIxQzM0LjYzMDkgMjAuNDMyMSAzMy40ODEgMTkuNTkxOCAzMi40NjQ0IDE4LjU3NTdDMzAuNzM5MyAxNi44NzIxIDI5LjE3OTIgMTQuOTkxNyAyNy4yMzM0IDEzLjUyQzI2Ljc3NjQgMTMuMTc1OCAyNi4zMTkzIDEyLjg1NiAyNS44NDY3IDEyLjU1MThDMjMuODYxOCAxMC41ODQgMjYuMTA2OSA4Ljk2Nzc3IDI2LjYyNyA4Ljc3NTg4QzI3LjE3MDQgOC41NzU2OCAyNi44MTU5IDcuODg3NyAyNS4wNTkxIDcuODk2QzIzLjMwMjIgNy45MDM4MSAyMS42OTUzIDguNTAzOTEgMTkuNjQ3IDkuMzAzNzFDMTkuMzQ3NyA5LjQyMzgzIDE5LjAzMjIgOS41MTE3MiAxOC43MDk1IDkuNTgzOThDMTYuODUwMSA5LjIyMzYzIDE0LjkxOTkgOS4xNDM1NSAxMi45MDMzIDkuMzc1OThDOS4xMDU5NiA5LjgwNzYyIDYuMDcyNzUgMTEuNjM5NiAzLjg0MzI2IDE0Ljc2ODFDMS4xNjQ1NSAxOC41Mjc4IDAuNTM0MTggMjIuNzk5OCAxLjMwNjY0IDI3LjI1NTlDMi4xMTc2OCAzMS45NTIxIDQuNDY1ODIgMzUuODM5OCA4LjA3MzczIDM4Ljg3OTlDMTEuODE1OSA0Mi4wMzIyIDE2LjEyNTUgNDMuNTc2MiAyMS4wNDEgNDMuMjgwM0MyNC4wMjY5IDQzLjEwNCAyNy4zNTE2IDQyLjY5NjMgMzEuMTAxNiAzOS40NTYxQzMyLjA0NjkgMzkuOTM2IDMzLjAzOTYgNDAuMTI3OSAzNC42ODYgNDAuMjcyQzM1Ljk1NDYgNDAuMzkyMSAzNy4xNzU4IDQwLjIwOCAzOC4xMjExIDQwLjAwNzhDMzkuNjAyMSAzOS42ODggMzkuNDk5NSAzOC4yODgxIDM4Ljk2MzkgMzguMDMyMkMzNC42MjMgMzUuOTY3OCAzNS41NzYyIDM2LjgwODEgMzQuNzEgMzYuMTI3OUMzNi45MTU1IDMzLjQ2MzkgNDAuMjQwMiAzMC42OTU4IDQxLjU0IDIxLjcyOEM0MS42NDI2IDIxLjAxNjEgNDEuNTU1NyAyMC41Njc5IDQxLjU0IDE5Ljk5MTdDNDEuNTMyMiAxOS42Mzk2IDQxLjYxMDggMTkuNTAzOSA0Mi4wMDQ5IDE5LjQ2MzlDNDMuMDkyMyAxOS4zMzU5IDQ0LjE0NzkgMTkuMDMxNyA0NS4xMTY3IDE4LjQ4NzhDNDcuOTI5MiAxNi45MTk5IDQ5LjA2NCAxNC4zNDM4IDQ5LjMzMTUgMTEuMjU1OUM0OS4zNzExIDEwLjc4MzcgNDkuMzIzNyAxMC4yOTU5IDQ4LjgzNTQgMTAuMDQ3OVpNMjQuMzI2MiAzNy44Mzk4QzIwLjExOTYgMzQuNDYzOSAxOC4wNzkxIDMzLjM1MjEgMTcuMjM1OCAzMy4zOTk5QzE2LjQ0ODIgMzMuNDQ4MiAxNi41ODk4IDM0LjM2ODIgMTYuNzYzMiAzNC45Njc4QzE2Ljk0NDMgMzUuNTYwMSAxNy4xODEyIDM1Ljk2ODMgMTcuNTExNyAzNi40ODc4QzE3Ljc0MDIgMzYuODMyIDE3Ljg5NzkgMzcuMzQ0MiAxNy4yODMyIDM3LjcyOEMxNS45MjgyIDM4LjU4NCAxMy41NzI4IDM3LjQzOTkgMTMuNDYyNCAzNy4zODM4QzEwLjcyMDcgMzUuNzM1OCA4LjQyODIyIDMzLjU2MDEgNi44MTM0OCAzMC41ODRDNS4yNTM0MiAyNy43MTk3IDQuMzQ3NjYgMjQuNjQ3OSA0LjE5Nzc1IDIxLjM2NzdDNC4xNTgyIDIwLjU3NTcgNC4zODY3MiAyMC4yOTU5IDUuMTU4NjkgMjAuMTUxOUM2LjE3NTI5IDE5Ljk2IDcuMjIzMTQgMTkuOTE5OSA4LjIzOTI2IDIwLjA3MThDMTIuNTMyNyAyMC43MTE5IDE2LjE4ODUgMjIuNjcxOSAxOS4yNTI5IDI1Ljc3NTlDMjEuMDAyIDI3LjU0MzkgMjIuMzI1MiAyOS42NTU4IDIzLjY4ODUgMzEuNzIwMkMyNS4xMzc3IDMzLjkxMjEgMjYuNjk3OCAzNiAyOC42ODMxIDM3LjcxMTlDMjkuMzg0MyAzOC4zMTIgMjkuOTQzNCAzOC43NjgxIDMwLjQ3OSAzOS4xMDRDMjguODY0MyAzOS4yODgxIDI2LjE2OTkgMzkuMzI4MSAyNC4zMjYyIDM3LjgzOThaTTI2LjM0MzMgMjQuNjAwMUMyNi4zNDMzIDI0LjI0OCAyNi42MTkxIDIzLjk2NzggMjYuOTY1OCAyMy45Njc4QzI3LjA0NDQgMjMuOTY3OCAyNy4xMTUyIDIzLjk4MzkgMjcuMTc4MiAyNC4wMDc4QzI3LjI2NTEgMjQuMDQgMjcuMzQzOCAyNC4wODc5IDI3LjQwNjcgMjQuMTYwMkMyNy41MTcxIDI0LjI3MiAyNy41ODAxIDI0LjQzMjEgMjcuNTgwMSAyNC42MDAxQzI3LjU4MDEgMjQuOTUyMSAyNy4zMDQyIDI1LjIzMTkgMjYuOTU3NSAyNS4yMzE5QzI2LjYxMDggMjUuMjMxOSAyNi4zNDMzIDI0Ljk1MjEgMjYuMzQzMyAyNC42MDAxWk0zMi42MDY0IDI3Ljg3OTlDMzIuMjA0NiAyOC4wNDc5IDMxLjgwMjcgMjguMTkxOSAzMS40MTY1IDI4LjIwOEMzMC44MTc5IDI4LjIzOTcgMzAuMTY0MSAyNy45OTIyIDI5LjgwOTYgMjcuNjg4QzI5LjI1ODMgMjcuMjE1OCAyOC44NjQzIDI2Ljk1MjEgMjguNjk4NyAyNi4xMjc5QzI4LjYyNzkgMjUuNzc1OSAyOC42Njc1IDI1LjIzMTkgMjguNzMwNSAyNC45MTk5QzI4Ljg3MjEgMjQuMjQ4IDI4LjcxNDQgMjMuODE1OSAyOC4yNDk1IDIzLjQyMzhDMjcuODcxNiAyMy4xMDQgMjcuMzkxMSAyMy4wMTYxIDI2Ljg2MzMgMjMuMDE2MUMyNi42NjYgMjMuMDE2MSAyNi40ODQ5IDIyLjkyNzcgMjYuMzUxMSAyMi44NTZDMjYuMTMwNCAyMi43NDQxIDI1Ljk0OTIgMjIuNDYzOSAyNi4xMjI2IDIyLjEyMDFDMjYuMTc3NyAyMi4wMDc4IDI2LjQ0NTggMjEuNzM1OCAyNi41MDg4IDIxLjY4OEMyNy4yMjU2IDIxLjI3MiAyOC4wNTI3IDIxLjQwNzcgMjguODE2OSAyMS43MTk3QzI5LjUyNTkgMjIuMDE2MSAzMC4wNjE1IDIyLjU2MDEgMzAuODM0IDIzLjMyODFDMzEuNjIxNiAyNC4yNTU5IDMxLjc2MzIgMjQuNTExNyAzMi4yMTI0IDI1LjIwOEMzMi41NjY5IDI1Ljc1MiAzMi44OTAxIDI2LjMxMiAzMy4xMTA0IDI2Ljk1MjFDMzMuMjQ0NiAyNy4zNTIxIDMzLjA3MTMgMjcuNjgwMiAzMi42MDY0IDI3Ljg3OTlaIgoJCWZpbGw9IiM0RDZCRkUiIGZpbGwtb3BhY2l0eT0iMS4wMDAwMDAiIGZpbGwtcnVsZT0ibm9uemVybyIgLz4KPC9zdmc+',
      doubao: 'data:image/png;base64,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',
    }

    const zh = {
      'tab.title': '网页助手',
      'panel.title': 'DeepSeek / 豆包 网页助手',
      'panel.subtitle': '在侧边栏中使用网页版 DeepSeek 提问，并让 Harness 读取网页版豆包的识图结果。',
      'action.deepseek': '在侧边栏打开 DeepSeek',
      'action.doubao': '在侧边栏打开豆包',
      'action.hint': '两个网页都在插件自管的持久化浏览器里打开：登录一次，重启 Harness 也不用再登录。',
      'notice.persistent': '已在持久浏览器中打开（登录一次后长期有效）。',
      'notice.sidebar': '持久浏览器不可用，已改用侧边栏标签页打开（重启后需要重新登录）。',
      'vision.title': '豆包识图（由 Harness 调用）',
      'vision.body': '上传图片后直接对 Harness 说“用豆包识别这张图”，模型会调用 doubao_vision 工具：插件把图片粘贴进已登录的豆包网页、读取回复文本，再作为工具结果返回对话。',
      'vision.example': '示例：先用 Harness 的附件按钮上传图片，再输入“用豆包识别这张图里的文字”。',
      'note.title': '说明',
      'note.item1': 'DeepSeek 网页禁止被 iframe 嵌入（CSP frame-ancestors none），因此通过浏览器标签内嵌，而不是直接挂 iframe。',
      'note.item2': '插件使用一个独立的持久化浏览器配置目录，登录状态不随 Harness 重启丢失。',
      'note.item3': '首次使用请在弹出的浏览器窗口里完成一次登录；之后的识图调用复用该会话。',
      'entry.label': '网页助手',
      'entry.deepseek': 'DeepSeek',
      'entry.doubao': '豆包',
      'entry.titleDeepseek': '一键在持久浏览器中打开网页版 DeepSeek（登录一次长期有效）',
      'entry.titleDoubao': '一键在持久浏览器中打开网页版豆包（登录一次长期有效）',
      'entry.titleClose': '收起网页助手面板',
      'error.noTarget': '请先在会话中打开右侧栏，再使用该按钮。',
    }
    const en = {
      'tab.title': 'Web companion',
      'panel.title': 'DeepSeek / Doubao web companion',
      'panel.subtitle': 'Ask the DeepSeek web app from the sidebar and let the harness read Doubao vision results.',
      'action.deepseek': 'Open DeepSeek in the sidebar',
      'action.doubao': 'Open Doubao in the sidebar',
      'action.hint': 'Both pages open in the plugin-owned persistent browser: sign in once, and restarts keep the session.',
      'notice.persistent': 'Opened in the persistent browser (the login survives restarts).',
      'notice.sidebar': 'Persistent browser unavailable — opened as a sidebar tab instead (sign-in again after restart).',
      'vision.title': 'Doubao vision (driven by the harness)',
      'vision.body': 'After you attach an image, ask the harness to “recognise this image with Doubao”. The model calls the doubao_vision tool; the plugin pastes the image into the signed-in Doubao page, reads the reply, and returns it as the tool result.',
      'vision.example': 'Example: attach the image with the composer button, then type “use Doubao to read the text in this image”.',
      'note.title': 'Notes',
      'note.item1': 'chat.deepseek.com refuses iframe embedding (CSP frame-ancestors none), so it is hosted in a Browser tab instead.',
      'note.item2': 'The plugin keeps its own persistent browser profile, so the login survives Harness restarts.',
      'note.item3': 'Sign in once in the browser window that opens; later vision calls reuse that session.',
      'entry.label': 'Web companion',
      'entry.deepseek': 'DeepSeek',
      'entry.doubao': 'Doubao',
      'entry.titleDeepseek': 'Open the DeepSeek web app in the persistent browser (one sign-in, kept across restarts)',
      'entry.titleDoubao': 'Open the Doubao web app in the persistent browser (one sign-in, kept across restarts)',
      'entry.titleClose': 'Collapse the web companion pane',
      'error.noTarget': 'Open a session and its right sidebar first.',
    }

    /** Open a right-sidebar tab of `kind`, preferring the public service call. */
    function openTab (ctx, element, kind, url) {
      const right = ctx.sidebarRight
      const options = url === undefined ? {} : { params: { url } }
      try {
        right.openTab(kind, options)
        return true
      } catch { /* no ambient tab target — fall back to the element form */ }
      const target = element === null || element === undefined ? undefined : right.commandTarget(element)
      if (target === undefined) return false
      try {
        right.openTabFromTarget(kind, target)
        return true
      } catch {
        return false
      }
    }

    /** Official brand mark for a target, rendered at the sidebar/panel icon size. */
    function BrandLogo ({ target, size }) {
      return h('img', {
        src: LOGOS[target],
        alt: '',
        'aria-hidden': true,
        width: size,
        height: size,
        style: {
          display: 'block',
          width: size,
          height: size,
          objectFit: 'contain',
          borderRadius: target === 'doubao' ? Math.round(size / 5) : 0,
        },
      })
    }

    function ActionButton ({ label, logo, onClick }) {
      return h('button', {
        type: 'button',
        onClick,
        style: {
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          padding: '6px 12px',
          marginRight: 8,
          borderRadius: 8,
          border: '1px solid rgba(127,127,127,0.35)',
          background: 'transparent',
          color: 'inherit',
          font: 'inherit',
          cursor: 'pointer',
        },
      }, logo === undefined ? null : h(BrandLogo, { target: logo, size: 16 }), label)
    }

    function Section ({ title, children }) {
      return h('section', { style: { marginTop: 18 } },
        h('h4', { style: { margin: '0 0 8px', fontSize: 13, fontWeight: 600, opacity: 0.9 } }, title),
        children)
    }

    function Panel (props) {
      const t = props.t
      const [notice, setNotice] = React.useState('')
      const open = (target, url) => async (event) => {
        // Default: the plugin's persistent browser, where the login survives restarts.
        try {
          await openPersistent(target)
          setNotice(t('notice.persistent'))
          return
        } catch { /* host route unavailable — fall back to the sidebar Browser tab */ }
        const ok = openTab(props.ctx, event.currentTarget, 'browser', url)
        setNotice(ok ? t('notice.sidebar') : t('error.noTarget'))
      }
      const paragraph = { margin: '0 0 8px', fontSize: 13, lineHeight: 1.6, opacity: 0.85 }
      return h('div', {
        style: {
          boxSizing: 'border-box',
          height: '100%',
          overflow: 'auto',
          padding: '16px 18px 24px',
          font: 'inherit',
        },
      },
      h('h3', { style: { margin: '0 0 6px', fontSize: 15, fontWeight: 600 } }, t('panel.title')),
      h('p', { style: paragraph }, t('panel.subtitle')),
      h(Section, { title: t('action.hint') },
        h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 8 } },
          h(ActionButton, { label: t('action.deepseek'), logo: 'deepseek', onClick: open('deepseek', DEEPSEEK_URL) }),
          h(ActionButton, { label: t('action.doubao'), logo: 'doubao', onClick: open('doubao', DOUBAO_URL) })),
        notice === '' ? null : h('p', { style: { ...paragraph, marginTop: 8, color: '#d97706' } }, notice)),
      h(Section, { title: t('vision.title') },
        h('p', { style: paragraph }, t('vision.body')),
        h('p', { style: { ...paragraph, opacity: 0.7 } }, t('vision.example'))),
      h(Section, { title: t('note.title') },
        h('ul', { style: { margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.7, opacity: 0.8 } },
          h('li', null, t('note.item1')),
          h('li', null, t('note.item2')),
          h('li', null, t('note.item3')))))
    }

    /** Ask the host to open a page in the persistent browser (login survives restarts). */
    async function openPersistent (target) {
      const response = await fetch(`/dsh-companion/open?target=${encodeURIComponent(target)}`)
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const body = await response.json()
      if (body.ok !== true) throw new Error(body.error ?? 'open failed')
      return body.url
    }

    /** One-click entry in the sidebar toolbar for one web app; both share the same browser. */
    function CompanionFooterButton (props) {
      const t = props.t
      const ctx = props.ctx
      const wide = props.wide !== false
      const target = props.target === 'doubao' ? 'doubao' : 'deepseek'
      const meta = target === 'doubao'
        ? { label: t('entry.doubao'), title: t('entry.titleDoubao'), url: DOUBAO_URL }
        : { label: t('entry.deepseek'), title: t('entry.titleDeepseek'), url: DEEPSEEK_URL }
      const run = async (event) => {
        // Primary action: the plugin's persistent browser, which works with or without a
        // Session and keeps the login across restarts.
        try { await openPersistent(target); return } catch { /* route unreachable */ }
        const right = ctx.sidebarRight
        try { right.openTab(TAB_KIND); return } catch { /* no mounted sidebar surface */ }
        openTab(ctx, event.currentTarget, 'browser', meta.url)
      }
      return h('button', {
        type: 'button',
        title: meta.title,
        onClick: run,
        style: {
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 6,
          height: 28,
          minWidth: wide ? undefined : 28,
          padding: wide ? '0 9px' : 0,
          borderRadius: 8,
          border: '1px solid rgba(127,127,127,0.3)',
          background: 'transparent',
          color: 'inherit',
          font: 'inherit',
          fontSize: 12,
          lineHeight: 1,
          cursor: 'pointer',
        },
      }, h(BrandLogo, { target, size: 16 }), wide ? meta.label : null)
    }

    return {
      inject: ['slots', 'locale', 'sidebarRight', 'sidebarRightTabs'],
      apply (ctx) {
        const namespace = 'webCompanion'
        const t = ctx.locale.bind(namespace)
        ctx.effect(() => ctx.locale.register(namespace, { zh, en }), 'web-companion: copy')

        ctx.effect(() => ctx.sidebarRightTabs.register({
          id: TAB_KIND,
          kind: TAB_KIND,
          multiple: true,
          title: () => t('tab.title'),
          // A card in the right sidebar's "start" tab, so the panel stays reachable.
          guide: [{ id: 'open', order: 20, title: () => t('entry.label'), description: () => t('panel.subtitle') }],
        }), 'web-companion: tab type')

        ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
          name: 'sidebar.right.pane.tab',
          key: TAB_KIND,
          locale: namespace,
        }, (props) => h(Panel, { ...props, t, ctx }))), 'web-companion: tab body')

        // Root-scoped seat, so the entry also exists on the new-conversation screen, where no
        // Session (and therefore no right sidebar) is mounted yet.
        ctx.effect(() => ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
          name: 'sidebar.footer.action',
          id: 'web-companion-deepseek',
          order: 10,
          locale: namespace,
          label: () => t('entry.deepseek'),
        }, (props) => h(CompanionFooterButton, { ...props, t, ctx, target: 'deepseek' }))), 'web-companion: deepseek entry')

        ctx.effect(() => ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
          name: 'sidebar.footer.action',
          id: 'web-companion-doubao',
          order: 11,
          locale: namespace,
          label: () => t('entry.doubao'),
        }, (props) => h(CompanionFooterButton, { ...props, t, ctx, target: 'doubao' }))), 'web-companion: doubao entry')
      },
    }
  },
})
