"""Apex oversight: intake telemetry, integrity metrics and audit stream."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.academics import ACTIVE_ACADEMIC_YEAR, resolve_year
from app.core.security import CurrentUser, get_current_user, scope_institution
from app.db.models import AuditLog, Institution, IntakeCycle, StudentEnrollment
from app.db.session import get_db
from app.schemas.student import AnalyticsOverview, AuditLogOut, IntakeRow

router = APIRouter(tags=["analytics"])


@router.get("/overview", response_model=AnalyticsOverview)
async def overview(
    academic_year: str = Query(default=ACTIVE_ACADEMIC_YEAR),
    db: AsyncSession = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> AnalyticsOverview:
    year = resolve_year(academic_year)
    scope = scope_institution(user, None)

    institution_count_stmt = select(func.count()).select_from(IntakeCycle).where(
        IntakeCycle.academic_year == year
    )
    sanctioned_stmt = select(func.sum(IntakeCycle.sanctioned_intake)).where(
        IntakeCycle.academic_year == year
    )
    filled_stmt = select(func.sum(IntakeCycle.current_enrolled)).where(
        IntakeCycle.academic_year == year
    )
    apaar_stmt = (
        select(func.count())
        .select_from(StudentEnrollment)
        .where(
            StudentEnrollment.status == "ACTIVE",
            StudentEnrollment.academic_year == year,
        )
    )
    conflict_stmt = (
        select(func.count())
        .select_from(AuditLog)
        .where(
            AuditLog.event_type == "CONCURRENCY_CONFLICT",
            AuditLog.academic_year == year,
        )
    )
    quota_stmt = (
        select(func.count())
        .select_from(AuditLog)
        .where(
            AuditLog.event_type == "QUOTA_BLOCK",
            AuditLog.academic_year == year,
        )
    )
    if scope:
        institution_count_stmt = institution_count_stmt.where(
            IntakeCycle.institution_id == scope
        )
        sanctioned_stmt = sanctioned_stmt.where(IntakeCycle.institution_id == scope)
        filled_stmt = filled_stmt.where(IntakeCycle.institution_id == scope)
        apaar_stmt = apaar_stmt.where(StudentEnrollment.institution_id == scope)
        conflict_stmt = conflict_stmt.where(AuditLog.institution_id == scope)
        quota_stmt = quota_stmt.where(AuditLog.institution_id == scope)

    total_institutions = await db.scalar(institution_count_stmt) or 0
    total_apaars = await db.scalar(apaar_stmt) or 0
    concurrency_blocks = await db.scalar(conflict_stmt) or 0
    quota_blocks = await db.scalar(quota_stmt) or 0
    sanctioned = await db.scalar(sanctioned_stmt) or 0
    filled = await db.scalar(filled_stmt) or 0

    return AnalyticsOverview(
        total_institutions=int(total_institutions),
        total_registered_apaars=int(total_apaars),
        prevented_concurrency_violations=int(concurrency_blocks),
        prevented_quota_violations=int(quota_blocks),
        total_sanctioned_seats=int(sanctioned),
        total_seats_filled=int(filled),
        seat_utilization_percent=round(int(filled) / int(sanctioned) * 100, 1)
        if sanctioned
        else 0.0,
        active_academic_year=year,
    )


@router.get("/intake", response_model=list[IntakeRow])
async def intake(
    academic_year: str = Query(default=ACTIVE_ACADEMIC_YEAR),
    db: AsyncSession = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> list[IntakeRow]:
    year = resolve_year(academic_year)
    scope = scope_institution(user, None)
    stmt = (
        select(Institution, IntakeCycle)
        .join(IntakeCycle, IntakeCycle.institution_id == Institution.institution_id)
        .where(IntakeCycle.academic_year == year)
        .order_by(Institution.institution_id)
    )
    if scope:
        stmt = stmt.where(Institution.institution_id == scope)
    rows = []
    for institution, cycle in (await db.execute(stmt)).all():
        utilization = (
            round(cycle.current_enrolled / cycle.sanctioned_intake * 100, 1)
            if cycle.sanctioned_intake
            else 0.0
        )
        rows.append(
            IntakeRow(
                institution_id=institution.institution_id,
                institution_name=institution.institution_name,
                course_name=institution.course_name,
                academic_year=cycle.academic_year,
                sanctioned_intake=cycle.sanctioned_intake,
                current_enrolled=cycle.current_enrolled,
                seats_remaining=max(cycle.sanctioned_intake - cycle.current_enrolled, 0),
                utilization_percent=utilization,
            )
        )
    return rows


@router.get("/audit-logs", response_model=list[AuditLogOut])
async def audit_logs(
    limit: int = Query(default=50, ge=1, le=250),
    event_type: str | None = Query(default=None),
    academic_year: str = Query(default=ACTIVE_ACADEMIC_YEAR),
    db: AsyncSession = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> list[AuditLogOut]:
    year = resolve_year(academic_year)
    scope = scope_institution(user, None)
    stmt = (
        select(AuditLog)
        .where(AuditLog.academic_year == year)
        .order_by(AuditLog.created_at.desc(), AuditLog.id.desc())
        .limit(limit)
    )
    if event_type:
        stmt = stmt.where(AuditLog.event_type == event_type)
    if scope:
        stmt = stmt.where(AuditLog.institution_id == scope)
    result = await db.execute(stmt)
    return [AuditLogOut.model_validate(entry) for entry in result.scalars().all()]
