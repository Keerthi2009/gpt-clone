# routers/pdf_qa.py

from fastapi import APIRouter, UploadFile, File, HTTPException
from pydantic import BaseModel
import uuid
import io
import numpy as np
from pypdf import PdfReader
from sentence_transformers import SentenceTransformer
from .chat import PROVIDERS, FALLBACK_ORDER

router = APIRouter(prefix="/pdf", tags=["PDF Q&A"])

# Load embedding model once at startup (downloads ~80MB on first run)
embedding_model = SentenceTransformer("all-MiniLM-L6-v2")

# In-memory session store: session_id -> {filename, chunks, embeddings}
pdf_sessions: dict = {}


def chunk_text(text: str, chunk_size: int = 500, overlap: int = 75) -> list:
    """Split text into overlapping chunks for better context coverage."""
    chunks = []
    start = 0
    while start < len(text):
        end = min(start + chunk_size, len(text))
        chunk = text[start:end].strip()
        if len(chunk) > 50:
            chunks.append(chunk)
        start += chunk_size - overlap
    return chunks


def cosine_similarity(query_vec: np.ndarray, matrix: np.ndarray) -> np.ndarray:
    """Compute cosine similarity between a query vector and a matrix of vectors."""
    query_norm = query_vec / (np.linalg.norm(query_vec) + 1e-10)
    matrix_norm = matrix / (np.linalg.norm(matrix, axis=1, keepdims=True) + 1e-10)
    return matrix_norm @ query_norm


# ─────────────────────────── UPLOAD ─────────────────────────── #

@router.post("/upload")
async def upload_pdf(file: UploadFile = File(...)):
    if not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are supported.")

    contents = await file.read()

    try:
        reader = PdfReader(io.BytesIO(contents))
    except Exception:
        raise HTTPException(status_code=422, detail="Could not parse the PDF file.")

    full_text = ""
    for page in reader.pages:
        page_text = page.extract_text()
        if page_text:
            full_text += page_text + "\n"

    if not full_text.strip():
        raise HTTPException(status_code=422, detail="No readable text found in PDF.")

    chunks = chunk_text(full_text)
    if not chunks:
        raise HTTPException(status_code=422, detail="PDF text could not be chunked.")

    embeddings = embedding_model.encode(chunks, show_progress_bar=False)

    session_id = str(uuid.uuid4())
    pdf_sessions[session_id] = {
        "filename": file.filename,
        "chunks": chunks,
        "embeddings": embeddings,
    }

    return {
        "session_id": session_id,
        "filename": file.filename,
        "pages": len(reader.pages),
        "chunks": len(chunks),
        "message": "PDF processed successfully. You can now ask questions."
    }


# ─────────────────────────── ASK ─────────────────────────── #

class AskRequest(BaseModel):
    session_id: str
    question: str
    provider: str = "auto"
    top_k: int = 3


@router.post("/ask")
async def ask_pdf(req: AskRequest):
    session = pdf_sessions.get(req.session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found. Please upload a PDF first.")

    if not req.question.strip():
        raise HTTPException(status_code=400, detail="Question cannot be empty.")

    top_k = min(req.top_k, len(session["chunks"]))

    # Embed the question and find most relevant chunks
    q_vec = embedding_model.encode([req.question])[0]
    scores = cosine_similarity(q_vec, session["embeddings"])
    top_indices = np.argsort(scores)[::-1][:top_k]

    top_chunks = [session["chunks"][i] for i in top_indices]
    top_scores = [round(float(scores[i]), 4) for i in top_indices]

    context = "\n\n---\n\n".join(top_chunks)

    messages = [
        {
            "role": "system",
            "content": (
                "You are a helpful assistant that answers questions strictly based on the "
                "provided document excerpts. If the answer is not present in the excerpts, "
                "clearly state that the information is not available in the document.\n\n"
                f"Document excerpts from '{session['filename']}':\n\n{context}"
            )
        },
        {
            "role": "user",
            "content": req.question
        }
    ]

    provider = req.provider.lower()

    if provider != "auto":
        if provider not in PROVIDERS:
            raise HTTPException(status_code=400, detail=f"Invalid provider: {provider}")
        try:
            answer = PROVIDERS[provider](messages)
            return {
                "answer": answer,
                "source_provider": provider,
                "sources": [{"text": c, "score": s} for c, s in zip(top_chunks, top_scores)]
            }
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"{provider} failed: {str(e)}")

    errors = {}
    for p in FALLBACK_ORDER:
        try:
            answer = PROVIDERS[p](messages)
            return {
                "answer": answer,
                "source_provider": p,
                "sources": [{"text": c, "score": s} for c, s in zip(top_chunks, top_scores)]
            }
        except Exception as e:
            errors[p] = str(e)

    raise HTTPException(status_code=500, detail={"error": "All providers failed", "details": errors})


# ─────────────────────────── SESSIONS ─────────────────────────── #

@router.delete("/session/{session_id}")
async def delete_session(session_id: str):
    if session_id not in pdf_sessions:
        raise HTTPException(status_code=404, detail="Session not found.")
    del pdf_sessions[session_id]
    return {"message": "Session deleted."}
