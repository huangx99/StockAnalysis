from fastapi import APIRouter, Depends, Query

from models.auth import (
    AuthLoginRequest,
    AuthRegisterRequest,
    AuthTokenResponse,
    CalculationTemplate,
    CalculationTemplateCreate,
    CalculationTemplateUpdate,
    PasswordChangeRequest,
    UserProfileUpdateRequest,
    UserPublic,
    UserUpdateRequest,
    Watchlist,
    WatchlistCreate,
    WatchlistItem,
    WatchlistItemCreate,
    WatchlistItemUpdate,
    WatchlistUpdate,
)
from services import auth_store

router = APIRouter(prefix="/api", tags=["auth"])


@router.post("/auth/register", response_model=AuthTokenResponse)
async def register(body: AuthRegisterRequest):
    user = auth_store.register_user(body.username, body.email, body.password)
    token = auth_store.create_access_token(user.id)
    return AuthTokenResponse(accessToken=token, expiresIn=auth_store.settings.auth_token_expire_minutes * 60, user=user)


@router.post("/auth/login", response_model=AuthTokenResponse)
async def login(body: AuthLoginRequest):
    user = auth_store.authenticate(body.account, body.password)
    token = auth_store.create_access_token(user.id)
    return AuthTokenResponse(accessToken=token, expiresIn=auth_store.settings.auth_token_expire_minutes * 60, user=user)


@router.get("/auth/me", response_model=UserPublic)
async def me(user: UserPublic = Depends(auth_store.get_current_user)):
    return user


@router.patch("/auth/me", response_model=UserPublic)
async def update_me(body: UserProfileUpdateRequest, user: UserPublic = Depends(auth_store.get_current_user)):
    return auth_store.update_current_user_profile(user.id, body.model_dump(exclude_unset=True))


@router.post("/auth/change-password")
async def change_password(body: PasswordChangeRequest, user: UserPublic = Depends(auth_store.get_current_user)):
    auth_store.change_current_user_password(user.id, body.currentPassword, body.newPassword)
    return {"status": "ok"}


@router.get("/admin/users", response_model=list[UserPublic])
async def users(_: UserPublic = Depends(auth_store.require_admin)):
    return auth_store.list_users()


@router.patch("/admin/users/{user_id}", response_model=UserPublic)
async def update_user(user_id: str, body: UserUpdateRequest, _: UserPublic = Depends(auth_store.require_admin)):
    return auth_store.update_user(user_id, body.model_dump(exclude_unset=True))


@router.get("/watchlists", response_model=list[Watchlist])
async def watchlists(user: UserPublic = Depends(auth_store.get_current_user)):
    return auth_store.list_watchlists(user.id)


@router.post("/watchlists", response_model=Watchlist)
async def create_watchlist(body: WatchlistCreate, user: UserPublic = Depends(auth_store.get_current_user)):
    return auth_store.create_watchlist(user.id, body.name, body.description)


@router.patch("/watchlists/{watchlist_id}", response_model=Watchlist)
async def update_watchlist(watchlist_id: str, body: WatchlistUpdate, user: UserPublic = Depends(auth_store.get_current_user)):
    return auth_store.update_watchlist(user.id, watchlist_id, body.model_dump(exclude_unset=True))


@router.delete("/watchlists/{watchlist_id}")
async def delete_watchlist(watchlist_id: str, user: UserPublic = Depends(auth_store.get_current_user)):
    auth_store.delete_watchlist(user.id, watchlist_id)
    return {"status": "ok"}


@router.post("/watchlists/{watchlist_id}/items", response_model=WatchlistItem)
async def add_watchlist_item(watchlist_id: str, body: WatchlistItemCreate, user: UserPublic = Depends(auth_store.get_current_user)):
    return auth_store.add_watchlist_item(user.id, watchlist_id, body.model_dump())


@router.post("/watchlist/items", response_model=WatchlistItem)
async def add_default_watchlist_item(body: WatchlistItemCreate, user: UserPublic = Depends(auth_store.get_current_user)):
    return auth_store.add_watchlist_item(user.id, None, body.model_dump())


@router.patch("/watchlist/items/{item_id}", response_model=WatchlistItem)
async def update_watchlist_item(item_id: str, body: WatchlistItemUpdate, user: UserPublic = Depends(auth_store.get_current_user)):
    return auth_store.update_watchlist_item(user.id, item_id, body.model_dump(exclude_unset=True))


@router.delete("/watchlist/items/{item_id}")
async def delete_watchlist_item(item_id: str, user: UserPublic = Depends(auth_store.get_current_user)):
    auth_store.delete_watchlist_item(user.id, item_id)
    return {"status": "ok"}


@router.delete("/watchlist/symbol/{stock_code}")
async def remove_watchlist_symbol(stock_code: str, user: UserPublic = Depends(auth_store.get_current_user)):
    auth_store.remove_watchlist_symbol(user.id, stock_code)
    return {"status": "ok"}


@router.get("/watchlist/check/{stock_code}")
async def check_watchlist_symbol(stock_code: str, user: UserPublic = Depends(auth_store.get_current_user)):
    lists = auth_store.list_watchlists(user.id)
    matches = [item for watchlist in lists for item in watchlist.get("items", []) if item.get("stockCode") == stock_code]
    return {"isFavorite": bool(matches), "items": matches}


@router.get("/templates", response_model=list[CalculationTemplate])
async def templates(user: UserPublic = Depends(auth_store.get_current_user)):
    return auth_store.list_templates(user)


@router.post("/templates", response_model=CalculationTemplate)
async def create_template(body: CalculationTemplateCreate, user: UserPublic = Depends(auth_store.get_current_user)):
    return auth_store.create_template(user, body.model_dump())


@router.patch("/templates/{template_id}", response_model=CalculationTemplate)
async def update_template(template_id: str, body: CalculationTemplateUpdate, user: UserPublic = Depends(auth_store.get_current_user)):
    return auth_store.update_template(user, template_id, body.model_dump(exclude_unset=True))


@router.delete("/templates/{template_id}")
async def delete_template(template_id: str, user: UserPublic = Depends(auth_store.get_current_user)):
    auth_store.delete_template(user, template_id)
    return {"status": "ok"}


@router.post("/templates/{template_id}/copy", response_model=CalculationTemplate)
async def copy_template(template_id: str, user: UserPublic = Depends(auth_store.get_current_user)):
    return auth_store.copy_template(user, template_id)


@router.get("/templates/categories")
async def template_categories(user: UserPublic = Depends(auth_store.get_current_user), category: str | None = Query(default=None)):
    items = auth_store.list_templates(user)
    if category:
        items = [item for item in items if item.get("category") == category]
    return {"items": items}
