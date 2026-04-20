FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .

# Install CPU-only PyTorch first to avoid downloading 4+ GB of NVIDIA CUDA libs.
# sentence-transformers pulls torch as a dependency — if torch isn't already
# installed it will pull the default CUDA build which is huge.
RUN pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu

RUN pip install --no-cache-dir -r requirements.txt

COPY . .

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]