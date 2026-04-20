import { useState, useRef } from "react";
import axios from "axios";
import "./PdfQA.css";

const API = import.meta.env.VITE_API_URL;

function PdfQA() {
  const [sessionId, setSessionId] = useState(null);
  const [filename, setFilename] = useState("");
  const [uploadStatus, setUploadStatus] = useState("idle"); // idle | uploading | ready | error
  const [uploadInfo, setUploadInfo] = useState(null);

  const [question, setQuestion] = useState("");
  const [provider, setProvider] = useState("auto");
  const [qaHistory, setQaHistory] = useState([]);
  const [asking, setAsking] = useState(false);

  const [expandedSources, setExpandedSources] = useState({});
  const fileInputRef = useRef(null);

  // ─── Upload ───────────────────────────────────────────────

  const handleFileChange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    await uploadFile(file);
  };

  const handleDrop = async (e) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) await uploadFile(file);
  };

  const uploadFile = async (file) => {
    if (!file.name.toLowerCase().endsWith(".pdf")) {
      alert("Only PDF files are supported.");
      return;
    }

    setUploadStatus("uploading");
    setSessionId(null);
    setQaHistory([]);
    setUploadInfo(null);

    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await axios.post(`${API}/pdf/upload`, formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      setSessionId(res.data.session_id);
      setFilename(res.data.filename);
      setUploadInfo(res.data);
      setUploadStatus("ready");
    } catch (err) {
      setUploadStatus("error");
      alert("Upload failed: " + (err.response?.data?.detail || err.message));
    }
  };

  const handleReset = () => {
    setSessionId(null);
    setFilename("");
    setUploadStatus("idle");
    setUploadInfo(null);
    setQaHistory([]);
    setExpandedSources({});
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  // ─── Ask ──────────────────────────────────────────────────

  const askQuestion = async () => {
    if (!question.trim() || !sessionId || asking) return;

    const currentQuestion = question.trim();
    setQuestion("");
    setAsking(true);

    const pendingEntry = { question: currentQuestion, answer: null, sources: [], provider: null };
    setQaHistory((prev) => [...prev, pendingEntry]);

    try {
      const res = await axios.post(`${API}/pdf/ask`, {
        session_id: sessionId,
        question: currentQuestion,
        provider,
        top_k: 3,
      });

      setQaHistory((prev) => {
        const updated = [...prev];
        updated[updated.length - 1] = {
          question: currentQuestion,
          answer: res.data.answer,
          sources: res.data.sources,
          provider: res.data.source_provider,
        };
        return updated;
      });
    } catch (err) {
      setQaHistory((prev) => {
        const updated = [...prev];
        updated[updated.length - 1] = {
          question: currentQuestion,
          answer: "Error: " + (err.response?.data?.detail || err.message),
          sources: [],
          provider: null,
        };
        return updated;
      });
    } finally {
      setAsking(false);
    }
  };

  const toggleSources = (index) => {
    setExpandedSources((prev) => ({ ...prev, [index]: !prev[index] }));
  };

  // ─── Render ───────────────────────────────────────────────

  return (
    <div className="pdfqa-container">
      <h2 className="pdfqa-title">PDF Q&amp;A</h2>
      <p className="pdfqa-subtitle">Upload a PDF and ask questions about its content.</p>

      {/* Upload Zone */}
      {uploadStatus !== "ready" && (
        <div
          className={`upload-zone ${uploadStatus === "uploading" ? "uploading" : ""}`}
          onDrop={handleDrop}
          onDragOver={(e) => e.preventDefault()}
          onClick={() => fileInputRef.current?.click()}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf"
            onChange={handleFileChange}
            style={{ display: "none" }}
          />
          {uploadStatus === "uploading" ? (
            <div className="upload-loading">
              <div className="spinner" />
              <p>Processing PDF…</p>
            </div>
          ) : (
            <>
              <div className="upload-icon">📄</div>
              <p className="upload-label">Drop a PDF here or click to browse</p>
              <span className="upload-hint">Only .pdf files are supported</span>
            </>
          )}
        </div>
      )}

      {/* Ready State */}
      {uploadStatus === "ready" && uploadInfo && (
        <div className="pdf-info-bar">
          <span className="pdf-icon">📄</span>
          <div className="pdf-details">
            <strong>{uploadInfo.filename}</strong>
            <span>{uploadInfo.pages} pages · {uploadInfo.chunks} chunks indexed</span>
          </div>
          <button className="reset-btn" onClick={handleReset} title="Upload a different PDF">
            ✕ Reset
          </button>
        </div>
      )}

      {/* Q&A Section */}
      {uploadStatus === "ready" && (
        <>
          <div className="provider-row">
            <label>Provider:</label>
            <select
              className="provider-select"
              value={provider}
              onChange={(e) => setProvider(e.target.value)}
            >
              <option value="auto">Auto</option>
              <option value="groq">Groq</option>
              <option value="openai">OpenAI</option>
              <option value="gemini">Gemini</option>
              <option value="openrouter">Openrouter</option>
              <option value="huggingface">HuggingFace</option>
              <option value="ollama">Ollama</option>
            </select>
          </div>

          {/* Q&A History */}
          <div className="qa-history">
            {qaHistory.length === 0 && (
              <p className="qa-empty">Ask your first question about <strong>{filename}</strong></p>
            )}

            {qaHistory.map((entry, idx) => (
              <div key={idx} className="qa-entry">
                {/* Question */}
                <div className="qa-question">
                  <span className="qa-badge user-badge">You</span>
                  <p>{entry.question}</p>
                </div>

                {/* Answer */}
                <div className="qa-answer">
                  <span className="qa-badge ai-badge">
                    AI {entry.provider ? `· ${entry.provider}` : ""}
                  </span>
                  {entry.answer === null ? (
                    <div className="thinking">
                      <div className="dot-pulse" />
                    </div>
                  ) : (
                    <p>{entry.answer}</p>
                  )}
                </div>

                {/* Sources */}
                {entry.sources && entry.sources.length > 0 && (
                  <div className="sources-section">
                    <button
                      className="sources-toggle"
                      onClick={() => toggleSources(idx)}
                    >
                      {expandedSources[idx] ? "▲ Hide sources" : "▼ Show sources"} ({entry.sources.length})
                    </button>

                    {expandedSources[idx] && (
                      <div className="sources-list">
                        {entry.sources.map((src, sIdx) => (
                          <div key={sIdx} className="source-chunk">
                            <div className="source-score">
                              Relevance: {(src.score * 100).toFixed(1)}%
                            </div>
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

          {/* Input */}
          <div className="qa-input-row">
            <input
              className="qa-input"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && askQuestion()}
              placeholder="Ask a question about the PDF…"
              disabled={asking}
            />
            <button className="qa-send-btn" onClick={askQuestion} disabled={asking || !question.trim()}>
              {asking ? "…" : "Ask"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export default PdfQA;
