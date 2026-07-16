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

-- Phase 0: max-chars hardcoded; Phase 1 will pass argv via executeAppleEvent.
set maxChars to 500
set theSender to ""
set theSubject to ""
set theDate to ""
set theBody to "[inbox empty]"

tell application "Mail"
	set msgCount to count of messages of inbox
	if msgCount is greater than 0 then
		set m to message 1 of inbox
		set theSender to sender of m
		set theSubject to subject of m
		set theDate to (date received of m) as string
		set theBody to content of m
		if (length of theBody) > maxChars then
			set theBody to text 1 thru maxChars of theBody
		end if
	end if
end tell

return "{\"sender\":\"" & jsonEscape(theSender) & "\",\"subject\":\"" & jsonEscape(theSubject) & "\",\"date_received\":\"" & jsonEscape(theDate) & "\",\"body_preview\":\"" & jsonEscape(theBody) & "\"}"
