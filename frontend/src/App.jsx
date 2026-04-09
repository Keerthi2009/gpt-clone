import { useState } from "react";
import axios from "axios";

function App() {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState([]);
  const [remaining, setRemaining] = useState(20);
  const [provider, setProvider] = useState("auto");

  const userId = "user_123"; // simulate login

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
        provider: provider 
      });

      if (res.data.error) {
        alert(res.data.error);
        return;
      }

      setMessages([
        ...newMessages,
        { role: "assistant", content: res.data.reply  + ` (${res.data.source})`}
      ]);

      setRemaining(res.data.remaining);

    } catch (err) {
      alert("Error: " + err.message);
    }
  };

  return (
    <div style={{ padding: 20 }}>
      <select value={provider} onChange={(e) => setProvider(e.target.value)}>
  <option value="auto">Auto (Best Available)</option>
  <option value="openai">OpenAI (Best Quality)</option>
  <option value="huggingface">HuggingFace (Free Cloud)</option>
  <option value="ollama">Ollama (Local Free)</option>
</select>
      <h2>ChatGPT Clone</h2>

      <p>Remaining messages today: {remaining}</p>

      <div style={{ minHeight: 300, marginBottom: 20 }}>
        {messages.map((msg, i) => (
          <div key={i}>
            <b>{msg.role}:</b> {msg.content}
          </div>
        ))}
      </div>

      <input
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder="Ask something..."
      />

      <button onClick={sendMessage}>Send</button>
    </div>
  );
}

export default App;