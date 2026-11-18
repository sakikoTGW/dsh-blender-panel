window.__ModuleLoader__.load({
  id: '@local/dsh-blender-panel',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const NS = 'dsh-modeldeck'
    const ROUTE = '/blender-panel'
    const COLORS = ['#5b9dff', '#ffb35b', '#5bff9d', '#ff5b9d', '#b35bff', '#5bfff5']

    const CSS = `
.dsh-md{display:flex;flex-direction:column;height:100%;min-height:0;background:#0b0c0f;color:#dfe3ea;font:12px/1.5 system-ui,sans-serif}
.dsh-md-bar{display:flex;align-items:center;gap:6px;padding:6px 8px;border-bottom:1px solid rgba(255,255,255,.1);flex:none}
.dsh-md-sel{flex:1;min-width:0;height:26px;border:1px solid rgba(255,255,255,.16);border-radius:6px;background:#16181e;color:inherit;font:inherit;padding:0 6px}
.dsh-md-btn{height:26px;padding:0 9px;border:1px solid rgba(255,255,255,.16);border-radius:6px;background:#16181e;color:inherit;font:inherit;cursor:pointer;white-space:nowrap}
.dsh-md-btn:hover{background:#21242c}
.dsh-md-btn[data-quiet]{opacity:.65}
.dsh-md-btn:disabled{opacity:.4;cursor:default}
.dsh-md-frame{flex:1;min-height:0;width:100%;border:0;display:block;background:#0b0c0f}
.dsh-md-list{flex:none;max-height:42%;overflow:auto;border-top:1px solid rgba(255,255,255,.1)}
.dsh-md-row{display:flex;align-items:center;gap:6px;padding:4px 8px;border-bottom:1px solid rgba(255,255,255,.06);font:11px/1.5 ui-monospace,monospace}
.dsh-md-row:hover{background:rgba(255,255,255,.04)}
.dsh-md-dot{width:9px;height:9px;border-radius:50%;flex:none}
.dsh-md-meta{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:pointer}
.dsh-md-note{width:34%;min-width:70px;height:20px;border:1px solid rgba(255,255,255,.14);border-radius:4px;background:#14161c;color:inherit;font:inherit;padding:0 4px}
.dsh-md-x{border:0;background:none;color:inherit;opacity:.55;cursor:pointer;font-size:13px;line-height:1;padding:2px 4px}
.dsh-md-x:hover{opacity:1;color:#ff8a7a}
.dsh-md-foot{display:flex;gap:6px;padding:6px 8px;flex:none;border-top:1px solid rgba(255,255,255,.1)}
.dsh-md-empty{padding:8px;opacity:.55;font:11px/1.6 system-ui,sans-serif}
`

    function installStyles() {
      const tag = document.createElement('style')
      tag.dataset.dshModelDeck = '1'
      tag.textContent = CSS
      document.head.appendChild(tag)
      return () => tag.remove()
    }

    const signature = (pick) => `${pick.face}:${pick.local.map((v) => v.toFixed(3)).join(',')}`

    function ModelView(props) {
      const fixedPath = typeof props.path === 'string' && props.path !== '' ? props.path : null
      const frame = React.useRef(null)
      const [files, setFiles] = React.useState([])
      const [file, setFile] = React.useState(fixedPath ?? '')
      const [version, setVersion] = React.useState(0)
      const [picks, setPicks] = React.useState([])
      const [notes, setNotes] = React.useState({})
      const [copied, setCopied] = React.useState(false)
      const [inserted, setInserted] = React.useState(false)

      const notesKey = `modeldeck:notes:${file}`

      React.useEffect(() => {
        if (fixedPath !== null) return undefined
        let alive = true
        fetch(`${ROUTE}/files`)
          .then((r) => r.json())
          .then((data) => {
            if (!alive) return
            const list = Array.isArray(data.files) ? data.files : []
            setFiles(list)
            const preferred = list.find((entry) => entry.path === data.default) || list[0]
            if (preferred) setFile(preferred.path)
          })
          .catch(() => {})
        return () => {
          alive = false
        }
      }, [fixedPath])

      React.useEffect(() => {
        try {
          const raw = localStorage.getItem(notesKey)
          setNotes(raw === null ? {} : JSON.parse(raw))
        } catch {
          setNotes({})
        }
      }, [notesKey])

      React.useEffect(() => {
        const onMessage = (event) => {
          const data = event.data
          if (data === null || typeof data !== 'object' || data.type !== 'blender-picks') return
          setPicks(Array.isArray(data.picks) ? data.picks : [])
          setCopied(false)
          window.dshModelDeck = { picks: data.picks }
          window.dispatchEvent(new CustomEvent('dsh:model-pick', { detail: data.picks }))
        }
        window.addEventListener('message', onMessage)
        return () => window.removeEventListener('message', onMessage)
      }, [])

      const tell = React.useCallback((message) => {
        const node = frame.current
        if (node !== null && node.contentWindow !== null) node.contentWindow.postMessage(message, '*')
      }, [])

      const remember = React.useCallback(
        (pick, text) => {
          setNotes((previous) => {
            const next = { ...previous, [signature(pick)]: text }
            try {
              localStorage.setItem(notesKey, JSON.stringify(next))
            } catch {
              /* storage may be unavailable */
            }
            return next
          })
        },
        [notesKey],
      )

      const line = React.useCallback(
        (pick, index) => {
          const note = (notes[signature(pick)] ?? '').trim()
          const local = pick.local.map((v) => v.toFixed(3)).join(', ')
          const uv = pick.uv === null ? '' : ` uv ${pick.uv[0].toFixed(3)},${pick.uv[1].toFixed(3)}`
          const head = `[引用模型元素 #${index + 1}] ${pick.file} | face ${pick.face} | 局部坐标 (${local})${uv} | 材质 ${pick.material}`
          return note === '' ? head : `${head} | 标注：${note}`
        },
        [notes],
      )

      const insertAll = React.useCallback(() => {
        if (picks.length === 0) return
        const text = picks.map((pick, index) => line(pick, index)).join('\n')
        // 联动：交给元素选择插件自己的插入通道（chip / composer actions）。
        const picker = window.__dshElementPicker
        if (picker !== undefined && typeof picker.commitReference === 'function') {
          try {
            if (picker.commitReference(text) === true) {
              setInserted(true)
              return
            }
          } catch {
            /* fall back to clipboard */
          }
        }
        setInserted(false)
        if (navigator.clipboard !== undefined) navigator.clipboard.writeText(text).then(() => setCopied(true)).catch(() => {})
      }, [picks, line])

      const copyAll = React.useCallback(async () => {
        if (picks.length === 0) return
        const text = picks.map((pick, index) => line(pick, index)).join('\n')
        try {
          await navigator.clipboard.writeText(text)
          setCopied(true)
        } catch {
          setCopied(false)
        }
      }, [picks, line])

      const refresh = React.useCallback(() => setVersion(Date.now()), [])
      const src = file === '' ? null : `${ROUTE}/viewer?file=${encodeURIComponent(file)}&v=${encodeURIComponent(String(version))}`

      return h(
        'div',
        { className: 'dsh-md' },
        fixedPath === null
          ? h(
              'div',
              { className: 'dsh-md-bar' },
              h(
                'select',
                {
                  className: 'dsh-md-sel',
                  value: file,
                  onChange: (event) => {
                    setPicks([])
                    setFile(event.target.value)
                  },
                  'aria-label': '选择模型',
                },
                files.length === 0
                  ? h('option', { value: '' }, '没有找到模型')
                  : files.map((entry) => h('option', { key: entry.path, value: entry.path }, entry.label)),
              ),
              h('button', { type: 'button', className: 'dsh-md-btn', onClick: refresh }, '刷新'),
            )
          : null,
        src === null
          ? h('div', { className: 'dsh-md-empty' }, '正在读取模型…')
          : h('iframe', { className: 'dsh-md-frame', src, title: '模型台', ref: frame }),
        h(
          'div',
          { className: 'dsh-md-list' },
          picks.length === 0
            ? h('div', { className: 'dsh-md-empty' }, '单击模型任意位置放置标注点；可连续点多个')
            : picks.map((pick, index) =>
                h(
                  'div',
                  { className: 'dsh-md-row', key: `${pick.face}-${index}` },
                  h('span', { className: 'dsh-md-dot', style: { background: COLORS[index % COLORS.length] } }),
                  h(
                    'span',
                    { className: 'dsh-md-meta', title: '点击定位到该点', onClick: () => tell({ type: 'focus-pick', index }) },
                    `#${index + 1} face ${pick.face} · (${pick.local.map((v) => v.toFixed(3)).join(', ')})`,
                  ),
                  h('input', {
                    className: 'dsh-md-note',
                    placeholder: '标注…',
                    defaultValue: notes[signature(pick)] ?? '',
                    onBlur: (event) => remember(pick, event.target.value),
                    onKeyDown: (event) => {
                      if (event.key === 'Enter') event.target.blur()
                    },
                  }),
                  h(
                    'button',
                    { type: 'button', className: 'dsh-md-x', title: '删除这个点', onClick: () => tell({ type: 'remove-pick', index }) },
                    '×',
                  ),
                ),
              ),
        ),
        h(
          'div',
          { className: 'dsh-md-foot' },
          h(
            'button',
            { type: 'button', className: 'dsh-md-btn', onClick: insertAll, disabled: picks.length === 0 },
            inserted ? '已插入输入框' : `插入到输入框 (${picks.length})`,
          ),
          h(
            'button',
            { type: 'button', className: 'dsh-md-btn', 'data-quiet': '1', onClick: copyAll, disabled: picks.length === 0 },
            copied ? '已复制' : '复制',
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'dsh-md-btn',
              'data-quiet': '1',
              disabled: picks.length === 0,
              onClick: () => tell({ type: 'clear-picks' }),
            },
            '清空',
          ),
        ),
      )
    }

    return {
      inject: ['betterSidebar', 'locale'],
      apply(ctx) {
        ctx.effect(() => installStyles(), 'dsh-modeldeck: styles')
        ctx.effect(
          () =>
            ctx.locale.register(NS, {
              zh: { tab: '模型台', desc: '看模型、调光调材质、点选标注，选中交给元素选择插件' },
              en: { tab: 'Model Deck', desc: 'Inspect the model, annotate picks and hand them to the element picker' },
            }),
          'dsh-modeldeck: dictionaries',
        )
        const t = ctx.locale.bind(NS)
        ctx.effect(
          () =>
            ctx.betterSidebar.registerTab({
              id: 'local-modeldeck:view',
              title: () => t('tab'),
              description: () => t('desc'),
              single: true,
              order: 40,
              component: (props) => h(ModelView, props),
            }),
          'dsh-modeldeck: tab',
        )
        ctx.effect(
          () =>
            ctx.betterSidebar.registerFileViewer({
              id: 'local-modeldeck:blend',
              title: () => t('tab'),
              exts: ['blend', 'glb', 'gltf'],
              priority: 60,
              fetchStrategy: 'none',
              component: (props) => h(ModelView, { ...props }),
            }),
          'dsh-modeldeck: blend viewer',
        )
      },
    }
  },
})
