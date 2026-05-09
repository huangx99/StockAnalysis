from typing import Any, Literal

from pydantic import BaseModel, Field


UserRole = Literal["admin", "user"]
TemplateType = Literal["private", "system", "shared"]


class UserPublic(BaseModel):
    id: str
    username: str
    email: str
    role: UserRole
    isActive: bool = True
    createdAt: str
    lastLoginAt: str = ""


class AuthRegisterRequest(BaseModel):
    username: str = Field(min_length=3, max_length=32)
    email: str = Field(min_length=3, max_length=128)
    password: str = Field(min_length=8, max_length=128)


class AuthLoginRequest(BaseModel):
    account: str = Field(min_length=1, max_length=128)
    password: str = Field(min_length=1, max_length=128)


class AuthTokenResponse(BaseModel):
    accessToken: str
    tokenType: str = "bearer"
    expiresIn: int
    user: UserPublic


class UserUpdateRequest(BaseModel):
    role: UserRole | None = None
    isActive: bool | None = None


class UserProfileUpdateRequest(BaseModel):
    email: str | None = Field(default=None, min_length=3, max_length=128)


class PasswordChangeRequest(BaseModel):
    currentPassword: str = Field(min_length=1, max_length=128)
    newPassword: str = Field(min_length=8, max_length=128)


class WatchlistItemCreate(BaseModel):
    stockCode: str = Field(min_length=6, max_length=16)
    stockName: str = Field(default="", max_length=128)
    market: str = Field(default="", max_length=16)
    note: str = Field(default="", max_length=1000)
    tags: list[str] = Field(default_factory=list)


class WatchlistItemUpdate(BaseModel):
    note: str | None = Field(default=None, max_length=1000)
    tags: list[str] | None = None
    sortOrder: int | None = None


class WatchlistItem(BaseModel):
    id: str
    watchlistId: str
    userId: str
    stockCode: str
    stockName: str = ""
    market: str = ""
    note: str = ""
    tags: list[str] = Field(default_factory=list)
    sortOrder: int = 0
    createdAt: str
    updatedAt: str


class WatchlistCreate(BaseModel):
    name: str = Field(min_length=1, max_length=40)
    description: str = Field(default="", max_length=300)


class WatchlistUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=40)
    description: str | None = Field(default=None, max_length=300)
    sortOrder: int | None = None


class Watchlist(BaseModel):
    id: str
    userId: str
    name: str
    description: str = ""
    sortOrder: int = 0
    isDefault: bool = False
    createdAt: str
    updatedAt: str
    items: list[WatchlistItem] = Field(default_factory=list)


class CalculationTemplateCreate(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    description: str = Field(default="", max_length=500)
    templateType: TemplateType = "private"
    category: str = Field(default="screener", max_length=40)
    content: dict[str, Any] = Field(default_factory=dict)


class CalculationTemplateUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=80)
    description: str | None = Field(default=None, max_length=500)
    templateType: TemplateType | None = None
    category: str | None = Field(default=None, max_length=40)
    content: dict[str, Any] | None = None
    isActive: bool | None = None


class CalculationTemplate(BaseModel):
    id: str
    ownerUserId: str
    name: str
    description: str = ""
    templateType: TemplateType = "private"
    category: str = "screener"
    content: dict[str, Any] = Field(default_factory=dict)
    isActive: bool = True
    createdAt: str
    updatedAt: str

