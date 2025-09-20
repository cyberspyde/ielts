import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

const AdminTicketPrint: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation() as any;
  const tickets = (location.state && Array.isArray(location.state.tickets)) ? location.state.tickets : [];

  React.useEffect(() => {
    if (!tickets.length) return;
    const id = setTimeout(() => { window.print(); }, 200);
    return () => clearTimeout(id);
  }, [tickets]);

  if (!tickets.length) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="text-gray-700 mb-2">No tickets to print.</div>
          <button className="px-3 py-2 border rounded" onClick={() => navigate('/admin/tickets')}>Back</button>
        </div>
      </div>
    );
  }

  const pages: any[][] = [];
  for (let i=0;i<tickets.length;i+=6) pages.push(tickets.slice(i,i+6));

  return (
    <div className="print-root">
      {pages.map((page, idx) => (
        <div key={idx} className="print-sheet">
          <div className="print-grid">
            {page.map((t:any) => {
              const personName = (t.issuedTo && t.issuedTo.name) || t.issuedToName || t.issued_to_name || '';
              return (
                <div key={t.id || t.code} className="ticket-card">
                  <div className="ticket-header">{t.exam?.title || 'IELTS Mock Exam'}</div>
                  <div className="ticket-meta">{t.exam?.type ? String(t.exam.type).toUpperCase() : ''}{t.exam?.id ? ` • ID: ${t.exam.id}` : ''}</div>
                  <div className="cut-line" />
                  <div className="label">Ticket Code</div>
                  <div className="code">{t.code || t.ticket_code}</div>
                  <div className="details">
                    {personName ? <div>Student: {personName}</div> : null}
                    <div>Valid: {t.validFrom ? new Date(t.validFrom).toLocaleDateString() : new Date(t.createdAt).toLocaleDateString()} → {t.validUntil ? new Date(t.validUntil).toLocaleDateString() : '—'}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
      <style>{`
@page { size: A4; margin: 10mm; }
@media screen { body { background: #f9fafb; } }
@media print {
  body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  /* Hide everything except the printable content to remove app header/nav */
  body * { visibility: hidden; }
  .print-root, .print-root * { visibility: visible; }
  .print-root { position: absolute; left: 0; top: 0; width: 100%; }
  /* Hide browser headers/footers if possible is controlled by the print dialog; content below avoids page URL placement areas */
}
.print-sheet { width: 100%; margin: 0; padding: 0; box-sizing: border-box; background: white; }
.print-sheet:not(:last-child) { page-break-after: always; }
.print-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8mm; }
.ticket-card { border: 1px dotted #9ca3af; padding: 6mm; box-sizing: border-box; border-radius: 2mm; min-height: 80mm; display: flex; flex-direction: column; justify-content: flex-start; }
.ticket-header { font-family: Georgia, 'Times New Roman', serif; font-size: 14pt; font-weight: 600; color: #111827; }
.ticket-meta { font-size: 9pt; color: #6b7280; margin-top: 1mm; }
.label { font-size: 8.5pt; color: #374151; letter-spacing: .05em; text-transform: uppercase; margin-top: 3mm; }
.code { font-family: 'Courier New', Courier, monospace; font-size: 22pt; letter-spacing: 1.2px; color: #111827; margin-top: 1mm; }
.details { margin-top: 3mm; font-size: 9pt; color: #374151; line-height: 1.3; }
.cut-line { border-top: 1px dotted #d1d5db; margin: 4mm 0 3mm 0; }
      `}</style>
    </div>
  );
};

export default AdminTicketPrint;


