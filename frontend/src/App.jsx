import { Routes, Route, Link } from "react-router-dom";
import { lazy, Suspense } from "react";

const Chat = lazy(() => import("./pages/Chat"));
const PdfQA = lazy(() => import("./pages/PdfQA"));

function Home() {
  return (
    <div style={{ padding: 20 }}>
      <h2>Home Page</h2>
      <p>Welcome to AI App 🚀</p>
      <Link to="/chat">Go to Chat</Link>
      {" · "}
      <Link to="/pdf-qa">PDF Q&amp;A</Link>
    </div>
  );
}

function App() {
  return (
    <div>
      {/* Simple Navbar */}
      <nav style={{ padding: 10, borderBottom: "1px solid #ccc" }}>
        <Link to="/" style={{ marginRight: 10 }}>Home</Link>
        <Link to="/chat" style={{ marginRight: 10 }}>Chat</Link>
        <Link to="/pdf-qa">PDF Q&amp;A</Link>
      </nav>

      {/* Routes */}
      <Suspense fallback={<div style={{ padding: 20 }}>Loading…</div>}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/chat" element={<Chat />} />
          <Route path="/pdf-qa" element={<PdfQA />} />
        </Routes>
      </Suspense>
    </div>
  );
}

export default App;