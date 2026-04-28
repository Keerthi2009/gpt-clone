import { createContext, useContext, useState } from "react";

// ── Default shape for a PDF session ──────────────────────────────
const emptySession = () => ({
  sessionId: null,
  uploadInfo: null,
  uploadStatus: "idle",   // idle | uploading | ready | error
  filename: "",
  history: [],            // [{q, a, sources, ...}]
});

// ── Context ───────────────────────────────────────────────────────
const SessionContext = createContext(null);

export function SessionProvider({ children }) {
  const [pdfQA,        setPdfQA]        = useState(emptySession);
  const [langchainRAG, setLangchainRAG] = useState(emptySession);

  return (
    <SessionContext.Provider value={{
      pdfQA,        setPdfQA,
      langchainRAG, setLangchainRAG,
    }}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSession() {
  return useContext(SessionContext);
}
