"""
用户侧助手市场与安装 API
"""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi_pagination.cursor import CursorPage, CursorParams
from fastapi.responses import JSONResponse, StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.deps.auth import get_current_user
from app.models import User
from app.repositories import (
    AssistantRepository,
    AssistantVersionRepository,
    AssistantInstallRepository,
    AssistantMarketRepository,
    AssistantRatingRepository,
    AssistantTagRepository,
    AssistantTagLinkRepository,
    UserSecretaryRepository,
    ReviewTaskRepository,
)
from app.schemas import (
    AssistantCreate,
    AssistantDTO,
    AssistantInstallItem,
    AssistantInstallUpdate,
    AssistantListResponse,
    AssistantMarketItem,
    AssistantPreviewRequest,
    AssistantRatingRequest,
    AssistantRatingResponse,
    AssistantSubmitReviewRequest,
    AssistantTagDTO,
    AssistantUpdate,
    MessageResponse,
)
from app.schemas.gateway import ChatCompletionResponse, GatewayError
from app.services.orchestrator.config import INTERNAL_PREVIEW_WORKFLOW
from app.services.orchestrator.context import Channel, WorkflowContext
from app.services.orchestrator.orchestrator import GatewayOrchestrator
from app.services.workflow.steps.upstream_call import StreamTokenAccumulator, stream_with_billing
from app.services.assistant.assistant_market_service import AssistantMarketService
from app.services.assistant.assistant_preview_service import AssistantPreviewService
from app.services.assistant.assistant_rating_service import AssistantRatingService
from app.services.assistant.assistant_tag_service import AssistantTagService
from app.services.assistant.assistant_service import AssistantService
from app.api.v1.external.gateway import _stream_billing_callback

router = APIRouter(prefix="/assistants", tags=["Assistants"])


def get_assistant_service(db: AsyncSession = Depends(get_db)) -> AssistantService:
    assistant_repo = AssistantRepository(db)
    version_repo = AssistantVersionRepository(db)
    return AssistantService(assistant_repo, version_repo)


def get_market_service(db: AsyncSession = Depends(get_db)) -> AssistantMarketService:
    assistant_repo = AssistantRepository(db)
    install_repo = AssistantInstallRepository(db)
    review_repo = ReviewTaskRepository(db)
    market_repo = AssistantMarketRepository(db)
    return AssistantMarketService(assistant_repo, install_repo, review_repo, market_repo)


def get_rating_service(db: AsyncSession = Depends(get_db)) -> AssistantRatingService:
    assistant_repo = AssistantRepository(db)
    install_repo = AssistantInstallRepository(db)
    rating_repo = AssistantRatingRepository(db)
    return AssistantRatingService(assistant_repo, install_repo, rating_repo)


def get_preview_service(db: AsyncSession = Depends(get_db)) -> AssistantPreviewService:
    assistant_repo = AssistantRepository(db)
    version_repo = AssistantVersionRepository(db)
    review_repo = ReviewTaskRepository(db)
    secretary_repo = UserSecretaryRepository(db)
    return AssistantPreviewService(assistant_repo, version_repo, review_repo, secretary_repo)


def get_tag_service(db: AsyncSession = Depends(get_db)) -> AssistantTagService:
    return AssistantTagService(
        AssistantTagRepository(db),
        AssistantTagLinkRepository(db),
    )


@router.get("/market", response_model=CursorPage[AssistantMarketItem])
async def list_market_assistants(
    params: CursorParams = Depends(),
    q: str | None = Query(None, description="搜索关键词"),
    tags: list[str] | None = Query(None, description="标签过滤，?tags=a&tags=b"),
    current_user: User = Depends(get_current_user),
    service: AssistantMarketService = Depends(get_market_service),
) -> CursorPage[AssistantMarketItem]:
    return await service.list_market(user_id=current_user.id, params=params, query=q, tags=tags)


@router.get("/tags", response_model=list[AssistantTagDTO])
async def list_assistant_tags(
    current_user: User = Depends(get_current_user),
    service: AssistantTagService = Depends(get_tag_service),
) -> list[AssistantTagDTO]:
    tags = await service.list_tags()
    return [AssistantTagDTO.model_validate(tag) for tag in tags]


@router.get("/installs", response_model=CursorPage[AssistantInstallItem])
async def list_installed_assistants(
    params: CursorParams = Depends(),
    current_user: User = Depends(get_current_user),
    service: AssistantMarketService = Depends(get_market_service),
) -> CursorPage[AssistantInstallItem]:
    return await service.list_installs(user_id=current_user.id, params=params)


@router.post("/{assistant_id}/install", response_model=AssistantInstallItem)
async def install_assistant(
    assistant_id: UUID,
    current_user: User = Depends(get_current_user),
    service: AssistantMarketService = Depends(get_market_service),
) -> AssistantInstallItem:
    try:
        return await service.install_assistant(user_id=current_user.id, assistant_id=assistant_id)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))


@router.delete("/{assistant_id}/install", response_model=MessageResponse)
async def uninstall_assistant(
    assistant_id: UUID,
    current_user: User = Depends(get_current_user),
    service: AssistantMarketService = Depends(get_market_service),
) -> MessageResponse:
    await service.uninstall_assistant(user_id=current_user.id, assistant_id=assistant_id)
    return MessageResponse(message="assistant uninstalled")


@router.patch("/{assistant_id}/install", response_model=AssistantInstallItem)
async def update_installed_assistant(
    assistant_id: UUID,
    payload: AssistantInstallUpdate,
    current_user: User = Depends(get_current_user),
    service: AssistantMarketService = Depends(get_market_service),
) -> AssistantInstallItem:
    try:
        return await service.update_install(
            user_id=current_user.id,
            assistant_id=assistant_id,
            payload=payload,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))


@router.post("/{assistant_id}/rating", response_model=AssistantRatingResponse)
async def rate_assistant(
    assistant_id: UUID,
    payload: AssistantRatingRequest,
    current_user: User = Depends(get_current_user),
    service: AssistantRatingService = Depends(get_rating_service),
) -> AssistantRatingResponse:
    try:
        assistant = await service.rate_assistant(
            user_id=current_user.id,
            assistant_id=assistant_id,
            rating=payload.rating,
        )
        return AssistantRatingResponse(
            assistant_id=assistant.id,
            rating_avg=assistant.rating_avg,
            rating_count=assistant.rating_count,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))


@router.post(
    "/{assistant_id}/preview",
    response_model=ChatCompletionResponse | GatewayError,
)
async def preview_assistant(
    assistant_id: UUID,
    payload: AssistantPreviewRequest,
    request: Request,
    current_user: User = Depends(get_current_user),
    service: AssistantPreviewService = Depends(get_preview_service),
    db: AsyncSession = Depends(get_db),
) -> JSONResponse | StreamingResponse:
    try:
        preview_request = await service.build_preview_request(
            user_id=current_user.id,
            assistant_id=assistant_id,
            message=payload.message,
            stream=payload.stream,
            temperature=payload.temperature,
            max_tokens=payload.max_tokens,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))

    ctx = WorkflowContext(
        channel=Channel.INTERNAL,
        capability="chat",
        requested_model=preview_request.model,
        db_session=db,
        tenant_id=str(current_user.id) if current_user else None,
        user_id=str(current_user.id) if current_user else None,
        api_key_id=str(current_user.id) if current_user else None,
        trace_id=getattr(request.state, "trace_id", None) if request else None,
    )
    ctx.set("validation", "request", preview_request)

    orchestrator = GatewayOrchestrator(workflow_config=INTERNAL_PREVIEW_WORKFLOW)
    result = await orchestrator.execute(ctx)
    if not result.success or not ctx.is_success:
        return JSONResponse(
            status_code=400,
            content=GatewayError(
                code=ctx.error_code or "GATEWAY_ERROR",
                message=ctx.error_message or "Request failed",
                source=ctx.error_source.value if ctx.error_source else "gateway",
                trace_id=ctx.trace_id,
                upstream_status=ctx.upstream_result.status_code,
                upstream_code=ctx.upstream_result.error_code,
            ).model_dump(),
        )

    if ctx.get("upstream_call", "stream"):
        stream = ctx.get("upstream_call", "response_stream")
        accumulator = ctx.get("upstream_call", "stream_accumulator") or StreamTokenAccumulator()
        wrapped_stream = stream_with_billing(
            stream=stream,
            ctx=ctx,
            accumulator=accumulator,
            on_complete=_stream_billing_callback,
        )
        return StreamingResponse(wrapped_stream, media_type="text/event-stream")

    response_body = ctx.get("response_transform", "response")
    status_code = ctx.get("upstream_call", "status_code") or 200
    return JSONResponse(content=response_body, status_code=status_code)


@router.post("", response_model=AssistantDTO)
async def create_custom_assistant(
    payload: AssistantCreate,
    current_user: User = Depends(get_current_user),
    service: AssistantService = Depends(get_assistant_service),
) -> AssistantDTO:
    try:
        assistant = await service.create_assistant(payload=payload, owner_user_id=current_user.id)
        assistant = await service.assistant_repo.get_with_versions(assistant.id)
        return AssistantDTO.model_validate(assistant)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))


@router.patch("/{assistant_id}", response_model=AssistantDTO)
async def update_custom_assistant(
    assistant_id: UUID,
    payload: AssistantUpdate,
    current_user: User = Depends(get_current_user),
    service: AssistantService = Depends(get_assistant_service),
) -> AssistantDTO:
    assistant = await service.assistant_repo.get(assistant_id)
    if not assistant:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="assistant not found")
    if assistant.owner_user_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="permission denied")
    try:
        assistant = await service.update_assistant(assistant_id, payload)
        assistant = await service.assistant_repo.get_with_versions(assistant.id)
        return AssistantDTO.model_validate(assistant)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))


@router.get("/owned", response_model=AssistantListResponse)
async def list_owned_assistants(
    cursor: str | None = None,
    size: int = 20,
    current_user: User = Depends(get_current_user),
    service: AssistantService = Depends(get_assistant_service),
) -> AssistantListResponse:
    size = max(1, min(size, 50))
    return await service.list_assistants(
        size=size,
        cursor=cursor,
        owner_user_id=current_user.id,
    )


@router.post("/{assistant_id}/submit", response_model=MessageResponse)
async def submit_assistant_for_review(
    assistant_id: UUID,
    payload: AssistantSubmitReviewRequest,
    current_user: User = Depends(get_current_user),
    service: AssistantMarketService = Depends(get_market_service),
) -> MessageResponse:
    try:
        await service.submit_for_review(
            user_id=current_user.id,
            assistant_id=assistant_id,
            payload=payload.payload,
        )
        return MessageResponse(message="assistant submitted for review")
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))
