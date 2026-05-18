# OmniRAG - Multimodal Retrieval-Augmented Generation System

OmniRAG is a production-grade multimodal intelligence platform that ingests, understands, and enables semantic querying across heterogeneous media — PDFs, images, audio, video, and scanned documents — through a unified retrieval-augmented generation pipeline.

Unlike text-only RAG systems, OmniRAG treats every modality as a first-class citizen. A single query can surface relevant text chunks, matched images, timestamped audio segments, and OCR-extracted content simultaneously — with citations pointing back to original sources.

---

## Key Capabilities

- Ingest PDFs (text, tables, layout), images, audio files, and video
- OCR pipeline for scanned documents and image-embedded text
- Whisper-based speech-to-text with speaker diarization and timestamps
- CLIP / Florence-2 image embeddings for semantic visual search
- Hybrid retrieval: dense vector search + BM25 keyword search
- Cross-modal querying: find images related to an audio discussion
- Citation engine returning page numbers, timestamps, and image sources
- Streaming LLM responses with full conversation memory
- Voice input (ASR → retrieval → LLM → TTS) pipeline
- Multi-agent architecture with modality-specialized retrieval agents

---

## Architecture

OmniRAG follows a layered pipeline architecture with eight distinct processing stages. Each stage is independently scalable and can be swapped without affecting other stages.

```
User Upload → [Ingestion] → [Processing] → [Chunking & Embedding]
           → [Vector DB]  → [Retrieval]  → [LLM Generation]
           → [Citation Engine] → Streaming Response
```

### Layer 1 — Ingestion

A FastAPI async endpoint validates MIME types, queues processing jobs via Celery, and returns a job ID for polling.

| MIME Type | Format | Max Size | Handler |
|---|---|---|---|
| `application/pdf` | .pdf | 500 MB | `PDFProcessor` |
| `image/png`, `image/jpeg`, `image/webp` | .png .jpg .webp | 50 MB | `ImageProcessor` |
| `audio/mpeg`, `audio/wav`, `audio/ogg` | .mp3 .wav .ogg | 2 GB | `AudioProcessor` |
| `video/mp4`, `video/webm` | .mp4 .webm | 5 GB | `VideoProcessor` |
| `application/octet-stream` (scan) | .tiff .bmp | 200 MB | `OCRProcessor` |

```
POST /api/v1/ingest                  → 202 { job_id, status, estimated_time }
GET  /api/v1/ingest/{job_id}/status  → { status, progress, chunks_created }
```

### Layer 2 — Processing

Each modality has a dedicated processor returning a list of `ProcessedChunk` objects.

**PDF** — Three-pass strategy: layout analysis (PyMuPDF) → table detection (pdfplumber) → fallback OCR (PaddleOCR) for scanned pages.

**OCR** — PaddleOCR as primary engine (multilingual), Tesseract as fallback. Preprocessing via OpenCV: deskew, denoise, binarize. Chunks below 0.6 confidence are flagged.

**Audio** — `faster-whisper` (CTranslate2-optimized) for transcription + `pyannote.audio` for speaker diarization with word-level timestamps.

| Whisper Model | VRAM | Speed | Use Case |
|---|---|---|---|
| tiny / base | 1 GB | 16–32× realtime | Dev / prototyping |
| medium | 5 GB | 6× realtime | Balanced |
| large-v3-turbo | 6 GB | 8× realtime | **Recommended** |
| large-v3 | 10 GB | 2× realtime | Max accuracy |

**Image** — Two parallel paths: vision captioning (BLIP-2 or Florence-2) + CLIP-ViT-Large-Patch14 embeddings (768-dim) for semantic visual search. Florence-2 is preferred for diagrams and technical drawings.

### Layer 3 — Chunking & Embedding

All processed content is normalized into a common `Chunk` schema before embedding.

| Modality | Model | Dimensions |
|---|---|---|
| Text (primary) | `BAAI/bge-large-en-v1.5` | 1024 |
| Text (multilingual) | `intfloat/multilingual-e5-large` | 1024 |
| Text (fast) | `nomic-ai/nomic-embed-text-v1.5` | 768 |
| Image | `openai/clip-vit-large-patch14` | 768 |

### Layer 4 — Vector Database (Qdrant)

Collections are partitioned by modality for filtered queries and independent scaling.

| Collection | Vector Size | Contains |
|---|---|---|
| `omnirag_text` | 1024 | PDF chunks, OCR results, audio transcripts |
| `omnirag_image` | 768 | CLIP image embeddings |
| `omnirag_multimodal` | 1024 | Cross-modal unified index |

Filterable payload fields: `source_id`, `modality`, `page`, `timestamp_s`, `speaker`.

### Layer 5 — Retrieval

Hybrid search combining dense vector retrieval and BM25 sparse retrieval, merged via **Reciprocal Rank Fusion (RRF, k=60)**, then reranked by `BGE-Reranker-v2-m3`.

```
Query → Embedding → Dense Retrieval (Qdrant)  ─┐
      → Tokenize  → BM25 Sparse Retrieval     ─┤→ RRF Fusion → Reranker → Top-K
      → Modality Router → Per-Modal Sub-Query  ─┘
```

| Parameter | Default | Description |
|---|---|---|
| `DENSE_TOP_K` | 20 | Candidates from vector search |
| `SPARSE_TOP_K` | 20 | Candidates from BM25 |
| `RERANK_TOP_K` | 7 | Final chunks sent to LLM |
| `SCORE_THRESHOLD` | 0.4 | Minimum rerank score |

### Layer 6 — Multi-Agent Retrieval

A LangGraph supervisor agent decomposes complex queries and dispatches to modality-specialized sub-agents. A lightweight DistilBERT classifier routes by intent; ambiguous queries fan out to all agents in parallel.

```
Supervisor Agent
  ├── PDF Agent    → queries text index (modality=pdf)
  ├── Audio Agent  → queries text index (modality=audio) + timestamp filters
  ├── Image Agent  → queries image index, returns url + caption
  └── OCR Agent    → queries text index (modality=ocr)
```

### Layer 7 — LLM Generation

A unified adapter interface supports multiple backends:

| Backend | Models | When to Use |
|---|---|---|
| Ollama (local) | Llama 3.1 70B, Mistral, Gemma 2 27B | Privacy-sensitive, offline |
| OpenAI API | GPT-4o, GPT-4o-mini | Best quality, easy setup |
| Anthropic API | Claude 3.5 Sonnet / Haiku | Strong reasoning, long context |
| HuggingFace TGI | Any open model | Custom models, fine-tunes |
| Groq Cloud | Llama 3.1 70B, Mixtral | Fastest inference |

The LLM is instructed to answer exclusively from retrieved context and cite sources using `[SOURCE:id]` markers.

### Layer 8 — Citation Engine

Parses `[SOURCE:id]` markers from LLM output and resolves them to structured citation objects — including page numbers, timestamps, speaker labels, image URLs, and confidence scores — returned alongside the text response.

### Voice Pipeline

```
Microphone → WebRTC → VAD → Whisper ASR → Text Query
→ [Standard Retrieval Pipeline]
→ LLM Response → TTS → Audio Stream → Speaker
```

| TTS Engine | Type | Latency | Notes |
|---|---|---|---|
| Kokoro TTS | Local | ~200ms | Open-source, recommended |
| ElevenLabs | Cloud | ~400ms | Highest quality |
| Coqui TTS | Local | ~300ms | Multilingual |
| Edge TTS | Cloud (free) | ~300ms | No API key needed |

---

## Quick Start

### Prerequisites

- Python 3.11+
- Node.js 20+
- Docker & Docker Compose
- CUDA 12+ (optional, recommended for GPU inference)
- 8 GB+ RAM, 4 GB+ VRAM for full local model stack

### 1. Clone and Configure

```bash
git clone https://github.com/your-org/omnirag.git && cd omnirag
cp .env.example .env
# Edit .env: set OPENAI_API_KEY or HUGGINGFACE_TOKEN, Qdrant URL, Redis URL
```

### 2. Start Infrastructure

```bash
docker compose up -d qdrant redis postgres
```

### 3. Install Python Dependencies

```bash
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
```

### 4. Initialize Collections

```bash
python scripts/init_qdrant_collections.py
```

### 5. Start Backend

```bash
uvicorn backend.main:app --reload --port 8000
```

### 6. Start Frontend

```bash
cd frontend && npm install && npm run dev
```

- UI: http://localhost:5173
- API docs: http://localhost:8000/docs

---

## Environment Variables

| Variable | Required | Description | Example |
|---|---|---|---|
| `OPENAI_API_KEY` | Optional | GPT-4o for LLM generation | `sk-...` |
| `HUGGINGFACE_TOKEN` | Optional | HF model downloads | `hf_...` |
| `QDRANT_URL` | Yes | Qdrant vector database URL | `http://localhost:6333` |
| `QDRANT_API_KEY` | No | Qdrant Cloud API key | `your-key` |
| `REDIS_URL` | Yes | Redis for memory & BM25 cache | `redis://localhost:6379` |
| `POSTGRES_URL` | Yes | Metadata and job tracking | `postgresql://...` |
| `WHISPER_MODEL` | Yes | Whisper model size | `large-v3-turbo` |
| `EMBED_MODEL_TEXT` | Yes | Text embedding model ID | `BAAI/bge-large-en-v1.5` |
| `EMBED_MODEL_IMAGE` | Yes | Image embedding model | `openai/clip-vit-large-patch14` |
| `RERANKER_MODEL` | Yes | Reranker model ID | `BAAI/bge-reranker-v2-m3` |
| `LLM_BACKEND` | Yes | LLM provider: `openai`/`ollama`/`hf` | `ollama` |
| `LLM_MODEL` | Yes | Model name for generation | `llama3:70b` |

---

## GPU Requirements

For running the full local model stack (e.g. RTX 4090, 24 GB VRAM):

| Component | VRAM | CPU Fallback |
|---|---|---|
| Whisper large-v3-turbo | 6 GB | Yes (slow) |
| BGE embedding model | 2 GB | Yes |
| CLIP image embedder | 1 GB | Yes |
| BGE Reranker | 2 GB | Yes |
| Florence-2 base | 4 GB | Yes (very slow) |
| Llama 3.1 8B (4-bit) | 5 GB | Marginal |
| Llama 3.1 70B (4-bit) | 40 GB | No |

For elastic GPU scaling, deploy inference via [Modal](https://modal.com) or [RunPod](https://runpod.io).

---

## Contributing

1. Fork the repository and create a feature branch
2. Run linting: `ruff check . && mypy backend/`
3. Run tests: `pytest tests/ -v`
4. Open a pull request with a clear description

---

## License

MIT License. See [LICENSE](./LICENSE) for details.