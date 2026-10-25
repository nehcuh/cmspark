"""Owned Xvfb window only. Test driver supplies a private directory, never HOME."""
import json
import importlib.util
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


def await_managed_ready(root, desktop, pid, publish):
    """Observe this private X connection; never consume Tk's connection/events.

    The parent's existing 10s receipt deadline remains the only startup budget.
    A clock tick or an unrelated mapped window cannot publish readiness.
    """
    c = desktop.ctypes758
    x = desktop.x
    signatures = {
        "XSelectInput": (c.c_int, [c.c_void_p, c.c_ulong, c.c_long]),
        "XConnectionNumber": (c.c_int, [c.c_void_p]),
        "XPending": (c.c_int, [c.c_void_p]),
        "XNextEvent": (c.c_int, [c.c_void_p, c.c_void_p]),
    }
    for name, (result, arguments) in signatures.items():
        fn = getattr(x, name)
        fn.restype, fn.argtypes = result, arguments
    # Observe notifications only, never redirect management or synthesize input.
    x.XSelectInput(desktop.display, desktop.root, (1 << 19) | (1 << 22))
    x.XSync(desktop.display, False)
    if desktop.error:
        raise RuntimeError("OWNED_ACTIVITY_OBSERVER_FAILED")
    fd = x.XConnectionNumber(desktop.display)
    if fd < 0:
        raise RuntimeError("OWNED_ACTIVITY_OBSERVER_FAILED")
    attached = True

    def detach():
        nonlocal attached
        if attached:
            attached = False
            root.deletefilehandler(fd)

    def observe(*_event):
        if not attached:
            return
        event = (c.c_long * 24)()  # XEvent union's public long pad[24].
        remaining = 4096
        for _ in range(4096):
            while x.XPending(desktop.display):
                if remaining == 0:
                    raise RuntimeError("OWNED_ACTIVITY_OBSERVER_EVENT_LIMIT")
                remaining -= 1
                x.XNextEvent(desktop.display, c.byref(event))
            stack = desktop.prop(desktop.root, "_NET_CLIENT_LIST_STACKING")
            if not isinstance(stack, list) or len(stack) > 4096:
                raise RuntimeError("OWNED_ACTIVITY_OBSERVER_FAILED")
            for window in stack:
                try:
                    current = desktop.info(window, False)  # real mapped/XRes owner, no title or pixels
                except (OSError, RuntimeError):
                    continue
                if current and type(current.get("pid")) is int and current["pid"] == pid:
                    detach()
                    publish()
                    return
            # Property queries can themselves buffer notifications. Handle
            # those before returning to Tk so a queued event cannot be lost.
            if not x.XPending(desktop.display):
                return
        raise RuntimeError("OWNED_ACTIVITY_OBSERVER_EVENT_LIMIT")

    root.createfilehandler(fd, tk.READABLE, observe)
    root.after_idle(observe)
    return detach


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


# Use the exact production read-only identity producer, on an independent
# connection to the driver-owned Xvfb. Import does not enter its CLI main.
spec = importlib.util.spec_from_file_location("owned_recorder758", Path(__file__).resolve().parents[2] / "src/activity/linux-recorder.py")
recorder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(recorder)
observer = recorder.Desktop()
observer.ctypes758 = recorder.C
detach = await_managed_ready(root, observer, os.getpid(), lambda: record("ready.json", {"pid": os.getpid()}))
root.after(50, poll)
try:
    root.mainloop()
finally:
    detach()
    observer.close()
