"""SQLAlchemy 2.0 declarative models and the non-negotiable seat invariants."""

from __future__ import annotations

import uuid
from datetime import date, datetime

from sqlalchemy import (
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


class Institution(Base):
    __tablename__ = "institutions"

    institution_id: Mapped[str] = mapped_column(String(50), primary_key=True)
    institution_name: Mapped[str] = mapped_column(String(255), nullable=False)
    course_name: Mapped[str] = mapped_column(String(100), nullable=False)
    academic_year: Mapped[str] = mapped_column(String(10), nullable=False)
    sanctioned_intake: Mapped[int] = mapped_column(Integer, nullable=False)
    current_enrolled: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default="0"
    )

    enrollments: Mapped[list["StudentEnrollment"]] = relationship(
        back_populates="institution", cascade="all, delete-orphan", lazy="selectin"
    )
    cycles: Mapped[list["IntakeCycle"]] = relationship(
        back_populates="institution", cascade="all, delete-orphan", lazy="selectin"
    )

    __table_args__ = (
        CheckConstraint(
            "current_enrolled <= sanctioned_intake",
            name="check_sanctioned_intake_limit",
        ),
        CheckConstraint("current_enrolled >= 0", name="check_enrolled_non_negative"),
        CheckConstraint("sanctioned_intake > 0", name="check_sanctioned_intake_positive"),
    )


class IntakeCycle(Base):
    """Approved intake and live seat usage for one institution and academic year."""

    __tablename__ = "intake_cycles"

    institution_id: Mapped[str] = mapped_column(
        String(50), ForeignKey("institutions.institution_id"), primary_key=True
    )
    academic_year: Mapped[str] = mapped_column(String(10), primary_key=True)
    sanctioned_intake: Mapped[int] = mapped_column(Integer, nullable=False)
    current_enrolled: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default="0"
    )

    institution: Mapped[Institution] = relationship(back_populates="cycles")

    __table_args__ = (
        CheckConstraint(
            "current_enrolled <= sanctioned_intake",
            name="check_cycle_intake_limit",
        ),
        CheckConstraint("current_enrolled >= 0", name="check_cycle_enrolled_non_negative"),
        CheckConstraint("sanctioned_intake > 0", name="check_cycle_intake_positive"),
    )


class StudentEnrollment(Base):
    __tablename__ = "student_enrollments"

    enrollment_id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    apaar_id: Mapped[str] = mapped_column(String(12), nullable=False, index=True)
    student_name: Mapped[str] = mapped_column(String(255), nullable=False)
    dob: Mapped[date] = mapped_column(Date, nullable=False)
    institution_id: Mapped[str] = mapped_column(
        String(50), ForeignKey("institutions.institution_id"), nullable=False, index=True
    )
    academic_year: Mapped[str] = mapped_column(String(10), nullable=False)
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, default="ACTIVE", server_default="ACTIVE"
    )
    signed_payload: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    institution: Mapped[Institution] = relationship(back_populates="enrollments")

    __table_args__ = (
        # Anti-hoarding lock: a student may hold only one ACTIVE seat per year,
        # across every institution in the country.
        UniqueConstraint(
            "apaar_id", "academic_year", "status", name="uq_active_seat_per_year"
        ),
        CheckConstraint(
            "status IN ('ACTIVE', 'CANCELLED', 'GRADUATED')", name="check_enrollment_status"
        ),
        CheckConstraint("length(apaar_id) = 12", name="check_apaar_length"),
    )


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    event_type: Mapped[str] = mapped_column(String(40), nullable=False, index=True)
    severity: Mapped[str] = mapped_column(
        String(10), nullable=False, default="INFO", server_default="INFO"
    )
    apaar_id: Mapped[str | None] = mapped_column(String(12), nullable=True, index=True)
    student_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    institution_id: Mapped[str | None] = mapped_column(String(50), nullable=True)
    conflicting_institution_id: Mapped[str | None] = mapped_column(String(50), nullable=True)
    academic_year: Mapped[str | None] = mapped_column(String(10), nullable=True, index=True)
    detail: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False, index=True
    )

    __table_args__ = (
        CheckConstraint(
            "severity IN ('INFO', 'WARNING', 'CRITICAL')", name="check_audit_severity"
        ),
    )
