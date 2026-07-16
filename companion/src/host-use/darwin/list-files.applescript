on jsonEscape(s)
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

-- Phase 1 W7: list files in a Finder folder (metadata only — no content).
-- Format: "macos:com.apple.finder:<folder-name>:file-<encoded-name>"
-- Folder is hardcoded to "Documents" for Phase 1 W7 simplicity. Phase 2 will
-- accept a folder path argument. Stable id uses URL-encoded file name.
-- Note: this script returns top-N only (default 100) and is read-only.

set maxCount to 100
set ids to {}
tell application "Finder"
	try
		set folderItems to every item of folder "Documents" of home
		set itemCount to count of folderItems
		if itemCount is greater than maxCount then set itemCount to maxCount
		repeat with i from 1 to itemCount
			set f to item i of folderItems
			set fileName to name of f
			set end of ids to "macos:com.apple.finder:Documents:file-" & (my urlEncode(fileName))
		end repeat
	end try
end tell

set jsonParts to {}
repeat with anId in ids
	set end of jsonParts to "\"" & jsonEscape(anId) & "\""
end repeat
return "[" & (my joinList(jsonParts, ",")) & "]"

on joinList(lst, sep)
	set oldTids to AppleScript's text item delimiters
	set AppleScript's text item delimiters to sep
	set out to lst as string
	set AppleScript's text item delimiters to oldTids
	return out
end joinList

on urlEncode(s)
	set oldTids to AppleScript's text item delimiters
	set AppleScript's text item delimiters to ""
	set chars to text items of s
	set encoded to {}
	repeat with c in chars
		set cid to id of c
		if (cid ≥ 48 and cid ≤ 57) or (cid ≥ 65 and cid ≤ 90) or (cid ≥ 97 and cid ≤ 122) or c is "-" or c is "_" or c is "." or c is "~" then
			set end of encoded to c
		else
			set end of encoded to "%" & (my hex2(cid mod 256))
		end if
	end repeat
	set AppleScript's text item delimiters to ""
	set out to encoded as string
	set AppleScript's text item delimiters to oldTids
	return out
end urlEncode

on hex2(n)
	set digits to "0123456789ABCDEF"
	set hi to (n div 16) + 1
	set lo to (n mod 16) + 1
	return (character hi of digits) & (character lo of digits)
end hex2
