import { jsPDF } from 'jspdf';
import {
  formatRecordDate,
  formatRecordDateTime,
  type OfficialRecord,
} from './official-record';

export interface CertificateMeta {
  checkedAt: Date;
  keyFingerprint: string | null;
}

const NAVY = [15, 23, 42] as const;
const SLATE = [100, 116, 139] as const;
const INDIGO = [79, 70, 229] as const;
const GREEN = [5, 150, 105] as const;
const BORDER = [226, 232, 240] as const;

export function downloadVerificationCertificate(
  record: OfficialRecord,
  meta: CertificateMeta,
): void {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const width = doc.internal.pageSize.getWidth();

  doc.setFillColor(255, 255, 255);
  doc.rect(0, 0, 210, 297, 'F');

  doc.setTextColor(238, 242, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(58);
  doc.text('AICTE VERIFIED', 105, 175, { align: 'center', angle: 28 });

  doc.setDrawColor(NAVY[0], NAVY[1], NAVY[2]);
  doc.setLineWidth(0.9);
  doc.rect(9, 9, 192, 279);
  doc.setDrawColor(BORDER[0], BORDER[1], BORDER[2]);
  doc.setLineWidth(0.35);
  doc.rect(13.5, 13.5, 183, 270);

  doc.setDrawColor(INDIGO[0], INDIGO[1], INDIGO[2]);
  doc.setLineWidth(0.6);
  doc.circle(105, 29, 8.5, 'S');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(6.2);
  doc.setTextColor(INDIGO[0], INDIGO[1], INDIGO[2]);
  doc.text('AICTE', 105, 28.2, { align: 'center' });
  doc.text('APEX', 105, 31.4, { align: 'center' });

  doc.setFontSize(13.5);
  doc.setTextColor(NAVY[0], NAVY[1], NAVY[2]);
  doc.text('ALL INDIA COUNCIL FOR TECHNICAL EDUCATION', width / 2, 46, {
    align: 'center',
  });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.2);
  doc.setTextColor(SLATE[0], SLATE[1], SLATE[2]);
  doc.text('AICTE-TrustNet  ·  National APAAR Credential Ledger', width / 2, 51.5, {
    align: 'center',
  });
  doc.setDrawColor(INDIGO[0], INDIGO[1], INDIGO[2]);
  doc.setLineWidth(0.5);
  doc.line(62, 55.5, 148, 55.5);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.setTextColor(NAVY[0], NAVY[1], NAVY[2]);
  doc.text('ACADEMIC VERIFICATION RECORD', width / 2, 66, { align: 'center' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(SLATE[0], SLATE[1], SLATE[2]);
  doc.text('Official cryptographic attestation of an approved academic seat', width / 2, 72, {
    align: 'center',
  });
  doc.setFont('courier', 'normal');
  doc.setFontSize(7.8);
  doc.text(`Reference: ${record.reference}`, width / 2, 79, { align: 'center' });

  doc.setFillColor(236, 253, 245);
  doc.setDrawColor(167, 243, 208);
  doc.setLineWidth(0.4);
  doc.roundedRect(48, 84, 114, 9, 2.5, 2.5, 'FD');
  doc.setFillColor(GREEN[0], GREEN[1], GREEN[2]);
  doc.circle(54, 88.5, 1.9, 'F');
  doc.setDrawColor(255, 255, 255);
  doc.setLineWidth(0.35);
  doc.line(53.1, 88.6, 53.8, 89.3);
  doc.line(53.8, 89.3, 55, 87.8);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.3);
  doc.setTextColor(GREEN[0], GREEN[1], GREEN[2]);
  doc.text('CRYPTOGRAPHICALLY VERIFIED VIA ED25519', width / 2 + 3, 89.3, {
    align: 'center',
  });

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.4);
  doc.setTextColor(SLATE[0], SLATE[1], SLATE[2]);
  doc.text('CREDENTIAL PARTICULARS', 20, 102);

  const field = (label: string, value: string, x: number, y: number, maxWidth = 80) => {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.5);
    doc.setTextColor(SLATE[0], SLATE[1], SLATE[2]);
    doc.text(label.toUpperCase(), x, y);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.3);
    doc.setTextColor(NAVY[0], NAVY[1], NAVY[2]);
    const lines = doc.splitTextToSize(value || '—', maxWidth);
    doc.text(lines.slice(0, 2), x, y + 4.6);
  };

  field('Student name', record.student_name || '—', 20, 111);
  field('APAAR ID', record.apaar || '—', 110, 111);
  field('Date of birth', formatRecordDate(record.dob), 20, 124);
  field('Institution code', record.institution_id || '—', 110, 124);
  field('Institution', record.institution_name ?? record.institution_id, 20, 137, 82);
  field('Programme', record.course_name ?? '—', 110, 137, 82);
  field('Academic year', record.academic_year || '—', 20, 150);
  field('Seat status', record.status || '—', 110, 150);
  field('Credential issued', formatRecordDate(record.issued_at), 20, 163);
  field('Verification checked', formatRecordDateTime(meta.checkedAt), 110, 163);

  doc.setDrawColor(BORDER[0], BORDER[1], BORDER[2]);
  doc.setLineWidth(0.35);
  doc.line(20, 175, 190, 175);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(6.5);
  doc.setTextColor(SLATE[0], SLATE[1], SLATE[2]);
  doc.text('APEX KEY FINGERPRINT', 20, 181);
  doc.setFont('courier', 'normal');
  doc.setFontSize(7.2);
  doc.setTextColor(NAVY[0], NAVY[1], NAVY[2]);
  const fingerprint = meta.keyFingerprint || 'Unavailable at issuance';
  doc.text(doc.splitTextToSize(fingerprint, 170).slice(0, 2), 20, 185.8);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(6.5);
  doc.setTextColor(SLATE[0], SLATE[1], SLATE[2]);
  doc.text('DETACHED ED25519 SIGNATURE', 20, 195);
  doc.setFont('courier', 'normal');
  doc.setFontSize(6.8);
  doc.setTextColor(NAVY[0], NAVY[1], NAVY[2]);
  doc.text(`${record.credential.signature.slice(0, 72)}…`, 20, 199.8);

  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(BORDER[0], BORDER[1], BORDER[2]);
  doc.setLineWidth(0.35);
  doc.roundedRect(20, 208, 128, 40, 2, 2, 'FD');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.2);
  doc.setTextColor(NAVY[0], NAVY[1], NAVY[2]);
  doc.text('VERIFICATION STATEMENT', 25, 214.5);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.9);
  doc.setTextColor(SLATE[0], SLATE[1], SLATE[2]);
  doc.text(
    doc.splitTextToSize(
      'The detached Ed25519 signature was verified in the browser against the AICTE apex public key. Canonical JSON binds the APAAR ID, institution code, academic year and seat status; any alteration invalidates this attestation.',
      116,
    ),
    25,
    219.5,
  );
  doc.setFontSize(6.4);
  doc.text('Computer-generated record — no physical signature required.', 25, 240.5);

  if (record.qr_code_url?.startsWith('data:image/')) {
    try {
      doc.addImage(record.qr_code_url, 'PNG', 157, 208, 33, 33);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(6.2);
      doc.setTextColor(SLATE[0], SLATE[1], SLATE[2]);
      doc.text('Scan to re-verify offline', 173.5, 245, { align: 'center' });
    } catch {
      /* a malformed QR should never block the certificate */
    }
  }

  doc.setDrawColor(BORDER[0], BORDER[1], BORDER[2]);
  doc.line(20, 258, 190, 258);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.6);
  doc.setTextColor(SLATE[0], SLATE[1], SLATE[2]);
  doc.text(
    'AICTE-TrustNet · SIH26263 prototype · This record reflects the national APAAR ledger at the time of verification.',
    width / 2,
    263.5,
    { align: 'center' },
  );
  doc.setFont('courier', 'normal');
  doc.setFontSize(6.2);
  doc.text(record.reference, width / 2, 268.5, { align: 'center' });

  doc.save(`AICTE-Verification-${record.apaar || 'credential'}.pdf`);
}
