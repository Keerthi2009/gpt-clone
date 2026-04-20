# routers/langchain_rag.py
#
# PDF Q&A with LangChain — FAISS vector store + conversation memory.
# Uses langchain_core + langchain_community directly (no langchain.chains import)
# so it works regardless of the high-level langchain package version.

from fastapi import APIRouter, UploadFile, File, HTTPException
from pydantic import BaseModel
import uuid, io, os
from pypdf import PdfReader
from dotenv import load_dotenv

# ── langchain_core is the stable low-level package ──
from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder
from langchain_core.output_parsers import StrOutputParser
from langchain_core.messages import AIMessage, HumanMessage

# ── langchain_community for FAISS + embeddings ──
from langchain_community.vectorstores import FAISS
from langchain_community.embeddings import HuggingFaceEmbeddings

# ── langchain_text_splitters is a standalone package ──
from langchain_text_splitters import RecursiveCharacterTextSplitter

# ── LLM providers ──
from langchain_groq import ChatGroq
from langchain_openai import ChatOpenAI

load_dotenv()

router = APIRouter(prefix="/langchain", tags=["LangChain RAG"])

_embeddings = HuggingFaceEmbeddings(model_name="all-MiniLM-L6-v2")

# session_id -> { retriever, chat_history, filename, pages, chunks }
lc_sessions: dict = {}


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


# ─── Core RAG logic (pure Python, no langchain.chains) ────────────

def run_rag(retriever, chat_history: list, question: str) -> dict:
    """
    Two-stage RAG with conversation memory — implemented with langchain_core only.

    Stage 1 — Rephrase:
      If there is chat history, rewrite the question as a standalone question
      so the retriever doesn't need the conversation context.

    Stage 2 — Answer:
      Retrieve the top-k chunks for the (rephrased) question and answer
      from the document context.
    """
    llm = get_llm()
    parser = StrOutputParser()

    # Stage 1: rephrase if we have history
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
         "If the answer is not in the context, say so clearly.\n\n"
         "Context:\n{context}"),
        MessagesPlaceholder("chat_history"),
        ("human", "{input}"),
    ])

    answer = (qa_prompt | llm | parser).invoke({
        "input": question,
        "chat_history": chat_history,
        "context": context,
    })

    sources = [{"text": d.page_content} for d in docs]
    return {"answer": answer, "sources": sources}


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
        chunk_size=500,
        chunk_overlap=75,
        separators=["\n\n", "\n", ".", " "],
    )
    docs = splitter.create_documents([full_text])

    vectorstore = FAISS.from_documents(docs, _embeddings)
    retriever = vectorstore.as_retriever(search_kwargs={"k": 3})

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
        "message": "PDF indexed with LangChain + FAISS. Conversation memory is active.",
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

    # Persist turn for next call
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
