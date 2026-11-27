"""User-initiated region capture. Only the rectangle accepted in the picker goes to stdout."""
import math
import os
import signal
import sys
import uuid

import gi
gi.require_version("Gtk", "3.0")
from gi.repository import Gdk, GdkPixbuf, Gio, GLib, Gtk


def portal_image():
    bus = Gio.bus_get_sync(Gio.BusType.SESSION, None)
    name = "org.freedesktop.portal.Desktop"
    iface = "org.freedesktop.portal.Request"
    token = "cmspark" + uuid.uuid4().hex
    owner = bus.get_unique_name()[1:].replace(".", "_")
    request = "/org/freedesktop/portal/desktop/request/" + owner + "/" + token
    reply = []
    loop = GLib.MainLoop()

    def received(_bus, _sender, _path, _interface, _signal, values):
        reply.append(values.unpack())
        loop.quit()

    def cancelled():
        try:
            bus.call_sync(name, request, iface, "Close", None, None, Gio.DBusCallFlags.NONE, 1000, None)
        finally:
            loop.quit()
        return GLib.SOURCE_REMOVE

    sub = bus.signal_subscribe(name, iface, "Response", request, None,
                               Gio.DBusSignalFlags.NONE, received)
    term = GLib.unix_signal_add(GLib.PRIORITY_DEFAULT, signal.SIGTERM, cancelled)
    try:
        bus.call_sync(name, "/org/freedesktop/portal/desktop", "org.freedesktop.portal.Screenshot",
                      "Screenshot", GLib.Variant("(sa{sv})", ("", {
                          "handle_token": GLib.Variant("s", token),
                          "interactive": GLib.Variant("b", True),
                      })), None, Gio.DBusCallFlags.NONE, 8000, None)
        loop.run()
    finally:
        bus.signal_unsubscribe(sub)
        if GLib.MainContext.default().find_source_by_id(term):
            GLib.source_remove(term)
    if not reply or reply[0][0] == 1:
        return None
    if reply[0][0] != 0:
        raise RuntimeError("桌面没有授权本次截屏")
    file = Gio.File.new_for_uri(reply[0][1]["uri"])
    stream = file.read(None)
    try:
        return GdkPixbuf.Pixbuf.new_from_stream(stream, None)
    finally:
        stream.close(None)


def select_region(source):
    width, height = source.get_width(), source.get_height()
    screen = Gdk.Display.get_default().get_primary_monitor() or Gdk.Display.get_default().get_monitor(0)
    work = screen.get_workarea()
    window = Gtk.Window(title="CMspark Mini · 框选截图")
    window.set_default_size(min(width, max(200, int(work.width * .9))),
                            min(height + 42, max(150, int(work.height * .88))))
    window.set_position(Gtk.WindowPosition.CENTER)
    window.set_keep_above(True)
    body = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=4)
    body.add(Gtk.Label(label="拖动选择要使用的区域，按 Esc 取消"))
    canvas = Gtk.DrawingArea()
    canvas.set_hexpand(True)
    canvas.set_vexpand(True)
    body.add(canvas)
    window.add(body)
    canvas.add_events(Gdk.EventMask.BUTTON_PRESS_MASK | Gdk.EventMask.BUTTON_RELEASE_MASK |
                      Gdk.EventMask.POINTER_MOTION_MASK)
    drag = []
    result = []

    def geometry():
        w, h = canvas.get_allocated_width(), canvas.get_allocated_height()
        scale = min(w / width, h / height)
        return scale, (w - width * scale) / 2, (h - height * scale) / 2

    def point(event):
        scale, x, y = geometry()
        return min(width, max(0, (event.x - x) / scale)), min(height, max(0, (event.y - y) / scale))

    def draw(_canvas, cr):
        scale, x, y = geometry()
        cr.translate(x, y)
        cr.scale(scale, scale)
        Gdk.cairo_set_source_pixbuf(cr, source, 0, 0)
        cr.paint()
        if len(drag) == 2:
            (x1, y1), (x2, y2) = drag
            cr.rectangle(min(x1, x2), min(y1, y2), abs(x1 - x2), abs(y1 - y2))
            cr.set_source_rgba(.12, .56, .9, .18)
            cr.fill_preserve()
            cr.set_source_rgb(.12, .56, .9)
            cr.set_line_width(2 / scale)
            cr.stroke()

    def press(_widget, event):
        if event.button == 1:
            drag[:] = [point(event), point(event)]
            canvas.queue_draw()

    def move(_widget, event):
        if drag:
            drag[1] = point(event)
            canvas.queue_draw()

    def release(_widget, event):
        if event.button != 1 or not drag:
            return
        (ax, ay), (bx, by) = drag[0], point(event)
        drag.clear()
        x, y = math.floor(min(ax, bx)), math.floor(min(ay, by))
        w, h = math.ceil(max(ax, bx)) - x, math.ceil(max(ay, by)) - y
        if w >= 2 and h >= 2:
            if w > 8192 or h > 8192 or w * h > 16777216:
                result.append("MINI_REGION_TOO_LARGE")
            else:
                result.append(source.new_subpixbuf(x, y, w, h))
            window.destroy()
        canvas.queue_draw()

    canvas.connect("draw", draw)
    canvas.connect("button-press-event", press)
    canvas.connect("motion-notify-event", move)
    canvas.connect("button-release-event", release)
    window.connect("key-press-event", lambda _w, e: window.destroy() if e.keyval == Gdk.KEY_Escape else False)
    window.connect("destroy", lambda *_args: Gtk.main_quit())
    window.show_all()
    canvas.get_window().set_cursor(Gdk.Cursor.new_from_name(canvas.get_display(), "crosshair"))
    Gtk.main()
    if result and isinstance(result[0], str):
        raise RuntimeError(result[0])
    return result[0] if result else None


def main():
    if not Gtk.init_check()[0]:
        raise RuntimeError("未检测到图形桌面")
    if os.environ.get("WAYLAND_DISPLAY") or os.environ.get("XDG_SESSION_TYPE") == "wayland":
        image = portal_image()
        if image is None:
            return
    else:
        root = Gdk.get_default_root_window()
        image = Gdk.pixbuf_get_from_window(root, 0, 0, root.get_width(), root.get_height())
        if image is None:
            raise RuntimeError("无法读取当前显示器")
    crop = select_region(image)
    if crop:
        ok, data = crop.save_to_bufferv("png", [], [])
        if not ok or len(data) > 6 * 1024 * 1024:
            raise RuntimeError("MINI_REGION_TOO_LARGE")
        sys.stdout.buffer.write(data)


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(str(exc), file=sys.stderr)
        sys.exit(1)
