"""Owned Xvfb window only. Test driver supplies a private directory, never HOME."""
import json
import os
from pathlib import Path
import sys
import tkinter as tk

directory = Path(sys.argv[1])
root = tk.Tk()
root.title("CMspark Activity 758 Owned Fixture")
root.geometry("800x300+80+80")
root.configure(background="white")
tk.Label(root, text="PROJECT ALPHA\nSEND REPORT FRIDAY", font=("DejaVu Sans", 30), fg="black", bg="white").pack(expand=True)
root.update()
overlay = None
seen = ""


def record(name, value):
    pending = directory / (name + ".pending")
    with pending.open("x", encoding="utf-8") as stream:
        json.dump(value, stream)
    pending.rename(directory / name)


def poll():
    global seen, overlay
    control = directory / "control.json"
    if control.exists():
        text = control.read_text()
        if text != seen:
            seen = text
            command = json.loads(text)["command"]
            if command == "minimize":
                root.iconify()
            elif command == "overlay":
                overlay = tk.Toplevel(root)
                overlay.overrideredirect(True)
                overlay.geometry("200x80+100+100")
                overlay.configure(bg="black")
                overlay.lift()
            elif command == "clear_overlay" and overlay:
                overlay.destroy()
                overlay = None
            elif command == "quit":
                root.destroy()
                return
            root.update_idletasks()
            record("ack.json", {"command": command})
    root.after(50, poll)


root.after(500, lambda: record("ready.json", {"pid": os.getpid()}))
root.after(50, poll)
root.mainloop()
