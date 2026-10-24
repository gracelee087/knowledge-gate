# Hybrid search

Embeddings are good at meaning, but they miss exact names, IDs and product codes.
Keyword search such as BM25 catches exact matches that embeddings miss.
Hybrid search runs both and merges the ranked lists, for example with reciprocal rank fusion.

## Notes to self
- Try BM25 first on a new project; add vectors only if recall is too low.
