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

-- Phase 1 W7: list notes TargetIds (top-N).
-- Format: "macos:com.apple.Notes:<account>:note-<stable-id>"
-- Notes AppleScript `id of note` is stable across launches.
-- Audit M2: KEEP EMITTING RAW ids — the account name and CoreData id contain
-- characters outside the TS validator charset (spaces, ":", "/"); the TS
-- adapter re-encodes both volatile segments base64url at the list boundary.

set maxCount to 100
tell application "Notes"
	set noteCount to count of notes
	if noteCount is greater than maxCount then set noteCount to maxCount

	set ids to {}
	repeat with i from 1 to noteCount
		set n to note i
		set noteId to id of n
		try
			set acctName to name of account of n
		on error
			set acctName to "iCloud"
		end try
		set end of ids to "macos:com.apple.Notes:" & acctName & ":note-" & (noteId as string)
	end repeat
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
