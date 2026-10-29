"""Admission ingestion, quota enforcement and the national concurrency guard."""

from __future__ import annotations

from collections.abc import Sequence
from io import BytesIO
from pathlib import Path
from typing import Any

import pandas as pd
from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import JSONResponse
from pydantic import ValidationError
from sqlalchemy import func, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.academics import ACTIVE_ACADEMIC_YEAR, resolve_year
from app.core.crypto import build_credential, canonical_json, generate_verifiable_qr
from app.core.security import CurrentUser, get_current_user, scope_institution
from app.db.models import AuditLog, Institution, IntakeCycle, StudentEnrollment
from app.db.session import get_db
from app.schemas.student import (
    BatchUploadResult,
    ConflictDetail,
    CredentialEnvelope,
    CredentialLookupOut,
    EnrolledStudent,
    InstitutionOut,
    SearchInstitutionOut,
    SearchResponse,
    SearchStudentOut,
    StudentRow,
)

router = APIRouter(tags=["admissions"])

MAX_UPLOAD_BYTES = 5 * 1024 * 1024
ALLOWED_SUFFIXES = {".csv", ".xlsx", ".xls"}

COLUMN_ALIASES = {
    "apaar": "apaar_id",
    "apaarid": "apaar_id",
    "apaar_no": "apaar_id",
    "student_id": "apaar_id",
    "name": "student_name",
    "full_name": "student_name",
    "student": "student_name",
    "date_of_birth": "dob",
    "birth_date": "dob",
    "birthdate": "dob",
}


def _error(status_code: int, payload: dict[str, Any]) -> JSONResponse:
    return JSONResponse(status_code=status_code, content=payload)


def _payload_summary(credential: CredentialEnvelope | None) -> dict[str, str] | None:
    if credential is None:
        return None
    payload = credential.payload
    return {
        "apaar": str(payload.get("apaar", "")),
        "institution": str(payload.get("inst", "")),
        "academic_year": str(payload.get("yr", "")),
        "status": str(payload.get("status", "")),
    }


def _format_student(
    enrollment: StudentEnrollment, qr_code_url: str | None = None
) -> EnrolledStudent:
    credential = None
    if enrollment.signed_payload:
        try:
            credential = CredentialEnvelope.model_validate_json(enrollment.signed_payload)
        except ValidationError:  # pragma: no cover - defensive for legacy rows
            credential = None
    return EnrolledStudent(
        enrollment_id=str(enrollment.enrollment_id),
        apaar_id=enrollment.apaar_id,
        student_name=enrollment.student_name,
        dob=enrollment.dob,
        institution_id=enrollment.institution_id,
        academic_year=enrollment.academic_year,
        status=enrollment.status,
        signed_payload=enrollment.signed_payload,
        credential=credential,
        qr_code_url=qr_code_url,
        payload_summary=_payload_summary(credential),
        created_at=enrollment.created_at,
    )


def _institution_out(institution: Institution, cycle: IntakeCycle) -> InstitutionOut:
    remaining = cycle.sanctioned_intake - cycle.current_enrolled
    utilization = (
        round(cycle.current_enrolled / cycle.sanctioned_intake * 100, 1)
        if cycle.sanctioned_intake
        else 0.0
    )
    return InstitutionOut(
        institution_id=institution.institution_id,
        institution_name=institution.institution_name,
        course_name=institution.course_name,
        academic_year=cycle.academic_year,
        sanctioned_intake=cycle.sanctioned_intake,
        current_enrolled=cycle.current_enrolled,
        seats_remaining=max(remaining, 0),
        utilization_percent=utilization,
    )


async def _cycle_for(
    db: AsyncSession, institution: Institution, academic_year: str | None
) -> tuple[str, IntakeCycle]:
    year = resolve_year(academic_year or institution.academic_year)
    cycle = await db.get(IntakeCycle, (institution.institution_id, year))
    if cycle is None:
        raise HTTPException(
            status_code=404,
            detail=(
                f"No approved intake for {institution.institution_id} in {year}. "
                "Choose an academic cycle from the selector."
            ),
        )
    return year, cycle


def _normalise_dob(value: Any) -> Any:
    if isinstance(value, str):
        cleaned = value.strip()
        if len(cleaned) >= 10 and cleaned[4] == "-" and cleaned[7] == "-":
            return cleaned[:10]
        return cleaned
    return value


def _normalise_apaar_cell(value: Any) -> Any:
    if isinstance(value, str):
        cleaned = value.strip().replace(" ", "")
        if cleaned.endswith(".0") and cleaned[:-2].isdigit():
            return cleaned[:-2]
        return cleaned
    return value


async def parse_roster(file: UploadFile) -> list[StudentRow]:
    """Read CSV/XLSX bytes into fully validated ``StudentRow`` objects."""
    filename = file.filename or "roster.csv"
    suffix = Path(filename).suffix.lower()
    if suffix not in ALLOWED_SUFFIXES:
        raise HTTPException(
            status_code=415,
            detail=f"Unsupported file type '{suffix or 'unknown'}'. Upload CSV or XLSX.",
        )

    raw = await file.read()
    if len(raw) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="Roster exceeds the 5 MB upload limit.")
    if not raw:
        raise HTTPException(status_code=422, detail="Uploaded file is empty.")

    try:
        if suffix in {".xlsx", ".xls"}:
            frame = pd.read_excel(BytesIO(raw), dtype=str)
        else:
            frame = pd.read_csv(BytesIO(raw), dtype=str)
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Unable to parse roster file: {exc}") from exc

    frame.columns = [
        COLUMN_ALIASES.get(
            str(column).strip().lower().replace(" ", "_"),
            str(column).strip().lower().replace(" ", "_"),
        )
        for column in frame.columns
    ]
    required = {"apaar_id", "student_name", "dob"}
    missing = sorted(required - set(frame.columns))
    if missing:
        raise HTTPException(
            status_code=422,
            detail=f"Roster is missing required column(s): {', '.join(missing)}",
        )

    frame = frame.dropna(how="all")
    if frame.empty:
        raise HTTPException(status_code=422, detail="Roster contains no student rows.")

    rows: list[StudentRow] = []
    errors: list[dict[str, Any]] = []
    seen: dict[str, int] = {}

    for offset, (_, record) in enumerate(frame.iterrows()):
        row_number = offset + 2  # header occupies row 1
        candidate = {
            "apaar_id": _normalise_apaar_cell(record.get("apaar_id")),
            "student_name": record.get("student_name"),
            "dob": _normalise_dob(record.get("dob")),
        }
        try:
            student = StudentRow(**candidate)
        except (ValidationError, ValueError) as exc:
            message = exc.errors()[0]["msg"] if isinstance(exc, ValidationError) else str(exc)
            errors.append(
                {
                    "row": row_number,
                    "apaar_id": candidate["apaar_id"],
                    "student_name": candidate["student_name"],
                    "error": message,
                }
            )
            continue
        if student.apaar_id in seen:
            errors.append(
                {
                    "row": row_number,
                    "apaar_id": student.apaar_id,
                    "student_name": student.student_name,
                    "error": (
                        "Duplicate APAAR ID inside upload "
                        f"(already on row {seen[student.apaar_id]})"
                    ),
                }
            )
            continue
        seen[student.apaar_id] = row_number
        rows.append(student)

    if errors:
        raise HTTPException(
            status_code=422,
            detail={"detail": "Roster validation failed", "errors": errors},
        )
    return rows


async def find_conflicts(
    db: AsyncSession,
    apaar_ids: Sequence[str],
    academic_year: str,
) -> list[ConflictDetail]:
    stmt = (
        select(StudentEnrollment, Institution)
        .join(Institution, Institution.institution_id == StudentEnrollment.institution_id)
        .where(
            StudentEnrollment.apaar_id.in_(apaar_ids),
            StudentEnrollment.academic_year == academic_year,
            StudentEnrollment.status == "ACTIVE",
        )
    )
    result = await db.execute(stmt)
    return [
        ConflictDetail(
            apaar_id=enrollment.apaar_id,
            student_name=enrollment.student_name,
            conflicting_institution=institution.institution_name,
            conflicting_institution_id=institution.institution_id,
        )
        for enrollment, institution in result.all()
    ]


async def _record_audit(db: AsyncSession, entries: list[AuditLog]) -> None:
    if not entries:
        return
    db.add_all(entries)
    await db.commit()


async def _conflict_response(
    db: AsyncSession,
    institution: Institution,
    students: Sequence[StudentRow],
    conflicts: list[ConflictDetail],
    academic_year: str,
) -> JSONResponse:
    name_lookup = {student.apaar_id: student.student_name for student in students}
    await _record_audit(
        db,
        [
            AuditLog(
                event_type="CONCURRENCY_CONFLICT",
                severity="CRITICAL",
                apaar_id=conflict.apaar_id,
                student_name=name_lookup.get(conflict.apaar_id) or conflict.student_name,
                institution_id=institution.institution_id,
                conflicting_institution_id=conflict.conflicting_institution_id,
                academic_year=academic_year,
                detail=(
                    f"Blocked double enrollment for {conflict.apaar_id}: active seat already "
                    f"held at {conflict.conflicting_institution} for {academic_year}."
                ),
            )
            for conflict in conflicts
        ],
    )
    return _error(
        409,
        {
            "detail": "Concurrency Conflict: Active seat collision detected",
            "conflicts": [conflict.model_dump() for conflict in conflicts],
            "academic_year": academic_year,
        },
    )


async def _quota_response(
    db: AsyncSession,
    institution: Institution,
    students: Sequence[StudentRow],
    remaining: int,
    academic_year: str,
) -> JSONResponse:
    message = (
        f"Sanctioned Intake Exceeded: Upload contains {len(students)} students, but only "
        f"{remaining} seats remain for this approved intake."
    )
    await _record_audit(
        db,
        [
            AuditLog(
                event_type="QUOTA_BLOCK",
                severity="WARNING",
                institution_id=institution.institution_id,
                academic_year=academic_year,
                detail=f"{message} ({institution.institution_name}, {academic_year})",
            )
        ],
    )
    return _error(422, {"detail": message, "academic_year": academic_year})


@router.get("/institutions", response_model=list[InstitutionOut])
async def list_institutions(
    academic_year: str = Query(default=ACTIVE_ACADEMIC_YEAR),
    db: AsyncSession = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> list[InstitutionOut]:
    year = resolve_year(academic_year)
    stmt = (
        select(Institution, IntakeCycle)
        .join(IntakeCycle, IntakeCycle.institution_id == Institution.institution_id)
        .where(IntakeCycle.academic_year == year)
        .order_by(Institution.institution_id)
    )
    if user.is_registrar:
        stmt = stmt.where(Institution.institution_id == user.institution_id)
    result = await db.execute(stmt)
    return [_institution_out(institution, cycle) for institution, cycle in result.all()]


@router.get("/institutions/{institution_id}", response_model=InstitutionOut)
async def get_institution(
    institution_id: str,
    academic_year: str = Query(default=ACTIVE_ACADEMIC_YEAR),
    db: AsyncSession = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> InstitutionOut:
    scope_institution(user, institution_id)
    institution = await db.get(Institution, institution_id)
    if institution is None:
        raise HTTPException(status_code=404, detail=f"Unknown institution '{institution_id}'")
    _, cycle = await _cycle_for(db, institution, academic_year)
    return _institution_out(institution, cycle)


@router.get("/institutions/{institution_id}/enrollments", response_model=list[EnrolledStudent])
async def list_enrollments(
    institution_id: str,
    limit: int = Query(default=15, ge=1, le=100),
    academic_year: str = Query(default=ACTIVE_ACADEMIC_YEAR),
    db: AsyncSession = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> list[EnrolledStudent]:
    scope_institution(user, institution_id)
    institution = await db.get(Institution, institution_id)
    if institution is None:
        raise HTTPException(status_code=404, detail=f"Unknown institution '{institution_id}'")

    year, _ = await _cycle_for(db, institution, academic_year)
    result = await db.execute(
        select(StudentEnrollment)
        .where(
            StudentEnrollment.institution_id == institution_id,
            StudentEnrollment.academic_year == year,
            StudentEnrollment.status == "ACTIVE",
        )
        .order_by(StudentEnrollment.created_at.desc())
        .limit(limit)
    )
    enrollments = result.scalars().all()
    response = []
    for enrollment in enrollments:
        qr_code_url = None
        credential = None
        if enrollment.signed_payload:
            try:
                credential = CredentialEnvelope.model_validate_json(enrollment.signed_payload)
                qr_code_url = generate_verifiable_qr(credential.model_dump())
            except ValidationError:  # pragma: no cover
                credential = None
        item = _format_student(enrollment, qr_code_url)
        item.credential = credential
        response.append(item)
    return response


@router.get("/credential", response_model=CredentialLookupOut)
async def lookup_credential(
    apaar_id: str | None = Query(default=None),
    student_name: str | None = Query(default=None),
    institution_id: str | None = Query(default=None),
    academic_year: str | None = Query(default=None),
    db: AsyncSession = Depends(get_db),
) -> CredentialLookupOut:
    """Resolve a user-supplied identity to its signed credential envelope."""
    apaar = (apaar_id or "").strip().replace(" ", "")
    name = " ".join((student_name or "").split())
    if not apaar and not name:
        raise HTTPException(
            status_code=422, detail="Provide an APAAR ID or a student name to verify."
        )

    stmt = (
        select(StudentEnrollment, Institution)
        .join(Institution, Institution.institution_id == StudentEnrollment.institution_id)
        .where(
            StudentEnrollment.status == "ACTIVE",
            StudentEnrollment.signed_payload.is_not(None),
        )
    )
    if apaar:
        stmt = stmt.where(StudentEnrollment.apaar_id == apaar)
    if name:
        stmt = stmt.where(func.lower(StudentEnrollment.student_name) == name.lower())
    if institution_id:
        stmt = stmt.where(StudentEnrollment.institution_id == institution_id.strip())
    if academic_year:
        stmt = stmt.where(
            StudentEnrollment.academic_year == resolve_year(academic_year)
        )
    stmt = stmt.order_by(StudentEnrollment.created_at.desc()).limit(1)

    result = await db.execute(stmt)
    row = result.first()
    if row is None:
        raise HTTPException(
            status_code=404,
            detail=(
                "No signed credential matches those details. Check the APAAR ID, name, "
                "institution code and academic year."
            ),
        )
    enrollment, institution = row
    try:
        envelope = CredentialEnvelope.model_validate_json(enrollment.signed_payload or "")
    except ValidationError as exc:  # pragma: no cover - legacy rows
        raise HTTPException(
            status_code=409, detail="This ledger row has no readable signed credential."
        ) from exc

    return CredentialLookupOut(
        enrollment_id=str(enrollment.enrollment_id),
        apaar_id=enrollment.apaar_id,
        student_name=enrollment.student_name,
        dob=enrollment.dob,
        institution_id=enrollment.institution_id,
        institution_name=institution.institution_name,
        course_name=institution.course_name,
        academic_year=enrollment.academic_year,
        status=enrollment.status,
        credential=envelope,
        qr_code_url=generate_verifiable_qr(envelope.model_dump()),
        created_at=enrollment.created_at,
    )


@router.get("/search", response_model=SearchResponse)
async def search(
    q: str = Query(default="", max_length=120),
    academic_year: str = Query(default=ACTIVE_ACADEMIC_YEAR),
    limit: int = Query(default=6, ge=1, le=20),
    db: AsyncSession = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> SearchResponse:
    term = " ".join(q.split())
    if len(term) < 2:
        return SearchResponse()
    year = resolve_year(academic_year)
    pattern = f"%{term.lower()}%"
    scope = scope_institution(user, None)

    student_stmt = (
        select(StudentEnrollment, Institution)
        .join(Institution, Institution.institution_id == StudentEnrollment.institution_id)
        .where(
            StudentEnrollment.status == "ACTIVE",
            StudentEnrollment.academic_year == year,
            or_(
                StudentEnrollment.apaar_id.contains(term),
                func.lower(StudentEnrollment.student_name).like(pattern),
            ),
        )
        .order_by(StudentEnrollment.student_name)
        .limit(limit)
    )
    if scope:
        student_stmt = student_stmt.where(StudentEnrollment.institution_id == scope)
    student_rows = (await db.execute(student_stmt)).all()

    institution_stmt = (
        select(Institution, IntakeCycle)
        .join(IntakeCycle, IntakeCycle.institution_id == Institution.institution_id)
        .where(
            IntakeCycle.academic_year == year,
            or_(
                func.lower(Institution.institution_id).like(pattern),
                func.lower(Institution.institution_name).like(pattern),
            ),
        )
        .order_by(Institution.institution_id)
        .limit(limit)
    )
    if scope:
        institution_stmt = institution_stmt.where(Institution.institution_id == scope)
    institution_rows = (await db.execute(institution_stmt)).all()

    return SearchResponse(
        students=[
            SearchStudentOut(
                apaar_id=enrollment.apaar_id,
                student_name=enrollment.student_name,
                institution_id=enrollment.institution_id,
                institution_name=institution.institution_name,
                academic_year=enrollment.academic_year,
            )
            for enrollment, institution in student_rows
        ],
        institutions=[
            SearchInstitutionOut(
                institution_id=institution.institution_id,
                institution_name=institution.institution_name,
                course_name=institution.course_name,
                academic_year=cycle.academic_year,
                sanctioned_intake=cycle.sanctioned_intake,
                current_enrolled=cycle.current_enrolled,
            )
            for institution, cycle in institution_rows
        ],
    )


@router.get("/sample-credential")
async def sample_credential(
    academic_year: str | None = Query(default=None),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Latest signed credential, used by the public verifier demo panel."""
    stmt = select(StudentEnrollment).where(StudentEnrollment.signed_payload.is_not(None))
    if academic_year:
        stmt = stmt.where(StudentEnrollment.academic_year == resolve_year(academic_year))
    stmt = stmt.order_by(StudentEnrollment.created_at.desc()).limit(1)
    enrollment = (await db.execute(stmt)).scalars().first()
    if enrollment is None:
        raise HTTPException(status_code=404, detail="No signed credentials in the ledger yet.")
    envelope = CredentialEnvelope.model_validate_json(enrollment.signed_payload)
    return {
        "student_name": enrollment.student_name,
        "institution_id": enrollment.institution_id,
        "academic_year": enrollment.academic_year,
        "credential": envelope.model_dump(),
        "qr_code_url": generate_verifiable_qr(envelope.model_dump()),
    }


@router.post(
    "/batch-upload",
    response_model=BatchUploadResult,
    responses={
        409: {"description": "Active seat collision"},
        422: {"description": "Quota exceeded or roster validation failure"},
    },
)
async def batch_upload(
    institution_id: str = Form(...),
    academic_year: str | None = Form(default=None),
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> BatchUploadResult | JSONResponse:
    scope_institution(user, institution_id)
    institution = await db.get(Institution, institution_id)
    if institution is None:
        raise HTTPException(status_code=404, detail=f"Unknown institution '{institution_id}'")
    year, cycle = await _cycle_for(db, institution, academic_year)

    students = await parse_roster(file)
    apaar_ids = [student.apaar_id for student in students]

    # Guard 1 — national concurrency check. Identity conflicts are evaluated
    # before seat math so a colliding student never receives a misleading quota
    # error when the college also happens to be full.
    conflicts = await find_conflicts(db, apaar_ids, year)
    if conflicts:
        return await _conflict_response(db, institution, students, conflicts, year)

    remaining = cycle.sanctioned_intake - cycle.current_enrolled
    if len(students) + cycle.current_enrolled > cycle.sanctioned_intake:
        return await _quota_response(db, institution, students, max(remaining, 0), year)

    issued: list[tuple[StudentEnrollment, dict[str, Any], str]] = []
    filled_before = cycle.current_enrolled
    try:
        for student in students:
            payload = {
                "apaar": student.apaar_id,
                "inst": institution.institution_id,
                "yr": year,
                "status": "VERIFIED_ACTIVE",
            }
            envelope = build_credential(payload)
            qr_code_url = generate_verifiable_qr(envelope)
            enrollment = StudentEnrollment(
                apaar_id=student.apaar_id,
                student_name=student.student_name,
                dob=student.dob,
                institution_id=institution.institution_id,
                academic_year=year,
                status="ACTIVE",
                signed_payload=canonical_json(envelope),
            )
            db.add(enrollment)
            await db.flush()
            issued.append((enrollment, envelope, qr_code_url))

        # Atomic capacity check-and-increment: the CHECK constraint is the last
        # line of defence if two uploads race past the guard above.
        capacity_update = await db.execute(
            update(IntakeCycle)
            .where(
                IntakeCycle.institution_id == institution.institution_id,
                IntakeCycle.academic_year == year,
                IntakeCycle.current_enrolled + len(students)
                <= IntakeCycle.sanctioned_intake,
            )
            .values(current_enrolled=IntakeCycle.current_enrolled + len(students))
        )
        if capacity_update.rowcount != 1:
            await db.rollback()
            refreshed = await db.get(IntakeCycle, (institution_id, year))
            return await _quota_response(
                db,
                institution,
                students,
                max(refreshed.sanctioned_intake - refreshed.current_enrolled, 0),
                year,
            )

        db.add(
            AuditLog(
                event_type="ENROLLMENT_SUCCESS",
                severity="INFO",
                institution_id=institution.institution_id,
                academic_year=year,
                detail=(
                    f"Admitted {len(students)} student(s) to {institution.institution_name}; "
                    f"seat ledger updated to {filled_before + len(students)}"
                    f"/{cycle.sanctioned_intake} for {year}."
                ),
            )
        )
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        error_text = str(exc.orig).lower()
        if "check_cycle_intake_limit" in error_text or "check_sanctioned_intake_limit" in error_text:
            refreshed = await db.get(IntakeCycle, (institution_id, year))
            return await _quota_response(
                db,
                institution,
                students,
                max(refreshed.sanctioned_intake - refreshed.current_enrolled, 0),
                year,
            )
        conflicts = await find_conflicts(db, apaar_ids, year)
        if conflicts:
            return await _conflict_response(db, institution, students, conflicts, year)
        raise HTTPException(
            status_code=409,
            detail="Concurrency conflict detected at commit time; please retry the roster.",
        ) from exc

    await db.refresh(cycle)

    return BatchUploadResult(
        institution_id=institution.institution_id,
        institution_name=institution.institution_name,
        academic_year=year,
        enrolled_count=len(issued),
        seats_filled=cycle.current_enrolled,
        sanctioned_intake=cycle.sanctioned_intake,
        seats_remaining=max(cycle.sanctioned_intake - cycle.current_enrolled, 0),
        students=[_format_student(enrollment, qr) for enrollment, _, qr in issued],
    )


@router.get("/summary")
async def admissions_summary(
    academic_year: str = Query(default=ACTIVE_ACADEMIC_YEAR),
    db: AsyncSession = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> dict[str, Any]:
    year = resolve_year(academic_year)
    scope = scope_institution(user, None)
    enrollment_stmt = (
        select(func.count())
        .select_from(StudentEnrollment)
        .where(
            StudentEnrollment.status == "ACTIVE",
            StudentEnrollment.academic_year == year,
        )
    )
    cycle_stmt = select(func.count()).select_from(IntakeCycle).where(
        IntakeCycle.academic_year == year
    )
    if scope:
        enrollment_stmt = enrollment_stmt.where(StudentEnrollment.institution_id == scope)
        cycle_stmt = cycle_stmt.where(IntakeCycle.institution_id == scope)
    total_students = await db.scalar(enrollment_stmt)
    total_institutions = await db.scalar(cycle_stmt)
    return {
        "academic_year": year,
        "active_enrollments": total_students or 0,
        "institutions": total_institutions or 0,
    }
