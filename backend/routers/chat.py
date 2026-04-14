# routers/chat.py

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from openai import OpenAI
import os
import requests
import google.genai as genai
from groq import Groq
from dotenv import load_dotenv

load_dotenv()

router = APIRouter()

# 🔑 KEYS
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
HF_API_KEY = os.getenv("HF_API_KEY")
GROQ_API_KEY = os.getenv("GROQ_API_KEY")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY")

# 🔌 Clients (lazy — only initialized if the key is present)
client = OpenAI(api_key=OPENAI_API_KEY) if OPENAI_API_KEY else None
groq_client = Groq(api_key=GROQ_API_KEY) if GROQ_API_KEY else None
if GEMINI_API_KEY:
    genai.configure(api_key=GEMINI_API_KEY)

# Request Model
class ChatRequest(BaseModel):
    messages: list
    provider: str = "auto"

#  Utils
def format_messages(messages):
    return "\n".join([f"{m['role']}: {m['content']}" for m in messages])

# ---------------- PROVIDERS ---------------- #

def call_openai(messages):
    response = client.chat.completions.create(
        model="gpt-4.1-mini",
        messages=messages,
        temperature=0.7,
        max_tokens=200
    )
    return response.choices[0].message.content


def call_groq(messages):
    response = groq_client.chat.completions.create(
        model="llama-3.3-70b-versatile",
        messages=messages,
        max_tokens=200,
        temperature=0.7
    )
    return response.choices[0].message.content


def call_gemini(messages):
    model = genai.GenerativeModel("gemini-3.1-flash-lite-preview")

    chat = model.start_chat(history=[
        {
            "role": "user" if m["role"] == "user" else "model",
            "parts": [m["content"]]
        } for m in messages[:-1]
    ])

    response = chat.send_message(messages[-1]["content"])
    return response.text


def call_huggingface(messages):
    response = requests.post(
        "https://router.huggingface.co/hf-inference/models/tiiuae/falcon-7b-instruct",
        headers={"Authorization": f"Bearer {HF_API_KEY}"},
        json={
            "inputs": format_messages(messages),
            "parameters": {"max_new_tokens": 200}
        },
        timeout=10
    )

    data = response.json()
    if isinstance(data, list):
        return data[0].get("generated_text", "")

    return data.get("generated_text", str(data))


def call_openrouter(messages):
    response = requests.post(
        "https://openrouter.ai/api/v1/chat/completions",
        headers={
            "Authorization": f"Bearer {OPENROUTER_API_KEY}",
            "Content-Type": "application/json"
        },
        json={
            "model": "meta-llama/llama-3.2-3b-instruct:free",
            "messages": messages,
            "max_tokens": 200
        },
        timeout=10
    )

    return response.json()["choices"][0]["message"]["content"]


def call_ollama(messages):
    response = requests.post(
        "http://localhost:11434/api/generate",
        json={
            "model": "llama3",
            "prompt": format_messages(messages),
            "stream": False
        },
        timeout=10
    )
    return response.json()["response"]


PROVIDERS = {
    "openai": call_openai,
    "groq": call_groq,
    "gemini": call_gemini,
    "huggingface": call_huggingface,
    "openrouter": call_openrouter,
    "ollama": call_ollama,
}

FALLBACK_ORDER = ["groq", "openrouter", "gemini", "openai", "ollama"]

# ---------------- ROUTES ---------------- #

@router.post("/chat")
async def chat(req: ChatRequest):
    provider = req.provider.lower()

    if provider != "auto":
        if provider not in PROVIDERS:
            raise HTTPException(400, f"Invalid provider: {provider}")

        try:
            reply = PROVIDERS[provider](req.messages)
            return {"reply": reply, "source": provider}
        except Exception as e:
            raise HTTPException(500, f"{provider} failed: {str(e)}")

    errors = {}

    for p in FALLBACK_ORDER:
        try:
            reply = PROVIDERS[p](req.messages)
            return {"reply": reply, "source": p}
        except Exception as e:
            errors[p] = str(e)

    raise HTTPException(500, {"error": "All providers failed", "details": errors})


@router.get("/models")
def get_models():
    return {
        "providers": list(PROVIDERS.keys()),
        "default_order": FALLBACK_ORDER
    }