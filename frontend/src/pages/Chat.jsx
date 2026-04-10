import { useState } from "react";
import axios from "axios";
import "./Chat.css";

function Chat() {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState([]);
  const [provider, setProvider] = useState("huggingface");

  const userId = "user_123";

  const sendMessage = async () => {
    if (!input) return;

    const newMessages = [
      ...messages,
      { role: "user", content: input }
    ];

    setMessages(newMessages);
    setInput("");

    try {
      const res = await axios.post("http://localhost:8000/chat", {
        messages: newMessages,
        user_id: userId,
        provider
      });

      if (res.data.error) {
        alert(res.data.error);
        return;
      }

      setMessages([
        ...newMessages,
        {
          role: "assistant",
          content: res.data.reply + ` (${res.data.source})`
        }
      ]);

    } catch (err) {
      alert("Error: " + err.message);
    }
  };

  return (
    <div className="chat-container">
      <h2 className="chat-title">Chat</h2>

      <select
        className="provider-select"
        value={provider}
        onChange={(e) => setProvider(e.target.value)}
      >
        <option value="auto">Auto</option>
        <option value="openai">OpenAI</option>
        <option value="huggingface">HuggingFace</option>
        <option value="ollama">Ollama</option>
        <option value="groq">Groq</option>
        <option value="gemini">Gemini</option>
        <option value="openrouter">Openrouter</option>

      </select>

      <div className="chat-box">
        {messages.map((msg, i) => (
          <div
            key={i}
            className={`message ${msg.role === "user" ? "user" : "assistant"}`}
          >
            {msg.content}
          </div>
        ))}
      </div>

      <div className="chat-input">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask something..."
            onKeyDown={(e) => {
    if (e.key === "Enter") {
      sendMessage();
    }
  }}
        />
        <button onClick={sendMessage}>Send</button>
      </div>
    </div>
  );
}

export default Chat;