# routers/agent.py
#
# LangGraph Research Agent with Server-Sent Events (SSE) streaming.
#
# Graph topology:
#   plan → search → evaluate → (loop back to search OR) synthesize → END
#
# Each node streams its output to the client in real-time so the UI
# can render the pipeline step-by-step as it executes.

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import TypedDict, List
import json, os
from dotenv import load_dotenv

from langgraph.graph import StateGraph, END
from langchain_community.tools import DuckDuckGoSearchRun
from langchain_groq import ChatGroq
from langchain_openai import ChatOpenAI
from langchain_core.messages import HumanMessage, SystemMessage

load_dotenv()

router = APIRouter(prefix="/agent", tags=["LangGraph Agent"])

_search = DuckDuckGoSearchRun()


# ─── LLM helper ───────────────────────────────────────────────────

def get_llm():
    if os.getenv("GROQ_API_KEY"):
        return ChatGroq(
            api_key=os.getenv("GROQ_API_KEY"),
            model="llama-3.3-70b-versatile",
            max_tokens=600,
        )
    if os.getenv("OPENAI_API_KEY"):
        return ChatOpenAI(
            api_key=os.getenv("OPENAI_API_KEY"),
            model="gpt-4.1-mini",
            max_tokens=600,
        )
    raise ValueError("No LLM API key configured.")


# ─── Graph State ──────────────────────────────────────────────────

class AgentState(TypedDict):
    question: str
    sub_questions: List[str]
    search_results: List[dict]   # [{query, result}]
    is_sufficient: bool
    answer: str
    iterations: int


# ─── Nodes ────────────────────────────────────────────────────────

def plan_node(state: AgentState) -> dict:
    """Break the user's question into 2-3 targeted sub-questions."""
    llm = get_llm()
    response = llm.invoke([
        SystemMessage(content=(
            "You are a research planner. Break the user's question into "
            "2-3 specific sub-questions that, together, fully answer it. "
            'Return ONLY a valid JSON array of strings, e.g. ["q1","q2"].'
        )),
        HumanMessage(content=state["question"]),
    ])
    try:
        sub_questions = json.loads(response.content)
        if not isinstance(sub_questions, list):
            raise ValueError
    except Exception:
        # Fallback: treat original question as single sub-question
        sub_questions = [state["question"]]
    return {"sub_questions": sub_questions}


def search_node(state: AgentState) -> dict:
    """Run DuckDuckGo search for each sub-question."""
    results = []
    for q in state["sub_questions"]:
        try:
            result = _search.run(q)
        except Exception as e:
            result = f"Search unavailable: {str(e)}"
        results.append({"query": q, "result": result[:1500]})   # cap length
    return {"search_results": results}


def evaluate_node(state: AgentState) -> dict:
    """Decide whether search results are sufficient to answer the question."""
    # Hard-cap at 2 iterations to avoid infinite loops
    if state["iterations"] >= 2:
        return {"is_sufficient": True, "iterations": state["iterations"] + 1}

    llm = get_llm()
    context = "\n\n".join(r["result"] for r in state["search_results"])
    response = llm.invoke([
        SystemMessage(content=(
            'Given the original question and the search results so far, '
            'reply with ONLY "yes" if there is enough information to write '
            'a good answer, or "no" if a second round of searching is needed.'
        )),
        HumanMessage(content=(
            f"Question: {state['question']}\n\n"
            f"Search results:\n{context}"
        )),
    ])
    is_sufficient = "yes" in response.content.strip().lower()
    return {"is_sufficient": is_sufficient, "iterations": state["iterations"] + 1}


def synthesize_node(state: AgentState) -> dict:
    """Write a comprehensive final answer from all search results."""
    llm = get_llm()
    context = "\n\n---\n\n".join(
        f"Sub-question: {r['query']}\nFindings: {r['result']}"
        for r in state["search_results"]
    )
    response = llm.invoke([
        SystemMessage(content=(
            "You are a research synthesizer. Write a clear, well-structured "
            "answer to the original question using the research findings. "
            "Reference key facts and keep it concise."
        )),
        HumanMessage(content=(
            f"Original question: {state['question']}\n\n"
            f"Research findings:\n{context}"
        )),
    ])
    return {"answer": response.content}


def route_after_evaluate(state: AgentState) -> str:
    return "synthesize" if state["is_sufficient"] else "search"


# ─── Build & compile graph ─────────────────────────────────────────

def _build_graph():
    g = StateGraph(AgentState)
    g.add_node("plan", plan_node)
    g.add_node("search", search_node)
    g.add_node("evaluate", evaluate_node)
    g.add_node("synthesize", synthesize_node)

    g.set_entry_point("plan")
    g.add_edge("plan", "search")
    g.add_edge("search", "evaluate")
    g.add_conditional_edges(
        "evaluate",
        route_after_evaluate,
        {"search": "search", "synthesize": "synthesize"},
    )
    g.add_edge("synthesize", END)
    return g.compile()


_graph = _build_graph()


# ─── Route ────────────────────────────────────────────────────────

class ResearchRequest(BaseModel):
    question: str


@router.post("/research")
async def research(req: ResearchRequest):
    if not req.question.strip():
        raise HTTPException(400, "Question cannot be empty.")

    initial_state: AgentState = {
        "question": req.question,
        "sub_questions": [],
        "search_results": [],
        "is_sufficient": False,
        "answer": "",
        "iterations": 0,
    }

    async def event_stream():
        try:
            # stream() yields {node_name: updated_state_fields} after each node
            for step in _graph.stream(initial_state):
                node_name = list(step.keys())[0]
                node_data = step[node_name]

                payload: dict = {"node": node_name, "data": {}}

                if node_name == "plan":
                    payload["data"] = {"sub_questions": node_data.get("sub_questions", [])}

                elif node_name == "search":
                    payload["data"] = {"search_results": node_data.get("search_results", [])}

                elif node_name == "evaluate":
                    payload["data"] = {
                        "is_sufficient": node_data.get("is_sufficient"),
                        "iterations": node_data.get("iterations"),
                    }

                elif node_name == "synthesize":
                    payload["data"] = {"answer": node_data.get("answer", "")}

                yield f"data: {json.dumps(payload)}\n\n"

        except Exception as exc:
            yield f"data: {json.dumps({'node': 'error', 'data': {'message': str(exc)}})}\n\n"

        yield "data: [DONE]\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",       # disable nginx buffering
        },
    )
