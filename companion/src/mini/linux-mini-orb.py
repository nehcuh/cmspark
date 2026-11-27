"""GTK desktop Mini. The tray owns visibility preferences and action dispatch."""
import json
import math
import os
from pathlib import Path
import sys

try:
    import cairo
    import gi
    gi.require_version("Gtk", "3.0")
    gi.require_version("Gdk", "3.0")
    from gi.repository import Gdk, GLib, Gtk
except (ImportError, ValueError):
    sys.exit("Linux Mini 需要 GTK 3 和系统 Python 的 PyGObject、Cairo 组件。")

SIZE = 48


class MiniOrb:
    def __init__(self, position_file, icon):
        self.position_file = position_file
        self.window = Gtk.Window(title="CMspark Mini")
        self.window.set_name("cmspark-mini")
        self.window.set_role("cmspark-mini")
        self.window.set_decorated(False)
        self.window.set_resizable(False)
        self.window.set_keep_above(True)
        self.window.stick()
        self.window.set_skip_taskbar_hint(True)
        self.window.set_skip_pager_hint(True)
        self.window.set_focus_on_map(False)
        self.window.set_type_hint(Gdk.WindowTypeHint.UTILITY)
        self.window.get_accessible().set_name("CMspark Mini")
        screen = self.window.get_screen()
        visual = screen.get_rgba_visual()
        if visual:
            self.window.set_visual(visual)
        self.x11 = "X11" in self.window.get_display().__gtype__.name
        self.button = Gtk.Button()
        self.button.set_name("mini-orb")
        self.button.set_size_request(SIZE, SIZE)
        self.button.get_accessible().set_name("CMspark Mini 操作菜单")
        self.button.set_tooltip_text("单击或右键打开操作 · 长按快速对话 · 拖动移动")
        self.button.set_image(self.icon(icon) if os.path.exists(icon) else Gtk.Image.new_from_icon_name("mail-message-new-symbolic", Gtk.IconSize.BUTTON))
        self.window.add(self.button)
        style = Gtk.CssProvider()
        style.load_from_data(b"""
            #cmspark-mini { background: transparent; }
            #mini-orb { border-radius: 50%; padding: 4px; border: 1px solid #718c7b;
                background: #151d2c; box-shadow: none; }
            #mini-orb:hover, #mini-orb:focus { border-color: #68e4b0; }
        """)
        Gtk.StyleContext.add_provider_for_screen(screen, style, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION)
        self.menu = Gtk.Menu()
        self.add_item(self.menu, "快速对话", "chat")
        capture = Gtk.MenuItem.new_with_label("截图")
        sub = Gtk.Menu()
        captures = (("抽取待办", "todo"), ("询问图片", "ask"), ("OCR 识别", "ocr"), ("仅截图", "capture"))
        for label, action in captures:
            self.add_item(sub, label, action)
        delayed = Gtk.MenuItem.new_with_label("延时截图")
        times = Gtk.Menu()
        delayed.set_submenu(times)
        sub.append(delayed)
        wayland = not self.x11
        for seconds in (3, 5, 10):
            label = f"{seconds} 秒后调出系统截屏" if wayland else f"框选后 {seconds} 秒"
            item = Gtk.MenuItem.new_with_label(label)
            actions = Gtk.Menu()
            item.set_submenu(actions)
            times.append(item)
            for title, action in captures:
                self.add_item(actions, title, f"{action}:{seconds}")
        capture.set_submenu(sub)
        self.menu.append(capture)
        self.menu.append(Gtk.SeparatorMenuItem())
        self.add_item(self.menu, "资料搜索", "search")
        self.add_item(self.menu, "会议记录", "meeting")
        self.menu.attach_to_widget(self.button, None)
        self.menu.show_all()
        self.start = None
        self.hold_timer = 0
        self.save_timer = 0
        self.position = None
        self.buffer = b""
        self.restore()
        self.button.add_events(Gdk.EventMask.POINTER_MOTION_MASK | Gdk.EventMask.BUTTON_PRESS_MASK |
                               Gdk.EventMask.BUTTON_RELEASE_MASK)
        self.button.connect("button-press-event", self.press)
        self.button.connect("button-release-event", self.release)
        self.button.connect("motion-notify-event", self.motion)
        self.button.connect("clicked", lambda *_: self.popup())
        self.button.connect("popup-menu", lambda *_: self.popup())
        self.window.connect("map-event", self.mapped)
        self.window.connect("configure-event", self.configured)
        self.window.connect("destroy", lambda *_: Gtk.main_quit())
        GLib.io_add_watch(sys.stdin.fileno(), GLib.PRIORITY_DEFAULT,
                          GLib.IO_IN | GLib.IO_HUP | GLib.IO_ERR, self.command)

    @staticmethod
    def icon(path):
        from gi.repository import GdkPixbuf
        return Gtk.Image.new_from_pixbuf(GdkPixbuf.Pixbuf.new_from_file_at_scale(path, 34, 34, True))

    def add_item(self, menu, label, action):
        item = Gtk.MenuItem.new_with_label(label)
        item.connect("activate", lambda *_: self.emit_action(action))
        menu.append(item)

    def emit_action(self, action):
        self.cancel_press()
        if action.split(":", 1)[0] in ("todo", "ask", "ocr", "capture"):
            self.hide()
            self.window.get_display().sync()
        print("action:" + action, flush=True)

    def popup(self, event=None):
        self.cancel_press()
        self.menu.popup_at_widget(self.button, Gdk.Gravity.NORTH_WEST, Gdk.Gravity.SOUTH_WEST, event)
        return True

    def cancel_press(self):
        self.start = None
        if self.hold_timer:
            GLib.source_remove(self.hold_timer)
            self.hold_timer = 0

    def press(self, _button, event):
        if event.button == 3:
            return self.popup(event)
        if event.button != 1:
            return False
        self.cancel_press()
        self.start = (event.x_root, event.y_root)

        def hold():
            self.hold_timer = 0
            self.emit_action("chat")
            return False

        self.hold_timer = GLib.timeout_add(450, hold)
        return True

    def motion(self, _button, event):
        if not self.start or not event.state & Gdk.ModifierType.BUTTON1_MASK:
            return False
        x, y = self.start
        if max(abs(event.x_root - x), abs(event.y_root - y)) >= 5:
            self.cancel_press()
            self.window.begin_move_drag(1, int(event.x_root), int(event.y_root), event.time)
        return True

    def release(self, _button, event):
        if event.button != 1:
            return False
        if self.start:
            self.popup(event)
        return True

    def restore(self):
        if not self.x11:
            return
        display = self.window.get_display()
        monitor = display.get_primary_monitor() or display.get_monitor(0)
        if not monitor:
            return
        area = monitor.get_workarea()
        x, y = area.x + area.width - SIZE - 30, area.y + area.height - SIZE - 72
        try:
            saved = json.loads(self.position_file.read_text())
            x, y = int(saved["x"]), int(saved["y"])
            area = display.get_monitor_at_point(x + SIZE // 2, y + SIZE // 2).get_workarea()
        except (OSError, ValueError, KeyError, TypeError, OverflowError):
            pass
        self.window.move(max(area.x, min(x, area.x + area.width - SIZE)),
                         max(area.y, min(y, area.y + area.height - SIZE)))

    def configured(self, _window, _event):
        if self.x11 and self.window.get_mapped():
            self.position = tuple(self.window.get_position())
            if self.save_timer:
                GLib.source_remove(self.save_timer)
            self.save_timer = GLib.timeout_add(180, self.save)
        return False

    def save(self):
        self.save_timer = 0
        if self.position:
            x, y = self.position
            try:
                self.position_file.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
                staging = self.position_file.with_suffix(".tmp")
                staging.write_text(json.dumps({"x": x, "y": y}))
                staging.replace(self.position_file)
            except OSError:
                pass
        return False

    def mapped(self, _window, _event):
        if self.x11 and not self.window.get_screen().is_composited():
            # Noncompositing X11 window managers show transparent corners as black.
            size = self.window.get_allocated_width()
            surface = cairo.ImageSurface(cairo.FORMAT_A1, size, size)
            pen = cairo.Context(surface)
            pen.arc(size / 2, size / 2, size / 2, 0, math.tau)
            pen.fill()
            self.window.shape_combine_region(Gdk.cairo_region_create_from_surface(surface))
        print("shown", flush=True)
        return False

    def hide(self):
        self.cancel_press()
        self.menu.popdown()
        self.window.hide()

    def command(self, fd, condition):
        chunk = os.read(fd, 4096) if condition & GLib.IO_IN else b""
        if not chunk:
            Gtk.main_quit()
            return False
        self.buffer += chunk
        while b"\n" in self.buffer:
            cmd, _, self.buffer = self.buffer.partition(b"\n")
            if cmd == b"show":
                if self.window.get_mapped():
                    print("shown", flush=True)
                else:
                    self.window.show_all()
            elif cmd == b"hide":
                self.hide()
            elif cmd == b"quit":
                Gtk.main_quit()
                return False
        return True


if __name__ == "__main__":
    if not Gtk.init_check()[0]:
        sys.exit("无法连接 Linux 图形桌面，请在桌面登录后从托盘打开 Mini。")
    orb = MiniOrb(Path(sys.argv[1]), sys.argv[2])
    Gtk.main()
    orb.save()
