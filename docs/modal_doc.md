# OmniRAG Backend - Modal ML Orchestration

This directory contains the core intelligence of OmniRAG, a cloud-native Multimodal Retrieval-Augmented Generation (RAG) system. The architecture is designed to handle text (PDFs), images, and audio through a distributed compute model using **Modal**.

## 🏗 System Architecture

The backend consists of three primary layers:

1.  **Orchestration Layer (FastAPI)**: Runs locally or in a container. Handles API requests, coordinates storage (B2), metadata (Neon Postgres), and triggers compute tasks.
2.  **Compute Layer (Modal)**: Scalable, GPU-accelerated serverless functions that perform heavy ML tasks like transcription, embedding, and reranking.
3.  **Vector Layer (Qdrant Cloud)**: Stores high-dimensional embeddings for both text and image modalities.

---

## 📂 File Explanations

### 1. Compute Components (Modal Apps)

*   **`modal_app.py` (Document Processor)**
    *   **Purpose**: Processes PDF documents.
    *   **Models**: `BAAI/bge-large-en-v1.5` (Text Embedding).
    *   **Workflow**: Downloads PDF from B2 → Extracts text via PyMuPDF → Chunks text → Generates embeddings on T4 GPU → Upserts to Qdrant `omnirag_text` collection.

*   **`modal_image_app.py` (Image Processor)**
    *   **Purpose**: Visual understanding and OCR.
    *   **Models**: `microsoft/Florence-2-large` (VLM), `openai/clip-vit-large-patch14` (Vision-Text Alignment), `PaddleOCR` (Text Extraction).
    *   **Workflow**: Downloads image → Generates detailed caption (Florence-2) → Extracts text (OCR) → Generates CLIP & BGE embeddings → Upserts to both `omnirag_text` and `omnirag_image` collections.

*   **`modal_audio_app.py` (Audio Processor)**
    *   **Purpose**: Speech-to-text and speaker identification.
    *   **Models**: `faster-whisper (large-v3)` (Transcription), `pyannote/speaker-diarization-3.1` (Diarization).
    *   **Workflow**: Preprocesses audio via FFmpeg → Transcribes → Maps segments to speakers → Embeds text → Upserts to `omnirag_text`.

*   **`modal_retrieval_app.py` (Reranker)**
    *   **Purpose**: Precision filtering of retrieved context.
    *   **Models**: `BAAI/bge-reranker-v2-m3` (Cross-Encoder).
    *   **Workflow**: Receives broad search results from Qdrant → Scores the relevance of (Query, Document) pairs → Returns the top-K most relevant chunks.

### 2. API & Logic Layer

*   **`main.py`**: The FastAPI entry point. Initializes database connections and mounts routers.
*   **`api/ingest.py`**: Handles file uploads. It pushes raw files to Backblaze B2, records the transaction in Neon (Postgres), and spawns the corresponding Modal task asynchronously.
*   **`api/query.py`**: The RAG engine. Coordinates multi-modal search across Qdrant, calls the Reranker, and streams the final synthesized response from the LLM.
*   **`llm/generation.py`**: Manages the final synthesis phase (usually via Groq/OpenAI/Llama-3), injecting retrieved context into a specialized prompt.

---

## 🔄 Data Flow & Processing

### The Ingestion Pipeline
1.  **Client** uploads a file to `/api/v1/ingest`.
2.  **FastAPI** streams the file to **Backblaze B2**.
3.  Metadata is saved to **Neon Postgres** with status `processing`.
4.  A **Modal Task** is triggered (`.remote.aio()`).
5.  **Modal Container** wakes up, downloads the file from B2, processes it (OCR/Transcription), embeds it, and saves it to **Qdrant**.
6.  Metadata status is updated to `ready`.

### The Query (RAG) Pipeline
1.  **Client** sends a question to `/api/v1/query`.
2.  **FastAPI** calls Modal to embed the query (BGE for text search, CLIP for image search).
3.  **Qdrant** performs a vector search across multiple collections.
4.  **Reranker (Modal)** takes the top ~20 broad results and narrows them down to the top 5 most relevant.
5.  **LLM** receives the query + reranked context and streams the response back to the client.

---

## 🚀 Model Loading & Performance

*   **Pre-loading**: All heavy models (Florence, Whisper, Reranker) are loaded inside the `@modal.enter()` decorator. This ensures the models are loaded into GPU VRAM **once** when the container starts, rather than on every request.
*   **Warm-up**: The `/api/v1/wakeup` endpoint sends a "ping" to all Modal classes. This is used by the frontend to spin up containers while the user is still selecting files, effectively eliminating cold-start latency.
*   **GPU Utilization**: All ML processing is offloaded to NVIDIA T4 GPUs in the cloud, keeping the local machine lightweight.
