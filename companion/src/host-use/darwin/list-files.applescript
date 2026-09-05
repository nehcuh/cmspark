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
-- Format: "macos:com.apple.finder:<folder-name>:file-<raw-name>"
-- Folder is hardcoded to "Documents" for Phase 1 W7 simplicity. Phase 2 will
-- accept a folder path argument.
-- Note: this script returns top-N only (default 100) and is read-only.
-- Audit M2 + issue #69 F3: KEEP EMITTING RAW filenames. Do NOT urlEncode.
-- collided (e.g. U+4E00 一 and U+4F00 伀 both became %00). The TS adapter's
-- encodeRawTargetId base64url-encodes folder + file name at the list
-- boundary (Buffer UTF-8 bijection) so the validator charset [A-Za-z0-9_-]
-- is satisfied and CJK round-trips losslessly. jsonEscape still handles
-- JSON metacharacters (" \ CR LF TAB) in the filename.

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
			set end of ids to "macos:com.apple.finder:Documents:file-" & fileName
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
