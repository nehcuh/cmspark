# Actual Git text-rename fixture (#464)

`code-review-rename-464.patch` is the exact 7522-byte public Git rename patch
from commit `bdc05e61ffc6d878a246a552f40e26ec48c53010`, parent
`52c14c27cd7bb6831c6089e6db0a292c48c63516`, recorded with rename detection.
It is R064 and contains six changed text hunks. Its SHA256 and independently
enumerated 174-line old/new hunk inventory digest are in the adjacent JSON.

The service test deliberately replaces text in an existing recorded BrowserBridge
wire with this real patch and its public Git identity. It is a synthetic wire
fixture, not a new authenticated webpage, code-host coverage or Agent receipt.
The unchanged EvidenceStore and CodeReviewService then produce the actual stored
review and validate side-specific findings. Native/host/business completeness
remains unknown and review_ready stays false.
