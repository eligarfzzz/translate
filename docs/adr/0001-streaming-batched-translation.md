# Streaming batched translation instead of a single page request

Translations are sent in **batches** of text nodes, each as its own streaming request (`stream: true`), rather than one request for the whole page. This keeps latency bounded per batch (a large page doesn't wait for one giant response), allows per-batch error isolation, and renders translations incrementally as tokens arrive. The cost is more requests and more prompt overhead per batch, accepted for v1.
