# GPT Clone

A full-stack AI chat application with multi-provider LLM support and PDF Q&A (RAG).

## Features

- **Multi-provider chat** — single interface, multiple LLM backends with automatic fallback
- **PDF Q&A (RAG)** — upload a PDF and ask questions; answers are grounded in the document
- **Provider selection** — choose a specific provider or let the app auto-select the best available one
- **Docker support** — fully containerised with Docker Compose

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 19, Vite, React Router, Axios |
| Backend | FastAPI, Python 3.11, Uvicorn |
| Embeddings | sentence-transformers (`all-MiniLM-L6-v2`) |
| PDF parsing | pypdf |
| Deployment | Docker Compose, GitHub Actions → AWS |

## LLM Providers

The app integrates six providers with an automatic fallback chain:

| Provider | Model |
|---|---|
| Groq | `llama-3.3-70b-versatile` |
| OpenRouter | `meta-llama/llama-3.2-3b-instruct:free` |
| Google Gemini | `gemini-2.0-flash-lite` |
| OpenAI | `gpt-4.1-mini` |
| HuggingFace | `tiiuae/falcon-7b-instruct` |
| Ollama (local) | `llama3` |

## Project Structure

```
gpt-clone/
├── backend/
│   ├── main.py                  # FastAPI app, CORS, router registration
│   ├── requirements.txt
│   ├── routers/
│   │   ├── chat.py              # /chat and /models endpoints
│   │   ├── pdf_qa.py            # /pdf/upload, /pdf/ask endpoints (RAG)
│   │   └── auth.py              # /login endpoint
│   └── utils/
│       └── auth.py              # JWT helpers
└── frontend/
    ├── src/
    │   ├── App.jsx              # Routes and navbar
    │   └── pages/
    │       ├── Chat.jsx         # Multi-provider chat UI
    │       ├── PdfQA.jsx        # PDF upload + Q&A UI
    │       └── *.css
    └── package.json
```

## Getting Started

### Prerequisites

- Python 3.11+
- Node.js 18+
- API keys for the providers you want to use

### Local Development

**1. Clone the repo**

```bash
git clone <repo-url>
cd gpt-clone
```

**2. Configure environment variables**

Create `backend/.env` with your API keys:

```env
OPENAI_API_KEY=sk-...
GROQ_API_KEY=gsk_...
GEMINI_API_KEY=...
OPENROUTER_API_KEY=sk-or-...
HF_API_KEY=hf_...
```

**3. Start the backend**

```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --reload
```

The backend runs at `http://localhost:8000`.
On first start, sentence-transformers downloads the `all-MiniLM-L6-v2` model (~80 MB, one-time).

**4. Start the frontend**

```bash
cd frontend
npm install
npm run dev
```

The frontend runs at `http://localhost:5173`.

### Docker (production)

```bash
docker-compose up --build
```

- Frontend: `http://localhost:3001`
- Backend: `http://localhost:8000`

## API Endpoints

### Chat

| Method | Path | Description |
|---|---|---|
| `POST` | `/chat` | Send a message; returns reply and provider used |
| `GET` | `/models` | List all providers and default fallback order |

**Request body for `/chat`:**
```json
{
  "messages": [{ "role": "user", "content": "Hello!" }],
  "provider": "auto"
}
```

### PDF Q&A

| Method | Path | Description |
|---|---|---|
| `POST` | `/pdf/upload` | Upload a PDF; returns `session_id` |
| `POST` | `/pdf/ask` | Ask a question about an uploaded PDF |
| `DELETE` | `/pdf/session/{id}` | Delete a session from memory |

**Request body for `/pdf/ask`:**
```json
{
  "session_id": "uuid",
  "question": "What is the main topic?",
  "provider": "auto",
  "top_k": 3
}
```

### Auth

| Method | Path | Description |
|---|---|---|
| `POST` | `/login` | Returns a JWT token |

## How PDF Q&A Works (RAG)

1. **Upload** — PDF text is extracted page by page using `pypdf`
2. **Chunking** — text is split into 500-character overlapping chunks (75-char overlap)
3. **Embedding** — each chunk is embedded with `sentence-transformers` locally (no API cost)
4. **Query** — the question is embedded, cosine similarity ranks all chunks, top-3 are selected
5. **Answer** — top chunks are injected as context into the LLM prompt; the model answers from the document only

## Deployment

CI/CD is configured via GitHub Actions (`.github/workflows/deploy.yml`). On every push to `main`:

1. SSH into the AWS server
2. Pull latest code
3. Rebuild and restart containers with `docker-compose up -d --build`
