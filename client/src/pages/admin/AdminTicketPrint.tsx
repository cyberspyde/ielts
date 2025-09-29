import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

const AdminTicketPrint: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation() as any;
  let tickets = (location.state && Array.isArray(location.state.tickets)) ? location.state.tickets : [];
  if (!tickets.length) {
    try {
      const cached = sessionStorage.getItem('tickets-print');
      if (cached) tickets = JSON.parse(cached);
    } catch {}
  }

  const toDateString = (value?: string | null) => {
    if (!value) return 'N/A';
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? 'N/A' : parsed.toLocaleDateString();
  };

  const getUsageInfo = (ticket: any) => {
    const current = Number(ticket.currentUses ?? ticket.current_uses ?? 0);
    const max = Number(ticket.maxUses ?? ticket.max_uses ?? 1);
    const safeCurrent = Number.isFinite(current) && current >= 0 ? current : 0;
    const safeMax = Number.isFinite(max) && max > 0 ? max : 1;
    return { current: safeCurrent, max: safeMax };
  };

  const getStatusInfo = (ticket: any) => {
    const { current, max } = getUsageInfo(ticket);
    const rawStatus = String(ticket.status ?? ticket.ticket_status ?? '').trim().toLowerCase();
    let normalized = rawStatus;
    if (!normalized) normalized = current >= max ? 'used' : 'active';
    const label = normalized
      .split(/\s|_/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');
    return { label: label || 'Unknown', usesLabel: `${current}/${max}` };
  };

  const buildMetaLine = (ticket: any) => {
    const parts: string[] = [];
    if (ticket.exam?.type) parts.push(String(ticket.exam.type).toUpperCase());
    if (ticket.exam?.id) parts.push(`ID: ${ticket.exam.id}`);
    return parts.join(' | ');
  };

  React.useEffect(() => {
    if (!tickets.length) return;
    const id = setTimeout(() => window.print(), 200);
    return () => clearTimeout(id);
  }, [tickets]);

  if (!tickets.length) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="text-gray-700 mb-2">No tickets to print.</div>
          <button className="px-3 py-2 border rounded" onClick={() => navigate('/admin/tickets')}>
            Back
          </button>
        </div>
      </div>
    );
  }

  const columns = 3;
  const rowsPerPage = 3;
  const perPage = columns * rowsPerPage;
  const pages: any[][] = [];
  for (let i = 0; i < tickets.length; i += perPage) {
    pages.push(tickets.slice(i, i + perPage));
  }

  const gridStyle: React.CSSProperties = {
    display: 'grid',
    gridTemplateColumns: `repeat(${columns}, 1fr)` as const,
    gridAutoRows: '1fr',
    gap: '4.5mm'
  };

  return (
    <div className="print-root">
      {pages.map((page, idx) => (
        <div key={idx} className="print-sheet">
          <div className="print-grid" style={gridStyle}>
            {page.map((t: any) => {
              const personName = (t.issuedTo && t.issuedTo.name) || t.issuedToName || t.issued_to_name || '';
              const metaLine = buildMetaLine(t);
              const statusInfo = getStatusInfo(t);
              const validFrom = toDateString(t.validFrom ?? t.valid_from ?? t.createdAt ?? t.created_at ?? null);
              const validUntil = toDateString(t.validUntil ?? t.valid_until ?? null);
              const codeValue = t.code || t.ticket_code;

              return (
                <div key={t.id || codeValue} className="ticket-card">
                  <div className="ticket-header">{t.exam?.title || 'IELTS Mock Exam'}</div>
                  <div className="ticket-meta">{metaLine}</div>
                  <div className="cut-line" />
                  <div className="label">Ticket Code</div>
                  <div className="code">{codeValue}</div>
                  <div className="details">
                    {personName ? <div>Student: {personName}</div> : null}
                    <div>Status: {statusInfo.label}</div>
                    <div>Uses: {statusInfo.usesLabel}</div>
                    <div>Valid: {validFrom} {'->'} {validUntil}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
      <style>{`
@page { size: A4 landscape; margin: 9mm; }
@media screen { body { background: #f9fafb; } }
@media print {
  body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body * { visibility: hidden; }
  .print-root, .print-root * { visibility: visible; }
  .print-root { position: absolute; left: 0; top: 0; width: 100%; }
}
.print-sheet { width: 100%; margin: 0; padding: 0; box-sizing: border-box; background: white; }
.print-sheet:not(:last-child) { page-break-after: always; }
.print-grid { width: 100%; height: 100%; }
.ticket-card {
  border: 1px dotted #9ca3af;
  padding: 3.5mm;
  box-sizing: border-box;
  border-radius: 2mm;
  min-height: 50mm;
  display: flex;
  flex-direction: column;
  justify-content: flex-start;
}
.ticket-header { font-family: Georgia, 'Times New Roman', serif; font-size: 11pt; font-weight: 600; color: #111827; }
.ticket-meta { font-size: 7.6pt; color: #6b7280; margin-top: 1mm; min-height: 8pt; }
.label { font-size: 7pt; color: #374151; letter-spacing: .04em; text-transform: uppercase; margin-top: 1.5mm; }
.code {
  font-family: 'Courier New', Courier, monospace;
  font-size: 15pt;
  letter-spacing: 0.7px;
  color: #111827;
  margin: 1mm 0;
  text-align: center;
  white-space: nowrap;
}
.details { margin-top: 1.5mm; font-size: 7.4pt; color: #374151; line-height: 1.2; }
.cut-line { border-top: 1px dotted #d1d5db; margin: 2mm 0 1.5mm 0; }
      `}</style>
    </div>
  );
};

export default AdminTicketPrint;
