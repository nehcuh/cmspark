#!/bin/sh
# Match the plain libomp name or a dot-separated numeric soname only.
is_whisper_omp_name() (
  case "$1" in
    libomp.dylib) return 0 ;;
    libomp.*.dylib)
      version=${1#libomp.}
      version=${version%.dylib}
      case "$version" in ''|*[!0-9.]*|.*|*.|*..*) return 1 ;; *) return 0 ;; esac ;;
    *) return 1 ;;
  esac
)
