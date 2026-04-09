from fastapi import FastAPI
from pydantic import BaseModel
from openai import OpenAI
from dotenv import load_dotenv
import os
import requests
from fastapi.middleware.cors import CORSMiddleware

load_dotenv()

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
HF_API_KEY = os.getenv("HF_API_KEY")

client = OpenAI(api_key=OPENAI_API_KEY)

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class ChatRequest(BaseModel):
    messages: list
    user_id: str = "guest"
    provider: str = "auto"

# 🔧 Convert messages → prompt
def format_messages(messages):
    return "\n".join([f"{m['role']}: {m['content']}" for m in messages])

# 🟢 Hugging Face call
def call_huggingface(messages):
    prompt = format_messages(messages)

    response = requests.post(
        "https://router.huggingface.co/models/mistralai/Mistral-7B-Instruct-v0.2",
        headers={
            "Authorization": f"Bearer {HF_API_KEY}"
        },
        json={
            "inputs": prompt,
            "parameters": {
                "max_new_tokens": 200,
                "temperature": 0.7
            }
        }
    )

    result = response.json()

    # HF returns list sometimes
    if isinstance(result, list):
        return result[0]["generated_text"]

    return result.get("generated_text", str(result))

# 🟣 Ollama call
def call_ollama(messages):
    prompt = format_messages(messages)

    response = requests.post(
        "http://localhost:11434/api/generate",
        json={
            "model": "llama3",
            "prompt": prompt,
            "stream": False
        }
    )

    return response.json()["response"]

@app.post("/chat")
async def chat(req: ChatRequest):

    provider = req.provider.lower()

    # 🔵 OPENAI ONLY
    if provider == "openai":
        try:
            response = client.chat.completions.create(
                model="gpt-4.1-mini",
                messages=req.messages,
                temperature=0.7,
                max_tokens=200
            )
            return {
                "reply": response.choices[0].message.content,
                "source": "openai"
            }
        except Exception as e:
            return {"error": f"OpenAI failed: {str(e)}"}

    # 🟢 HUGGINGFACE ONLY
    if provider == "huggingface":
        try:
            return {
                "reply": call_huggingface(req.messages),
                "source": "huggingface"
            }
        except Exception as e:
            return {"error": f"HuggingFace failed: {str(e)}"}

    # 🟣 OLLAMA ONLY
    if provider == "ollama":
        try:
            return {
                "reply": call_ollama(req.messages),
                "source": "ollama"
            }
        except Exception as e:
            return {"error": f"Ollama failed: {str(e)}"}

    # ⚡ AUTO MODE (fallback chain)
    # OpenAI → HuggingFace → Ollama
    try:
        response = client.chat.completions.create(
            model="gpt-4.1-mini",
            messages=req.messages,
            temperature=0.7,
            max_tokens=200
        )
        return {
            "reply": response.choices[0].message.content,
            "source": "openai"
        }
    except:
        pass

    try:
        return {
            "reply": call_huggingface(req.messages),
            "source": "huggingface"
        }
    except:
        pass

    try:
        return {
            "reply": call_ollama(req.messages),
            "source": "ollama"
        }
    except Exception as e:
        return {"error": "All providers failed", "details": str(e)}