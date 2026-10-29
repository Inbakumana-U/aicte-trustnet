"""Pydantic v2 contract for ingestion, credentials, analytics and mocks."""

from __future__ import annotations

import json
from datetime import date, datetime, timezone
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_serializer, field_validator

from app.core.verhoeff import validate_verhoeff

APAAR_ERROR = "Invalid APAAR ID checksum (Mod-10 Verhoeff failure)"


def _utc(dt: datetime | None) -> datetime | None:
    if dt is None:
        return None
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt.astimezone(timezone.utc)


class StudentRow(BaseModel):
    """One validated roster line. This is the only door into the ledger."""

    apaar_id: str
    student_name: str
    dob: date

    @field_validator("apaar_id", mode="before")
    @classmethod
    def _normalise_apaar(cls, value: Any) -> str:
        if isinstance(value, float) and value.is_integer():
            value = int(value)
        if isinstance(value, int):
            value = str(value)
        if isinstance(value, str):
            return value.strip().replace(" ", "")
        raise ValueError("APAAR ID must be a 12-digit string")

    @field_validator("apaar_id")
    @classmethod
    def _check_apaar(cls, value: str) -> str:
        if len(value) != 12 or not value.isdigit():
            raise ValueError("APAAR ID must be exactly 12 numeric digits")
        if not validate_verhoeff(value):
            raise ValueError(APAAR_ERROR)
        return value

    @field_validator("student_name", mode="before")
    @classmethod
    def _normalise_name(cls, value: Any) -> str:
        if not isinstance(value, str) or not value.strip():
            raise ValueError("student_name is required")
        return " ".join(value.split())

    @field_validator("student_name")
    @classmethod
    def _check_name(cls, value: str) -> str:
        if len(value) > 255:
            raise ValueError("student_name must be 255 characters or fewer")
        return value

    @field_validator("dob")
    @classmethod
    def _check_dob(cls, value: date) -> date:
        if value > date.today():
            raise ValueError("dob cannot be in the future")
        if value.year < 1900:
            raise ValueError("dob is implausible")
        return value


class InstitutionOut(BaseModel):
    institution_id: str
    institution_name: str
    course_name: str
    academic_year: str
    sanctioned_intake: int
    current_enrolled: int
    seats_remaining: int
    utilization_percent: float


class CredentialEnvelope(BaseModel):
    payload: dict[str, Any]
    signature: str
    algorithm: str = "Ed25519"
    issuer: str = "AICTE-APEX"


class EnrolledStudent(BaseModel):
    enrollment_id: str
    apaar_id: str
    student_name: str
    dob: date
    institution_id: str
    academic_year: str
    status: str
    signed_payload: str | None = None
    credential: CredentialEnvelope | None = None
    qr_code_url: str | None = None
    payload_summary: dict[str, str] | None = None
    created_at: datetime | None = None

    @field_serializer("created_at")
    def _serialize_created_at(self, value: datetime | None, _info) -> datetime | None:
        return _utc(value)


class BatchUploadResult(BaseModel):
    institution_id: str
    institution_name: str
    academic_year: str
    enrolled_count: int
    seats_filled: int
    sanctioned_intake: int
    seats_remaining: int
    students: list[EnrolledStudent]


class ConflictDetail(BaseModel):
    apaar_id: str
    student_name: str
    conflicting_institution: str
    conflicting_institution_id: str
    reason: str = "Active seat already registered for this academic year"


class QuotaError(BaseModel):
    detail: str


class ConcurrencyError(BaseModel):
    detail: str
    conflicts: list[ConflictDetail]


class RosterValidationError(BaseModel):
    detail: str
    errors: list[dict[str, Any]]


class AuditLogOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    event_type: str
    severity: Literal["INFO", "WARNING", "CRITICAL"]
    apaar_id: str | None = None
    student_name: str | None = None
    institution_id: str | None = None
    conflicting_institution_id: str | None = None
    academic_year: str | None = None
    detail: str
    created_at: datetime

    @field_serializer("created_at")
    def _serialize_created_at(self, value: datetime, _info) -> datetime:
        return _utc(value)


class AnalyticsOverview(BaseModel):
    total_institutions: int
    total_registered_apaars: int
    prevented_concurrency_violations: int
    prevented_quota_violations: int
    total_sanctioned_seats: int
    total_seats_filled: int
    seat_utilization_percent: float
    active_academic_year: str


class IntakeRow(BaseModel):
    institution_id: str
    institution_name: str
    course_name: str
    academic_year: str
    sanctioned_intake: int
    current_enrolled: int
    seats_remaining: int
    utilization_percent: float


class LoginRequest(BaseModel):
    role: Literal["REGISTRAR", "APEX"]
    identifier: str = Field(min_length=3, max_length=160)
    password: str = Field(min_length=4, max_length=128)


class AuthUserOut(BaseModel):
    identifier: str
    role: Literal["REGISTRAR", "APEX"]
    name: str
    title: str
    institution_id: str | None = None
    institution_name: str | None = None
    initials: str


class LoginResponse(BaseModel):
    token: str
    expires_at: datetime
    user: AuthUserOut


class CredentialLookupOut(BaseModel):
    enrollment_id: str
    apaar_id: str
    student_name: str
    dob: date
    institution_id: str
    institution_name: str
    course_name: str
    academic_year: str
    status: str
    credential: CredentialEnvelope
    qr_code_url: str
    created_at: datetime | None = None

    @field_serializer("created_at")
    def _serialize_created_at(self, value: datetime | None, _info) -> datetime | None:
        return _utc(value)


class SearchStudentOut(BaseModel):
    apaar_id: str
    student_name: str
    institution_id: str
    institution_name: str
    academic_year: str


class SearchInstitutionOut(BaseModel):
    institution_id: str
    institution_name: str
    course_name: str
    academic_year: str
    sanctioned_intake: int
    current_enrolled: int


class SearchResponse(BaseModel):
    students: list[SearchStudentOut] = Field(default_factory=list)
    institutions: list[SearchInstitutionOut] = Field(default_factory=list)


class ApexKeyResponse(BaseModel):
    issuer: str
    algorithm: str
    public_key: str
    key_fingerprint: str
    usage: str
    endpoints: dict[str, str]


class VerifyCredentialRequest(BaseModel):
    credential: dict[str, Any] | str
    signature: str | None = None
    public_key: str | None = None

    @field_validator("credential", mode="before")
    @classmethod
    def _parse_credential(cls, value: Any) -> Any:
        if isinstance(value, str):
            try:
                return json.loads(value)
            except json.JSONDecodeError as exc:
                raise ValueError("credential is not valid JSON") from exc
        return value


class VerifyCredentialResponse(BaseModel):
    valid: bool
    reason: str
    payload: dict[str, Any] | None = None
    algorithm: str = "Ed25519"
    issuer: str = "AICTE-APEX"
    key_fingerprint: str
    verified_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class DigiLockerIdentity(BaseModel):
    apaar_id: str
    full_name: str
    dob: date
    gender: str
    category: str
    state: str
    guardian_name: str
    aadhaar_masked: str
    verified: bool = True
    source: str = "DigiLocker (mock)"
    fetched_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class CreditRecord(BaseModel):
    course_code: str
    course_name: str
    credits: float = Field(gt=0, le=40)
    grade: str


class ABCSyncRequest(BaseModel):
    apaar_id: str
    student_name: str
    institution_id: str
    program: str
    graduation_year: int | None = None
    credits: list[CreditRecord] = Field(min_length=1)

    @field_validator("apaar_id")
    @classmethod
    def _check_apaar(cls, value: str) -> str:
        value = value.strip()
        if len(value) != 12 or not value.isdigit():
            raise ValueError("APAAR ID must be exactly 12 numeric digits")
        if not validate_verhoeff(value):
            raise ValueError(APAAR_ERROR)
        return value


class ABCSyncResponse(BaseModel):
    status: Literal["SYNCED_TO_ABC"]
    ledger_txn: str
    apaar_id: str
    credits_ingested: int
    total_credits: float
    network: str = "Academic Bank of Credits"
    anchored_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
