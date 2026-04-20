# routers/langchain_rag.py
#
# PDF Q&A with LangChain — in-memory numpy retriever + conversation memory.
# No faiss-cpu needed (removes ~300 MB of C binaries from the Docker image).

from fastapi import APIRouter, UploadFile, File, HTTPException
from pydantic import BaseModel
from typing import List, Any
import uuid, io, os
import numpy as np
from pypdf import PdfReader
from dotenv import load_dotenv

from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder
from langchain_core.output_parsers import StrOutputParser
from langchain_core.messages import AIMessage, HumanMessage
from langchain_core.retrievers import BaseRetriever
from langchain_core.documents import Document
from langchain_core.callbacks.manager import CallbackManagerForRetrieverRun

from langchain_community.embeddings import HuggingFaceEmbeddings
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_groq import ChatGroq
from langchain_openai import ChatOpenAI

load_dotenv()

router = APIRouter(prefix="/langchain", tags=["LangChain RAG"])

_embeddings = HuggingFaceEmbeddings(model_name="all-MiniLM-L6-v2")

lc_sessions: dict = {}


# ─── Numpy-based in-memory retriever (replaces faiss-cpu) ─────────

class NumpyRetriever(BaseRetriever):
    """
    LangChain-compatible retriever backed by numpy cosine similarity.
    Identical behaviour to FAISS but zero C-extension dependencies.
    """
    docs: List[Document]
    doc_embeddings: Any      # np.ndarray stored as Any to satisfy pydantic
    embed_model: Any
    k: int = 3

    class Config:
        arbitrary_types_allowed = True

    def _get_relevant_documents(
        self, query: str, *, run_manager: CallbackManagerForRetrieverRun
    ) -> List[Document]:
        q_vec = np.array(self.embed_model.embed_query(query))
        matrix = np.array(self.doc_embeddings)
        # cosine similarity
        q_norm = np.linalg.norm(q_vec) + 1e-10
        m_norms = np.linalg.norm(matrix, axis=1) + 1e-10
        scores = (matrix @ q_vec) / (m_norms * q_norm)
        top_idx = np.argsort(scores)[::-1][: self.k]
        return [self.docs[i] for i in top_idx]


def build_retriever(docs: List[Document], k: int = 3) -> NumpyRetriever:
    texts = [d.page_content for d in docs]
    embeddings = _embeddings.embed_documents(texts)
    return NumpyRetriever(
        docs=docs,
        doc_embeddings=embeddings,
        embed_model=_embeddings,
        k=k,
    )


# ─── LLM helper ───────────────────────────────────────────────────

def get_llm():
    if os.getenv("GROQ_API_KEY"):
        return ChatGroq(
            api_key=os.getenv("GROQ_API_KEY"),
            model="llama-3.3-70b-versatile",
            max_tokens=512,
        )
    if os.getenv("OPENAI_API_KEY"):
        return ChatOpenAI(
            api_key=os.getenv("OPENAI_API_KEY"),
            model="gpt-4.1-mini",
            max_tokens=512,
        )
    raise HTTPException(500, "No LLM API key configured (GROQ_API_KEY or OPENAI_API_KEY).")


# ─── Core RAG logic ────────────────────────────────────────────────

def run_rag(retriever: NumpyRetriever, chat_history: list, question: str) -> dict:
    llm = get_llm()
    parser = StrOutputParser()

    # Stage 1: rephrase question if there is chat history
    if chat_history:
        rephrase_prompt = ChatPromptTemplate.from_messages([
            ("system",
             "Given the conversation history and the user's latest question, "
             "rewrite it as a fully self-contained question. "
             "Do NOT answer — only rewrite if needed, otherwise return as-is."),
            MessagesPlaceholder("chat_history"),
            ("human", "{input}"),
        ])
        standalone_q = (rephrase_prompt | llm | parser).invoke({
            "input": question,
            "chat_history": chat_history,
        })
    else:
        standalone_q = question

    # Stage 2: retrieve + answer
    docs = retriever.invoke(standalone_q)
    context = "\n\n---\n\n".join(d.page_content for d in docs)

    qa_prompt = ChatPromptTemplate.from_messages([
        ("system",
         "You are a helpful assistant answering questions about a document. "
         "Use ONLY the retrieved context below to answer. "
         "If the answer is not in the context, say so clearly.\n\nContext:\n{context}"),
        MessagesPlaceholder("chat_history"),
        ("human", "{input}"),
    ])

    answer = (qa_prompt | llm | parser).invoke({
        "input": question,
        "chat_history": chat_history,
        "context": context,
    })

    return {
        "answer": answer,
        "sources": [{"text": d.page_content} for d in docs],
    }


# ─── Routes ────────────────────────────────────────────────────────

@router.post("/upload")
async def upload_pdf(file: UploadFile = File(...)):
    if not file.filename.lower().endswith(".pdf"):
        raise HTTPException(400, "Only PDF files are supported.")

    contents = await file.read()
    try:
        reader = PdfReader(io.BytesIO(contents))
    except Exception:
        raise HTTPException(422, "Could not parse the PDF.")

    full_text = "\n".join(p.extract_text() or "" for p in reader.pages)
    if not full_text.strip():
        raise HTTPException(422, "No readable text found in PDF.")

    splitter = RecursiveCharacterTextSplitter(
        chunk_size=500, chunk_overlap=75,
        separators=["\n\n", "\n", ".", " "],
    )
    docs = splitter.create_documents([full_text])
    retriever = build_retriever(docs)

    session_id = str(uuid.uuid4())
    lc_sessions[session_id] = {
        "retriever": retriever,
        "chat_history": [],
        "filename": file.filename,
        "pages": len(reader.pages),
        "chunks": len(docs),
    }

    return {
        "session_id": session_id,
        "filename": file.filename,
        "pages": len(reader.pages),
        "chunks": len(docs),
        "message": "PDF indexed with LangChain + numpy retriever. Conversation memory is active.",
    }


class AskRequest(BaseModel):
    session_id: str
    question: str


@router.post("/ask")
async def ask(req: AskRequest):
    session = lc_sessions.get(req.session_id)
    if not session:
        raise HTTPException(404, "Session not found. Upload a PDF first.")
    if not req.question.strip():
        raise HTTPException(400, "Question cannot be empty.")

    result = run_rag(
        retriever=session["retriever"],
        chat_history=session["chat_history"],
        question=req.question,
    )

    session["chat_history"].append(HumanMessage(content=req.question))
    session["chat_history"].append(AIMessage(content=result["answer"]))

    return {
        "answer": result["answer"],
        "sources": result["sources"],
        "filename": session["filename"],
        "turn": len(session["chat_history"]) // 2,
    }


@router.delete("/session/{session_id}")
async def delete_session(session_id: str):
    if session_id not in lc_sessions:
        raise HTTPException(404, "Session not found.")
    del lc_sessions[session_id]
    return {"message": "Session deleted."}
