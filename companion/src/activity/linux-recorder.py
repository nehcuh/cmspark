"""First-party, read-only X11 recorder. No shell, input, activation or network.

PID comes from the X server's XRes client ownership, NEVER _NET_WM_PID.
Wayland/XWayland and unknown identities are refused before pixels are read.
"""
import ctypes as C
import ctypes.util
import hashlib
import json
import os
import re
import stat
import struct
import subprocess
import sys
import zlib

PROTECTED = re.compile(r"keychain|1password|onepassword|bitwarden|lastpass|keepass|dashlane|authy|authenticator|passwords|wallet|metamask|ledger|exodus|secretive|screensaver|screenlock|kscreenlocker|gnome-shell|gdm|lightdm|sddm", re.I)
P = C.c_void_p
U = C.c_ulong
I = C.c_int


def unlocked_brokers():
    """Read existing local desktop services without auto-activating a lock manager.

    XScreenSaver alone cannot observe compositor-drawn lock screens. Unknown is
    a refusal, never permission to read a hidden application's redirected pixels.
    """
    address = os.environ.get("DBUS_SESSION_BUS_ADDRESS", "")
    if not address:
        try:
            bus = f"/run/user/{os.getuid()}/bus"
            metadata = os.lstat(bus)
            if stat.S_ISSOCK(metadata.st_mode) and metadata.st_uid == os.getuid():
                address = "unix:path=" + bus
        except OSError:
            pass
    if not address.startswith("unix:") or ";" in address:
        raise RuntimeError("LOCK_STATE_UNKNOWN")

    def call(owner, target, method, *args):
        try:
            result = subprocess.run(["/usr/bin/gdbus", "call", "--session", "--dest", owner, "--object-path", target, "--method", method, *args], capture_output=True, text=True, timeout=2, env={**os.environ, "DBUS_SESSION_BUS_ADDRESS": address})
            return result.stdout.strip() if result.returncode == 0 and len(result.stdout) < 512 else None
        except (OSError, subprocess.TimeoutExpired):
            return None

    observed = []
    for name, targets in [
        ("org.gnome.ScreenSaver", ["/org/gnome/ScreenSaver"]),
        ("org.freedesktop.ScreenSaver", ["/org/freedesktop/ScreenSaver", "/ScreenSaver"]),
        ("org.xfce.ScreenSaver", ["/org/xfce/ScreenSaver"]),
        ("org.mate.ScreenSaver", ["/org/mate/ScreenSaver"]),
        ("org.cinnamon.ScreenSaver", ["/org/cinnamon/ScreenSaver"]),
    ]:
        exists = call("org.freedesktop.DBus", "/org/freedesktop/DBus", "org.freedesktop.DBus.NameHasOwner", name)
        if exists == "(false,)":
            continue
        if exists != "(true,)":
            raise RuntimeError("LOCK_STATE_UNKNOWN")
        owner_value = call("org.freedesktop.DBus", "/org/freedesktop/DBus", "org.freedesktop.DBus.GetNameOwner", name)
        owner = re.fullmatch(r"\('(:[0-9]+\.[0-9]+)',\)", owner_value or "")
        if not owner:
            raise RuntimeError("LOCK_STATE_UNKNOWN")
        unique = owner.group(1)
        uid_value = call("org.freedesktop.DBus", "/org/freedesktop/DBus", "org.freedesktop.DBus.GetConnectionUnixUser", unique)
        uid = re.fullmatch(r"\((?:uint32 )?([0-9]+),\)", uid_value or "")
        if not uid or int(uid.group(1)) != os.getuid():
            raise RuntimeError("LOCK_STATE_UNKNOWN")
        responses = [(target, call(unique, target, name + ".GetActive")) for target in targets]
        if any(value == "(true,)" for _target, value in responses):
            raise RuntimeError("SCREEN_LOCK_OR_SAVER")
        valid = [target for target, value in responses if value == "(false,)"]
        if not valid:
            raise RuntimeError("LOCK_STATE_UNKNOWN")
        observed.append((name, unique, valid[0]))
    if not observed:
        raise RuntimeError("LOCK_STATE_UNKNOWN")
    return observed


class Spec(C.Structure):
    _fields_ = [("client", U), ("mask", C.c_uint)]


class Id(C.Structure):
    _fields_ = [("spec", Spec), ("length", C.c_long), ("value", P)]


class Saver(C.Structure):
    _fields_ = [("window", U), ("state", I), ("kind", I), ("til_or_since", U), ("idle", U), ("eventMask", U)]


class Image(C.Structure):
    _fields_ = [("width", I), ("height", I), ("xoffset", I), ("format", I), ("data", P), ("byte_order", I), ("bitmap_unit", I), ("bitmap_bit_order", I), ("bitmap_pad", I), ("depth", I), ("bytes_per_line", I), ("bits_per_pixel", I), ("red_mask", U), ("green_mask", U), ("blue_mask", U)]


class Attributes(C.Structure):
    _fields_ = [(name, I) for name in ("x", "y", "width", "height", "border_width", "depth")] + [("visual", P), ("root", U)] + [(name, I) for name in ("class_", "bit_gravity", "win_gravity", "backing_store")] + [("backing_planes", U), ("backing_pixel", U), ("save_under", I), ("colormap", U), ("map_installed", I), ("map_state", I), ("all_event_masks", C.c_long), ("your_event_mask", C.c_long), ("do_not_propagate_mask", C.c_long), ("override_redirect", I), ("screen", P)]


def library(name):
    candidate = ctypes.util.find_library(name)
    if not candidate:
        raise RuntimeError("DEPENDENCY_MISSING")
    return C.CDLL(candidate)


class Desktop:
    def __init__(self):
        if os.environ.get("WAYLAND_DISPLAY") or os.environ.get("XDG_SESSION_TYPE") != "x11" or not re.fullmatch(r"(?:unix/?)?:[0-9]{1,5}(?:\.[0-9]{1,3})?", os.environ.get("DISPLAY", "")):
            raise RuntimeError("X11_DESKTOP_REQUIRED")
        self.x = library("X11")
        self.res = library("XRes")
        self.ss = library("Xss")
        signatures = {
            "XOpenDisplay": (P, [C.c_char_p]), "XDefaultRootWindow": (U, [P]), "XCloseDisplay": (I, [P]),
            "XInternAtom": (U, [P, C.c_char_p, I]), "XFree": (I, [P]),
            "XGetWindowProperty": (I, [P, U, U, C.c_long, C.c_long, I, U, C.POINTER(U), C.POINTER(I), C.POINTER(U), C.POINTER(U), C.POINTER(P)]),
            "XGetGeometry": (I, [P, U, C.POINTER(U), C.POINTER(I), C.POINTER(I), C.POINTER(C.c_uint), C.POINTER(C.c_uint), C.POINTER(C.c_uint), C.POINTER(C.c_uint)]),
            "XTranslateCoordinates": (I, [P, U, U, I, I, C.POINTER(I), C.POINTER(I), C.POINTER(U)]),
            "XGetImage": (C.POINTER(Image), [P, U, I, I, C.c_uint, C.c_uint, U, I]),
            "XDestroyImage": (I, [C.POINTER(Image)]), "XGrabServer": (I, [P]), "XUngrabServer": (I, [P]), "XSync": (I, [P, I]),
            "XGetWindowAttributes": (I, [P, U, C.POINTER(Attributes)]),
            "XGetInputFocus": (I, [P, C.POINTER(U), C.POINTER(I)]),
            "XQueryExtension": (I, [P, C.c_char_p, C.POINTER(I), C.POINTER(I), C.POINTER(I)]),
            "XQueryTree": (I, [P, U, C.POINTER(U), C.POINTER(U), C.POINTER(C.POINTER(U)), C.POINTER(C.c_uint)]),
        }
        for name, (result, args) in signatures.items():
            fn = getattr(self.x, name); fn.restype = result; fn.argtypes = args
        self.res.XResQueryClientIds.argtypes = [P, C.c_long, C.POINTER(Spec), C.POINTER(C.c_long), C.POINTER(C.POINTER(Id))]
        self.res.XResGetClientPid.argtypes = [C.POINTER(Id)]
        self.res.XResGetClientPid.restype = I
        self.res.XResClientIdsDestroy.argtypes = [C.c_long, C.POINTER(Id)]
        self.ss.XScreenSaverQueryInfo.argtypes = [P, U, C.POINTER(Saver)]
        self.display = self.x.XOpenDisplay(None)
        if not self.display:
            raise RuntimeError("X11_AUTHORIZATION_REQUIRED")
        opcode, event, error = I(), I(), I()
        if self.x.XQueryExtension(self.display, b"XWAYLAND", C.byref(opcode), C.byref(event), C.byref(error)):
            self.x.XCloseDisplay(self.display)
            raise RuntimeError("X11_DESKTOP_REQUIRED")
        self.root = self.x.XDefaultRootWindow(self.display)
        # X errors must fail the operation, not terminate halfway through provenance.
        self.error = False
        self.error_handler = C.CFUNCTYPE(I, P, P)(self.on_error)
        self.x.XSetErrorHandler.argtypes = [P]
        self.x.XSetErrorHandler(self.error_handler)

    def on_error(self, _display, _error):
        self.error = True
        return 0

    def prop(self, window, name):
        actual, fmt, count, remaining, data = U(), I(), U(), U(), P()
        atom = self.x.XInternAtom(self.display, name.encode("ascii"), True)
        if not atom:
            return []
        result = self.x.XGetWindowProperty(self.display, window, atom, 0, 4096, False, 0, C.byref(actual), C.byref(fmt), C.byref(count), C.byref(remaining), C.byref(data))
        try:
            if result != 0 or remaining.value or count.value > 4096 or not data:
                return []
            if fmt.value == 32:
                return list(C.cast(data, C.POINTER(U))[:count.value])
            return C.string_at(data, count.value) if fmt.value == 8 else []
        finally:
            if data:
                self.x.XFree(data)

    def client_pid(self, window):
        spec, count, ids = Spec(window, 2), C.c_long(), C.POINTER(Id)()
        if self.res.XResQueryClientIds(self.display, 1, C.byref(spec), C.byref(count), C.byref(ids)) != 0:
            raise RuntimeError("XRES_IDENTITY_UNAVAILABLE")
        try:
            if count.value != 1 or not ids or ids[0].spec.mask != 2:
                raise RuntimeError("XRES_IDENTITY_UNAVAILABLE")
            pid = self.res.XResGetClientPid(C.byref(ids[0]))
            if pid <= 0 or os.stat(f"/proc/{pid}").st_uid != os.getuid():
                raise RuntimeError("FOREIGN_PROCESS")
            return pid
        finally:
            if ids:
                self.res.XResClientIdsDestroy(count, ids)

    def info(self, window, include_title=True):
        attr = Attributes()
        if not self.x.XGetWindowAttributes(self.display, window, C.byref(attr)) or attr.map_state != 2:
            raise RuntimeError("WINDOW_NOT_VISIBLE")
        pid = self.client_pid(window)
        exe = os.readlink(f"/proc/{pid}/exe")
        if not exe.startswith("/") or exe.endswith(" (deleted)") or PROTECTED.search(exe):
            raise RuntimeError("PROTECTED_APPLICATION")
        with open(f"/proc/{pid}/stat", encoding="utf-8") as stream:
            started = stream.read(8192).rpartition(")")[2].split()[19]
        title = (self.prop(window, "_NET_WM_NAME") or self.prop(window, "WM_NAME")) if include_title else b""
        title = title.decode("utf-8", "replace")[:500] if isinstance(title, bytes) else ""
        return {"window": window, "pid": pid, "started": started, "app_id": "linux." + hashlib.sha256(exe.encode()).hexdigest(), "app_name": os.path.basename(exe)[:200], "title": title}

    def geometry(self, window):
        root, x, y, width, height, border, depth, child = U(), I(), I(), C.c_uint(), C.c_uint(), C.c_uint(), C.c_uint(), U()
        if not self.x.XGetGeometry(self.display, window, C.byref(root), C.byref(x), C.byref(y), C.byref(width), C.byref(height), C.byref(border), C.byref(depth)):
            raise RuntimeError("WINDOW_GONE")
        if not self.x.XTranslateCoordinates(self.display, window, self.root, 0, 0, C.byref(x), C.byref(y), C.byref(child)):
            raise RuntimeError("WINDOW_GONE")
        w, h = width.value, height.value
        if w <= 0 or h <= 0 or w > 8192 or h > 8192 or w*h > 16_777_216:
            raise RuntimeError("WINDOW_BOUNDS")
        return x.value, y.value, w, h

    def active(self):
        saver = Saver()
        if not self.ss.XScreenSaverQueryInfo(self.display, self.root, C.byref(saver)) or saver.state != 0:
            raise RuntimeError("SCREEN_LOCK_OR_SAVER")
        active = self.prop(self.root, "_NET_ACTIVE_WINDOW")
        stack = self.prop(self.root, "_NET_CLIENT_LIST_STACKING")
        if not isinstance(active, list) or len(active) != 1 or not stack or active[0] not in stack:
            raise RuntimeError("FOREGROUND_UNAVAILABLE")
        if stack[-1] != active[0]:
            raise RuntimeError("WINDOW_OCCLUDED")
        focus, revert = U(), I()
        self.x.XGetInputFocus(self.display, C.byref(focus), C.byref(revert))
        current = focus.value
        for _ in range(32):
            if current == active[0]:
                break
            if current in (0, 1, self.root):
                raise RuntimeError("FOCUS_IDENTITY_UNAVAILABLE")
            current, _children = self.tree(current)
        else:
            raise RuntimeError("FOCUS_IDENTITY_UNAVAILABLE")
        return self.info(active[0])

    def tree(self, window):
        root, parent, children, count = U(), U(), C.POINTER(U)(), C.c_uint()
        if not self.x.XQueryTree(self.display, window, C.byref(root), C.byref(parent), C.byref(children), C.byref(count)):
            raise RuntimeError("STACK_UNAVAILABLE")
        try:
            if count.value > 4096:
                raise RuntimeError("STACK_UNAVAILABLE")
            return parent.value, list(children[:count.value]) if children else []
        finally:
            if children:
                self.x.XFree(children)

    def unobscured(self, window, bounds):
        frame = window
        for _ in range(32):
            parent, _children = self.tree(frame)
            if parent == self.root:
                break
            if not parent or parent == frame:
                raise RuntimeError("STACK_UNAVAILABLE")
            frame = parent
        else:
            raise RuntimeError("STACK_UNAVAILABLE")
        _parent, children = self.tree(self.root)
        if frame not in children:
            raise RuntimeError("STACK_UNAVAILABLE")
        x, y, w, h = bounds
        for above in children[children.index(frame)+1:]:
            attr = Attributes()
            if not self.x.XGetWindowAttributes(self.display, above, C.byref(attr)):
                raise RuntimeError("STACK_UNAVAILABLE")
            if attr.map_state != 2 or attr.class_ == 2:  # InputOnly carries no pixels.
                continue
            ax, ay, aw, ah = self.geometry(above)
            if ax < x+w and ay < y+h and ax+aw > x and ay+ah > y:
                raise RuntimeError("WINDOW_OCCLUDED")

    def capture(self, output, allowed):
        brokers = unlocked_brokers()
        self.x.XGrabServer(self.display)
        try:
            before = self.active()
            if before["app_id"] not in allowed:
                return None
            window = before["window"]
            bounds = self.geometry(window)
            root_bounds = self.geometry(self.root)
            x, y, w, h = bounds
            if x < 0 or y < 0 or x+w > root_bounds[2] or y+h > root_bounds[3]:
                raise RuntimeError("WINDOW_NOT_FULLY_VISIBLE")
            self.unobscured(window, bounds)
            image = self.x.XGetImage(self.display, window, 0, 0, w, h, U(-1).value, 2)
            if not image:
                raise RuntimeError("CAPTURE_FAILED")
            try:
                value = image.contents
                if not value.data or value.width != w or value.height != h or value.bits_per_pixel != 32 or value.byte_order != 0 or (value.red_mask, value.green_mask, value.blue_mask) != (0xff0000, 0xff00, 0xff) or value.bytes_per_line < w*4 or value.bytes_per_line > w*4+64:
                    raise RuntimeError("UNSUPPORTED_PIXEL_LAYOUT")
                stride = value.bytes_per_line
                pixels = C.string_at(value.data, stride*h)
            finally:
                self.x.XDestroyImage(image)
            if self.active() != before or self.geometry(window) != bounds or self.error:
                raise RuntimeError("SOURCE_CHANGED")
        finally:
            self.x.XUngrabServer(self.display)
            self.x.XSync(self.display, False)
        if self.error:
            raise RuntimeError("SOURCE_CHANGED")
        if unlocked_brokers() != brokers:
            raise RuntimeError("SOURCE_CHANGED")
        rows = bytearray()
        for line in range(h):
            raw = pixels[line*stride:line*stride+w*4]
            rgb = bytearray(w*3); rgb[0::3] = raw[2::4]; rgb[1::3] = raw[1::4]; rgb[2::3] = raw[0::4]
            rows.extend(b"\x00" + rgb)
        def chunk(kind, body):
            return struct.pack("!I", len(body)) + kind + body + struct.pack("!I", zlib.crc32(kind+body) & 0xffffffff)
        png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack("!IIBBBBB", w, h, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(rows, 3)) + chunk(b"IEND", b"")
        if len(png) > 8*1024*1024:
            raise RuntimeError("IMAGE_TOO_LARGE")
        if not re.fullmatch(r"pending-[a-f0-9-]+\.png", os.path.basename(output)):
            raise RuntimeError("INVALID_OUTPUT")
        fd = os.open(output, os.O_WRONLY | os.O_NOFOLLOW)
        try:
            st = os.fstat(fd)
            if not stat.S_ISREG(st.st_mode) or st.st_uid != os.getuid() or st.st_nlink != 1 or st.st_size != 0 or stat.S_IMODE(st.st_mode) != 0o600:
                raise RuntimeError("UNSAFE_OUTPUT")
            with os.fdopen(fd, "wb", closefd=False) as stream:
                stream.write(png)
        finally:
            os.close(fd)
        return before

    def close(self):
        self.x.XCloseDisplay(self.display)


def main(argv):
    desktop = Desktop()
    try:
        if argv == ["probe"]:
            return {"ok": True, "window": desktop.active()}
        if argv == ["apps"]:
            stack = desktop.prop(desktop.root, "_NET_CLIENT_LIST_STACKING")
            if not isinstance(stack, list) or len(stack) > 4096:
                raise RuntimeError("APP_LIST_UNAVAILABLE")
            apps = {}
            for window in stack:
                try:
                    info = desktop.info(window, False)
                    if len(apps) < 200:
                        apps[info["app_id"]] = {"app_id": info["app_id"], "app_name": info["app_name"]}
                except (OSError, RuntimeError):
                    continue
            return {"ok": True, "apps": list(apps.values())}
        if len(argv) == 3 and argv[0] == "capture":
            allowed = json.loads(argv[2])
            if not isinstance(allowed, list) or len(allowed) > 20 or any(not isinstance(a, str) or not re.fullmatch(r"linux\.[a-f0-9]{64}", a) for a in allowed):
                raise RuntimeError("INVALID_ALLOWLIST")
            return {"ok": True, "window": desktop.capture(argv[1], allowed)}
        raise RuntimeError("INVALID_ARGUMENTS")
    finally:
        desktop.close()


if __name__ == "__main__":
    try:
        print(json.dumps(main(sys.argv[1:]), ensure_ascii=True))
    except Exception as error:
        # Never print process paths, window titles or captured text on failure.
        code = str(error)
        allowed = {"DEPENDENCY_MISSING", "X11_DESKTOP_REQUIRED", "X11_AUTHORIZATION_REQUIRED", "LOCK_STATE_UNKNOWN", "SCREEN_LOCK_OR_SAVER", "FOREGROUND_UNAVAILABLE", "FOCUS_IDENTITY_UNAVAILABLE", "WINDOW_OCCLUDED", "WINDOW_NOT_VISIBLE", "SOURCE_CHANGED", "XRES_IDENTITY_UNAVAILABLE", "FOREIGN_PROCESS", "PROTECTED_APPLICATION", "WINDOW_NOT_FULLY_VISIBLE", "STACK_UNAVAILABLE", "WINDOW_GONE", "WINDOW_BOUNDS", "UNSUPPORTED_PIXEL_LAYOUT", "CAPTURE_FAILED", "IMAGE_TOO_LARGE", "UNSAFE_OUTPUT", "INVALID_OUTPUT", "INVALID_ALLOWLIST", "INVALID_ARGUMENTS"}
        print(code if code in allowed else "X11_CAPTURE_UNAVAILABLE", file=sys.stderr)
        sys.exit(1)
