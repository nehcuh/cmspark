<tool_calls>
<invoke name="Glob">
<parameter name="pattern">companion/src/summoner/**/*.ts</parameter>
</invoke>
<invoke name="Grep">
<parameter name="pattern">surface</parameter>
<parameter name="path">companion/src/ws</parameter>
<parameter name="output_mode">content</parameter>
<parameter name="-n">true</parameter>
</invoke>
<invoke name="Grep">
<parameter name="pattern">mcp\.toggle_server|toggle_server</parameter>
<parameter name="path">companion/src</parameter>
<parameter name="output_mode">content</parameter>
<parameter name="-n">true</parameter>
</invoke>
<invoke name="Glob">
<parameter name="pattern">chrome-extension/src/sidepanel/**/*.{ts,tsx,css}</parameter>
</invoke>
</tool_calls>