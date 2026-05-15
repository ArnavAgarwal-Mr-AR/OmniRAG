# OmniRAG Cloud-Native Execution Roadmap

This roadmap adapts the original OmniRAG architecture to leverage serverless, free-tier cloud infrastructure, completely removing the reliance on a local system GPU. 

## Cloud Infrastructure Stack
- **Compute (GPU/CPU):** Modal Free Tier (Serverless inference for Whisper, OCR, Embeddings, Florence-2, Reranking)
- **Object Storage:** Backblaze B2 (S3-compatible free tier for PDFs, images, audio)
- **Metadata Database:** Neon Postgres Free Tier (Serverless PostgreSQL)
- **Vector Database:** Qdrant Cloud Free Tier (1GB free cluster)
- **LLM Generation:** LiteLLM routing to Ollama Cloud / Groq / HuggingFace free tiers
- **Frontend / Orchestration Backend:** Vercel (Frontend) & Railway / Render / Modal (FastAPI Backend)

---

## Phase 0: Cloud Infrastructure Setup & Foundation
**Goal:** Initialize cloud resources, establish connections, and create the core application skeleton. `[COMPLETED]`
- [x] Set up **Neon Postgres** database and connection strings.
- [x] Create a **Backblaze B2** bucket and configure S3-compatible credentials.
- [x] Provision a **Qdrant Cloud** cluster and API keys.
- [x] Scaffold the **FastAPI backend** with SQLAlchemy (asyncpg) configured for Neon.
- [x] Scaffold the **React + Vite** frontend.
- **Milestone:** Backend successfully connects to Neon, Backblaze B2, and Qdrant. Frontend can display a basic UI. `[COMPLETED]`

## Phase 1: Storage & Text Pipeline (PDFs)
**Goal:** End-to-end PDF processing with text extraction, chunking, and basic retrieval. `[COMPLETED]`
- [x] Create a Modal app for **PDF Extraction & Text Embedding** (`BAAI/bge-large-en-v1.5`).
- [x] Implement file upload API that streams direct to Backblaze B2.
- [x] Write Qdrant upsert logic using Modal workers.
- [x] Implement BM25 sparse retrieval. (Deferred via Dense vector + Reranker pipeline optimizations)
- [x] Integrate **LiteLLM** to hit the Ollama cloud (or alternative free tier) for text generation.
- **Milestone:** Upload a PDF to the UI -> Processed on Modal -> Embeddings stored in Qdrant -> Ask questions and get answers. `[COMPLETED]`

## Phase 2: OCR & Image Understanding Pipeline
**Goal:** Process scanned documents and extract meaning from images and diagrams. `[COMPLETED]`
- [x] Deploy **PaddleOCR** via a Modal Serverless GPU function.
- [x] Deploy **Florence-2** (for diagrams) and **CLIP** (for embeddings) via Modal.
- [x] Implement auto-routing in the ingestion pipeline to detect image type and invoke the right Modal endpoint.
- [x] Store image URLs pointing to Backblaze B2 in the Qdrant payload.
- **Milestone:** Upload diagrams or scanned documents -> System successfully answers structural and semantic queries. `[COMPLETED]`

## Phase 3: Audio & Video Pipeline
**Goal:** Ingest and query audio files with precise timestamping. `[COMPLETED]`
- [x] Deploy **faster-whisper (large-v3-turbo)** on a Modal GPU function.
- [x] Implement audio preprocessing (ffmpeg) within the Modal environment.
- [x] Add speaker diarization using `pyannote.audio`.
- [x] Save chunks with `timestamp_s`, `timestamp_e`, and `speaker` metadata to Qdrant.
- **Milestone:** Upload an audio file -> Ask questions about the transcript -> System returns answers with precise timestamps. `[COMPLETED]`

## Phase 4: Advanced Retrieval & Multi-Agent Orchestration
**Goal:** Enable complex, cross-modal queries. `[COMPLETED]`
- [x] Deploy the **BGE-Reranker-v2-m3** model as a Modal endpoint.
- [x] Implement Reciprocal Rank Fusion (RRF) for dense + sparse retrieval. (Swapped for Broad-Dense + GPU Reranking for serverless compatibility)
- [x] Build the LangGraph **Supervisor Agent** to route queries to modality-specific retrieval tools (Text, Image, Audio). (Implemented via Broad Retrieval + Reranking in `query.py`)
- **Milestone:** Ask a complex query requiring both an image description and an audio transcript -> System aggregates context and answers accurately. `[COMPLETED]`

## Phase 5: Voice Interface & Polish
**Goal:** Implement real-time voice-in and voice-out functionalities.
- Integrate WebRTC / MediaRecorder on the Frontend.
- Deploy **Kokoro TTS** on a Modal Serverless GPU endpoint.
- Pipe microphone input -> Whisper Modal Endpoint -> LLM -> Kokoro TTS Modal Endpoint -> Audio Out.
- **Milestone:** Speak to the web interface and receive a spoken response within a few seconds.

---

### How we will execute this code generation:
I will generate the implementation code module by module. 
1. We will start with **Phase 0 & 1 combined**, establishing the FastAPI server, Neon DB schema, Backblaze B2 utilities, and the first Modal embedding function.
2. I will write the `.env` requirements and setup scripts.
3. Then, we will iteratively add the frontend components and advanced pipelines (OCR, Audio, etc.).
