import io
p = r"E:\逆向\dsh-blender-panel\addon\dsh_bridge.py"
s = io.open(p, encoding="utf-8").read()

s = s.replace("import traceback\n", "import traceback\nimport urllib.request\n")

s = s.replace("""def register():
    bpy.utils.register_class(DSHBridge)
    start()


def unregister():
    stop()
    bpy.utils.unregister_class(DSHBridge)""",
"""def register():
    for cls in (DSHBridge, DSH_OT_send, DSH_OT_send_file, DSH_PT_panel):
        try:
            bpy.utils.register_class(cls)
        except ValueError:
            pass
    if not hasattr(bpy.types.Scene, "dsh_message"):
        bpy.types.Scene.dsh_message = bpy.props.StringProperty(name="消息", default="")
    start()


def unregister():
    stop()
    for cls in (DSH_PT_panel, DSH_OT_send_file, DSH_OT_send, DSHBridge):
        try:
            bpy.utils.unregister_class(cls)
        except RuntimeError:
            pass""")
io.open(p, "w", encoding="utf-8", newline="\n").write(s)
print("patched")
