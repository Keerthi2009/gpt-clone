"""
Standalone MCP Server for GPT Clone
=====================================
Uses the official Anthropic MCP Python SDK (mcp[cli]).

Run:
    python backend/mcp_app.py

Connect from Claude Desktop (~/.claude/claude_desktop_config.json):
    {
      "mcpServers": {
        "gpt-clone": {
          "command": "python",
          "args": ["/absolute/path/to/backend/mcp_app.py"]
        }
      }
    }

Connect from Claude Code:
    claude mcp add gpt-clone python /absolute/path/to/backend/mcp_app.py
"""

import os, sys, json
import numpy as np
from dotenv import load_dotenv

# Make sure routers are importable when running from project root
sys.path.insert(0, os.path.dirname(__file__))

load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))

from mcp.server.fastmcp import FastMCP

mcp = FastMCP("GPT Clone")

# ── lazy imports so the server starts fast ──

def _get_providers():
    from routers.chat import PROVIDERS, FALLBACK_ORDER
    return PROVIDERS, FALLBACK_ORDER

def _get_pdf_store():
    from routers.pdf_qa import pdf_sessions, embedding_model, cosine_similarity
    return pdf_sessions, embedding_model, cosine_similarity


# ─── Tools ────────────────────────────────────────────────────────

@mcp.tool()
def ask_llm(question: str, provider: str = "auto") -> str:
    """
    Ask a question to the LLM using the configured provider fallback chain.

    Args:
        question: The question or prompt to send.
        provider: One of auto | groq | openai | gemini | openrouter | huggingface | ollama.
    """
    PROVIDERS, FALLBACK_ORDER = _get_providers()
    messages = [{"role": "user", "content": question}]

    if provider != "auto":
        if provider not in PROVIDERS:
            return f"Error: unknown provider '{provider}'"
        try:
            return PROVIDERS[provider](messages)
        except Exception as e:
            return f"Error from {provider}: {e}"

    for p in FALLBACK_ORDER:
        try:
            return PROVIDERS[p](messages)
        except Exception:
            continue
    return "Error: all providers failed."


@mcp.tool()
def list_pdf_sessions() -> str:
    """List all active PDF sessions that have been uploaded to the server."""
    pdf_sessions, _, _ = _get_pdf_store()
    if not pdf_sessions:
        return "No PDF sessions found. Upload a PDF via the web app first."
    lines = [f"- {sid[:8]}…  {s['filename']}  ({len(s['chunks'])} chunks)"
             for sid, s in pdf_sessions.items()]
    return "\n".join(lines)


@mcp.tool()
def ask_pdf(session_id: str, question: str, top_k: int = 3) -> str:
    """
    Ask a question about a previously uploaded PDF using RAG retrieval.

    Args:
        session_id: Session ID returned when the PDF was uploaded.
        question: The question to answer from the PDF.
        top_k: Number of document chunks to retrieve (default 3).
    """
    pdf_sessions, embedding_model, cosine_similarity = _get_pdf_store()
    PROVIDERS, FALLBACK_ORDER = _get_providers()

    session = pdf_sessions.get(session_id)
    if not session:
        return f"Session '{session_id}' not found. Upload a PDF via the web app first."

    q_vec = embedding_model.encode([question])[0]
    scores = cosine_similarity(q_vec, session["embeddings"])
    top_indices = np.argsort(scores)[::-1][:top_k]
    top_chunks = [session["chunks"][i] for i in top_indices]
    context = "\n\n---\n\n".join(top_chunks)

    messages = [
        {"role": "system", "content": f"Answer based only on this document:\n\n{context}"},
        {"role": "user", "content": question},
    ]
    for p in FALLBACK_ORDER:
        try:
            return PROVIDERS[p](messages)
        except Exception:
            continue
    return "Error: all providers failed."


@mcp.tool()
def list_providers() -> str:
    """List all available LLM providers and their auto-fallback order."""
    PROVIDERS, FALLBACK_ORDER = _get_providers()
    providers = list(PROVIDERS.keys())
    return json.dumps({
        "available_providers": providers,
        "auto_fallback_order": FALLBACK_ORDER,
    }, indent=2)


# ─── Entry point ──────────────────────────────────────────────────

if __name__ == "__main__":
    mcp.run()   # stdio transport — compatible with Claude Desktop & Claude Code
