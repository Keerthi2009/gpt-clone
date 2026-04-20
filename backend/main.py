from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from routers import chat, auth, pdf_qa

app = FastAPI(title="GPT Clone API", version="2.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ✅ Core routers (always loaded)
app.include_router(chat.router)
app.include_router(auth.router)
app.include_router(pdf_qa.router)

# ✅ Optional routers — require extra packages (langchain, langgraph, mcp)
# If a package is missing the server still starts; install via requirements.txt
def _try_include(module_path: str, package_hint: str):
    try:
        import importlib
        mod = importlib.import_module(module_path)
        app.include_router(mod.router)
        print(f"[OK] loaded {module_path}")
    except ImportError as exc:
        print(f"[SKIP] {module_path} — missing package ({package_hint}): {exc}"
              f"\n       Run: pip install {package_hint}")

_try_include("routers.langchain_rag", "langchain langchain-community langchain-groq langchain-openai langchain-text-splitters faiss-cpu")
_try_include("routers.agent",         "langgraph langchain-groq duckduckgo-search")
_try_include("routers.mcp_server",    "mcp[cli]")