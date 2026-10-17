# Actual payload fixture (#70)

`app-gallery-list-70.json` was recorded from production `handleAppsMessage({type: "apps.list"})`, not handwritten. The dedicated Companion test invokes the actual handler and configuration writer in the canonical runner's owned data directory; `exists` always returns false and `signerProbe` throws if unexpectedly invoked. The Windows platform field is an explicit inert test seam. No app/signature/native result is fabricated. The bundled fixed-release reference fields are copied from the separately recorded hosted Windows witness; this apps.list fixture still reports no detected installed file or installed-file signature verdict.

Record using the focused Companion test with `CMSPARK_70_RECORD_FIXTURE` set to an absolute new owned file, then copy the exact output. Current payload SHA256: `c685eb57e3572cd62cf736b7c256885d328270443f4f84c5a0b8d5c3ea8ab741`.

The frontend renders this complete payload. Malformed fields are deliberate negative mutations of that real output; they are not positive certificate evidence.
