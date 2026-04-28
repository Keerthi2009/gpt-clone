import { Routes, Route, Link, useLocation } from "react-router-dom";
import { lazy, Suspense } from "react";
import "./App.css";
import { SessionProvider } from "./context/SessionContext";

const Chat           = lazy(() => import("./pages/Chat"));
const PdfQA          = lazy(() => import("./pages/PdfQA"));
const LangChainRAG   = lazy(() => import("./pages/LangChainRAG"));
const ResearchAgent  = lazy(() => import("./pages/ResearchAgent"));
const MCPExplorer    = lazy(() => import("./pages/MCPExplorer"));

const NAV_LINKS = [
  { to: "/",               label: "Home" },
  { to: "/chat",           label: "Chat" },
  { to: "/pdf-qa",         label: "PDF Q&A" },
  { to: "/langchain-rag",  label: "LangChain RAG" },
  { to: "/agent",          label: "Research Agent" },
  { to: "/mcp",            label: "MCP Explorer" },
];

function Navbar() {
  const { pathname } = useLocation();
  return (
    <nav className="app-nav">
      {NAV_LINKS.map(({ to, label }) => (
        <Link
          key={to}
          to={to}
          className={`app-nav-link ${pathname === to ? "active" : ""}`}
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}

function Home() {
  return (
    <div className="home-container">
      <h2>AI App</h2>
      <p>Explore the features below:</p>
      <div className="home-cards">
        <HomeCard to="/chat"          title="Chat"           desc="Multi-provider chat with OpenAI, Groq, Gemini and more." color="#007bff" />
        <HomeCard to="/pdf-qa"        title="PDF Q&A"        desc="Upload a PDF and ask questions using hand-rolled RAG." color="#6f42c1" />
        <HomeCard to="/langchain-rag" title="LangChain RAG"  desc="Conversational PDF Q&A with FAISS and memory via LangChain LCEL." color="#1c7ed6" />
        <HomeCard to="/agent"         title="Research Agent" desc="LangGraph StateGraph that plans, searches, evaluates and synthesizes." color="#7950f2" />
        <HomeCard to="/mcp"           title="MCP Explorer"   desc="Live tool playground showcasing the Model Context Protocol." color="#0ca678" />
      </div>
    </div>
  );
}

function HomeCard({ to, title, desc, color }) {
  return (
    <Link to={to} className="home-card" style={{ borderTopColor: color }}>
      <strong style={{ color }}>{title}</strong>
      <p>{desc}</p>
    </Link>
  );
}

function App() {
  return (
    <SessionProvider>
      <div>
        <Navbar />
        <Suspense fallback={<div style={{ padding: 24, color: "#888" }}>Loading…</div>}>
          <Routes>
            <Route path="/"              element={<Home />} />
            <Route path="/chat"          element={<Chat />} />
            <Route path="/pdf-qa"        element={<PdfQA />} />
            <Route path="/langchain-rag" element={<LangChainRAG />} />
            <Route path="/agent"         element={<ResearchAgent />} />
            <Route path="/mcp"           element={<MCPExplorer />} />
          </Routes>
        </Suspense>
      </div>
    </SessionProvider>
  );
}

export default App;