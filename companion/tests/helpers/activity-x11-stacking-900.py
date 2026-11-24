"""Owned Xvfb test only. Put a managed nonfocusable dock above the fixture chat."""
import importlib.util
import os
import sys
import time
import tkinter as tk
import uuid
from pathlib import Path

helper, selected, app_id, directory = sys.argv[1:]
spec = importlib.util.spec_from_file_location("recorder", helper)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
desktop = mod.Desktop()
chat = int(selected)
dock = tk.Tk()
dock.withdraw()
dock.wm_attributes("-type", "dock")
dock.geometry("100x55+1000+100")
dock.deiconify()

def wait_until(check):
    end = time.monotonic() + 4
    while time.monotonic() < end:
        dock.update()
        if check():
            return
        time.sleep(0.02)
    raise RuntimeError("fixture dock was not observed in the expected position")

def above_chat():
    stack = desktop.prop(desktop.root, "_NET_CLIENT_LIST_STACKING") or []
    return chat in stack and any(desktop.info(w, False)["pid"] == os.getpid() for w in stack[stack.index(chat)+1:])

def occluded():
    try:
        desktop.unobscured(chat, desktop.geometry(chat))
    except RuntimeError as error:
        if str(error) == "WINDOW_OCCLUDED":
            return True
        raise
    return False

try:
    wait_until(above_chat)
    assert desktop.prop(desktop.root, "_NET_ACTIVE_WINDOW") == [chat]
    output = Path(directory) / ("pending-" + str(uuid.uuid4()) + ".png")
    fd = os.open(output, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    os.close(fd)
    try:
        assert desktop.capture(str(output), [app_id])["window"] == chat
        assert output.read_bytes().startswith(b"\x89PNG")
        output.write_bytes(b"")
        dock.geometry("100x55+140+150")
        wait_until(occluded)
        try:
            desktop.capture(str(output), [app_id])
        except RuntimeError as error:
            assert str(error) == "WINDOW_OCCLUDED"
        else:
            raise AssertionError("overlapping managed dock was recorded")
        assert output.stat().st_size == 0
    finally:
        output.unlink()
finally:
    dock.destroy()
    desktop.close()
