import { useState, useRef } from "react";
import axios from "axios";
import "./PdfQA.css";
import { useSession } from "../context/SessionContext";

const API = import.meta.env.VITE_API_URL;

function PdfQA() {
  // ── Persistent state lives in context (survives tab switches) ──
  const { pdfQA, setPdfQA } = useSession();
  const { sessionId, filename, uploadStatus, uploadInfo, history: qaHistory } = pdfQA;

  const set = (patch) => setPdfQA(prev => ({ ...prev, ...patch }));

  // ── Transient UI state stays local ────────────────────────────
  const [question, setQuestion]           = useState("");
  const [provider, setProvider]           = useState("auto");
  const [asking, setAsking]               = useState(false);
  const [expandedSources, setExpandedSources] = useState({});
  const fileInputRef = useRef(null);

  // ── Upload ────────────────────────────────────────────────────

  const uploadFile = async (file) => {
    if (!file.name.toLowerCase().endsWith(".pdf")) {
      alert("Only PDF files are supported.");
      return;
    }
    set({ uploadStatus: "uploading", sessionId: null, uploadInfo: null, history: [] });

    const formData = new FormData();
    formData.append("file", file);
    try {
      const res = await axios.post(`${API}/pdf/upload`, formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      set({
        sessionId: res.data.session_id,
        filename: res.data.filename,
        uploadInfo: res.data,
        uploadStatus: "ready",
      });
    } catch (err) {
      set({ uploadStatus: "error" });
      alert("Upload failed: " + (err.response?.data?.detail || err.message));
    }
  };

  const handleFileChange = (e) => { if (e.target.files[0]) uploadFile(e.target.files[0]); };
  const handleDrop = (e) => { e.preventDefault(); if (e.dataTransfer.files[0]) uploadFile(e.dataTransfer.files[0]); };

  const handleReset = () => {
    set({ sessionId: null, filename: "", uploadStatus: "idle", uploadInfo: null, history: [] });
    setExpandedSources({});
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  // ── Ask ───────────────────────────────────────────────────────

  const askQuestion = async () => {
    if (!question.trim() || !sessionId || asking) return;
    const q = question.trim();
    setQuestion("");
    setAsking(true);

    set({ history: [...qaHistory, { question: q, answer: null, sources: [], provider: null }] });

    try {
      const res = await axios.post(`${API}/pdf/ask`, {
        session_id: sessionId, question: q, provider, top_k: 3,
      });
      set({
        history: [
          ...qaHistory,
          { question: q, answer: res.data.answer, sources: res.data.sources, provider: res.data.source_provider },
        ],
      });
    } catch (err) {
      set({
        history: [
          ...qaHistory,
          { question: q, answer: "Error: " + (err.response?.data?.detail || err.message), sources: [], provider: null },
        ],
      });
    } finally {
      setAsking(false);
    }
  };

  const toggleSources = (i) => setExpandedSources(prev => ({ ...prev, [i]: !prev[i] }));

  // ── Render ────────────────────────────────────────────────────

  return (
    <div className="pdfqa-container">
      <h2 className="pdfqa-title">PDF Q&amp;A</h2>
      <p className="pdfqa-subtitle">Upload a PDF and ask questions about its content.</p>

      {uploadStatus !== "ready" && (
        <div
          className={`upload-zone ${uploadStatus === "uploading" ? "uploading" : ""}`}
          onDrop={handleDrop} onDragOver={e => e.preventDefault()}
          onClick={() => fileInputRef.current?.click()}
        >
          <input ref={fileInputRef} type="file" accept=".pdf"
            onChange={handleFileChange} style={{ display: "none" }} />
          {uploadStatus === "uploading" ? (
            <div className="upload-loading"><div className="spinner" /><p>Processing PDF…</p></div>
          ) : (
            <>
              <div className="upload-icon">📄</div>
              <p className="upload-label">Drop a PDF here or click to browse</p>
              <span className="upload-hint">Only .pdf files are supported</span>
            </>
          )}
        </div>
      )}

      {uploadStatus === "ready" && uploadInfo && (
        <div className="pdf-info-bar">
          <span className="pdf-icon">📄</span>
          <div className="pdf-details">
            <strong>{uploadInfo.filename}</strong>
            <span>{uploadInfo.pages} pages · {uploadInfo.chunks} chunks indexed</span>
          </div>
          <button className="reset-btn" onClick={handleReset}>✕ Reset</button>
        </div>
      )}

      {uploadStatus === "ready" && (
        <>
          <div className="provider-row">
            <label>Provider:</label>
            <select className="provider-select" value={provider}
              onChange={e => setProvider(e.target.value)}>
              <option value="auto">Auto</option>
              <option value="groq">Groq</option>
              <option value="openai">OpenAI</option>
              <option value="gemini">Gemini</option>
              <option value="openrouter">Openrouter</option>
              <option value="huggingface">HuggingFace</option>
              <option value="ollama">Ollama</option>
            </select>
          </div>

          <div className="qa-history">
            {qaHistory.length === 0 && (
              <p className="qa-empty">Ask your first question about <strong>{filename}</strong></p>
            )}
            {qaHistory.map((entry, idx) => (
              <div key={idx} className="qa-entry">
                <div className="qa-question">
                  <span className="qa-badge user-badge">You</span>
                  <p>{entry.question}</p>
                </div>
                <div className="qa-answer">
                  <span className="qa-badge ai-badge">
                    AI {entry.provider ? `· ${entry.provider}` : ""}
                  </span>
                  {entry.answer === null ? (
                    <div className="thinking"><div className="dot-pulse" /></div>
                  ) : (
                    <p>{entry.answer}</p>
                  )}
                </div>
                {entry.sources?.length > 0 && (
                  <div className="sources-section">
                    <button className="sources-toggle" onClick={() => toggleSources(idx)}>
                      {expandedSources[idx] ? "▲ Hide sources" : "▼ Show sources"} ({entry.sources.length})
                    </button>
                    {expandedSources[idx] && (
                      <div className="sources-list">
                        {entry.sources.map((src, si) => (
                          <div key={si} className="source-chunk">
                            <div className="source-score">Relevance: {(src.score * 100).toFixed(1)}%</div>
                            <p>{src.text}</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className="qa-input-row">
            <input className="qa-input" value={question}
              onChange={e => setQuestion(e.target.value)}
              onKeyDown={e => e.key === "Enter" && askQuestion()}
              placeholder="Ask a question about the PDF…" disabled={asking} />
            <button className="qa-send-btn" onClick={askQuestion}
              disabled={asking || !question.trim()}>
              {asking ? "…" : "Ask"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export default PdfQA;
