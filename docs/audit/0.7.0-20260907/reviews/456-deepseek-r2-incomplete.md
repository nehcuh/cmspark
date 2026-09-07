# DeepSeek R2 incomplete attempts — not approval

Actual model: deepseek-v4-pro. The first Read-based R2 invocation was stopped after over 31 minutes without a final report. Its empty output does not constitute a finding or verdict.

The subsequent full-packet stdin invocation returned is_error=true and exited 1 after exceeding the per-response output limit. It produced no usable review; accumulated output token usage includes automatic transport retries and is not a completed report.

```json
{
  "is_error": true,
  "duration_ms": 1159508,
  "result": "API Error: Claude's response exceeded the 16000 output token maximum. To configure this behavior, set the CLAUDE_CODE_MAX_OUTPUT_TOKENS environment variable.",
  "modelUsage": {
    "deepseek-v4-pro": {
      "inputTokens": 43481,
      "outputTokens": 64000,
      "cacheReadInputTokens": 129408,
      "cacheCreationInputTokens": 0,
      "webSearchRequests": 0,
      "costUSD": 1.882109,
      "contextWindow": 200000,
      "maxOutputTokens": 32000
    }
  }
}
```

Recovery uses three bounded lanes of the same frozen R2: authorization, HTTP transport/execution, and knowledge projection. Their section union is mechanically checked against the complete original packet; overlapping cross-module context is preserved. All three require valid reports and zero unresolved BLOCK/MAJOR findings. No other reviewer reports are supplied. The original full packet, each lane and its mapping/digest remain in local artifacts.
