import { useState, useRef } from "react";
import axios from "axios";
import "./LangChainRAG.css";

const API = import.meta.env.VITE_API_URL;

// Tech badges shown in the header
const TECH = ["LangChain", "FAISS", "Conversation Memory", "LCEL"];

function LangChainRAG() {
  const [sessionId, setSessionId]     = useState(null);
  const [uploadInfo, setUploadInfo]   = useState(null);
  const [uploadStatus, setUploadStatus] = useState("idle"); // idle|uploading|ready|error

  const [question, setQuestion]       = useState("");
  const [history, setHistory]         = useState([]);   // [{q, a, sources, turn}]
  const [asking, setAsking]           = useState(false);
  const [expandedIdx, setExpandedIdx] = useState(null);

  const fileInputRef = useRef(null);
  const chatEndRef   = useRef(null);

  // ── Upload ──────────────────────────────────────────────────────

  const uploadFile = async (file) => {
    if (!file.name.toLowerCase().endsWith(".pdf")) {
      alert("Only PDF files are supported.");
      return;
    }
    setUploadStatus("uploading");
    setSessionId(null);
    setHistory([]);
    const form = new FormData();
    form.append("file", file);
    try {
      const res = await axios.post(`${API}/langchain/upload`, form, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      setSessionId(res.data.session_id);
      setUploadInfo(res.data);
      setUploadStatus("ready");
    } catch (err) {
      setUploadStatus("error");
      alert("Upload failed: " + (err.response?.data?.detail || err.message));
    }
  };

  const handleFileChange = (e) => { if (e.target.files[0]) uploadFile(e.target.files[0]); };
  const handleDrop = (e) => { e.preventDefault(); if (e.dataTransfer.files[0]) uploadFile(e.dataTransfer.files[0]); };

  const reset = () => {
    setSessionId(null); setUploadInfo(null);
    setUploadStatus("idle"); setHistory([]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  // ── Ask ─────────────────────────────────────────────────────────

  const ask = async () => {
    if (!question.trim() || !sessionId || asking) return;
    const q = question.trim();
    setQuestion("");
    setAsking(true);
    setHistory(prev => [...prev, { q, a: null, sources: [], turn: null }]);

    try {
      const res = await axios.post(`${API}/langchain/ask`, {
        session_id: sessionId,
        question: q,
      });
      setHistory(prev => {
        const updated = [...prev];
        updated[updated.length - 1] = {
          q,
          a: res.data.answer,
          sources: res.data.sources || [],
          turn: res.data.turn,
        };
        return updated;
      });
    } catch (err) {
      setHistory(prev => {
        const updated = [...prev];
        updated[updated.length - 1] = {
          q, a: "Error: " + (err.response?.data?.detail || err.message),
          sources: [], turn: null,
        };
        return updated;
      });
    } finally {
      setAsking(false);
      setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
    }
  };

  // ── Render ───────────────────────────────────────────────────────

  return (
    <div className="lc-container">
      {/* Header */}
      <div className="lc-header">
        <h2 className="lc-title">LangChain RAG</h2>
        <p className="lc-subtitle">
          Conversational PDF Q&amp;A powered by LangChain's history-aware retrieval chain.
          Follow-up questions work because each query is rephrased using the full chat history
          before chunks are retrieved.
        </p>
        <div className="lc-tech-badges">
          {TECH.map(t => <span key={t} className="tech-badge">{t}</span>)}
        </div>
      </div>

      {/* Upload Zone */}
      {uploadStatus !== "ready" && (
        <div
          className={`lc-upload-zone ${uploadStatus === "uploading" ? "uploading" : ""}`}
          onDrop={handleDrop}
          onDragOver={e => e.preventDefault()}
          onClick={() => fileInputRef.current?.click()}
        >
          <input ref={fileInputRef} type="file" accept=".pdf"
            onChange={handleFileChange} style={{ display: "none" }} />
          {uploadStatus === "uploading" ? (
            <div className="lc-uploading">
              <div className="lc-spinner" />
              <p>Indexing PDF with FAISS…</p>
            </div>
          ) : (
            <>
              <div className="lc-upload-icon">📄</div>
              <p className="lc-upload-label">Drop a PDF here or click to browse</p>
              <span className="lc-upload-hint">Conversation memory persists across all questions</span>
            </>
          )}
        </div>
      )}

      {/* Info bar */}
      {uploadStatus === "ready" && uploadInfo && (
        <div className="lc-info-bar">
          <span>📄</span>
          <div className="lc-info-detail">
            <strong>{uploadInfo.filename}</strong>
            <span>{uploadInfo.pages} pages · {uploadInfo.chunks} chunks in FAISS index</span>
          </div>
          <button className="lc-reset-btn" onClick={reset}>✕ Reset</button>
        </div>
      )}

      {/* Chat */}
      {uploadStatus === "ready" && (
        <>
          <div className="lc-chat-box">
            {history.length === 0 && (
              <p className="lc-empty">
                Ask your first question — then try a follow-up like <em>"Can you elaborate?"</em> or
                <em> "What about X?"</em> to see conversation memory in action.
              </p>
            )}

            {history.map((entry, idx) => (
              <div key={idx} className="lc-entry">
                {/* Question */}
                <div className="lc-bubble-row user-row">
                  <div className="lc-bubble user-bubble">{entry.q}</div>
                  <span className="lc-label user-label">You</span>
                </div>

                {/* Answer */}
                <div className="lc-bubble-row ai-row">
                  <span className="lc-label ai-label">
                    LangChain {entry.turn ? `· turn ${entry.turn}` : ""}
                  </span>
                  {entry.a === null ? (
                    <div className="lc-bubble ai-bubble thinking">
                      <span className="dot" /><span className="dot" /><span className="dot" />
                    </div>
                  ) : (
                    <div className="lc-bubble ai-bubble">{entry.a}</div>
                  )}
                </div>

                {/* Sources */}
                {entry.sources?.length > 0 && (
                  <div className="lc-sources">
                    <button className="lc-src-toggle"
                      onClick={() => setExpandedIdx(expandedIdx === idx ? null : idx)}>
                      {expandedIdx === idx ? "▲ Hide" : "▼ Sources"} ({entry.sources.length})
                    </button>
                    {expandedIdx === idx && (
                      <div className="lc-src-list">
                        {entry.sources.map((s, si) => (
                          <div key={si} className="lc-src-chunk">{s.text}</div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
            <div ref={chatEndRef} />
          </div>

          {/* Input */}
          <div className="lc-input-row">
            <input
              className="lc-input"
              value={question}
              onChange={e => setQuestion(e.target.value)}
              onKeyDown={e => e.key === "Enter" && ask()}
              placeholder="Ask a question — follow-ups remember context…"
              disabled={asking}
            />
            <button className="lc-send-btn" onClick={ask}
              disabled={asking || !question.trim()}>
              {asking ? "…" : "Ask"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export default LangChainRAG;
