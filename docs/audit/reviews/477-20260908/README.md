# #477 UI gate

Final production source matches polish-final manifest. Grok4.6 APPROVE_WITH_NITS; DeepSeekV4Pro APPROVE. Review covers only #477, not full #476 or native desktop.

Machine: full suite5023 total5000 pass23skip +20 auxiliary before final polish; final buildPASS,71 owning testsPASS; Playwright actual HTML and synthetic transport at320/360/390/760/1000/1440 andshort420/480PASS. Additional focus/error assertions after packet freeze change tests only: close button -> visible navigation; wide Escape -> newChat; browser-status error never paints false disconnected.

Disposition: full-height sidebar divider is decorative and intentionally not extended (fill is continuous); status/CTA retain wider high-priority content geometry instead of constrained prose width, no hit-test/overflow failure. Escape activeElement test now passes in narrow andwide. HTTP test helper converts legacy test query token notation into Cookie before send; actual GET query-token rejection test remains passing. No production query-token allowance.

Transport failures: first Grok offloaded/truncated prompt stalled (exit124); first DeepSeekCLI stopped at max_tokens with empty final (invalid, not approval). Direct configured DeepSeekV4Pro with thinking disabled returned explicit verdicts; Grok --verbatim complete source avoided prompt offload. Only final text/model metadata archived, no hidden reasoning or credentials. DeepSeek runner has_verdict is case-sensitive and falsely saysfalse for heading "Verdict"; explicit final APPROVE text is present and inspected.

Windows/macOS icons and prior conversation management merged separately in#475. #476/#480 remain open. Current macOS workspace DMG builds; live replacement proof recorded separately after signature/runtime verification.
