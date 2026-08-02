# Speed and Performance

**Countless context curation optimizations allow Dirac to run lean and fast.**

To prevent "context bloat," Dirac uses `inspect_ast` to map source structure, retrieve complete named implementations, and locate exact symbol occurrences without reading every line. This just-in-time code loading keeps the context window focused, improving LLM performance and reducing latency.

![Dirac Transparency Demo](https://storage.googleapis.com/cline_public_images/docs/assets/clines-transparency-hifi-5_compress.webp)
