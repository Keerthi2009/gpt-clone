import { useState, useEffect } from "react";
import axios from "axios";
import "./MCPExplorer.css";

const API = import.meta.env.VITE_API_URL;

const TECH = ["MCP Protocol", "Tool Schemas", "JSON Schema", "FastMCP"];

export default function MCPExplorer() {
  const [serverInfo, setServerInfo]   = useState(null);
  const [tools, setTools]             = useState([]);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState(null);

  const [selectedTool, setSelectedTool] = useState(null);
  const [args, setArgs]               = useState({});       // {field: value}
  const [calling, setCalling]         = useState(false);
  const [callResult, setCallResult]   = useState(null);
  const [callError, setCallError]     = useState(null);

  const [expandedTool, setExpandedTool] = useState(null);   // schema viewer

  // ── Load server info + tools ───────────────────────────────────

  useEffect(() => {
    Promise.all([
      axios.get(`${API}/mcp/info`),
      axios.get(`${API}/mcp/tools`),
    ])
      .then(([infoRes, toolsRes]) => {
        setServerInfo(infoRes.data);
        setTools(toolsRes.data.tools);
        if (toolsRes.data.tools.length > 0) {
          selectTool(toolsRes.data.tools[0]);
        }
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  // ── Tool selection ─────────────────────────────────────────────

  const selectTool = (tool) => {
    setSelectedTool(tool);
    setCallResult(null);
    setCallError(null);
    // init args with defaults
    const defaults = {};
    for (const [k, v] of Object.entries(tool.inputSchema?.properties || {})) {
      defaults[k] = v.default ?? "";
    }
    setArgs(defaults);
  };

  // ── Call tool ──────────────────────────────────────────────────

  const callTool = async () => {
    if (!selectedTool || calling) return;
    setCalling(true);
    setCallResult(null);
    setCallError(null);

    // Coerce integer fields
    const coerced = {};
    for (const [k, v] of Object.entries(args)) {
      const schema = selectedTool.inputSchema?.properties?.[k];
      coerced[k] = schema?.type === "integer" ? parseInt(v, 10) || v : v;
    }

    try {
      const res = await axios.post(
        `${API}/mcp/tools/${selectedTool.name}/call`,
        { arguments: coerced }
      );
      setCallResult(res.data);
    } catch (e) {
      setCallError(e.response?.data?.detail || e.message);
    } finally {
      setCalling(false);
    }
  };

  // ── Render ─────────────────────────────────────────────────────

  if (loading) return <div className="mcp-loading">Loading MCP server…</div>;
  if (error)   return <div className="mcp-error">Error: {error}</div>;

  return (
    <div className="mcp-container">
      {/* Header */}
      <div className="mcp-header">
        <h2 className="mcp-title">MCP Explorer</h2>
        <p className="mcp-subtitle">
          The <strong>Model Context Protocol</strong> standardises how AI models interact with tools.
          This server exposes tools following MCP's JSON Schema spec — any MCP-compatible client
          (Claude Desktop, Claude Code) can call them directly.
        </p>
        <div className="mcp-tech-badges">
          {TECH.map(t => <span key={t} className="mcp-badge">{t}</span>)}
        </div>
      </div>

      {/* Server info card */}
      {serverInfo && (
        <div className="mcp-server-card">
          <div className="mcp-server-row">
            <span className="mcp-server-dot" />
            <strong>{serverInfo.name}</strong>
            <span className="mcp-server-ver">v{serverInfo.version}</span>
            <span className="mcp-server-count">{serverInfo.tools_count} tools</span>
          </div>
          <p className="mcp-server-desc">{serverInfo.description}</p>

          <div className="mcp-connect-box">
            <strong>Connect from Claude Code:</strong>
            <code>claude mcp add gpt-clone python /path/to/backend/mcp_app.py</code>
          </div>
          <div className="mcp-connect-box">
            <strong>Claude Desktop config (~/.claude/claude_desktop_config.json):</strong>
            <pre>{JSON.stringify(serverInfo.claude_desktop_config, null, 2)}</pre>
          </div>
        </div>
      )}

      <div className="mcp-body">
        {/* Tool list */}
        <div className="mcp-tool-list">
          <h3 className="mcp-section-title">Available Tools</h3>
          {tools.map(tool => (
            <div
              key={tool.name}
              className={`mcp-tool-card ${selectedTool?.name === tool.name ? "selected" : ""}`}
              onClick={() => selectTool(tool)}
            >
              <div className="mcp-tool-name">{tool.name}</div>
              <div className="mcp-tool-desc">{tool.description}</div>
              <div className="mcp-tool-params">
                {Object.keys(tool.inputSchema?.properties || {}).length} param(s)
              </div>
              <button
                className="mcp-schema-btn"
                onClick={e => { e.stopPropagation(); setExpandedTool(expandedTool === tool.name ? null : tool.name); }}
              >
                {expandedTool === tool.name ? "Hide schema" : "View schema"}
              </button>
              {expandedTool === tool.name && (
                <pre className="mcp-schema-pre">
                  {JSON.stringify(tool.inputSchema, null, 2)}
                </pre>
              )}
            </div>
          ))}
        </div>

        {/* Playground */}
        <div className="mcp-playground">
          <h3 className="mcp-section-title">Tool Playground</h3>
          {selectedTool ? (
            <>
              <div className="mcp-play-tool-name">{selectedTool.name}</div>
              <p className="mcp-play-desc">{selectedTool.description}</p>

              {/* Dynamic form from JSON Schema */}
              <div className="mcp-form">
                {Object.entries(selectedTool.inputSchema?.properties || {}).map(([key, schema]) => {
                  const required = selectedTool.inputSchema?.required?.includes(key);
                  return (
                    <div key={key} className="mcp-field">
                      <label className="mcp-field-label">
                        {key}
                        {required && <span className="mcp-required">*</span>}
                        <span className="mcp-field-type">{schema.type}</span>
                      </label>
                      {schema.enum ? (
                        <select
                          className="mcp-select"
                          value={args[key] ?? ""}
                          onChange={e => setArgs(a => ({ ...a, [key]: e.target.value }))}
                        >
                          {schema.enum.map(opt => (
                            <option key={opt} value={opt}>{opt}</option>
                          ))}
                        </select>
                      ) : schema.type === "integer" ? (
                        <input
                          type="number"
                          className="mcp-input"
                          value={args[key] ?? ""}
                          onChange={e => setArgs(a => ({ ...a, [key]: e.target.value }))}
                        />
                      ) : (
                        <textarea
                          className="mcp-textarea"
                          rows={key === "question" ? 3 : 1}
                          value={args[key] ?? ""}
                          onChange={e => setArgs(a => ({ ...a, [key]: e.target.value }))}
                          placeholder={schema.description || ""}
                        />
                      )}
                      <span className="mcp-field-hint">{schema.description}</span>
                    </div>
                  );
                })}
              </div>

              <button
                className="mcp-call-btn"
                onClick={callTool}
                disabled={calling}
              >
                {calling ? "Calling…" : `Call ${selectedTool.name}`}
              </button>

              {/* Result */}
              {callResult && (
                <div className="mcp-result">
                  <div className="mcp-result-head">✅ Result</div>
                  <pre className="mcp-result-pre">
                    {JSON.stringify(callResult.result, null, 2)}
                  </pre>
                </div>
              )}
              {callError && (
                <div className="mcp-result error">
                  <div className="mcp-result-head">❌ Error</div>
                  <pre className="mcp-result-pre">{callError}</pre>
                </div>
              )}
            </>
          ) : (
            <p className="mcp-play-empty">Select a tool from the left to test it.</p>
          )}
        </div>
      </div>
    </div>
  );
}
