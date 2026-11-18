/**
 * Sidebar model viewer: orbit the exported GLB, adjust lighting/material, and
 * pick any point on the mesh to get a reference the agent can act on.
 */
export const VIEWER_CSS = `
  html,body{margin:0;height:100%;background:#0b0c0f;overflow:hidden}
  canvas{display:block}
  #hint{position:fixed;left:10px;bottom:8px;color:#7f838c;font:11px/1.5 system-ui,sans-serif;pointer-events:none}
  #err{position:fixed;left:12px;right:12px;bottom:30px;color:#ff8a7a;font:12px/1.55 ui-monospace,monospace;white-space:pre-wrap}
  #bar{position:fixed;left:8px;top:8px;right:8px;display:flex;flex-wrap:wrap;gap:6px;align-items:center;font:11px/1.4 system-ui,sans-serif;color:#dfe3ea;z-index:5}
  #bar button{background:rgba(22,24,30,.86);border:1px solid rgba(255,255,255,.14);color:#dfe3ea;border-radius:6px;padding:4px 8px;font:inherit;cursor:pointer}
  #bar button:hover{background:rgba(40,44,54,.9)}
  #bar button[data-on="1"]{border-color:#5b9dff;color:#9cc4ff}
  #bar .sep{width:1px;height:18px;background:rgba(255,255,255,.14)}
  #bar input[type=range]{width:80px}
  #pick{position:fixed;left:8px;right:8px;bottom:26px;background:rgba(18,20,26,.9);border:1px solid rgba(255,255,255,.12);
       border-radius:8px;padding:6px 9px;color:#cfd6e2;font:11px/1.6 ui-monospace,monospace;display:none;z-index:5}
  #pick b{color:#9cc4ff;font-weight:600}
`

export const VIEWER_SCRIPT = `
const ROUTE = '/blender-panel'
const params = new URLSearchParams(location.search)
const file = params.get('file') || ''
const version = params.get('v') || String(Date.now())
const hint = document.getElementById('hint')
const errEl = document.getElementById('err')
const pickEl = document.getElementById('pick')

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true })
renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
renderer.setSize(innerWidth, innerHeight)
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = 1.0
document.body.appendChild(renderer.domElement)

const scene = new THREE.Scene()
const camera = new THREE.PerspectiveCamera(42, innerWidth / innerHeight, 0.01, 200)
const controls = new OrbitControls(camera, renderer.domElement)
controls.enableDamping = true
controls.dampingFactor = 0.08

const hemi = new THREE.HemisphereLight(0xdfe7ff, 0x14161c, 1.1)
scene.add(hemi)
const key = new THREE.DirectionalLight(0xffffff, 2.2)
const fill = new THREE.DirectionalLight(0x88aaff, 0.7)
const rim = new THREE.DirectionalLight(0xffd9b0, 1.0)
scene.add(key, fill, rim)

const pickMarkers = []
const picks = []
const PICK_COLORS = [0x5b9dff, 0xffb35b, 0x5bff9d, 0xff5b9d, 0xb35bff, 0x5bfff5]

function addMarker(point, index) {
  const group = new THREE.Group()
  const color = PICK_COLORS[index % PICK_COLORS.length]
  group.add(new THREE.Mesh(new THREE.SphereGeometry(0.006, 16, 16), new THREE.MeshBasicMaterial({ color })))
  group.add(new THREE.Mesh(new THREE.RingGeometry(0.012, 0.016, 32), new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, transparent: true, opacity: 0.9 })))
  group.position.copy(point)
  group.lookAt(camera.position)
  scene.add(group)
  pickMarkers.push(group)
}

function clearMarkers() {
  while (pickMarkers.length > 0) {
    const group = pickMarkers.pop()
    scene.remove(group)
  }
}

const raycaster = new THREE.Raycaster()
const pointer = new THREE.Vector2()
let model = null
let targetMesh = null
let materialMode = 'original'
let picking = true
let originals = []

function applyLighting(name) {
  const presets = {
    studio: [[0xdfe7ff, 0x14161c, 1.1], [0xffffff, 2.2, [2.2, 3.2, 2.4]], [0x88aaff, 0.7, [-2.4, 1.2, -1.6]], [0xffd9b0, 1.0, [0.4, 2.0, -2.6]]],
    warm: [[0xffe3c8, 0x1a1210, 1.0], [0xffd7b5, 2.6, [2.4, 2.6, 2.2]], [0xff9d6e, 0.6, [-1.8, 1.0, -1.4]], [0xffc7a0, 1.2, [0.2, 2.2, -2.4]]],
    cool: [[0xd7e6ff, 0x0f141c, 1.0], [0xe8f2ff, 2.4, [2.0, 3.0, 2.2]], [0x6f9dff, 0.9, [-2.2, 1.2, -1.8]], [0xa9c8ff, 1.1, [0.4, 2.0, -2.6]]],
    flat: [[0xffffff, 0x101014, 2.4], [0xffffff, 0.15, [2, 3, 2]], [0xffffff, 0.1, [-2, 1, -1]], [0xffffff, 0.1, [0, 2, -2]]],
  }
  const preset = presets[name] || presets.studio
  hemi.color.setHex(preset[0][0]); hemi.groundColor.setHex(preset[0][1]); hemi.intensity = preset[0][2]
  key.color.setHex(preset[1][0]); key.intensity = preset[1][1]; key.position.set(...preset[1][2])
  fill.color.setHex(preset[2][0]); fill.intensity = preset[2][1]; fill.position.set(...preset[2][2])
  rim.color.setHex(preset[3][0]); rim.intensity = preset[3][1]; rim.position.set(...preset[3][2])
}

function applyBackground(name) {
  const colors = { black: 0x0b0c0f, gray: 0x2a2d34, white: 0xe9ecf2 }
  if (name === 'transparent') {
    scene.background = null
    renderer.setClearAlpha(0)
  } else {
    scene.background = new THREE.Color(colors[name] || colors.black)
    renderer.setClearAlpha(1)
  }
}

function applyMaterial(name) {
  materialMode = name
  if (model === null) return
  model.traverse((object) => {
    if (!object.isMesh) return
    if (name === 'wireframe') {
      object.material = new THREE.MeshBasicMaterial({ color: 0x9cc4ff, wireframe: true })
      return
    }
    if (name === 'clay') {
      object.material = new THREE.MeshStandardMaterial({ color: 0xb9bcc4, roughness: 0.55, metalness: 0.0 })
      return
    }
    const index = originals.find((entry) => entry.object === object)
    if (index !== undefined) object.material = index.material
  })
}

function view(name) {
  if (targetMesh === null) return
  const box = new THREE.Box3().setFromObject(targetMesh)
  const size = box.getSize(new THREE.Vector3())
  const center = box.getCenter(new THREE.Vector3())
  const radius = Math.max(size.x, size.y, size.z) * 0.5 || 1
  const distance = (radius / Math.tan((42 * Math.PI) / 360)) * 1.25
  const dirs = {
    front: [0, 0, 1],
    back: [0, 0, -1],
    left: [-1, 0, 0],
    right: [1, 0, 0],
    top: [0, 1, 0.001],
    three: [0.78, 0.42, 0.88],
  }
  const dir = new THREE.Vector3(...(dirs[name] || dirs.three)).normalize()
  camera.position.copy(center).add(dir.multiplyScalar(distance))
  controls.target.copy(center)
  camera.near = Math.max(distance / 200, 0.001)
  camera.far = distance * 40
  camera.updateProjectionMatrix()
  controls.update()
}

function publishPicks() {
  window.parent.postMessage({ type: 'blender-picks', picks }, '*')
  const last = picks[picks.length - 1]
  if (last === undefined) {
    pickEl.style.display = 'none'
    return
  }
  pickEl.style.display = 'block'
  const local = last.local.map((v) => v.toFixed(3)).join(', ')
  pickEl.innerHTML = '<b>#' + picks.length + ' ' + last.object + '</b>  face ' + last.face + '  local (' + local + ')' +
    (last.uv === null ? '' : '  uv (' + last.uv[0].toFixed(3) + ', ' + last.uv[1].toFixed(3) + ')')
}

function pickAt(event) {
  if (!picking || targetMesh === null) return
  const rect = renderer.domElement.getBoundingClientRect()
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
  raycaster.setFromCamera(pointer, camera)
  const hits = raycaster.intersectObject(targetMesh, true)
  if (hits.length === 0) return
  const hit = hits[0]
  const local = targetMesh.worldToLocal(hit.point.clone())
  const uv = hit.uv === undefined ? null : [hit.uv.x, hit.uv.y]
  picks.push({
    object: targetMesh.name || 'mesh',
    face: hit.faceIndex,
    point: [hit.point.x, hit.point.y, hit.point.z],
    local: [local.x, local.y, local.z],
    uv,
    material: Array.isArray(targetMesh.material) ? targetMesh.material.map((m) => m.name).join(',') : targetMesh.material && targetMesh.material.name,
    file,
    note: '',
  })
  addMarker(hit.point, picks.length - 1)
  publishPicks()
}

addEventListener('message', (event) => {
  const data = event.data
  if (data === null || typeof data !== 'object') return
  if (data.type === 'remove-pick') {
    if (Number.isInteger(data.index) && data.index >= 0 && data.index < picks.length) {
      picks.splice(data.index, 1)
      clearMarkers()
      picks.forEach((entry, index) => addMarker(new THREE.Vector3(...entry.point), index))
      publishPicks()
    }
    return
  }
  if (data.type === 'focus-pick') {
    const entry = picks[Number(data.index)]
    if (entry !== undefined) {
      controls.target.set(entry.point[0], entry.point[1], entry.point[2])
      controls.update()
    }
    return
  }
  if (data.type === 'clear-picks') {
    picks.length = 0
    clearMarkers()
    publishPicks()
  }
})

document.getElementById('bar').addEventListener('click', (event) => {
  const button = event.target.closest('button')
  if (button === null) return
  const group = button.dataset.group
  const value = button.dataset.value
  if (group === undefined) {
    if (button.id === 'shot') {
      const link = document.createElement('a')
      link.download = 'view.png'
      link.href = renderer.domElement.toDataURL('image/png')
      link.click()
      return
    }
    if (button.id === 'picktoggle') {
      picking = !picking
      button.dataset.on = picking ? '1' : '0'
      return
    }
    return
  }
  if (group === 'view') view(value)
  if (group === 'light') applyLighting(value)
  if (group === 'bg') applyBackground(value)
  if (group === 'mat') applyMaterial(value)
  document.querySelectorAll('[data-group="' + group + '"]').forEach((node) => {
    node.dataset.on = node === button ? '1' : '0'
  })
})

const viewsKey = 'modeldeck:views:' + file
function loadViews() {
  try {
    const raw = localStorage.getItem(viewsKey)
    const parsed = raw === null ? [] : JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}
function renderViews() {
  const select = document.getElementById('views')
  const saved = loadViews()
  select.innerHTML = '<option value="">视角…</option>' +
    saved.map((entry, index) => '<option value="' + index + '">' + entry.name + '</option>').join('')
}
document.getElementById('saveview').addEventListener('click', () => {
  const saved = loadViews()
  saved.push({ name: '视角 ' + (saved.length + 1), p: camera.position.toArray(), t: controls.target.toArray() })
  localStorage.setItem(viewsKey, JSON.stringify(saved))
  renderViews()
})
document.getElementById('views').addEventListener('change', (event) => {
  const saved = loadViews()
  const entry = saved[Number(event.target.value)]
  if (entry === undefined) return
  camera.position.fromArray(entry.p)
  controls.target.fromArray(entry.t)
  controls.update()
  event.target.value = ''
})
renderViews()

document.getElementById('exposure').addEventListener('input', (event) => {
  renderer.toneMappingExposure = Number(event.target.value)
})

let downAt = 0
let downX = 0
let downY = 0
renderer.domElement.addEventListener('pointerdown', (event) => {
  downAt = performance.now()
  downX = event.clientX
  downY = event.clientY
})
renderer.domElement.addEventListener('pointerup', (event) => {
  const quick = performance.now() - downAt < 350
  const still = Math.abs(event.clientX - downX) < 4 && Math.abs(event.clientY - downY) < 4
  if (quick && still) pickAt(event)
})

const loader = new GLTFLoader()
loader.load(
  ROUTE + '/glb?file=' + encodeURIComponent(file) + '&v=' + encodeURIComponent(version),
  (gltf) => {
    model = gltf.scene
    scene.add(model)
    let best = null
    let bestCount = -1
    model.traverse((object) => {
      if (!object.isMesh) return
      originals.push({ object, material: object.material })
      const geometry = object.geometry
      const count = geometry.index !== null && geometry.index !== undefined
        ? geometry.index.count
        : (geometry.attributes.position ? geometry.attributes.position.count : 0)
      if (count > bestCount) { bestCount = count; best = object }
    })
    targetMesh = best !== null ? best : model
    view('three')
    hint.textContent = '拖动旋转 · 滚轮缩放 · 单击选择'
    window.parent.postMessage({ type: 'blender-ready', file }, '*')
  },
  (event) => {
    if (event.total) hint.textContent = '载入 ' + Math.round((event.loaded / event.total) * 100) + '%'
  },
  (error) => {
    errEl.textContent = '加载失败：' + (error && error.message ? error.message : String(error))
    hint.textContent = ''
  },
)

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(innerWidth, innerHeight)
})

const clock = new THREE.Clock()
renderer.setAnimationLoop(() => {
  clock.getDelta()
  controls.update()
  renderer.render(scene, camera)
})

applyLighting('studio')
applyBackground('black')
`

export function renderViewerHtml(exporterVersion = 'v7') {
  return `<!doctype html>
<html lang="zh">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Blender view</title>
<style>${VIEWER_CSS}</style>
<script type="importmap">
{"imports":{"three":"/blender-panel/assets/three.module.min.js","three/addons/":"/blender-panel/assets/"}}
</script>
</head>
<body>
<div id="bar">
  <button data-group="view" data-value="three" data-on="1">3/4</button>
  <button data-group="view" data-value="front">前</button>
  <button data-group="view" data-value="left">侧</button>
  <button data-group="view" data-value="back">后</button>
  <button data-group="view" data-value="top">顶</button>
  <span class="sep"></span>
  <button data-group="light" data-value="studio" data-on="1">棚拍</button>
  <button data-group="light" data-value="warm">暖</button>
  <button data-group="light" data-value="cool">冷</button>
  <button data-group="light" data-value="flat">平光</button>
  <span class="sep"></span>
  <button data-group="bg" data-value="black" data-on="1">黑底</button>
  <button data-group="bg" data-value="gray">灰底</button>
  <button data-group="bg" data-value="white">白底</button>
  <button data-group="bg" data-value="transparent">透明</button>
  <span class="sep"></span>
  <button data-group="mat" data-value="original" data-on="1">贴图</button>
  <button data-group="mat" data-value="clay">黏土</button>
  <button data-group="mat" data-value="wireframe">线框</button>
  <span class="sep"></span>
  <button id="picktoggle" data-on="1">选择</button>
  <label style="display:flex;align-items:center;gap:4px;opacity:.8">曝光<input id="exposure" type="range" min="0.4" max="2.2" step="0.05" value="1"></label>
  <button id="shot">截图</button>
  <button id="saveview">存视角</button>
  <select id="views" style="height:24px;border-radius:6px;background:#16181e;color:#dfe3ea;border:1px solid rgba(255,255,255,.16)"></select>
</div>
<div id="pick"></div>
<div id="hint">载入中…</div>
<div id="err"></div>
<script type="module">
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
${VIEWER_SCRIPT}
</script>
</body>
</html>`
}
