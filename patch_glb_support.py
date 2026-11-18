import io
P = r"E:\逆向\dsh-blender-panel\index.js"
s = io.open(P, encoding="utf-8").read()

# 1) default model: the raw Tripo T-pose GLB the user actually wants
s = s.replace("const DEFAULT_BLEND = 'E:\\\\逆向\\\\_hero\\\\anon\\\\anon_8k_clean.blend'",
              "const DEFAULT_BLEND = 'E:\\\\逆向\\\\_hero\\\\anon\\\\tripo-tpose-model2\\\\tripo-out\\\\anon-tpose-v2-2-0b09cfbd\\\\model.glb'")

# 2) list .glb files as well
s = s.replace("} else if (entry.isFile() && entry.name.toLowerCase().endsWith('.blend')) {",
              "} else if (entry.isFile() && /\\.(blend|glb|gltf)$/i.test(entry.name)) {")

# 3) serve a .glb directly instead of exporting it from Blender
anchor = """      if (url.pathname === `${ROUTE}/glb` && req.method === 'GET') {
        const file = url.searchParams.get('file') ?? ''
        if (!insideRoot(root, file) || !existsSync(file)) {
          sendJson(res, 400, { error: 'invalid-file' })
          return
        }"""
replacement = """      if (url.pathname === `${ROUTE}/glb` && req.method === 'GET') {
        const file = url.searchParams.get('file') ?? ''
        if (!insideRoot(root, file) || !existsSync(file)) {
          sendJson(res, 400, { error: 'invalid-file' })
          return
        }
        // A .glb/.gltf is served as-is: no Blender round-trip, no rewriting.
        if (/\\.(glb|gltf)$/i.test(file)) {
          const raw = readFileSync(file)
          res.statusCode = 200
          res.setHeader('Content-Type', /gltf$/i.test(file) ? 'model/gltf+json' : 'model/gltf-binary')
          res.setHeader('Content-Length', String(raw.length))
          res.setHeader('Cache-Control', 'public, max-age=604800, immutable')
          res.end(raw)
          return
        }"""
if anchor not in s:
    raise SystemExit("glb route anchor not found")
s = s.replace(anchor, replacement, 1)

io.open(P, "w", encoding="utf-8", newline="\n").write(s)
print("patched")
