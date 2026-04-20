import { useState, useRef } from "react";
import "./ResearchAgent.css";

const API = import.meta.env.VITE_API_URL;

const TECH = ["LangGraph", "StateGraph", "DuckDuckGo Search", "SSE Streaming"];

const NODE_META = {
  plan:       { label: "Plan",      icon: "🗺️",  color: "#7950f2" },
  search:     { label: "Search",    icon: "🔍",  color: "#1c7ed6" },
  evaluate:   { label: "Evaluate",  icon: "⚖️",  color: "#f59f00" },
  synthesize: { label: "Synthesize",icon: "✍️",  color: "#2f9e44" },
  error:      { label: "Error",     icon: "❌",  color: "#e03131" },
};

const STATUS = { idle: "idle", running: "running", done: "done" };

function ResearchAgent() {
  const [question, setQuestion] = useState("");
  const [status, setStatus]     = useState(STATUS.idle);
  const [steps, setSteps]       = useState([]);   // [{node, data, ts}]
  const [answer, setAnswer]     = useState("");
  const [activeNode, setActiveNode] = useState(null);
  const readerRef = useRef(null);

  // ── Run research ───────────────────────────────────────────────

  const runResearch = async () => {
    if (!question.trim() || status === STATUS.running) return;

    setStatus(STATUS.running);
    setSteps([]);
    setAnswer("");
    setActiveNode("plan");

    try {
      const response = await fetch(`${API}/agent/research`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: question.trim() }),
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.detail || "Request failed");
      }

      const reader = response.body.getReader();
      readerRef.current = reader;
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop();  // keep incomplete line

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const raw = line.slice(6).trim();
          if (raw === "[DONE]") { setStatus(STATUS.done); setActiveNode(null); break; }

          try {
            const event = JSON.parse(raw);
            const { node, data } = event;

            setSteps(prev => [...prev, { node, data, ts: Date.now() }]);

            if (node === "synthesize" && data.answer) {
              setAnswer(data.answer);
              setActiveNode(null);
            } else if (node === "error") {
              setStatus(STATUS.done);
              setActiveNode(null);
            } else {
              // set next expected node
              const next = { plan: "search", search: "evaluate", evaluate: "synthesize" };
              setActiveNode(next[node] || null);
            }
          } catch (_) { /* ignore malformed line */ }
        }
      }
    } catch (err) {
      setSteps(prev => [...prev, { node: "error", data: { message: err.message }, ts: Date.now() }]);
      setStatus(STATUS.done);
      setActiveNode(null);
    }
  };

  const reset = () => {
    readerRef.current?.cancel();
    setStatus(STATUS.idle);
    setSteps([]);
    setAnswer("");
    setActiveNode(null);
  };

  // ── Pipeline header nodes ─────────────────────────────────────

  const completedNodes = new Set(steps.map(s => s.node));
  const pipelineNodes  = ["plan", "search", "evaluate", "synthesize"];

  // ── Render ────────────────────────────────────────────────────

  return (
    <div className="ra-container">
      {/* Header */}
      <div className="ra-header">
        <h2 className="ra-title">Research Agent</h2>
        <p className="ra-subtitle">
          A LangGraph <code>StateGraph</code> that plans sub-questions, searches the web,
          evaluates sufficiency, and synthesizes a final answer — streamed step by step.
        </p>
        <div className="ra-tech-badges">
          {TECH.map(t => <span key={t} className="ra-badge">{t}</span>)}
        </div>
      </div>

      {/* Input */}
      <div className="ra-input-row">
        <input
          className="ra-input"
          value={question}
          onChange={e => setQuestion(e.target.value)}
          onKeyDown={e => e.key === "Enter" && runResearch()}
          placeholder="Ask a research question, e.g. 'How does RAG work in LLMs?'"
          disabled={status === STATUS.running}
        />
        {status === STATUS.running ? (
          <button className="ra-btn stop-btn" onClick={reset}>Stop</button>
        ) : (
          <button className="ra-btn run-btn" onClick={runResearch}
            disabled={!question.trim()}>
            Research
          </button>
        )}
      </div>
      {status !== STATUS.idle && (
        <button className="ra-reset-link" onClick={reset}>← New question</button>
      )}

      {/* Pipeline visual */}
      {status !== STATUS.idle && (
        <div className="ra-pipeline">
          {pipelineNodes.map((n, i) => {
            const meta   = NODE_META[n];
            const done   = completedNodes.has(n);
            const active = activeNode === n;
            return (
              <div key={n} className="ra-pipe-item">
                <div
                  className={`ra-pipe-node ${done ? "done" : ""} ${active ? "active" : ""}`}
                  style={{ "--node-color": meta.color }}
                >
                  <span className="ra-pipe-icon">{meta.icon}</span>
                  <span className="ra-pipe-label">{meta.label}</span>
                  {active && <span className="ra-pipe-pulse" />}
                </div>
                {i < pipelineNodes.length - 1 && (
                  <div className={`ra-pipe-arrow ${done ? "done" : ""}`}>→</div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Step details */}
      {steps.length > 0 && (
        <div className="ra-steps">
          {steps.map((step, idx) => {
            const meta = NODE_META[step.node] || NODE_META.error;
            return (
              <div key={idx} className="ra-step-card"
                style={{ borderLeftColor: meta.color }}>
                <div className="ra-step-head">
                  <span className="ra-step-icon">{meta.icon}</span>
                  <strong>{meta.label}</strong>
                </div>
                <StepBody node={step.node} data={step.data} />
              </div>
            );
          })}
        </div>
      )}

      {/* Final answer */}
      {answer && (
        <div className="ra-answer-card">
          <div className="ra-answer-head">✍️ Final Answer</div>
          <p className="ra-answer-text">{answer}</p>
        </div>
      )}
    </div>
  );
}

// ── Step body renderer ─────────────────────────────────────────

function StepBody({ node, data }) {
  const [expanded, setExpanded] = useState(false);

  if (node === "plan") {
    return (
      <ul className="ra-step-list">
        {(data.sub_questions || []).map((q, i) => (
          <li key={i}>{q}</li>
        ))}
      </ul>
    );
  }

  if (node === "search") {
    return (
      <div>
        {(data.search_results || []).map((r, i) => (
          <div key={i} className="ra-search-item">
            <div className="ra-search-query">🔎 {r.query}</div>
            <p className="ra-search-snippet">
              {expanded ? r.result : r.result?.slice(0, 200) + (r.result?.length > 200 ? "…" : "")}
            </p>
          </div>
        ))}
        <button className="ra-expand-btn" onClick={() => setExpanded(e => !e)}>
          {expanded ? "Show less" : "Show full results"}
        </button>
      </div>
    );
  }

  if (node === "evaluate") {
    const ok = data.is_sufficient;
    return (
      <p className={`ra-eval-result ${ok ? "sufficient" : "insufficient"}`}>
        {ok
          ? "✅ Information is sufficient — proceeding to synthesis."
          : `🔄 Needs more research — running search again (iteration ${data.iterations}).`}
      </p>
    );
  }

  if (node === "synthesize") {
    return <p className="ra-step-answer">{data.answer}</p>;
  }

  if (node === "error") {
    return <p className="ra-error-msg">⚠️ {data.message}</p>;
  }

  return null;
}

export default ResearchAgent;
