on jsonEscape(s)
	-- Escape JSON metacharacters in the given string. Order matters:
	-- backslash first (so we don't double-escape subsequent replacements).
	-- CRITICAL: capture text items into a variable BEFORE switching the
	-- delimiter; otherwise split+join with the same delimiter is a no-op
	-- (Kimi phase0 review Critical #1).
	set oldTids to AppleScript's text item delimiters

	set AppleScript's text item delimiters to "\\"
	set sParts to text items of s
	set AppleScript's text item delimiters to "\\\\"
	set s to sParts as string

	set AppleScript's text item delimiters to "\""
	set sParts to text items of s
	set AppleScript's text item delimiters to "\\\""
	set s to sParts as string

	set AppleScript's text item delimiters to (character id 13)
	set sParts to text items of s
	set AppleScript's text item delimiters to "\\r"
	set s to sParts as string

	set AppleScript's text item delimiters to (character id 10)
	set sParts to text items of s
	set AppleScript's text item delimiters to "\\n"
	set s to sParts as string

	set AppleScript's text item delimiters to (character id 9)
	set sParts to text items of s
	set AppleScript's text item delimiters to "\\t"
	set s to sParts as string

	set AppleScript's text item delimiters to oldTids
	return s
end jsonEscape

-- Audit M8: maxChars is FIXED script-side. cmspark-host runs this precompiled
-- .scpt via NSAppleScript executeAndReturnError, which cannot receive argv
-- (Phase 2 may add NSAppleEventDescriptor handler invocation). The TS layer
-- no longer sends --max-chars (it was silently dropped); smaller max_chars
-- values are applied TS-side after parsing. Values above 500 return ≤500.
--
-- User test 2026-07-26 (#mxz27i): `message 1 of inbox` is the OLDEST message
-- in the unified inbox (e.g. 2023 iCloud welcome), NOT the newest — so
-- Exchange / Gmail recent mail never surfaces. Pick max(date received) among
-- recent messages (30d, then 365d fallback). Unified inbox already merges
-- all accounts (iCloud + Exchange + …).
set maxChars to 500
set theSender to ""
set theSubject to ""
set theDate to ""
set theBody to "[inbox empty]"

tell application "Mail"
	set msgCount to count of messages of inbox
	if msgCount is greater than 0 then
		set recent to {}
		try
			set cutoff to (current date) - (30 * days)
			set recent to (messages of inbox whose date received ≥ cutoff)
		end try
		if (count of recent) is 0 then
			try
				set cutoff to (current date) - (365 * days)
				set recent to (messages of inbox whose date received ≥ cutoff)
			end try
		end if
		-- Last resort: full scan is too slow on large inboxes; sample ends.
		if (count of recent) is 0 then
			set end of recent to message 1 of inbox
			set end of recent to message msgCount of inbox
			if msgCount > 2 then set end of recent to message (msgCount - 1) of inbox
		end if

		set bestMsg to item 1 of recent
		set bestDate to date received of bestMsg
		set nRecent to count of recent
		repeat with i from 2 to nRecent
			set m to item i of recent
			try
				set d to date received of m
				if d > bestDate then
					set bestDate to d
					set bestMsg to m
				end if
			end try
		end repeat

		set theSender to sender of bestMsg
		set theSubject to subject of bestMsg
		set theDate to (date received of bestMsg) as string
		set theBody to content of bestMsg
		if (length of theBody) > maxChars then
			set theBody to text 1 thru maxChars of theBody
		end if
	end if
end tell

return "{\"sender\":\"" & jsonEscape(theSender) & "\",\"subject\":\"" & jsonEscape(theSubject) & "\",\"date_received\":\"" & jsonEscape(theDate) & "\",\"body_preview\":\"" & jsonEscape(theBody) & "\"}"
