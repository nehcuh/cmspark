# Windows capture protective refusal (#723)

GitHub: #723
Status: implemented candidate; source review and real remote Windows acceptance pending.

This finite bugfix rejects the fixed `CMspark Confirmation Cockpit [723]` page title, or that exact marker followed by ` - `, in Windows executor selection, existing ownership validation, independent L2 preview, and the final capture boundary. The page publishes the title before mounting. A title is spoofable and is only a refusal signal. No title match or non-match supplies ownership, authorization, or pixel-quality evidence. Old loaded builds may lack the marker. Other OS selection is unchanged.

The existing fallback makes one existing ForceForeground call. A false result, non-target foreground after the existing 250ms settle, failed GetWindowRect, or foreground drift before save refuses the capture through existing CAPTUREFAILED/CAPTURE_FAILED. The initial rectangle query also consumes its BOOL. PrintWindow usable pixels remain available without foregrounding. BitBlt BOOL/black-frame refusal, DPI, raw cleanup, ownership and all L2/forceConfirm/45s/task budgets retain their existing semantics.

This does not prove that every topmost or partial occluder is absent, make title an extension identity, disable dialog channels, change thresholds, grant read-only decritical access, add quality/rect messages or auto-close the cockpit. Historical #723 HWND choice remains UNKNOWN. Refs #723; not a whole-issue closure. No changes to ADR-017 or the separate #728 ADR-025.
