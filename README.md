# Official FMCSA news collector

This repository contains only public FMCSA articles and a standalone collector. It contains no CPD application code, database, documents, credentials or AI keys.

Runs hourly at minute 17 and on manual request. A failed fetch preserves the previous verified JSON. Each article retains its official URL, publication date and article text. checkedAt records the last successful collection; the consuming application must visibly label old snapshots.

Requires GitHub Actions enabled and repository Contents write permission for the workflow. Verify the first run succeeds before configuring CPD Safety Solutions to consume the raw JSON. No Cloudflare permissions required.

