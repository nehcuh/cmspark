# Actual payload fixture (#70)

`app-gallery-list-70.json` was recorded from production `handleAppsMessage({type: "apps.list"})`, not handwritten. The dedicated Companion test invokes the actual handler and configuration writer in the canonical runner's owned data directory; `exists` always returns false and `signerProbe` throws if unexpectedly invoked. The Windows platform field is an explicit inert test seam. No app/signature/native result is fabricated. All certificate reference fields remain null.

Record using the focused Companion test with `CMSPARK_70_RECORD_FIXTURE` set to an absolute new owned file, then copy the exact output. Current payload SHA256: `f523c6fa08b4d0d7c1a82fdca8c00858cf54e517e6f2f8e886314aec8dab4228`.

The frontend renders this complete payload. Malformed fields are deliberate negative mutations of that real output; they are not positive certificate evidence.
