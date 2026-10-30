These four unmodified headers are from `node-v22.23.4-headers.tar.gz`, whose
SHA-256 is pinned in `DESKTOP_WINDOWS_INPUTS.headers`. Their individual hashes
are also checked by the production helper and its test before use. They provide
a deterministic test runtime layout; they are not substituted for the real build
runtime. `LICENSE` reproduces the Node.js v22.23.4 upstream license with one
whitespace-only indentation normalized; it is not a byte-identical archive copy.
