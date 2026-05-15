# OmniRAG Retrieval Architecture: Vector Search & Reranking

In modern Retrieval-Augmented Generation (RAG) systems, retrieving the *correct* information from a massive knowledge base is the most critical challenge. OmniRAG tackles this using a two-stage retrieval pipeline: **Bi-Encoder Vector Search** (via Qdrant) followed by **Cross-Encoder Reranking** (via Modal GPUs).

This document explains the technical necessity, mathematical differences, and practical implementations of these two distinct stages.

---

## Stage 1: Vector Search (The "Broad" Search)

The first stage of retrieval is designed for extreme scale and speed. Its goal is to filter millions of documents down to a small, relevant subset (e.g., the top 30 candidates).

### How it Works (Bi-Encoder Architecture)
Vector databases like Qdrant use a **Bi-Encoder** approach. 
1. During ingestion, every document chunk is passed through an embedding model (like `BGE-large-en-v1.5`) independently to generate a high-dimensional vector.
2. During a query, the user's question is passed through the *same* embedding model to generate a query vector.
3. The database then calculates the mathematical distance (usually Cosine Similarity or Dot Product) between the query vector and all document vectors in the database.

### Technical Characteristics
* **Time Complexity:** $O(N)$ for exact search, but effectively $O(\log N)$ using advanced indexing algorithms like HNSW (Hierarchical Navigable Small World).
* **Speed:** Blazing fast. Can search millions of records in milliseconds.
* **Flaw (The "Semantic Gap"):** Bi-Encoders are essentially comparing summaries of concepts. Because the query and document are embedded *independently*, the model cannot see how the specific words in the query interact with the specific words in the document.
* **Example Failure:** If you query `"How do I kill a process?"`, a Bi-Encoder might return a document explaining `"How a process kills a thread"` because the overlapping concepts (process, kill) result in similar vectors, even though the semantic intent is entirely different.

---

## Stage 2: The Reranker (The "Deep" Search)

Because the top 30 results from the Vector Search are likely to contain "conceptually similar but functionally useless" documents, we need a second stage. The Reranker acts as a highly intelligent, but computationally expensive, filter.

### How it Works (Cross-Encoder Architecture)
Instead of comparing pre-computed vectors, a Reranker uses a **Cross-Encoder** (like `BGE-Reranker-v2-m3`).
1. It takes the user's query and concatenates it directly with a document: `[CLS] Query [SEP] Document [SEP]`.
2. This combined string is passed through a deep transformer network.
3. The model's attention mechanisms are able to calculate "Cross-Attention"—allowing every word in the query to dynamically interact with every word in the document simultaneously.
4. The model outputs a single highly accurate relevance score (e.g., `0.95` for a perfect match).

### Technical Characteristics
* **Time Complexity:** $O(K)$, where $K$ is the number of candidates retrieved from Stage 1. However, the constant factor is massive because full transformer inference is required for every single pair.
* **Speed:** Slow. You cannot run a Cross-Encoder over an entire database; it would take hours or days for a single query. This is why it is strictly reserved for the top 30-50 results of the Vector DB.
* **Accuracy:** Extremely high. Because of Cross-Attention, the model easily understands the structural difference between `"How do I kill a process?"` and `"How a process kills a thread"`, accurately scoring the correct document as highly relevant and the other as irrelevant.

---

## OmniRAG Implementation Pipeline

1. **User queries the API.**
2. **FastAPI** calls the `modal_backend` to embed the query (Bi-Encoder).
3. **Qdrant (Vector DB)** rapidly scans the `omnirag_text` and `omnirag_image` collections, returning the Top 30 broad candidates.
4. **FastAPI** sends the query and the 30 raw texts to the `omnirag-retrieval-processor` (Modal GPU).
5. The **BGE-Reranker** (Cross-Encoder) evaluates all 30 pairs simultaneously in a batched tensor operation on the T4 GPU.
6. The Reranker sorts the results by the new relevance score, filters out anything below a `0.1` threshold, and returns the absolute best Top 5 documents.
7. These Top 5 documents are injected into the context window of **Llama-3** via Groq to generate the final, highly accurate answer.
