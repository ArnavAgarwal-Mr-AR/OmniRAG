from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import os
from dotenv import load_dotenv, find_dotenv

# Try to find .env or .env.local in parent directories
env_path = find_dotenv(".env.local") or find_dotenv(".env")
load_dotenv(env_path)

from database.neon import engine, Base
from api.ingest import router as ingest_router
from api.query import router as query_router

app = FastAPI(
    title="OmniRAG API",
    description="Cloud-native Multimodal RAG System leveraging Modal, Neon, B2, and Qdrant",
    version="1.0.0",
)

# CORS config for frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allows all origins for development
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

from retrieval.vector_db import init_collections

@app.on_event("startup")
async def startup_event():
    # Initialize DB tables if they don't exist
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        print("Database tables verified/created.")
    
    # Initialize Qdrant collections
    await init_collections()
    print("Qdrant collections verified/created.")

app.include_router(ingest_router)
app.include_router(query_router)

class HealthResponse(BaseModel):
    status: str
    db: str
    vector_db: str
    storage: str
    compute: str

@app.get("/api/v1/health", response_model=HealthResponse)
async def health_check():
    # In a real setup, we would ping each service here
    return HealthResponse(
        status="ok",
        db="configured" if os.getenv("POSTGRES_URL") else "missing",
        vector_db="configured" if os.getenv("QDRANT_URL") else "missing",
        storage="configured" if os.getenv("B2_ENDPOINT_URL") else "missing",
        compute="modal_ready"
    )

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
