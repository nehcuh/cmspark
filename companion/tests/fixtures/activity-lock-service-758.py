"""Controlled lock-state oracle on the test driver's fresh private D-Bus only."""
import json
import os
from pathlib import Path
import sys
import dbus
import dbus.service
from dbus.mainloop.glib import DBusGMainLoop
from gi.repository import GLib

DBusGMainLoop(set_as_default=True)
root = Path(sys.argv[1])
bus = dbus.SessionBus()
name = dbus.service.BusName("org.freedesktop.ScreenSaver", bus=bus, do_not_queue=True)


class LockOracle(dbus.service.Object):
    @dbus.service.method("org.freedesktop.ScreenSaver", out_signature="b")
    def GetActive(self):
        return (root / "locked").exists()


oracle = LockOracle(bus, "/org/freedesktop/ScreenSaver")
loop = GLib.MainLoop()


def stop_owned():
    if (root / "stop").exists():
        bus.release_name("org.freedesktop.ScreenSaver")
        pending = root / "stopped.pending"
        pending.write_text(json.dumps({"released": True}))
        pending.rename(root / "stopped.json")
        loop.quit()
        return False
    return True


GLib.timeout_add(50, stop_owned)
pending = root / "ready.pending"
pending.write_text(json.dumps({"pid": os.getpid(), "bus_name": "org.freedesktop.ScreenSaver"}))
pending.rename(root / "ready.json")
loop.run()
