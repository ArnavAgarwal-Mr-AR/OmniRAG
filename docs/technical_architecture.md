# OmniRAG Technical Architecture & Specifications

This document outlines the deeply technical specifics, configurations, and dataflows powering the cloud-native OmniRAG system. It spans all processing phases, detailing the integration of serverless Modal compute with edge databases and object storage.

---

## 1. Cloud & Infrastructure Topology

OmniRAG utilizes a completely serverless and abstracted infrastructure pattern:

*   **Compute (Modal)**: We use Modal's elastic GPU containers (`T4` / `A10G`). Containers are isolated per modality to prevent dependency bloat (e.g., `modal_app.py` for text/PDF vs. `modal_image_app.py` for PaddleOCR/Florence-2).
*   **Object Storage (Backblaze B2)**: Used via the `boto3` S3-compatible API. Files are streamed from the FastAPI layer directly into B2 buckets. Modal compute nodes download these files dynamically based on the S3 `file_key`.
*   **Vector Engine (Qdrant Cloud)**: Two primary collections are maintained:
    *   `omnirag_text` (1024-dim, Cosine) for `BAAI/bge-large-en-v1.5` embeddings.
    *   `omnirag_image` (768-dim, Cosine) for `openai/clip-vit-large-patch14` embeddings.
*   **Relational DB (Neon Postgres)**: Accessed asynchronously via `asyncpg` and `SQLAlchemy`. Tracks the ingestion state machine (Uploading -> Processing -> Completed/Failed).

---

## 2. Phase 1: Storage & Text Pipeline (PDFs)

### 2.1. Ingestion Flow
When a file is sent to `/api/v1/ingest`, the FastAPI backend:
1.  Uploads the raw bytes to Backblaze B2.
2.  Inserts a tracking UUID into Neon Postgres.
3.  Triggers a background GPU task on Modal via `.spawn(b2_file_key)`. This instantly offloads heavy processing and keeps the API latency low.

### 2.2. Text Processing & Embeddings
*   **Extraction:** Handled via `fitz` (PyMuPDF).
*   **Embedding Model:** `BAAI/bge-large-en-v1.5`. BGE enforces an asymmetric retrieval schema; queries are prefixed with `"Represent this sentence for searching relevant passages: "`, whereas the document chunks are embedded raw.
*   **Schema:** The resulting chunks are pushed to Qdrant Cloud as `PointStruct` objects carrying strict payload metadata (`source_id`, `page`, `content`, `modality: "pdf"`).

---

## 3. Phase 2: OCR & Image Understanding Pipeline

Vision requires massive VRAM and heavy libraries (`libgl1`, `paddlepaddle-gpu`). Therefore, it runs in a completely separate Modal environment (`ImageProcessor`) using an `nvidia-T4` instance to isolate dependencies and prevent GPU bloat.

### 3.1. `ImageProcessor` Modal App Models
The `ImageProcessor` automatically loads and utilizes the following models:
*   **Florence-2 Large:** Used for deep semantic understanding. It automatically detects if an image is a photo or a diagram using an object detection (`<OD>`) prompt. If it's a technical diagram, it generates a highly structured technical caption using the `<DETAILED_CAPTION>` task. Standard photos get a concise label.
*   **PaddleOCR (v4):** Runs Optical Character Recognition on the images. Configured with rotation detection enabled (`use_angle_cls=True`) to pull out any written text on scanned documents, which is then appended to the Florence-2 caption.
*   **CLIP (ViT-Large-Patch14):** Generates a 768-dimensional visual embedding of the raw image itself for pure text-to-image semantic search.
*   **BGE (Large-v1.5):** Generates a 1024-dimensional semantic embedding of the Florence-2 caption and OCR text for standard textual search.

Both the CLIP and BGE embeddings are upserted seamlessly to Qdrant Cloud in a dual-embedding strategy.

### 3.2. Ingestion Routing
The `/api/v1/ingest` endpoint is configured with automatic MIME type detection. When a user uploads an image (e.g., `image/jpeg` or `image/png`), the backend detects this, bypasses the standard PDF text processor, and spawns an asynchronous job on the new `ImageProcessor` Modal endpoint, piping the image directly from Backblaze B2.

### 3.3. Cross-Modal Hybrid Querying
The `/api/v1/query` endpoint is built to be truly cross-modal:
1.  **Concurrent Embedding:** When a user submits a query (e.g., *"Find the architecture diagram showing the database"*), the API hits the Modal compute cluster to retrieve **both** a BGE text embedding and a CLIP text embedding simultaneously.
2.  **Concurrent Searching:** It then concurrently searches the `omnirag_text` collection (for textual matches) and the `omnirag_image` collection (for visual matches).
3.  **Synthesis:** The returned documents and **Image URLs** (with their detailed Florence-2 descriptions) are aggregated and passed directly into the context window for the streaming LLM to synthesize a comprehensive answer.

---

## 4. Phase 3: Audio & Video Pipeline

### 4.1. Transcription & Chunking
*   **Engine:** `faster-whisper` (CTranslate2 optimized) using the `large-v3-turbo` model. It delivers 8x realtime inference on a T4 GPU using `float16` compute type.
*   **Speaker Diarization:** Achieved via `pyannote/speaker-diarization-3.1`. The Whisper transcript timestamps are mathematically aligned with pyannote's VAD (Voice Activity Detection) boundary markers to assign a specific `speaker_id` to each chunk.
*   **Payload Struct:** Audio chunks pushed to Qdrant contain `timestamp_s`, `timestamp_e`, and `speaker` metadata, enabling exact temporal searches (e.g., *"What did Speaker 1 say at minute 12?"*).

---

## 5. Phase 4: Cross-Modal Search & Retrieval (Future Refinement)

### 5.1. Reciprocal Rank Fusion (RRF) & Reranking
To guarantee top precision:
*   Sparse (BM25) and Dense (Cosine) vectors are merged via RRF mathematically: `score = 1 / (k + rank)`.
*   The top 20 candidates are passed to a Cross-Encoder (`BAAI/bge-reranker-v2-m3`). Unlike Bi-Encoders, Cross-Encoders predict the relevance of `[Query, Document]` pairs via a deep transformer forward-pass, significantly boosting `Precision@5`.

---

## 6. Generation & Streaming (LiteLLM)

### 6.1. LLM Integration
We use `litellm` as an abstraction layer to prevent vendor lock-in. 
*   **Supported Targets:** HuggingFace Serverless, Ollama Cloud endpoints, Groq, or OpenAI.
*   **Streaming Strategy:** Uses Server-Sent Events (SSE). The generated tokens yield via an async generator (`async for chunk in response`), allowing the React frontend to display characters in real-time, matching modern UX expectations.
