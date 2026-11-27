"""Exercise the real GTK region picker on an isolated X display and test D-Bus."""
import os
import subprocess
import sys
import tempfile
import threading
from pathlib import Path


def isolated_session():
    with tempfile.TemporaryDirectory() as scratch:
        env = {**os.environ, "CMSPARK_MINI_TEST_DIR": scratch, "NO_AT_BRIDGE": "1"}
        env.pop("WAYLAND_DISPLAY", None)
        return subprocess.run(["dbus-run-session", "--", "xvfb-run", "-a", "-s", "-screen 0 1000x700x24",
                               sys.executable, __file__, "--isolated"], env=env).returncode


def test_picker():
    import gi
    gi.require_version("Gtk", "3.0")
    gi.require_version("GdkPixbuf", "2.0")
    from gi.repository import GdkPixbuf, Gio, GLib, Gtk

    helper = Path(__file__).resolve().parents[1] / "src/mini/linux-mini-region.py"
    image = Path(os.environ["CMSPARK_MINI_TEST_DIR"]) / "portal.png"
    green = (25, 130, 60)
    pixbuf = GdkPixbuf.Pixbuf.new(GdkPixbuf.Colorspace.RGB, False, 8, 640, 480)
    pixbuf.fill(0x19823cff)
    pixbuf.savev(str(image), "png", [], [])
    mode = ""
    bus = Gio.bus_get_sync(Gio.BusType.SESSION, None)
    name = "org.freedesktop.portal.Desktop"
    bus.call_sync("org.freedesktop.DBus", "/org/freedesktop/DBus", "org.freedesktop.DBus", "RequestName",
                  GLib.Variant("(su)", (name, 0)), None, Gio.DBusCallFlags.NONE, 3000, None)

    def portal(connection, sender, _path, _iface, _method, args, invocation):
        _, options = args.unpack()
        assert options["interactive"]
        request = "/org/freedesktop/portal/desktop/request/" + sender[1:].replace(".", "_") + "/" + options["handle_token"]
        invocation.return_value(GLib.Variant("(o)", (request,)))

        def reply():
            result = (1, {}) if mode == "portal-cancel" else (0, {"uri": GLib.Variant("s", image.as_uri())})
            connection.emit_signal(sender, request, "org.freedesktop.portal.Request", "Response", GLib.Variant("(ua{sv})", result))
            return False
        GLib.idle_add(reply)

    methods = """<node><interface name="org.freedesktop.portal.Screenshot"><method name="Screenshot">
        <arg type="s" direction="in"/><arg type="a{sv}" direction="in"/><arg type="o" direction="out"/>
        </method></interface></node>"""
    bus.register_object("/org/freedesktop/portal/desktop", Gio.DBusNodeInfo.new_for_xml(methods).interfaces[0], portal, None, None)
    window = Gtk.Window(title="Mini test canvas")
    window.set_default_size(1000, 700)
    window.set_decorated(False)
    canvas = Gtk.DrawingArea()

    def draw(_widget, context):
        context.set_source_rgb(*(v / 255 for v in green))
        context.paint()
    canvas.connect("draw", draw)
    window.add(canvas)
    window.show_all()
    failures = []

    def run():
        nonlocal mode
        try:
            for mode in ("x11-select", "x11-cancel", "portal-select", "portal-cancel"):
                env = {**os.environ, "XDG_SESSION_TYPE": "wayland" if mode.startswith("portal") else "x11"}
                with subprocess.Popen([sys.executable, helper], stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env) as child:
                    try:
                        if mode != "portal-cancel":
                            wid = subprocess.check_output(["xdotool", "search", "--sync", "--onlyvisible", "--name", "CMspark Mini"],
                                                          text=True, timeout=8).splitlines()[0]
                            subprocess.run(["xdotool", "windowfocus", "--sync", wid], check=True)
                            if mode.endswith("cancel"):
                                subprocess.run(["xdotool", "key", "Escape"], check=True)
                            else:
                                subprocess.run(["xdotool", "mousemove", "--window", wid, "160", "140", "mousedown", "1",
                                                "sleep", ".1", "mousemove", "--window", wid, "225", "180", "mouseup", "1"], check=True)
                        data, error = child.communicate(timeout=8)
                    finally:
                        if child.poll() is None:
                            child.kill()
                    assert child.returncode == 0, error
                if mode.endswith("cancel"):
                    assert not data
                else:
                    loader = GdkPixbuf.PixbufLoader.new_with_type("png")
                    loader.write(data)
                    loader.close()
                    crop = loader.get_pixbuf()
                    w, h = crop.get_width(), crop.get_height()
                    assert 20 <= w <= 95 and 15 <= h <= 65, (w, h)
                    offset = (h // 2) * crop.get_rowstride() + (w // 2) * crop.get_n_channels()
                    assert bytes(crop.get_pixels()[offset:offset+3]) == bytes(green)
                print("PASS", mode, flush=True)
        except Exception as exc:
            failures.append(exc)
        finally:
            GLib.idle_add(Gtk.main_quit)

    GLib.timeout_add(300, lambda: threading.Thread(target=run, daemon=True).start() or False)
    Gtk.main()
    if failures:
        raise failures[0]


if __name__ == "__main__":
    if sys.argv[1:] == ["--isolated"] and os.environ.get("CMSPARK_MINI_TEST_DIR"):
        test_picker()
    else:
        sys.exit(isolated_session())
