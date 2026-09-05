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

-- Phase 1 W5: list inbox message TargetIds (top-N).
-- Format per docs/decisions/targetid-format-synthesis.md:
--   "macos:com.apple.mail:<account-name>:msg-<stable-id>"
-- The account-name segment disambiguates Mail's account-scoped message ids.
-- Audit M2: KEEP EMITTING RAW ids — account names may contain spaces or
-- punctuation outside the TS validator charset; the TS adapter re-encodes
-- both volatile segments base64url at the list boundary.

-- Phase 2 (#69, audit M8 fix): maxCount arrives as a positional handler
-- argument via an 'ascr'/'psbr' subroutine Apple Event (runScriptHandler in
-- host.swift) — the hardcoded top-100 cap is gone for list-mail. Swift
-- validates 1...500 before invoking (the script walks the inbox one Apple
-- event per message, so the ceiling bounds worst-case latency).
on listMail(maxCount)
	tell application "Mail"
		set msgCount to count of messages of inbox
		if msgCount is greater than maxCount then set msgCount to maxCount

		set ids to {}
		repeat with i from 1 to msgCount
			set m to message i of inbox
			set msgId to id of m
			try
				set acctName to name of account of mailbox of m
			on error
				set acctName to "unknown"
			end try
			set end of ids to "macos:com.apple.mail:" & acctName & ":msg-" & (msgId as string)
		end repeat
	end tell

	set jsonParts to {}
	repeat with anId in ids
		set end of jsonParts to "\"" & my jsonEscape(anId) & "\""
	end repeat
	return "[" & (my joinList(jsonParts, ",")) & "]"
end listMail

on joinList(lst, sep)
	set oldTids to AppleScript's text item delimiters
	set AppleScript's text item delimiters to sep
	set out to lst as string
	set AppleScript's text item delimiters to oldTids
	return out
end joinList
