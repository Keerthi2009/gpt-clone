# routers/mcp_server.py
#
# REST API that exposes MCP-style tools for the in-app Explorer UI.
# Each tool has a JSON Schema definition (exactly what the MCP protocol
# uses) so the UI can render a live playground without hardcoding forms.
#
# The standalone MCP server (usable from Claude Desktop / Claude Code)
# lives in backend/mcp_app.py — run it with: python mcp_app.py

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
import os
from dotenv import load_dotenv

from .chat import PROVIDERS, FALLBACK_ORDER
from .pdf_qa import pdf_sessions, embedding_model, cosine_similarity

import numpy as np

load_dotenv()

router = APIRouter(prefix="/mcp", tags=["MCP Explorer"])


# ─── Tool registry (JSON Schema — same format as real MCP) ────────

TOOLS = {
    "ask_llm": {
        "name": "ask_llm",
        "description": "Ask any question to the LLM using the configured provider fallback chain.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "question": {
                    "type": "string",
                    "description": "The question or prompt to send to the LLM.",
                },
                "provider": {
                    "type": "string",
                    "description": "LLM provider to use.",
                    "enum": ["auto", "groq", "openai", "gemini", "openrouter", "huggingface", "ollama"],
                    "default": "auto",
                },
            },
            "required": ["question"],
        },
    },
    "list_pdf_sessions": {
        "name": "list_pdf_sessions",
        "description": "List all active PDF sessions that have been uploaded to the server.",
        "inputSchema": {
            "type": "object",
            "properties": {},
            "required": [],
        },
    },
    "ask_pdf": {
        "name": "ask_pdf",
        "description": "Ask a question about a previously uploaded PDF using RAG retrieval.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "session_id": {
                    "type": "string",
                    "description": "Session ID returned by /pdf/upload.",
                },
                "question": {
                    "type": "string",
                    "description": "The question to answer from the PDF.",
                },
                "top_k": {
                    "type": "integer",
                    "description": "Number of document chunks to retrieve.",
                    "default": 3,
                },
            },
            "required": ["session_id", "question"],
        },
    },
    "list_providers": {
        "name": "list_providers",
        "description": "List all configured LLM providers and their auto-fallback order.",
        "inputSchema": {
            "type": "object",
            "properties": {},
            "required": [],
        },
    },
}


# ─── Tool execution ────────────────────────────────────────────────

def run_tool(name: str, args: dict) -> dict:
    if name == "ask_llm":
        question = args.get("question", "").strip()
        if not question:
            raise ValueError("'question' is required.")
        provider = args.get("provider", "auto").lower()
        messages = [{"role": "user", "content": question}]

        if provider != "auto":
            if provider not in PROVIDERS:
                raise ValueError(f"Unknown provider: {provider}")
            reply = PROVIDERS[provider](messages)
            return {"answer": reply, "provider": provider}

        errors = {}
        for p in FALLBACK_ORDER:
            try:
                reply = PROVIDERS[p](messages)
                return {"answer": reply, "provider": p}
            except Exception as e:
                errors[p] = str(e)
        raise ValueError(f"All providers failed: {errors}")

    elif name == "list_pdf_sessions":
        return {
            "sessions": [
                {
                    "session_id": sid,
                    "filename": s["filename"],
                    "chunks": len(s["chunks"]),
                }
                for sid, s in pdf_sessions.items()
            ],
            "count": len(pdf_sessions),
        }

    elif name == "ask_pdf":
        session_id = args.get("session_id", "")
        question = args.get("question", "").strip()
        top_k = int(args.get("top_k", 3))

        session = pdf_sessions.get(session_id)
        if not session:
            raise ValueError(f"Session '{session_id}' not found. Upload a PDF first.")
        if not question:
            raise ValueError("'question' is required.")

        q_vec = embedding_model.encode([question])[0]
        scores = cosine_similarity(q_vec, session["embeddings"])
        top_indices = np.argsort(scores)[::-1][:top_k]
        top_chunks = [session["chunks"][i] for i in top_indices]
        context = "\n\n---\n\n".join(top_chunks)

        messages = [
            {"role": "system", "content": f"Answer based only on this document:\n\n{context}"},
            {"role": "user", "content": question},
        ]
        errors = {}
        for p in FALLBACK_ORDER:
            try:
                answer = PROVIDERS[p](messages)
                return {"answer": answer, "filename": session["filename"], "provider": p}
            except Exception as e:
                errors[p] = str(e)
        raise ValueError(f"All providers failed: {errors}")

    elif name == "list_providers":
        return {
            "providers": list(PROVIDERS.keys()),
            "fallback_order": FALLBACK_ORDER,
        }

    else:
        raise ValueError(f"Unknown tool: '{name}'")


# ─── REST endpoints ────────────────────────────────────────────────

@router.get("/info")
def server_info():
    return {
        "name": "GPT Clone MCP Server",
        "version": "1.0.0",
        "description": "MCP server exposing LLM chat and PDF Q&A tools.",
        "protocol": "Model Context Protocol (MCP)",
        "tools_count": len(TOOLS),
        "standalone_server": "Run `python backend/mcp_app.py` to start the real MCP server.",
        "claude_desktop_config": {
            "mcpServers": {
                "gpt-clone": {
                    "command": "python",
                    "args": ["backend/mcp_app.py"],
                }
            }
        },
    }


@router.get("/tools")
def list_tools():
    return {"tools": list(TOOLS.values())}


class CallRequest(BaseModel):
    arguments: dict = {}


@router.post("/tools/{tool_name}/call")
def call_tool(tool_name: str, req: CallRequest):
    if tool_name not in TOOLS:
        raise HTTPException(404, f"Tool '{tool_name}' not found.")
    try:
        result = run_tool(tool_name, req.arguments)
        return {"tool": tool_name, "result": result, "isError": False}
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        raise HTTPException(500, str(e))
