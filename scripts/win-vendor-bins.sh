# Shared Windows vendor-binary lookup (package.sh + build-windows-installer.sh).
#
# - Prefer [ -f ] over [ -x ]: Git Bash -x is flaky on NTFS Program Files .exe.
# - Emit /c/Program Files/… always (Git Bash). C:/… only on MSYS/Cygwin —
#   on POSIX, C:/foo is cwd-relative and could exec a planted lookalike.

is_msysish() {
  case "$(uname -s 2>/dev/null || true)" in
    MINGW*|MSYS*|CYGWIN*) return 0 ;;
    *) return 1 ;;
  esac
}

# Print each candidate, then first existing file. Usage:
#   find_windows_pe "/c/Program Files/7-Zip/7z.exe" "C:/Program Files/7-Zip/7z.exe"
find_windows_pe() {
  local c
  for c in "$@"; do
    case "$c" in
      [Cc]:/*)
        is_msysish || continue
        ;;
    esac
    if [ -f "$c" ]; then
      printf '%s' "$c"
      return 0
    fi
  done
  return 1
}
