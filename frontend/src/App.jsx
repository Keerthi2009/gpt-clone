import { Routes, Route, Link } from "react-router-dom";
import Chat from "./pages/Chat";

function Home() {
  return (
    <div style={{ padding: 20 }}>
      <h2>Home Page</h2>
      <p>Welcome to AI App 🚀</p>
      <Link to="/chat">Go to Chat</Link>
    </div>
  );
}

function App() {
  return (
    <div>
      {/* Simple Navbar */}
      <nav style={{ padding: 10, borderBottom: "1px solid #ccc" }}>
        <Link to="/" style={{ marginRight: 10 }}>Home</Link>
        <Link to="/chat">Chat</Link>
      </nav>

      {/* Routes */}
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/chat" element={<Chat />} />
      </Routes>
    </div>
  );
}


export default App;