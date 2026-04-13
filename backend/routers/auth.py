from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from utils.auth import create_token

router = APIRouter()

# Fake user DB
fake_user = {
    "username": "admin",
    "password": "1234"
}

class LoginRequest(BaseModel):
    username: str
    password: str

@router.post("/login")
async def login(req: LoginRequest):
    if (
        req.username != fake_user["username"]
        or req.password != fake_user["password"]
    ):
        raise HTTPException(status_code=401, detail="Invalid credentials")

    token = create_token({"sub": req.username})

    return {
        "access_token": token,
        "token_type": "bearer"
    }