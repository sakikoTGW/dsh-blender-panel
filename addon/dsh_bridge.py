"""DSH Blender workbench bridge.

Serves the real Blender session to the DSH sidebar: scene tree, selection,
visibility, transforms, render settings, operators and a Python console.
Requests are marshalled onto Blender's main thread through a timer.

Load from Blender:
    blender --python "<this file>"
"""

import json
import os
import queue
import threading
import traceback
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

import bpy

PORT = int(os.environ.get("DSH_BLENDER_BRIDGE_PORT", "8731"))

_request_queue: "queue.Queue[dict]" = queue.Queue()
_server = None
_thread = None


def _ask(payload, timeout=30):
    slot = {"event": threading.Event(), "value": None}
    payload["slot"] = slot
    _request_queue.put(payload)
    if not slot["event"].wait(timeout=timeout):
        return {"ok": False, "error": "blender did not answer in time"}
    return slot["value"]


def _object_brief(obj):
    return {
        "name": obj.name,
        "type": obj.type,
        "visible": bool(obj.visible_get()),
        "selected": bool(obj.select_get()),
        "parent": obj.parent.name if obj.parent is not None else "",
    }


def _state():
    scene = bpy.context.scene
    active = bpy.context.view_layer.objects.active
    collections = []
    for collection in bpy.data.collections:
        collections.append(
            {
                "name": collection.name,
                "objects": [_object_brief(o) for o in collection.objects],
            }
        )
    loose = [o for o in scene.objects if len(o.users_collection) == 0]
    transform = {"location": [0.0, 0.0, 0.0], "rotation": [0.0, 0.0, 0.0], "scale": [1.0, 1.0, 1.0]}
    if active is not None:
        transform = {
            "location": [round(v, 4) for v in active.location],
            "rotation": [round(v, 4) for v in active.rotation_euler],
            "scale": [round(v, 4) for v in active.scale],
        }
    return {
        "ok": True,
        "file": bpy.data.filepath,
        "scene": scene.name,
        "engine": scene.render.engine,
        "frame": scene.frame_current,
        "frameStart": scene.frame_start,
        "frameEnd": scene.frame_end,
        "samples": scene.cycles.samples if hasattr(scene, "cycles") else 0,
        "resolution": [scene.render.resolution_x, scene.render.resolution_y],
        "collections": collections,
        "loose": [_object_brief(o) for o in loose],
        "selected": [o.name for o in bpy.context.selected_objects],
        "active": active.name if active is not None else "",
        "camera": scene.camera.name if scene.camera is not None else "",
        "materials": [m.name for m in bpy.data.materials if m.users > 0],
        "objects": len(scene.objects),
        "activeTransform": transform,
    }


def _select(name, extend=False):
    target = bpy.data.objects.get(name)
    if target is None:
        return {"ok": False, "error": f"no object named {name}"}
    if not extend:
        for obj in bpy.context.selected_objects:
            obj.select_set(False)
    target.select_set(True)
    bpy.context.view_layer.objects.active = target
    return {"ok": True}


def _toggle(name):
    target = bpy.data.objects.get(name)
    if target is None:
        return {"ok": False, "error": f"no object named {name}"}
    hidden = not target.hide_get()
    target.hide_set(hidden)
    target.hide_viewport = hidden
    return {"ok": True, "hidden": hidden, "name": name}


def _transform(name, values):
    target = bpy.data.objects.get(name)
    if target is None:
        return {"ok": False, "error": f"no object named {name}"}
    for field, attr in (("location", "location"), ("rotation", "rotation_euler"), ("scale", "scale")):
        if field in values:
            triple = values[field]
            if isinstance(triple, list) and len(triple) == 3:
                setattr(target, attr, [float(v) for v in triple])
    return {"ok": True, "object": _object_brief(target)}


def _settings(values):
    scene = bpy.context.scene
    if "engine" in values:
        scene.render.engine = str(values["engine"])
    if "frame" in values:
        scene.frame_set(int(values["frame"]))
    if "resolution" in values:
        width, height = values["resolution"]
        scene.render.resolution_x = int(width)
        scene.render.resolution_y = int(height)
    if "samples" in values and hasattr(scene, "cycles"):
        scene.cycles.samples = int(values["samples"])
    return _state()


def _file_action(action, path):
    if action == "open":
        bpy.ops.wm.open_mainfile(filepath=path)
    elif action == "save":
        bpy.ops.wm.save_mainfile()
    elif action == "save_as":
        bpy.ops.wm.save_as_mainfile(filepath=path)
    elif action == "new":
        bpy.ops.wm.read_homefile(use_empty=False)
    return _state()


def _python(code):
    namespace = {"bpy": bpy, "result": None}
    output = []
    exec(code, namespace)
    return {"ok": True, "result": repr(namespace.get("result")), "state": _state()}


def _handle(payload):
    kind = payload.get("kind")
    if kind == "state":
        return _state()
    if kind == "select":
        return _select(payload.get("name", ""), bool(payload.get("extend")))
    if kind == "toggle":
        return _toggle(payload.get("name", ""))
    if kind == "transform":
        return _transform(payload.get("name", ""), payload.get("values", {}))
    if kind == "settings":
        return _settings(payload.get("values", {}))
    if kind == "file":
        return _file_action(payload.get("action", ""), payload.get("path", ""))
    if kind == "python":
        return _python(payload.get("code", ""))
    return {"ok": False, "error": f"unknown request {kind}"}


def _drain():
    while True:
        try:
            payload = _request_queue.get_nowait()
        except queue.Empty:
            return 0.05
        slot = payload["slot"]
        try:
            slot["value"] = _handle(payload)
        except Exception:  # noqa: BLE001 - surface Blender errors to the panel
            slot["value"] = {"ok": False, "error": traceback.format_exc(limit=3)}
        finally:
            slot["event"].set()
    return 0.05


class _Handler(BaseHTTPRequestHandler):
    def log_message(self, *_args):
        return

    def _json(self, payload, status=200):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):  # noqa: N802
        parsed = urlparse(self.path)
        if parsed.path == "/state":
            self._json(_ask({"kind": "state"}))
            return
        if parsed.path == "/panel":
            self._json(_ask({"kind": "state"}))
            return
        self._json({"ok": False, "error": "not-found"}, 404)

    def do_POST(self):  # noqa: N802
        length = int(self.headers.get("Content-Length", "0"))
        raw = self.rfile.read(length).decode("utf-8") if length else "{}"
        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            data = {}
        parsed = urlparse(self.path)
        routes = {
            "/select": "select",
            "/toggle": "toggle",
            "/transform": "transform",
            "/settings": "settings",
            "/file": "file",
            "/python": "python",
        }
        kind = routes.get(parsed.path)
        if kind is None:
            self._json({"ok": False, "error": "not-found"}, 404)
            return
        payload = dict(data)
        payload["kind"] = kind
        self._json(_ask(payload))


def start():
    global _server, _thread
    if _server is not None:
        return
    if not bpy.app.timers.is_registered(_drain):
        bpy.app.timers.register(_drain, first_interval=0.05, persistent=True)
    _server = ThreadingHTTPServer(("127.0.0.1", PORT), _Handler)
    _thread = threading.Thread(target=_server.serve_forever, daemon=True)
    _thread.start()
    print(f"[dsh-workbench] listening on http://127.0.0.1:{PORT}")


def _dsh_post(path, payload):
    base = os.environ.get("DSH_WEB_URL", "").rstrip("/")
    if base == "":
        raise RuntimeError("DSH_WEB_URL is not set; start Blender from the DSH panel")
    data = json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        base + path, data=data, headers={"Content-Type": "application/json"}, method="POST"
    )
    with urllib.request.urlopen(request, timeout=10) as response:
        return json.loads(response.read().decode("utf-8"))


class DSH_OT_send(bpy.types.Operator):
    bl_idname = "dsh.send_message"
    bl_label = "发送到 DSH"
    bl_description = "把这条消息交给 DSH 侧栏（跨窗口）"

    def execute(self, _context):
        scene = bpy.context.scene
        text = (scene.dsh_message or "").strip()
        if text == "":
            self.report({"WARNING"}, "消息为空")
            return {"CANCELLED"}
        try:
            _dsh_post("/blender-panel/intake", {"text": text, "source": "blender"})
            scene.dsh_message = ""
            self.report({"INFO"}, "已发送到 DSH")
        except Exception as exc:  # noqa: BLE001 - report to the user in Blender
            self.report({"ERROR"}, str(exc))
            return {"CANCELLED"}
        return {"FINISHED"}


class DSH_OT_send_file(bpy.types.Operator):
    bl_idname = "dsh.send_file"
    bl_label = "把当前文件交给 DSH"
    bl_description = "把当前 .blend 的路径发给 DSH，让 Agent 接管"

    def execute(self, _context):
        path = bpy.data.filepath
        if path == "":
            self.report({"WARNING"}, "当前文件尚未保存")
            return {"CANCELLED"}
        try:
            _dsh_post("/blender-panel/intake", {"text": path, "source": "blender-file"})
            self.report({"INFO"}, path)
        except Exception as exc:  # noqa: BLE001
            self.report({"ERROR"}, str(exc))
            return {"CANCELLED"}
        return {"FINISHED"}


class DSH_PT_panel(bpy.types.Panel):
    bl_label = "DSH"
    bl_space_type = "VIEW_3D"
    bl_region_type = "UI"
    bl_category = "DSH"

    def draw(self, context):
        layout = self.layout
        layout.prop(context.scene, "dsh_message", text="")
        row = layout.row(align=True)
        row.operator("dsh.send_message", icon="EXPORT")
        row.operator("dsh.send_file", text="文件", icon="FILEBLEND")
        try:
            response = urllib.request.urlopen(f"http://127.0.0.1:{PORT}/state", timeout=3)
            state = json.loads(response.read().decode("utf-8"))
            layout.label(text=f"DSH 桥接在线 · {state.get('objects', 0)} 对象")
        except Exception:  # noqa: BLE001
            layout.label(text="DSH 桥接离线")



def stop():
    global _server, _thread
    if _server is not None:
        _server.shutdown()
        _server = None
    _thread = None
    if bpy.app.timers.is_registered(_drain):
        bpy.app.timers.unregister(_drain)


if __name__ == "__main__":
    start()
