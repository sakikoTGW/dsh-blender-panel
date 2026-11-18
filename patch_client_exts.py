import io
P = r"E:\逆向\dsh-blender-panel\client.js"
s = io.open(P, encoding="utf-8").read()
s = s.replace("exts: ['blend'],", "exts: ['blend', 'glb', 'gltf'],")
s = s.replace("'没有找到 .blend'", "'没有找到模型'")
io.open(P, "w", encoding="utf-8", newline="\n").write(s)
print("patched")
