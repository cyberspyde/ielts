import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Clock, AlertTriangle, ChevronLeft, ChevronRight } from 'lucide-react';
import { toast } from 'react-toastify';
import { apiService } from '../../services/api';
import { useAuth } from '../../contexts/AuthContext';

interface TimerProps {
  duration: number;
  onTimeUp: () => void;
  isPaused: boolean;
  darkMode: boolean;
}

const Timer: React.FC<TimerProps> = ({ duration, onTimeUp, isPaused, darkMode }) => {
  const [timeLeft, setTimeLeft] = useState(duration * 60);

  useEffect(() => {
    setTimeLeft(duration * 60);
  }, [duration]);

  useEffect(() => {
    if (isPaused) return;
    const timer = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) {
          clearInterval(timer);
          onTimeUp();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [isPaused, onTimeUp]);

  const minutes = Math.floor(timeLeft / 60);
  const seconds = timeLeft % 60;
  const urgency = timeLeft <= 300 ? (timeLeft <= 120 ? 'text-red-500' : 'text-amber-500') : (darkMode ? 'text-gray-100' : 'text-gray-900');

  return (
    <div className={"flex items-center space-x-2 font-mono text-lg font-semibold " + urgency}>
      <Clock className="h-5 w-5" />
      <span>{minutes}:{seconds.toString().padStart(2, '0')}</span>
      {isPaused && <span className="text-sm opacity-70">(Paused)</span>}
    </div>
  );
};

const SECTION_DURATION_MINUTES: Record<string, number> = { listening: 30, reading: 60, writing: 60, speaking: 15 };

// Pretty name for section type/title
const formatSectionName = (section: any): string => {
  if (!section) return 'Section';
  const title = section.title || section.sectionType || 'Section';
  return String(title).charAt(0).toUpperCase() + String(title).slice(1);
};

// Determine duration (minutes) for a given section
const resolveSectionDuration = (section: any, exam: any): number => {
  if (!section) return Math.max(1, Number(exam?.durationMinutes) || 60);
  const t = String(section.sectionType || '').toLowerCase();
  const d = SECTION_DURATION_MINUTES[t];
  return d ? d : 60;
};

const ExamTaking: React.FC = () => {
  const { examId } = useParams<{ examId: string }>();
  const [searchParams] = useSearchParams();
  const sectionParam = searchParams.get('section') || undefined;
  const sidFromUrl = searchParams.get('sid') || undefined;
  const navigate = useNavigate();
  const [answers, setAnswers] = useState<Record<string, { questionId: string; answer: string | string[] }>>({});
  const [fillBlankDrafts, setFillBlankDrafts] = useState<Record<string, string[]>>({});
  const [isPaused, setIsPaused] = useState(false);
  const [showConfirmSubmit, setShowConfirmSubmit] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sectionTimerDuration, setSectionTimerDuration] = useState<number>(0);
  const [timerKey, setTimerKey] = useState(0);
  const previousSectionIndexRef = useRef<number | null>(null);
  const transitionReasonRef = useRef<'manual' | 'timeUp' | null>(null);
  const [sectionTransition, setSectionTransition] = useState<{ fromName: string; toName: string; reason: 'manual' | 'timeUp'; } | null>(null);
  // UI preferences
  const [showSettings, setShowSettings] = useState(false);
  const [prefFontSize, setPrefFontSize] = useState<number>(() => {
    const saved = localStorage.getItem('readingFontSize');
    return saved ? Number(saved) : 16;
  });
  const [prefFontFamily, setPrefFontFamily] = useState<string>(() => localStorage.getItem('readingFontFamily') || 'serif');
  // Default to light mode; previous implementation forced dark by stored localStorage key
  const [darkMode, setDarkMode] = useState<boolean>(() => localStorage.getItem('examDarkMode') === '1');
  // Ensure we do not toggle global document dark class; Tailwind is configured as 'class' so we scope dark styles locally
  useEffect(() => { localStorage.setItem('readingFontSize', String(prefFontSize)); }, [prefFontSize]);
  useEffect(() => { localStorage.setItem('readingFontFamily', prefFontFamily); }, [prefFontFamily]);
  useEffect(() => { localStorage.setItem('examDarkMode', darkMode ? '1' : '0'); }, [darkMode]);

  // Derived style helpers
  const primaryTextClass = darkMode ? 'text-gray-100' : 'text-gray-900';
  const secondaryTextClass = darkMode ? 'text-gray-400' : 'text-gray-600';
  const inputBase = darkMode
    ? 'bg-gray-900 border-gray-600 placeholder-gray-500 text-gray-100 focus:ring-blue-500 focus:border-blue-400'
    : 'bg-white border-gray-300 placeholder-gray-400 text-gray-900 focus:ring-blue-500 focus:border-blue-500';
  const blankInputExtra = darkMode
    ? 'shadow-[0_0_0_1px_rgba(255,255,255,0.05)] hover:border-blue-500/70 focus:border-blue-400 focus:shadow-[0_0_0_2px_rgba(59,130,246,0.35)]'
    : 'hover:border-blue-400 focus:border-blue-500';
  const warningPanel = darkMode
    ? 'bg-amber-900/30 border border-amber-700 text-amber-200'
    : 'bg-yellow-50 border border-yellow-200 text-gray-800';
  const chipClass = (isCurrent: boolean, isAnswered: boolean) => {
    if (isCurrent) return 'bg-blue-600 text-white border-blue-600';
    if (isAnswered) return darkMode ? 'bg-green-700 text-green-100 border-green-600' : 'bg-green-100 text-green-800 border-green-300';
    return darkMode ? 'bg-gray-800 text-gray-300 border-gray-600 hover:bg-gray-700' : 'bg-gray-50 text-gray-600 border-gray-300 hover:bg-gray-100';
  };
  // Matching drag & drop state
  const [draggingHeading, setDraggingHeading] = useState<string | null>(null);
  // Inline table drag_drop token DnD visual state
  const [draggingTokenAnchor, setDraggingTokenAnchor] = useState<string | null>(null);
  const [dragOverDragDropQuestion, setDragOverDragDropQuestion] = useState<string | null>(null);
  const [recentDropQuestion, setRecentDropQuestion] = useState<string | null>(null);
  // Navigation state
  const [currentSectionIndex, setCurrentSectionIndex] = useState(0);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  // Instruction debug toggle
  const [instructionDebug, setInstructionDebug] = useState<boolean>(() => {
    try { return /debugInstr=1/i.test(window.location.search) || localStorage.getItem('debugInstructions') === '1'; } catch { return false; }
  });

  // Removed zoom; container will handle its own scroll/size

  // Normalize author-entered new line tokens like "\n" or "/n" into actual newlines for display
  const normalizeNewlines = (text: string | undefined | null): string => {
    if (!text) return '';
    return String(text)
      .replace(/\r\n/g, '\n')
      .replace(/\\r\\n/g, '\n')
      .replace(/\\n/g, '\n')
      .replace(/\s*\/n\s*/g, '\n');
  };

  // Helper to extract numbers and answered state from a simple_table question (used for nav chips and progress)
  const extractSimpleTableNumbersFromQuestion = React.useCallback((q: any): { num: number; answered: boolean }[] => {
    try {
      let meta: any = q?.metadata;
      if (meta && typeof meta === 'string') { try { meta = JSON.parse(meta); } catch { meta = {}; } }
      const rows: any[][] = meta?.simpleTable?.rows || [];
      const out: { num:number; answered:boolean }[] = [];
      const seqStart: number | undefined = meta?.simpleTable?.sequenceStart;
      let derivedCounter = seqStart || 0;
      rows.forEach((row:any[], ri:number) => row.forEach((cell:any, ci:number) => {
        if (cell?.type !== 'question') return; // skip pure text cells
        const baseKey = `${q.id}_${ri}_${ci}`;
        const effectiveType = cell?.questionType || 'fill_blank';
        // Mirror renderer logic for assigning a displayNumber
        let displayNumber: number | undefined = cell?.questionNumber;
        if (displayNumber === undefined && seqStart !== undefined) {
          displayNumber = derivedCounter;
          derivedCounter += 1;
        }
        if (effectiveType === 'fill_blank') {
            const raw: string = cell?.content || '';
            const matches = raw.match(/\{answer\d*\}|_{3,}/gi) || [];
            const hasInline = matches.length > 0;
            let blanks = matches.length || 1;
            if (Array.isArray(cell.multiNumbers) && cell.multiNumbers.length > blanks) blanks = cell.multiNumbers.length;
            const numbers: number[] = Array.isArray(cell.multiNumbers) && cell.multiNumbers.length >= blanks
              ? cell.multiNumbers.slice(0, blanks)
              : (displayNumber !== undefined ? Array.from({length: blanks}, (_,_i)=> displayNumber! + _i) : []);
            numbers.forEach((num, bi) => {
              if (typeof num !== 'number') return;
              // Renderer uses `_b${i}` for inline blanks even when there is only one; respect that here.
              const keySingleInline = `${baseKey}_b0`;
              const key = blanks > 1 ? `${baseKey}_b${bi}` : (hasInline ? keySingleInline : baseKey);
              let ans = (answers as any)[key]?.answer;
              // Fallback: if authors toggled between inline/non-inline, try the alternate key shape
              if (!ans && blanks === 1) {
                const altKey = hasInline ? baseKey : keySingleInline;
                ans = (answers as any)[altKey]?.answer;
              }
              out.push({ num, answered: !!ans });
            });
        } else {
          if (displayNumber !== undefined) {
            const ans = (answers as any)[baseKey]?.answer;
            out.push({ num: displayNumber, answered: !!ans });
          }
        }
      }));
      return out;
    } catch {
      return [];
    }
  }, [answers]);

  // Fetch exam (with questions) - include sid so server can authorize question access for ticket-based (unauth) sessions
  const activeSid = sidFromUrl || sessionId || undefined;
  const { data: exam, isLoading: examLoading } = useQuery({
    queryKey: ['exam', examId, activeSid, sectionParam],
    queryFn: async () => {
      const params: Record<string, string> = { questions: 'true' };
      if (sectionParam) params.section = sectionParam;
      if (activeSid) params.sid = activeSid; // server also accepts 'session'
      const res = await apiService.get<any>(`/exams/${examId}`, params);
      return (res.data as any)?.exam || res.data;
    },
    enabled: !!examId
  });

  // Debug: table/question diagnostics. Enable with ?debugTables=1 or ?debug=1 or localStorage.debugTables=1. Toggle with Ctrl+Shift+D.
  const [debugTables, setDebugTables] = useState<boolean>(() => {
    try {
      const qs = window.location.search;
      if (/debugTables=1/i.test(qs) || /[?&]debug=1/i.test(qs)) return true;
      if (localStorage.getItem('debugTables') === '1') return true;
    } catch {}
    return false;
  });
  useEffect(() => {
    let lastToggle = 0;
    const handler = (e: KeyboardEvent) => {
      if (e.repeat) return; // ignore auto-repeat
      if (e.key.toLowerCase() === 'd' && e.ctrlKey && e.shiftKey) {
        const now = Date.now();
        if (now - lastToggle < 250) return; // debounce fast double press
        lastToggle = now;
        setDebugTables(prev => {
          const next = !prev; try { localStorage.setItem('debugTables', next ? '1':'0'); } catch {}
          // eslint-disable-next-line no-console
          console.info('[ExamTaking] debugTables toggled ->', next);
          return next;
        });
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // Keep debug on if URL param persists even after internal toggles
  useEffect(() => {
    try {
      const qs = window.location.search;
      if ((/debugTables=1/i.test(qs) || /[?&]debug=1/i.test(qs)) && !debugTables) {
        setDebugTables(true);
      }
    } catch {}
  }, [debugTables]);

  // Start a session for this exam (used on first load or when re-establishing)
  const startSession = useMutation({
    mutationFn: async (eid: string) => {
      const body: any = {};
      if (sectionParam) body.section = sectionParam;
      const res = await apiService.post<any>(`/exams/${eid}/start`, body);
      if (!res.success || !res.data) throw new Error(res.message || 'Failed to start exam');
      return (res.data as any).sessionId as string;
    },
    onSuccess: (sid) => setSessionId(sid)
  });

  // If sid present in URL, adopt it once
  useEffect(() => {
    if (sidFromUrl && !sessionId) {
      setSessionId(sidFromUrl);
    }
  }, [sidFromUrl, sessionId]);

  useEffect(() => {
    if (exam && !sessionId && !sidFromUrl) {
      startSession.mutate(exam.id);
    }
  }, [exam, sessionId, sidFromUrl]);

  // Lock outer scroll (hide global scrollbar) while taking exam
  useEffect(() => {
    const original = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = original; };
  }, []);

  // Submit
  const submit = useMutation({
    mutationFn: async (sid: string) => {
      // Consolidate synthetic simple_table cell IDs (pattern: parentUUID_row_col or parentUUID_row_col_bN) into one answer per parent question
      // Supports multi-blank cells (answers keyed with _b index) aggregated into arrays preserving order.
      const simpleTableGroups: Record<string, { cells: Record<string, any> }> = {};
      const directAnswers: { questionId: string; studentAnswer: any }[] = [];
      const uuidLike = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
      Object.values(answers).forEach(a => {
        const id = a.questionId;
        const m = id.match(/^([0-9a-fA-F-]{36})_(\d+)_(\d+)(?:_b(\d+))?$/);
        if (m && uuidLike.test(m[1])) {
          const parentId = m[1];
          const row = m[2];
          const col = m[3];
          const blankIndexRaw = m[4];
          const cellKey = `${row}_${col}`;
          if (!simpleTableGroups[parentId]) simpleTableGroups[parentId] = { cells: {} };
          if (blankIndexRaw !== undefined) {
            // multi-blank: aggregate into array
            const idx = Number(blankIndexRaw);
            if (!Array.isArray(simpleTableGroups[parentId].cells[cellKey])) simpleTableGroups[parentId].cells[cellKey] = [] as any[];
            const arr = simpleTableGroups[parentId].cells[cellKey] as any[];
            arr[idx] = a.answer; // preserve positional order
          } else {
            // single blank cell
            simpleTableGroups[parentId].cells[cellKey] = a.answer;
          }
        } else {
          directAnswers.push({ questionId: id, studentAnswer: a.answer });
        }
      });
      // Convert grouped table answers to JSON strings so backend can store them (backend unaware yet of per-cell granularity)
      Object.entries(simpleTableGroups).forEach(([parentId, data]) => {
        // Send structured object; backend will stringify when persisting
        directAnswers.push({ questionId: parentId, studentAnswer: { type: 'simple_table', version: 1, ...data } });
      });
      return apiService.post(`/exams/sessions/${sid}/submit`, { answers: directAnswers });
    },
  onSuccess: () => {
      hasSubmitRetriedRef.current = false;
      setShowConfirmSubmit(false);
      // Policy: Do not show results to students after submit
      toast.success('Your exam was submitted successfully. Results will be reviewed by admins.');
      navigate('/dashboard');
    },
    onError: (err: any) => {
      const status = err?.response?.status;
      const msg = err?.response?.data?.message || err?.message || '';
      const looksLikeMissingSession = status === 404 || /session not found/i.test(msg || '');
      if (looksLikeMissingSession && exam?.id && !hasSubmitRetriedRef.current) {
        hasSubmitRetriedRef.current = true;
        toast.info('Session expired. Re-establishing and retrying...');
        // Start a new session, then retry once with same answers state
        (async () => {
          try {
            const newSid = await startSession.mutateAsync(exam.id);
            setSessionId(newSid);
            submit.mutate(newSid);
          } catch (e: any) {
            hasSubmitRetriedRef.current = false;
            toast.error(e?.message || 'Failed to restart session. Please reload the page.');
          }
        })();
        return;
      }
      toast.error(msg || 'Failed to submit exam');
    }
  });
  const hasSubmitRetriedRef = useRef(false);

  const currentSection = exam?.sections?.[currentSectionIndex];
  useEffect(() => {
    if (debugTables && currentSection?.questions) {
      // eslint-disable-next-line no-console
      console.log('[ExamTaking][debugTables] section questions', currentSection.questions.map((q:any)=> ({ id:q.id, num:q.questionNumber, type:q.questionType, metaType: typeof q.metadata })));
    }
  }, [debugTables, currentSection]);
  useEffect(() => {
    const sections = exam?.sections || [];
    if (!sections.length) return;

    const current = sections[currentSectionIndex];
    const newDuration = resolveSectionDuration(current, exam);
    setSectionTimerDuration(newDuration);
    setTimerKey(prev => prev + 1);

    const prevIndex = previousSectionIndexRef.current;
    if (prevIndex === null) {
      previousSectionIndexRef.current = currentSectionIndex;
      setSectionTransition(null);
      setIsPaused(false);
      transitionReasonRef.current = null;
      return;
    }

    const fromSection = sections[prevIndex];
    const toSection = current;
    const fromType = (fromSection?.sectionType || '').toLowerCase();
    const toType = (toSection?.sectionType || '').toLowerCase();
    const movingForward = currentSectionIndex > prevIndex;

    if (movingForward && fromType && toType && fromType !== toType) {
      setSectionTransition({
        fromName: formatSectionName(fromSection),
        toName: formatSectionName(toSection),
        reason: transitionReasonRef.current || 'manual',
      });
      setIsPaused(true);
    } else {
      setSectionTransition(null);
      setIsPaused(false);
    }

    previousSectionIndexRef.current = currentSectionIndex;
    transitionReasonRef.current = null;
  }, [exam, currentSectionIndex, formatSectionName]);

  useEffect(() => {
    if (!exam) return;
    try {
      const dump = (exam.sections || []).map((section: any) => ({
        sectionId: section.id,
        type: section.sectionType,
        questions: (section.questions || []).map((q: any) => ({
          id: q.id,
          qnum: q.questionNumber,
          metadata: q.metadata,
        })),
      }));
      (window as any).__dropdownDump = dump;
      console.log('[DropdownDump]', dump);
    } catch (e) {
      console.warn('[DropdownDump] failed', e);
    }
  }, [exam]);

  const handleSectionTransitionContinue = () => {
    setSectionTransition(null);
    setIsPaused(false);
  };

  // Section transition overlay (restored) - shows when moving between major sections after time up/manual advance
  const transitionOverlay = sectionTransition ? (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className={(darkMode ? 'bg-gray-900 text-gray-100' : 'bg-white text-gray-900') + ' w-full max-w-md rounded-lg shadow-xl p-6'}>
        <h2 className="text-xl font-semibold mb-2">Next Section: {sectionTransition.toName}</h2>
        <p className="text-sm mb-4">
          {(sectionTransition.reason === 'timeUp' ? `${sectionTransition.fromName} time has ended.` : `${sectionTransition.fromName} complete.`)} Ready to begin {sectionTransition.toName}?
        </p>
        <button
          type="button"
          onClick={handleSectionTransitionContinue}
          className="w-full px-4 py-2 rounded bg-blue-600 text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          Begin {sectionTransition.toName}
        </button>
      </div>
    </div>
  ) : null;

  const isListeningSection = (currentSection?.sectionType || '').toLowerCase() === 'listening';
  const isWritingSection = (currentSection?.sectionType || '').toLowerCase() === 'writing';
  // Writing parts (Task 1 / Task 2). Default mapping: writing_task1 -> Part 1, essay -> Part 2, overrideable via metadata.writingPart
  const writingQuestions = React.useMemo(() => (currentSection?.questions || []).filter((q: any) => ['writing_task1','essay'].includes(q.questionType)), [currentSection]);
  const getWritingPart = React.useCallback((q: any): number => (q?.metadata?.writingPart) || (q.questionType === 'writing_task1' ? 1 : (q.questionType === 'essay' ? 2 : 1)), []);
  const writingParts: number[] = React.useMemo(() => {
    const parts = writingQuestions.map(getWritingPart) as number[];
    const unique = Array.from(new Set<number>(parts));
    unique.sort((a, b) => a - b);
    return unique;
  }, [writingQuestions, getWritingPart]);
  const [currentWritingPart, setCurrentWritingPart] = useState<number>(1);
  useEffect(() => {
    if (!isWritingSection) return;
    const first = writingParts[0] || 1;
    setCurrentWritingPart(first);
  }, [isWritingSection, currentSection?.id]);
  const activeWritingQuestion = React.useMemo(() => {
    return writingQuestions.find((q:any) => getWritingPart(q) === currentWritingPart) || writingQuestions[0];
  }, [writingQuestions, getWritingPart, currentWritingPart]);
  // Listening part helpers.
  // Supports two modes:
  //  1) Single-section mode (original): one listening section with questionNumbers 1..40 (auto parts every 10).
  //  2) Multi-section mode: multiple listening sections each representing a part (common authoring pattern). We surface each section as a Part.
  const listeningSections = React.useMemo(() => (exam?.sections || []).filter((s: any) => (s.sectionType || '').toLowerCase() === 'listening'), [exam]);
  const multiSectionListening = listeningSections.length > 1; // treat each listening section as a part
  const listeningParts: number[] = React.useMemo(() => {
    if (!isListeningSection) return [];
    if (multiSectionListening) {
  return listeningSections.map((_: any, idx: number) => idx + 1); // one part per listening section
    }
    // single-section legacy logic
    const qs = currentSection?.questions || [];
    const partsSet = new Set<number>();
    qs.forEach((q: any) => {
      const part = q.metadata?.listeningPart || (q.questionNumber ? Math.ceil(q.questionNumber / 10) : 1);
      partsSet.add(Math.min(4, Math.max(1, part)));
    });
    const arr = Array.from(partsSet).sort((a,b)=>a-b);
    for (let i=1;i<=4;i++) { if (!arr.includes(i) && i <= (arr[arr.length-1]||0)) arr.push(i); }
    return arr.sort((a,b)=>a-b);
  }, [isListeningSection, multiSectionListening, listeningSections, currentSection]);
  const [currentListeningPart, setCurrentListeningPart] = useState<number>(1);
  // Prevent feedback loops when we programmatically switch parts via chevrons
  const suppressPartSyncRef = useRef<boolean>(false);
  // Derive the effective listening part: in multi-section mode it's tied to the current section index; otherwise use state.
  const effectiveListeningPart = React.useMemo(() => {
    if (!isListeningSection) return 1;
    if (multiSectionListening) {
      const curId = currentSection?.id;
      const idx = curId ? listeningSections.findIndex((s: any) => s.id === curId) : -1;
      return idx !== -1 ? idx + 1 : 1;
    }
    return currentListeningPart;
  }, [isListeningSection, multiSectionListening, currentSection?.id, listeningSections, currentListeningPart]);
  // Note: In multi-section mode we no longer force the section to follow the part via an effect.
  // Navigation handlers (chevrons, part buttons) explicitly set the section index.
  useEffect(() => {
    if (!isListeningSection) return;
    // Auto-sync part to current active number (from focus/ref); avoids fighting with programmatic changes
    if (multiSectionListening) return; // only for single-section listening exams
    if (suppressPartSyncRef.current) return; // skip while programmatic navigation is in progress
    const num = listeningCurrentNumRef.current;
    if (typeof num !== 'number') return;
    const inferred = Math.ceil(num / 10);
    if (inferred !== currentListeningPart) {
      setCurrentListeningPart(inferred);
    }
    // We intentionally exclude currentListeningPart from deps to prevent feedback loops
    // when inferred toggles briefly during part transitions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isListeningSection, multiSectionListening, currentQuestionIndex]);
  // Questions for active listening part (1-based)
  const listeningPartQuestions = React.useMemo(() => {
    if (!isListeningSection) return [] as any[];
    if (multiSectionListening) {
      // In multi-section mode, the currentSection already corresponds to currentListeningPart; just use all its questions (excluding simple_table container) sorted.
      return (currentSection?.questions || [])
        .filter((q: any) => q.questionType !== 'simple_table')
        .sort((a: any,b: any)=> (a.questionNumber||0)-(b.questionNumber||0));
    }
    // single-section filtering by part
    return (currentSection?.questions || [])
      .filter((q: any) => {
        const part = q.metadata?.listeningPart || (q.questionNumber ? Math.ceil(q.questionNumber / 10) : 1);
        if (q.questionType === 'simple_table') return false;
    return part === effectiveListeningPart;
      })
      .sort((a: any,b: any)=> (a.questionNumber||0)-(b.questionNumber||0));
  }, [isListeningSection, multiSectionListening, currentSection, effectiveListeningPart]);

  // Helper: get ALL questions for a given listening part across all listening sections (for aggregated counting / instruction carry-forward)
  const allQuestionsForPart = React.useCallback((partNumber: number) => {
    if (!isListeningSection) return [] as any[];
    // Actually just iterate all sections and collect questions whose derived part matches
    const collected: any[] = [];
    (exam?.sections || []).forEach((s:any) => {
      (s.questions || []).forEach((q:any) => {
        const part = q?.metadata?.listeningPart || (q.questionNumber ? Math.ceil(q.questionNumber / 10) : 1);
        if (part === partNumber) collected.push(q);
      });
    });
    return collected.sort((a:any,b:any)=> (a.questionNumber||0)-(b.questionNumber||0));
  }, [exam, isListeningSection]);
  // Deprecated listeningGroups after flow merge; kept comment for reference.
  // Table container (rendered separately) - includes simple tables
  const tableContainer = React.useMemo(() => {
    const qs = currentSection?.questions || [];
    for (const q of qs) {
  // Treat legacy table_* and essay.tableBlock as single container render; simple_table is rendered separately above (Simple Tables block)
  const isTable = (q.questionType === 'table_fill_blank' || q.questionType === 'table_drag_drop' || (q.questionType === 'essay' && (q.metadata?.tableBlock)));
      if (isTable) return q;
    }
    return null;
  }, [currentSection]);
  // Visible questions (exclude group members, matching (special UI), and table container which we render once above list)
  const visibleQuestions = React.useMemo(() => {
    // Normalize metadata (server may return JSON string) & include table containers
    const raw = currentSection?.questions || [];
    const all = raw.map((q: any) => {
      if (q && q.metadata && typeof q.metadata === 'string') {
        try { return { ...q, metadata: JSON.parse(q.metadata) }; } catch { /* ignore parse error */ }
      }
      return q;
    });
    // Include table container questions (table_fill_blank, table_drag_drop, simple_table, legacy essay.tableBlock) so table renders in flow
    return all.filter((q: any) => {
      if (q.metadata?.groupMemberOf) return false; // skip group members
      if (q.questionType === 'matching') return false; // matching handled separately
      if (tableContainer && q.id === tableContainer.id) return false; // skip container itself
      return true;
    }).sort((a:any,b:any)=> (a.questionNumber||0)-(b.questionNumber||0));
  }, [currentSection, tableContainer]);
  // blankNumberMap: questionId -> assigned sequential numbers for blanks.
  // Modes:
  //   Default (no metadata.singleNumber): multi-blank fill_blank consumes one number per blank (displayed as a range Questions X–Y).
  //   If metadata.singleNumber === true OR metadata.combineBlanks === true: consumes only ONE number; all blanks share that number (legacy singleNumber + new combineBlanks flag).
  const blankNumberMap = React.useMemo(() => {
    const map: Record<string, number[]> = {};
    const list = [...visibleQuestions];
    if (!list.length) return map;
    // We now trust backend assigned questionNumber; do not resequence. Only map blanks for quick placeholder display.
  for (const q of list) {
      if (q.questionType === 'fill_blank') {
    const text = normalizeNewlines(q.questionText || '');
        const curly = (text.match(/\{answer\d+\}/gi) || []).length;
        const underscores = (text.match(/_{3,}/g) || []).length;
        const blanks = curly || underscores || 1;
        // Use existing questionNumber as anchor; if multi-blank allocate synthetic subsequent numbers just for display (not persisted)
        const base = q.questionNumber || 0;
        if (blanks <=1 || q.metadata?.singleNumber) map[q.id] = [base];
  const combine = !!(q.metadata?.singleNumber || q.metadata?.combineBlanks); // backward compatible
  if (blanks <=1 || combine) map[q.id] = [base];
        else {
          const nums: number[] = []; for (let i=0;i<blanks;i++) nums.push(base + i); map[q.id] = nums;
        }
      }
    }
    return map;
  }, [visibleQuestions]);
  // For listening sections: build a map of first questionNumber -> instruction for each distinct groupInstruction block.
  const listeningInstructionMap = React.useMemo(() => {
    const map: Record<number, string> = {};
    if (!isListeningSection) return map;
    const norm = (listeningPartQuestions || []).map((q:any) => {
      if (q && q.metadata && typeof q.metadata === 'string') { try { return { ...q, metadata: JSON.parse(q.metadata) }; } catch { /* ignore */ } }
      return q;
    }).sort((a:any,b:any)=> (a.questionNumber||0)-(b.questionNumber||0));
    let lastCoveredEnd = -1;
    for (const q of norm) {
      const start = q.questionNumber || 0;
      const instr = q.metadata?.groupInstruction;
      const end = q.metadata?.groupRangeEnd || start;
      if (instr && start > lastCoveredEnd) {
        map[start] = instr;
        lastCoveredEnd = end;
      } else if (instr && start <= lastCoveredEnd && end > lastCoveredEnd) {
        // overlapping but extends range; still note start if not present
        if (!map[start]) map[start] = instr;
        lastCoveredEnd = end;
      }
    }
    return map;
  }, [isListeningSection, listeningPartQuestions]);
  // Expose a small debug API on window for manual inspection (placed after listeningInstructionMap is defined)
  useEffect(() => {
    const w = window as any;
    w.examInstructionDebugAPI = {
      enable: () => { setInstructionDebug(true); try { localStorage.setItem('debugInstructions','1'); } catch {}; console.info('[InstrDebug] Enabled'); },
      disable: () => { setInstructionDebug(false); try { localStorage.removeItem('debugInstructions'); } catch {}; console.info('[InstrDebug] Disabled'); },
      dump: () => {
        const section = exam?.sections?.[currentSectionIndex];
        if (!section) { console.warn('[InstrDebug] No current section'); return; }
        const rows = (section.questions||[]).map((q:any) => {
          let meta = q.metadata; if (meta && typeof meta === 'string') { try { meta = JSON.parse(meta); } catch { meta = {}; } }
          return {
            qnum: q.questionNumber,
            id: q.id,
            type: q.questionType,
            hasGI: !!meta?.groupInstruction,
            groupInstruction: meta?.groupInstruction || '',
            memberOf: meta?.groupMemberOf || '',
            rangeEnd: meta?.groupRangeEnd || '',
            singleNumber: !!(meta?.singleNumber || meta?.combineBlanks),
            listeningPart: meta?.listeningPart || (q.questionNumber ? Math.ceil(q.questionNumber/10):''),
            metadata: meta
          };
        });
        console.table(rows.filter((r:any)=> r.type==='fill_blank' || r.hasGI));
        return rows;
      },
      listeningMap: () => { console.log('[InstrDebug] listeningInstructionMap', listeningInstructionMap); return listeningInstructionMap; },
      forceReload: () => { setCurrentQuestionIndex(i=> i); console.info('[InstrDebug] Forced re-render'); }
    };
    if (instructionDebug) console.info('[InstrDebug] Active. API: window.examInstructionDebugAPI');
  }, [exam, currentSectionIndex, listeningInstructionMap, instructionDebug]);
  // currentQuestion removed (unused after refactor)
  const isMatchingSection = (currentSection?.questions || []).some((q: any) => (q.questionType === 'matching'));
  const headingOptions: any[] = isMatchingSection
    ? ((currentSection as any)?.headingBank?.options ||
       ((currentSection?.questions || []).find((q: any) => q.questionType === 'matching')?.options || []))
    : [];

  // Precompute matching questions
  const matchingQuestions = (currentSection?.questions || []).filter((q: any) => q.questionType === 'matching');
  const matchingQuestionsSorted = [...matchingQuestions].sort((a: any, b: any) => (a.questionNumber || 0) - (b.questionNumber || 0));

  // Auto-detect paragraphs with letter markers (either a line containing only 'A' or a line starting 'A ' inline). Ensure unique sequential letters.
  interface PassageParagraph { letter?: string; text: string; }
  const passageParagraphs: (PassageParagraph & { index?: number })[] = React.useMemo(() => {
    if (!currentSection?.passageText) return [];
    const raw = currentSection.passageText.replace(/\r\n/g, '\n');
    // First detect explicit markers like [[paragraph1]] [[p2]] etc.
    const markerRegex = /\[\[(?:p|paragraph)\s*(\d+)\]\]/gi;
    const markers: { num: number; start: number; end: number }[] = [];
    let m: RegExpExecArray | null;
    while ((m = markerRegex.exec(raw)) !== null) {
      markers.push({ num: Number(m[1]), start: m.index, end: m.index + m[0].length });
    }
    if (markers.length) {
      const paras: (PassageParagraph & { index?: number })[] = [];
      for (let i = 0; i < markers.length; i++) {
        const cur = markers[i];
        const next = markers[i + 1];
        const seg = raw.slice(cur.end, next ? next.start : undefined).trim();
        if (seg) paras.push({ text: seg, index: cur.num });
      }
      return paras.sort((a,b)=> (a.index||0)-(b.index||0));
    }
    // Fallback to letter detection as before
    const lines = raw.split(/\n/);
    const paras: (PassageParagraph & { index?: number })[] = [];
    let current: { letter?: string; buffer: string[] } | null = null;
    const pushCurrent = () => { if (!current) return; const text = current.buffer.join('\n').trim(); if (text) paras.push({ letter: current.letter, text }); current = null; };
    for (let i = 0; i < lines.length; i++) {
      const rawLine = lines[i];
      const line = rawLine.trim();
      const singleLetter = /^[A-Z]$/.test(line);
      const inlineLetter = /^([A-Z])\s+/.exec(line);
      if (singleLetter) { pushCurrent(); current = { letter: line, buffer: [] }; continue; }
      else if (inlineLetter && (current === null || current.buffer.length === 0)) { pushCurrent(); current = { letter: inlineLetter[1], buffer: [rawLine.slice(rawLine.indexOf(inlineLetter[1]) + 1).trimStart()] }; continue; }
      if (!current) current = { buffer: [], letter: undefined };
      current.buffer.push(rawLine);
    }
    pushCurrent();
    if (paras.length < 2) {
      const parts = raw.split(/\n{2,}/).map((p: string) => p.trim()).filter((p: string) => p.length > 0);
      return parts.map((p: string) => ({ text: p }));
    }
    const firstLetterIndex = paras.findIndex(p => !!p.letter);
    const used = new Set<string>();
    paras.forEach((p, idx) => {
      if (p.letter) { if (used.has(p.letter)) { let code = 65; while (used.has(String.fromCharCode(code))) code++; p.letter = String.fromCharCode(code); } used.add(p.letter); }
      else if (firstLetterIndex !== -1 && idx > firstLetterIndex) { let code = 65; while (used.has(String.fromCharCode(code))) code++; p.letter = String.fromCharCode(code); used.add(p.letter); }
    });
    return paras;
  }, [currentSection?.passageText]);

  // Helper: assign heading to question ensuring uniqueness (one heading used only once)
  const assignHeadingToQuestion = (letter: string, questionId: string) => {
    setAnswers(prev => {
      const next = { ...prev } as typeof prev;
      // Remove letter from any other question to enforce uniqueness
      Object.values(next).forEach(v => {
        if (v.questionId !== questionId && v.answer === letter) {
          v.answer = '';
        }
      });
      next[questionId] = { questionId, answer: letter };
      return next;
    });
  };

  const clearHeadingFromQuestion = (questionId: string) => {
    setAnswers(prev => ({ ...prev, [questionId]: { questionId, answer: '' } }));
    setFillBlankDrafts(prev => {
      if (!prev[questionId]) return prev;
      const next = { ...prev };
      delete next[questionId];
      return next;
    });
  };

  const resolveHeadingText = (letter: string | undefined) => {
    if (!letter) return '';
    const found = headingOptions.find((o: any) => (o.letter || o.option_letter) === letter);
    return found?.text || found?.option_text || letter;
  };

  const changeSection = React.useCallback((targetIndex: number, reason: 'manual' | 'timeUp' = 'manual', targetQuestionIndex?: number) => {
    const sections = exam?.sections || [];
    if (!sections[targetIndex]) return;
    transitionReasonRef.current = reason;
    setCurrentSectionIndex(targetIndex);
    if (typeof targetQuestionIndex === 'number' && !Number.isNaN(targetQuestionIndex)) {
      setCurrentQuestionIndex(targetQuestionIndex);
    } else {
      setCurrentQuestionIndex(0);
    }
  }, [exam?.sections]);

  const goToQuestion = (sectionIndex: number, questionIndex: number) => {
    if (sectionIndex === currentSectionIndex) {
      setCurrentQuestionIndex(questionIndex);
    } else {
      changeSection(sectionIndex, 'manual', questionIndex);
    }
  };

  const goToNextQuestion = () => {
    if (currentQuestionIndex < visibleQuestions.length - 1) {
      setCurrentQuestionIndex(prev => prev + 1);
    } else if (currentSectionIndex < (exam?.sections?.length || 0) - 1) {
      changeSection(currentSectionIndex + 1, 'manual', 0);
    }
  };

  const goToPreviousQuestion = () => {
    if (currentQuestionIndex > 0) {
      setCurrentQuestionIndex(prev => prev - 1);
    } else if (currentSectionIndex > 0) {
      const prevSection = exam?.sections?.[currentSectionIndex - 1];
      const prevVisible = (prevSection?.questions || []).filter((q: any) => !q.metadata?.groupMemberOf && q.questionType !== 'matching');
      changeSection(currentSectionIndex - 1, 'manual', prevVisible.length ? prevVisible.length - 1 : 0);
    }
  };

  // Keyboard navigation (Left/Right arrows) — disabled in listening layout to avoid part/index conflicts
  useEffect(() => {
    if (isListeningSection) return; // listening has its own navigator
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') { e.preventDefault(); goToNextQuestion(); }
      if (e.key === 'ArrowLeft') { e.preventDefault(); goToPreviousQuestion(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isListeningSection, goToNextQuestion, goToPreviousQuestion]);

  const handleAnswerChange = (questionId: string, answer: string | string[], blankIndex?: number) => {
    const persistDraft = (payload: string | string[] | null) => {
      try {
        const key = sessionId ? `draft_${sessionId}` : 'draft_temp';
        const existingRaw = localStorage.getItem(key);
        const existing = existingRaw ? JSON.parse(existingRaw) : {};
        if (payload === null) {
          delete existing[questionId];
        } else {
          existing[questionId] = { questionId, answer: payload };
        }
        localStorage.setItem(key, JSON.stringify(existing));
      } catch {}
    };

    if (typeof blankIndex === 'number') {
      const rawValue = typeof answer === 'string'
        ? answer
        : (Array.isArray(answer) ? (answer[blankIndex] ?? '') : '');
      const prevDraft = fillBlankDrafts[questionId]
        ?? (Array.isArray(answers[questionId]?.answer)
          ? [...(answers[questionId]?.answer as string[])]
          : (typeof answers[questionId]?.answer === 'string' && (answers[questionId]?.answer as string).length
            ? [answers[questionId]?.answer as string]
            : []));
      const base = [...prevDraft];
      while (base.length <= blankIndex) base.push('');
      base[blankIndex] = rawValue;
      const finalArray = [...base];
      while (finalArray.length > 0 && finalArray[finalArray.length - 1] === '') {
        finalArray.pop();
      }
      setFillBlankDrafts(prev => {
        const next = { ...prev };
        if (finalArray.length) next[questionId] = [...finalArray];
        else delete next[questionId];
        return next;
      });
      setAnswers(prev => {
        const next = { ...prev } as typeof prev;
        next[questionId] = { questionId, answer: finalArray.length ? [...finalArray] : [] };
        return next;
      });
      persistDraft(finalArray.length ? finalArray : []);
      return;
    }

    setFillBlankDrafts(prev => {
      if (!prev[questionId]) return prev;
      const next = { ...prev };
      delete next[questionId];
      return next;
    });
    setAnswers(prev => ({ ...prev, [questionId]: { questionId, answer } }));
    persistDraft(answer);
  };

  const getBlankValues = (questionId: string): string[] => {
    const draft = fillBlankDrafts[questionId];
    if (draft) return draft;
    const existing = answers[questionId]?.answer;
    if (Array.isArray(existing)) return existing as string[];
    if (typeof existing === 'string' && existing.length) return [existing];
    return [];
  };

  const handleTimeUp = React.useCallback(() => {
    const totalSections = exam?.sections?.length || 0;
    if (!totalSections) {
      if (sessionId) submit.mutate(sessionId);
      return;
    }

    const isLastSection = currentSectionIndex >= totalSections - 1;
    if (isLastSection) {
      if (sessionId) submit.mutate(sessionId);
    } else {
      changeSection(currentSectionIndex + 1, 'timeUp', 0);
    }
  }, [exam?.sections, currentSectionIndex, sessionId, submit, changeSection]);

  const { user } = useAuth();

  const [leftWidthPct, setLeftWidthPct] = useState<number>(50); // large screens only
  useEffect(() => {
    const onResize = () => {
      // keep range 20-80
      setLeftWidthPct(prev => Math.min(80, Math.max(20, prev)));
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Load drafts from localStorage and server when session becomes available
  useEffect(() => {
    if (!sessionId) return;
    // local first
    try {
      const draftRaw = localStorage.getItem(`draft_${sessionId}`);
      if (draftRaw) {
        const obj = JSON.parse(draftRaw);
        setAnswers((prev:any) => ({ ...prev, ...obj }));
      }
    } catch {}
    // server drafts
    (async () => {
      try {
        const res = await apiService.get<any>(`/exams/sessions/${sessionId}/answers`);
        const srv = res.data?.answers || {};
        if (srv && Object.keys(srv).length) setAnswers((prev:any) => ({ ...srv, ...prev }));
      } catch {}
    })();
  }, [sessionId]);

  // Debounced server autosave
  useEffect(() => {
    if (!sessionId) return;
    const timer = setTimeout(() => {
      const draft = Object.values(answers || {}) as any[];
      if (!draft.length) return;
      apiService.post(`/exams/sessions/${sessionId}/answers`, { answers: draft }).catch(()=>{});
    }, 900);
    return () => clearTimeout(timer);
  }, [answers, sessionId]);

  const startDrag = (e: React.PointerEvent) => {
    if (window.innerWidth < 1024) return; // only on lg+
    e.preventDefault();
    const startX = e.clientX;
    const startLeft = leftWidthPct;
    const total = document.body.clientWidth;
    let active = false; // activate only after threshold
    const threshold = 3; // px
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      if (!active && Math.abs(dx) >= threshold) {
        active = true;
        document.body.style.userSelect = 'none';
        document.body.style.cursor = 'col-resize';
      }
      if (!active) return;
      const percentDelta = (dx / total) * 100;
      const next = Math.min(80, Math.max(20, startLeft + percentDelta));
      setLeftWidthPct(next);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up, { once: true });
  };

  // Scroll handling for right pane question list
  const rightScrollRef = useRef<HTMLDivElement | null>(null);
  // Track active number in non-listening sections
  const sectionCurrentNumRef = useRef<number | null>(null);
  const questionRefs = useRef<Record<string, HTMLDivElement | null>>({});
  // Generic helper: scroll and focus by question number within a container
  const scrollAndFocusByQnum = (num: number, container: HTMLElement | null) => {
    if (!container) return;
    const target = container.querySelector(`[data-qnum="${num}"]`) as HTMLElement | null;
    if (target) {
      target.scrollIntoView({ block: 'center', behavior: 'smooth' });
      setTimeout(() => { try { (target as any).focus?.(); } catch {} }, 120);
    }
  };
  // Update non-listening current number when focus moves within right pane
  useEffect(() => {
    const container = rightScrollRef.current as HTMLElement | null;
    if (!container) return;
    const onFocusIn = (e: Event) => {
      const el = e.target as HTMLElement;
      let cur: HTMLElement | null = el;
      while (cur && cur !== container) {
        const attr = cur.getAttribute?.('data-qnum');
        if (attr && !isNaN(Number(attr))) { sectionCurrentNumRef.current = Number(attr); break; }
        cur = cur.parentElement as HTMLElement | null;
      }
    };
    container.addEventListener('focusin', onFocusIn as any);
    return () => container.removeEventListener('focusin', onFocusIn as any);
  }, []);

  useEffect(() => {
  const section = currentSection;
  if (!section) return;
  const targetQuestion = visibleQuestions[currentQuestionIndex];
    if (!targetQuestion) return;
    const container = rightScrollRef.current;
    if (!container) return;
    // For matching questions (handled on left), scroll to top of headings list.
    if (targetQuestion.questionType === 'matching') {
      container.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    const el = questionRefs.current[targetQuestion.id];
    if (el) {
      const offsetTop = el.offsetTop - 8; // small padding adjustment
      container.scrollTo({ top: offsetTop, behavior: 'smooth' });
      // Focus first interactive control inside question after scroll
      setTimeout(() => {
        try {
          const first = el.querySelector('input, select, textarea') as HTMLElement | null;
          first?.focus?.();
        } catch {}
      }, 140);
    }
  }, [currentQuestionIndex, currentSectionIndex, currentSection, visibleQuestions]);

  // Ensure currentQuestionIndex stays in range when section or filters change
  useEffect(() => {
    const activeLength = isListeningSection ? (listeningPartQuestions.length) : (visibleQuestions.length);
    if (currentQuestionIndex > activeLength - 1) {
      setCurrentQuestionIndex(activeLength ? activeLength - 1 : 0);
    }
  }, [isListeningSection, listeningPartQuestions, visibleQuestions, currentQuestionIndex]);

  const examSectionsLength = exam?.sections?.length || 0;
  const notFound = !exam && !examLoading;
  // Dedicated Listening layout (overrides default two-pane UI)
  // Centralized exam-level listening audio (single player & optional single-play enforcement)
  // Listening audio control (single, unstoppable playback)
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const listeningScrollRef = useRef<HTMLDivElement | null>(null);
  // Keep listening current number in sync with focus and index
  useEffect(() => {
    const container = listeningScrollRef.current as HTMLElement | null;
    if (!container) return;
    const onFocusIn = (e: Event) => {
      const el = e.target as HTMLElement;
      let cur: HTMLElement | null = el;
      while (cur && cur !== container) {
        const attr = cur.getAttribute?.('data-qnum');
        if (attr && !isNaN(Number(attr))) { listeningCurrentNumRef.current = Number(attr); break; }
        cur = cur.parentElement as HTMLElement | null;
      }
    };
    container.addEventListener('focusin', onFocusIn as any);
    return () => container.removeEventListener('focusin', onFocusIn as any);
  }, []);
  // Track active number in listening layout
  const listeningCurrentNumRef = useRef<number | null>(null);
  const [audioStarted, setAudioStarted] = useState(false);
  const [audioEnded, setAudioEnded] = useState(false);
  const [autoplayBlocked, setAutoplayBlocked] = useState(false);
  const [isAudioPlaying, setIsAudioPlaying] = useState(false);
  const [audioVolume, setAudioVolume] = useState<number>(() => {
    const v = Number(localStorage.getItem('listeningVolume') || '1');
    return isNaN(v) ? 1 : Math.min(1, Math.max(0, v));
  });
  const examAudioUrl = exam?.audioUrl;

  // Enforce single auto-play (no pause/seek/replay) for listening sections
  useEffect(() => {
    if (!isListeningSection || !examAudioUrl) return;
    const el = audioRef.current;
    if (!el) return;
    const onPlay = () => { setAudioStarted(true); setIsAudioPlaying(true); };
    const onPause = () => { // Immediately resume if user attempts to pause before end
      if (el.ended) { setIsAudioPlaying(false); return; }
      // Resume shortly to avoid rapid pause/play loop
      setTimeout(() => { el.play().catch(() => {}); }, 30);
    };
    const onEnded = () => { setIsAudioPlaying(false); setAudioEnded(true); };
    el.addEventListener('play', onPlay);
    el.addEventListener('pause', onPause);
    el.addEventListener('ended', onEnded);
    try { el.volume = audioVolume; } catch {}
    // Attempt autoplay
    el.play().then(() => setAutoplayBlocked(false)).catch(() => setAutoplayBlocked(true));
    return () => {
      el.removeEventListener('play', onPlay);
      el.removeEventListener('pause', onPause);
      el.removeEventListener('ended', onEnded);
    };
  }, [isListeningSection, examAudioUrl, audioVolume]);

  // Persist volume and apply to element
  useEffect(() => {
    localStorage.setItem('listeningVolume', String(audioVolume));
    const el = audioRef.current; if (el) { try { el.volume = audioVolume; } catch {} }
  }, [audioVolume]);
  // When changing question index in listening layout, scroll/focus that number and set ref
  useEffect(() => {
    if (!isListeningSection) return;
    // If a control inside the listening pane currently has a data-qnum in its ancestry, don't overwrite the manual/current focus number.
    const container = listeningScrollRef.current as HTMLElement | null;
    if (container) {
      const focused = container.querySelector(':focus') as HTMLElement | null;
      let cur: HTMLElement | null = focused;
      while (cur && cur !== container) {
        const attr = cur.getAttribute?.('data-qnum');
        if (attr && !isNaN(Number(attr))) return; // keep focused qnum as current
        cur = cur.parentElement as HTMLElement | null;
      }
    }
    const num = listeningPartQuestions[currentQuestionIndex]?.questionNumber as number | undefined;
    if (num !== undefined) {
      listeningCurrentNumRef.current = num;
      scrollAndFocusByQnum(num, listeningScrollRef.current);
    }
  }, [isListeningSection, listeningPartQuestions, currentQuestionIndex]);
  // For non-listening, sync ref to selected question number
  useEffect(() => {
    if (isListeningSection) return;
    const container = rightScrollRef.current as HTMLElement | null;
    // If a control inside the right pane currently has a data-qnum in its ancestry, don't overwrite the manual/current focus number.
    if (container) {
      const focused = container.querySelector(':focus') as HTMLElement | null;
      let cur: HTMLElement | null = focused;
      while (cur && cur !== container) {
        const attr = cur.getAttribute?.('data-qnum');
        if (attr && !isNaN(Number(attr))) return; // keep the focused qnum
        cur = cur.parentElement as HTMLElement | null;
      }
    }
    const num = visibleQuestions[currentQuestionIndex]?.questionNumber as number | undefined;
    if (num !== undefined) sectionCurrentNumRef.current = num;
  }, [isListeningSection, visibleQuestions, currentQuestionIndex]);

  if (isListeningSection) {
    return (
      <div className={(darkMode ? 'dark ' : '') + "h-screen flex flex-col overflow-hidden select-text " + (darkMode ? 'bg-gray-900 text-gray-100' : 'bg-gray-50 text-gray-900')}>
        {/* Top header mimicking IELTS listening part banner */}
        <div className={(darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white') + " border-b px-4 py-3 flex items-center justify-between shadow-sm"}>
          <div className="flex flex-col">
            <span className={"text-xs font-medium " + secondaryTextClass}>Test taker ID</span>
            <h1 className={"text-sm font-semibold " + primaryTextClass}>{exam?.title || 'Listening Test'}</h1>
          </div>
          <div className="flex items-center gap-4">
            {examAudioUrl && (
              <div className="flex items-center text-xs font-medium gap-2">
                {!audioStarted && !autoplayBlocked && (
                  <>
                    <span className={"inline-block w-2 h-2 rounded-full animate-pulse " + (darkMode ? 'bg-amber-400' : 'bg-amber-600')} />
                    <span className={secondaryTextClass}>Loading audio…</span>
                  </>
                )}
                {autoplayBlocked && !audioStarted && (
                  <button
                    type="button"
                    onClick={() => {
                      const el = audioRef.current; if (!el || audioEnded) return; el.play().then(()=> setAutoplayBlocked(false)).catch(()=>{});
                    }}
                    className="px-2 py-1 rounded bg-blue-600 text-white hover:bg-blue-700"
                  >Start Audio</button>
                )}
                {isAudioPlaying && (
                  <>
                    <span className={"inline-block w-2 h-2 rounded-full animate-pulse " + (darkMode ? 'bg-green-400' : 'bg-green-600')} />
                    <span className={secondaryTextClass}>Audio playing</span>
                  </>
                )}
                {/* Volume */}
                <div className="flex items-center gap-1 ml-2">
                  <span className={"text-[11px] " + (darkMode ? 'text-gray-400' : 'text-gray-500')}>Vol</span>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={audioVolume}
                    onChange={(e)=> setAudioVolume(Number(e.target.value))}
                    className="w-24 accent-blue-600"
                    title={`Volume: ${Math.round(audioVolume*100)}%`}
                  />
                </div>
                {audioEnded && (
                  <>
                    <span className={"inline-block w-2 h-2 rounded-full " + (darkMode ? 'bg-gray-500' : 'bg-gray-500')} />
                    <span className={secondaryTextClass}>Audio finished</span>
                  </>
                )}
              </div>
            )}
            <button onClick={() => setShowSettings(s => !s)} className={(showSettings ? 'ring-2 ring-blue-500 ' : '') + "px-3 py-2 rounded text-sm border transition-colors " + (darkMode ? 'border-gray-600 bg-gray-700 hover:bg-gray-600 text-gray-100' : 'border-gray-300 bg-white hover:bg-gray-100 text-gray-700')}>Settings</button>
            {/* Per-section timer (Listening) */}
            <Timer key={`timer-${timerKey}`} darkMode={darkMode} duration={sectionTimerDuration || 30} onTimeUp={handleTimeUp} isPaused={isPaused} />
            <button onClick={() => setShowConfirmSubmit(true)} className="px-3 py-2 text-xs bg-red-600 text-white rounded hover:bg-red-700">Submit</button>
          </div>
        </div>
        {showSettings && (
          <div className={(darkMode ? 'bg-gray-800/95 backdrop-blur border-gray-700 text-gray-200' : 'bg-white/95 backdrop-blur') + " border-b px-4 py-4 text-sm"}>
            <div className="flex flex-wrap gap-6 items-start">
              <div className="flex flex-col w-40">
                <label className="text-[11px] uppercase tracking-wide font-semibold opacity-70 mb-1">Font Size</label>
                <input type="range" min={14} max={24} value={prefFontSize} onChange={(e)=> setPrefFontSize(Number(e.target.value))} className="w-full accent-purple-600" />
                <div className="mt-1 text-xs font-mono">{prefFontSize}px</div>
              </div>
              <div className="flex flex-col w-48">
                <label className="text-[11px] uppercase tracking-wide font-semibold opacity-70 mb-1">Font Family</label>
                <select value={prefFontFamily} onChange={(e)=> setPrefFontFamily(e.target.value)} className={"border rounded px-2 py-2 text-sm focus:ring-2 focus:ring-blue-500 " + (darkMode ? 'bg-gray-900 border-gray-600 text-gray-100' : 'bg-white border-gray-300 text-gray-800')}>
                  <option value="serif">Serif (IELTS style)</option>
                  <option value="sans">Sans</option>
                  <option value="mono">Mono</option>
                </select>
              </div>
              <div className="flex flex-col w-32">
                <label className="text-[11px] uppercase tracking-wide font-semibold opacity-70 mb-2">Theme</label>
                <button
                  onClick={()=> setDarkMode(d => !d)}
                  className={"relative inline-flex items-center h-8 px-3 rounded border text-xs font-medium transition-colors " + (darkMode ? 'bg-gray-900 border-gray-600 text-gray-100 hover:bg-gray-700' : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-100')}
                >{darkMode ? 'Dark Mode' : 'Light Mode'}</button>
              </div>
              <div className="flex flex-col gap-2">
                <label className="text-[11px] uppercase tracking-wide font-semibold opacity-70 mb-1">Quick</label>
                <div className="flex gap-2">
                  <button onClick={()=> { setPrefFontSize(16); setPrefFontFamily('serif'); }} className="px-3 py-1.5 text-xs rounded border border-blue-500 text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/30">IELTS Default</button>
                  <button onClick={()=> { setPrefFontSize(18); setPrefFontFamily('sans'); }} className="px-3 py-1.5 text-xs rounded border border-gray-400 hover:bg-gray-50 dark:border-gray-600 dark:hover:bg-gray-700/50">Readable</button>
                  <button onClick={()=> { setPrefFontSize(16); setPrefFontFamily('serif'); setDarkMode(false); }} className="px-3 py-1.5 text-xs rounded border border-red-500 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/30">Reset</button>
                </div>
              </div>
            </div>
          </div>
        )}
        {/* Part banner */}
        <div className={(darkMode ? 'bg-gray-1000' : 'bg-gray-100') + ' border-b px-4 py-2 text-sm'}>
          <span className="font-semibold">Part {effectiveListeningPart}</span>
          {multiSectionListening ? (
            <span className="ml-4">Listen and answer the questions for this part.</span>
          ) : (
            <span className="ml-4">Listen and answer questions {(effectiveListeningPart -1)*10 + 1}–{(effectiveListeningPart -1)*10 + listeningPartQuestions.length}.</span>
          )}
        </div>
        {/* Audio player sticky */}
        {examAudioUrl && (
          <div className={(darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200') + ' border-b px-4 py-3'}>
            {(() => {
              const apiFull = (import.meta.env.VITE_API_URL || 'http://localhost:7000/api');
              const apiOrigin = apiFull.replace(/\/?api\/?$/, '');
              const resolvedSrc = examAudioUrl?.startsWith('http') ? examAudioUrl : (examAudioUrl ? `${apiOrigin}${examAudioUrl}` : undefined);
              return (
                <audio
                  ref={audioRef}
                  preload="auto"
                  src={resolvedSrc}
                  style={{ display: 'none' }}
                  onLoadedMetadata={(e) => {
                    if (e.currentTarget.duration === Infinity || isNaN(e.currentTarget.duration)) {
                      try { e.currentTarget.currentTime = 1; e.currentTarget.currentTime = 0; } catch {}
                    }
                  }}
                  onError={(e) => {
                    const el = e.currentTarget;
                    const container = el.parentElement;
                    if (container && !container.querySelector('.audio-error-msg')) {
                      const div = document.createElement('div');
                      div.className = 'audio-error-msg mt-1 text-[11px] text-red-600';
                      div.textContent = 'Audio failed to load. Check URL or network.';
                      container.appendChild(div);
                    }
                  }}
                />
              );
            })()}
            <div className="mt-1 text-[11px] text-gray-500">
              {audioEnded ? 'Audio playback complete. Continue answering until time expires.' : 'Audio will play once and cannot be paused or replayed.'}
              {autoplayBlocked && !audioStarted && ' (Click Start Audio above to begin)'}
            </div>
          </div>
        )}
  {/* Questions area */}
  <div ref={listeningScrollRef} className="flex-1 overflow-auto px-4 py-4 space-y-10">
      {/* Listening per-block instructions: inject BEFORE each question whose groupInstruction starts a new block.
        For fill_blank we always show when present (these are the problematic ones like Questions 19–20).
        We intentionally replaced the previous single-part instruction banner. */}
          {/* (Removed legacy single-part instruction banner; per-question banners handled inside listeningGroups mapping) */}
          {(() => {
            if (!(multiSectionListening && listeningPartQuestions.length === 0)) return null;
              const partNum = effectiveListeningPart;
            const hasTableInPart = (exam?.sections || []).some((sec:any) => (sec.questions||[]).some((q:any) => {
              if (q.questionType !== 'simple_table') return false;
              let meta:any = q.metadata; if (meta && typeof meta === 'string') { try { meta = JSON.parse(meta); } catch { meta = {}; } }
              const rows:any[][] = meta?.simpleTable?.rows || [];
              let firstNum = Number(meta?.simpleTable?.sequenceStart);
              if (!firstNum || isNaN(firstNum)) {
                const nums:number[] = [];
                rows.forEach((row:any[]) => row.forEach((cell:any) => { if (cell?.type==='question' && typeof cell.questionNumber==='number') nums.push(cell.questionNumber); }));
                if (nums.length) firstNum = Math.min(...nums);
              }
              const explicitPart = Number(meta?.listeningPart);
              const inferredPart = firstNum ? Math.ceil(firstNum / 10) : (q.questionNumber ? Math.ceil(q.questionNumber/10) : undefined);
              const part = explicitPart || inferredPart;
              return part === partNum;
            }));
            if (hasTableInPart) return null;
            return <div className="text-sm text-gray-500 italic">No questions have been added for this listening part yet.</div>;
          })()}
          {/* Simple Tables (listening layout) - moved to render AFTER related fill_blank questions so that for sequences like Q21, Q22 the table shows once at the end */}
          {/* We'll collect simple tables now and defer rendering until after note-completion groups below. */}
          {/* (Rendering moved to bottom of questions list) */}
          {/* Drag & Drop groups (rows layout) */}
          {(() => {
            const dragGroups = (currentSection?.questions || []).filter((q:any)=> q.questionType==='drag_drop' && !q.metadata?.groupMemberOf);
            return dragGroups.sort((a:any,b:any)=> (a.questionNumber||0)-(b.questionNumber||0)).map((anchor:any)=> {
              const layout = anchor.metadata?.layout || 'rows';
              const members = (currentSection?.questions||[]).filter((m:any)=> m.questionType==='drag_drop' && m.metadata?.groupMemberOf === anchor.id).sort((a:any,b:any)=> (a.questionNumber||0)-(b.questionNumber||0));
              const options = (anchor.options||[]).map((o:any,i:number)=> ({ letter: o.option_letter||o.letter||String.fromCharCode(65+i), text: o.option_text||o.text||'' }));
              if (layout === 'map') {
                // Map label layout
                const img = anchor.metadata?.mapImageUrl;
                return (
                  <div key={anchor.id} className="space-y-4">
                    <div className="text-sm font-semibold whitespace-pre-wrap">{normalizeNewlines(anchor.questionText) || `Questions ${members[0]?.questionNumber || ''}–${members[members.length-1]?.questionNumber || ''}`}</div>
                    <div className="flex flex-col md:flex-row gap-8">
                      <div className="relative border rounded p-2 bg-white max-w-xl overflow-hidden">
                        {img ? <img src={img} alt="Map" className="max-w-full h-auto select-none pointer-events-none" /> : <div className="text-xs text-gray-500 p-4">No map image provided.</div>}
                        {members.map((m:any) => {
                          const val = (answers[m.id]?.answer as string) || '';
                          const x = m.metadata?.x ?? 10; const y = m.metadata?.y ?? 10;
                          return (
                            <div key={m.id} style={{ left: x + '%', top: y + '%', transform: 'translate(-50%, -50%)' }} className="absolute">
                              <div className={(darkMode ? 'border-gray-600 bg-gray-900' : 'border-gray-400 bg-white') + ' px-2 py-1 rounded border shadow-sm'}>
                                <span className="mr-1 font-semibold text-[11px]">{m.questionNumber}</span>
                                <input
                                  value={val}
                                  onChange={(e)=> handleAnswerChange(m.id, e.target.value)}
                                  className={(darkMode ? 'bg-gray-800 border-gray-600 text-gray-100' : 'bg-white border-gray-300 text-gray-900') + ' border rounded px-1 py-0.5 text-[12px] w-20'}
                                />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                      <div className="flex flex-col gap-2">
                        {options.map((opt: any) => (
                          <button
                            type="button"
                            key={opt.letter}
                            onClick={() => {
                              // focus next empty blank
                              const target = members.find((m:any)=> !(answers[m.id]?.answer));
                              if (target) handleAnswerChange(target.id, opt.text || opt.letter);
                            }}
                            className={(darkMode ? 'bg-gray-800 border-gray-600 text-gray-100 hover:bg-gray-700' : 'bg-white border-gray-300 hover:bg-gray-50 text-gray-700') + ' px-3 py-1.5 rounded border text-sm text-left'}
                          >{opt.text || opt.letter}</button>
                        ))}
                      </div>
                    </div>
                  </div>
                );
              }
              // rows layout (two-column people/answers style)
              return (
                <div key={anchor.id} className="space-y-4">
                  <div className="text-sm font-semibold whitespace-pre-wrap">{normalizeNewlines(anchor.questionText) || `Questions ${members[0]?.questionNumber || ''}–${members[members.length-1]?.questionNumber || ''}`}</div>
                  <div className="flex flex-col md:flex-row gap-10">
                    <div className="flex-1 space-y-3">
                      {members.map((m:any) => {
                        const val = (answers[m.id]?.answer as string) || '';
                        return (
                          <div key={m.id} className="flex items-center gap-3 text-sm">
                            <span className={(darkMode ? 'bg-gray-800 text-gray-100 border-gray-600' : 'bg-white text-gray-900 border-gray-300') + ' inline-flex items-center justify-center font-semibold rounded border px-2 h-8 text-[13px]'}>{m.questionNumber}</span>
                            <span className="w-48 max-w-[50%] truncate" title={normalizeNewlines(m.questionText)}>{normalizeNewlines(m.questionText)}</span>
                            <input
                              type="text"
                              value={val}
                              onChange={(e)=> handleAnswerChange(m.id, e.target.value)}
                              className={(darkMode ? 'bg-gray-900 border-gray-600 text-gray-100' : 'bg-white border-gray-400 text-gray-900') + ' px-2 py-1 rounded border text-center text-sm font-medium tracking-wide min-w-[120px]'}
                            />
                          </div>
                        );
                      })}
                    </div>
                    <div className="w-56 flex flex-col gap-2">
                      <div className="font-semibold text-sm">{anchor.metadata?.choicesTitle || 'Options'}</div>
                      {options.map((opt: any) => (
                        <button
                          key={opt.letter}
                          type="button"
                          onClick={() => {
                            const target = members.find((m:any)=> !(answers[m.id]?.answer));
                            if (target) handleAnswerChange(target.id, opt.text || opt.letter);
                          }}
                          className={(darkMode ? 'bg-gray-800 border-gray-600 text-gray-100 hover:bg-gray-700' : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50') + ' px-3 py-1.5 rounded border text-sm text-left'}
                        >{opt.text || opt.letter}</button>
                      ))}
                    </div>
                  </div>
                </div>
              );
            });
          })()}

          {/* Ordered listening flow: merge questions and simple tables by question number */}
          {(() => {
            // Build flow items with an order index = questionNumber (or first table number)
            const questions = [...listeningPartQuestions];
            // Only include simple_table blocks that belong to the current listening part
            const simpleTables = (currentSection?.questions || []).filter((q:any)=> q.questionType==='simple_table').filter((q:any) => {
              try {
                let meta:any = q.metadata; if (meta && typeof meta === 'string') { try { meta = JSON.parse(meta); } catch { meta = {}; } }
                const rows:any[][] = meta?.simpleTable?.rows || [];
                let firstNum = Number(meta?.simpleTable?.sequenceStart);
                if (!firstNum || isNaN(firstNum)) {
                  const nums:number[] = [];
                  rows.forEach((row:any[]) => row.forEach((cell:any) => { if (cell?.type==='question' && typeof cell.questionNumber==='number') nums.push(cell.questionNumber); }));
                  if (nums.length) firstNum = Math.min(...nums);
                }
                const explicitPart = Number(meta?.listeningPart);
                const inferredPart = firstNum ? Math.ceil(firstNum / 10) : undefined;
                const part = explicitPart || inferredPart;
                // If we can't infer, hide by default in other parts to avoid duplicates
                return part ? (part === effectiveListeningPart) : false;
              } catch { return false; }
            });
            const tableItems = simpleTables.map((q:any) => {
              let meta:any = q.metadata; if (meta && typeof meta === 'string') { try { meta = JSON.parse(meta); } catch { meta = {}; } }
              const rows:any[][] = meta?.simpleTable?.rows || [];
              let firstNum = Number(meta?.simpleTable?.sequenceStart);
              if (!firstNum || isNaN(firstNum)) {
                const nums:number[] = [];
                rows.forEach((row:any[]) => row.forEach((cell:any) => { if (cell?.type==='question' && typeof cell.questionNumber==='number') nums.push(cell.questionNumber); }));
                if (nums.length) firstNum = Math.min(...nums); else firstNum = Number.MAX_SAFE_INTEGER;
              }
              return { type:'simple_table' as const, order:firstNum, q, meta, rows };
            });
            const flow = [
              ...questions.map(q => ({ type:'question' as const, order: q.questionNumber || 0, q })),
              ...tableItems
            ].sort((a,b)=> a.order - b.order);
            let lastGI: string | undefined;
            return flow.map((item) => {
              if (item.type === 'simple_table') {
                const q = item.q; const meta = item.meta; const rows:any[][] = item.rows; const seqStart:number|undefined = meta?.simpleTable?.sequenceStart;
                let derivedCounter = seqStart || 0;
                if (!rows.length) return null;
                return (
                  <div key={`table-${q.id}`} className="space-y-3 border-t mt-8 pt-6 border-dashed border-gray-300 dark:border-gray-700">
                    {q.questionText && <div className="font-semibold text-sm whitespace-pre-wrap leading-snug">{normalizeNewlines(q.questionText)}</div>}
                    <div className="overflow-auto">
                      <table className={'text-sm min-w-[480px] border ' + (darkMode ? 'border-gray-600' : 'border-gray-300')}>
                        <tbody>
                          {rows.map((row, ri) => (
                            <tr key={ri} className={darkMode ? 'border-b border-gray-700 last:border-b-0' : 'border-b border-gray-200 last:border-b-0'}>
                              {row.map((cell:any, ci:number) => {
                                const answerKey = `${q.id}_${ri}_${ci}`;
                                let displayNumber: number | undefined = cell?.questionNumber;
                                if (displayNumber === undefined && cell?.type==='question' && seqStart) {
                                  if (!cell.__numberAssigned) {
                                    displayNumber = derivedCounter;
                                    derivedCounter += 1;
                                    cell.__numberAssigned = displayNumber;
                                  } else displayNumber = cell.__numberAssigned;
                                }
                                const baseTd = (darkMode ? 'border-r border-gray-700' : 'border-r border-gray-200') + ' last:border-r-0 p-3 align-top';
                                if (cell?.type === 'text') {
                                  return <td key={ci} className={baseTd}><div className="whitespace-pre-wrap">{normalizeNewlines(cell?.content || '')}</div></td>;
                                }
                                if (cell?.type === 'question') {
                                  const effectiveType = cell?.questionType || 'fill_blank';
                                  const isFill = effectiveType === 'fill_blank';
                                  const rawContent: string = normalizeNewlines(cell?.content || '');
                                  const inlinePatternGlobal = /_{3,}|\{answer\}/gi;
                                  const hasInlineBlank = isFill && inlinePatternGlobal.test(rawContent);
                                  inlinePatternGlobal.lastIndex = 0;
                                  const multiNumbers: number[] | undefined = cell.multiNumbers;
                                  return (
                                    <td key={ci} className={baseTd}>
                                      <div className="space-y-2">
                                        {!hasInlineBlank && rawContent && <div className="text-sm font-medium whitespace-pre-wrap">{rawContent}</div>}
                    {isFill && hasInlineBlank && (() => {
                                          const parts: React.ReactNode[] = [];
                                          let lastIndex = 0;
                                          const matches = [...rawContent.matchAll(inlinePatternGlobal)];
                                          matches.forEach((m, i) => {
                                            const i0 = m.index || 0;
                                            if (i0 > lastIndex) parts.push(rawContent.slice(lastIndex, i0));
                      const num = multiNumbers ? multiNumbers[i] : (displayNumber !== undefined ? (displayNumber + i) : undefined);
                                            const key = `${answerKey}_b${i}`;
                                            const val = (answers[key]?.answer as string) || '';
                                            parts.push(
                                              <span key={key} className="relative inline-flex align-middle mx-1">
                                                <input
                                                  type="text"
                                                  value={val}
                                                  onChange={(e)=> handleAnswerChange(key, e.target.value)}
                          className={'px-2 py-1 rounded border focus:ring-2 text-center font-medium tracking-wide min-w-[70px] ' + (darkMode ? 'bg-gray-700 text-white border-gray-600 focus:ring-blue-500' : 'bg-white text-gray-900 border-gray-300 focus:ring-blue-300')}
                          data-qnum={num !== undefined ? num : undefined}
                                                />
                                                {!val && num !== undefined && (
                                                  <span className={'pointer-events-none absolute inset-0 flex items-center justify-center text:[11px] font-semibold select-none ' + (darkMode ? 'text-gray-500' : 'text-gray-600')}>{num}</span>
                                                )}
                                              </span>
                                            );
                                            lastIndex = i0 + m[0].length;
                                          });
                                          if (lastIndex < rawContent.length) parts.push(rawContent.slice(lastIndex));
                                          return <div className="text-sm font-medium whitespace-pre-wrap leading-relaxed">{parts}</div>;
                                        })()}
                                        {isFill && !hasInlineBlank && (
                                          <span className="relative inline-flex w-full">
                                            <input
                                              type="text"
                                              value={(answers[answerKey]?.answer as string) || ''}
                                              onChange={(e)=> handleAnswerChange(answerKey, e.target.value)}
                        className={'w-full px-2 py-1 rounded border focus:ring-2 text-center font-medium tracking-wide ' + (darkMode ? 'bg-gray-700 text-white border-gray-600 focus:ring-blue-500' : 'bg-white text-gray-900 border-gray-300 focus:ring-blue-300')}
                        data-qnum={displayNumber !== undefined ? displayNumber : undefined}
                                            />
                                            {!(answers[answerKey]?.answer) && displayNumber !== undefined && (
                                              <span className={'pointer-events-none absolute inset-0 flex items-center justify-center text-[12px] font-semibold select-none ' + (darkMode ? 'text-gray-500' : 'text-gray-600')}>{displayNumber}</span>
                                            )}
                                          </span>
                                        )}
                                        {!isFill && effectiveType === 'multiple_choice' && (
                                          <div className="space-y-1">
                                            {(() => {
                                              const parts = (cell.content || '').split(/[A-D]\)/).slice(1);
                                              return parts.map((option: string, oi: number) => {
                                                const letter = String.fromCharCode(65 + oi);
                                                const selected = (answers[answerKey]?.answer as string) === letter;
                                                return (
                                                  <label
                                                    key={letter}
                                                    className={`flex items-start gap-2 cursor-pointer rounded px-2 py-1 border transition-colors ${selected ? (darkMode ? 'bg-blue-700 border-blue-600 text-white' : 'bg-gray-200 border-gray-300') : (darkMode ? 'border-gray-600 hover:bg-gray-700' : 'border-transparent hover:bg-gray-100')}`}
                                                    onClick={() => handleAnswerChange(answerKey, letter)}
                                                  >
                                                    <input
                                                      type="radio"
                                                      className={'mt-1 ' + (darkMode ? 'accent-blue-500' : '')}
                                                      name={`question-${answerKey}`}
                                                      value={letter}
                                                      checked={selected}
                                                      onChange={() => handleAnswerChange(answerKey, letter)}
                                                      data-qnum={displayNumber !== undefined ? displayNumber : undefined}
                                                    />
                                                    <span className={'text-sm select-none ' + (darkMode ? 'text-gray-100' : 'text-gray-900')}>
                                                      {letter}) {option.trim()}
                                                    </span>
                                                  </label>
                                                );
                                              });
                                            })()}
                                          </div>
                                        )}
                                        {!isFill && effectiveType === 'true_false' && (
                                          <div className="flex gap-2">
                                            {['True', 'False', 'Not Given'].map((val) => {
                                              const selected = (answers[answerKey]?.answer as string) === val;
                                              return (
                                                <button
                                                  key={val}
                                                  onClick={() => handleAnswerChange(answerKey, val)}
                                                  className={`px-2 py-1 rounded border text-xs ${selected ? 'bg-blue-600 text-white border-blue-600' : (darkMode ? 'border-gray-600 text-gray-300 hover:bg-gray-700' : 'border-gray-300 text-gray-700 hover:bg-gray-50')}`}
                                                  data-qnum={displayNumber !== undefined ? displayNumber : undefined}
                                                >{val}</button>
                                              );
                                            })}
                                          </div>
                                        )}
                                      </div>
                                    </td>
                                  );
                                }
                                return <td key={ci} className={baseTd}><div className="text-gray-500 italic">?</div></td>;
                              })}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div className="text-xs text-gray-500">Answer directly in the table.</div>
                  </div>
                );
              }
              // Question item rendering (reusing previous logic)
              const q:any = (item as any).q;
              if (q && q.metadata && typeof q.metadata === 'string') { try { q.metadata = JSON.parse(q.metadata); } catch {/* ignore */} }
              let instructionNode: React.ReactNode = null;
              const giText: string | undefined = q?.metadata?.groupInstruction;
              if (giText && giText !== lastGI) {
                instructionNode = (
                  <div className={"mb-2 text-sm font-semibold rounded p-3 whitespace-pre-wrap leading-snug tracking-normal " + warningPanel}>
                    {normalizeNewlines(giText)}
                  </div>
                );
                lastGI = giText;
              }
              const qNum = q.questionNumber || '';
              const prefix = q.metadata?.notePrefix || '';
              const suffix = q.metadata?.noteSuffix || '';
              const type = q.questionType;
              return (
                <React.Fragment key={q.id}>
                  {instructionNode}
                  {(() => {
                // Multiple Choice (single or multi-select) rendering
                if (type === 'multiple_choice') {
                  const allowMulti = !!q.metadata?.allowMultiSelect;
                  const selectCount = Number(q.metadata?.selectCount) || 2;
                  const current = answers[q.id]?.answer as any;
                  const selectedLetters: string[] = allowMulti ? (Array.isArray(current) ? current : (typeof current === 'string' && current ? current.split('|') : [])) : ([]);
                  // Detect dropdown mode from various metadata aliases
                  const metaAny: any = q.metadata || {};
                  const dropdownRaw = metaAny?.displayMode ?? metaAny?.display_mode ?? metaAny?.renderMode ?? metaAny?.dropdown ?? q.displayMode ?? q.renderMode ?? (typeof q.dropdown !== 'undefined' ? q.dropdown : undefined);
                  const dropdownMode = (!allowMulti) && (dropdownRaw === true
                    || dropdownRaw === 'dropdown'
                    || dropdownRaw === 'Dropdown'
                    || (typeof dropdownRaw === 'string' && dropdownRaw.toLowerCase() === 'dropdown')
                    || (typeof dropdownRaw === 'string' && dropdownRaw.toLowerCase() === 'true'));
                  return (
                    <div key={q.id} className="text-sm flex flex-col gap-2">
                      <div className="flex items-start gap-2 flex-wrap">
                        <span data-qnum={qNum} className={(darkMode ? 'bg-gray-800 text-gray-100 border-gray-600' : 'bg-white text-gray-900 border-gray-300') + ' w-8 h-8 inline-flex items-center justify-center font-semibold rounded border text-[13px]'}>{qNum}</span>
                        <div className="flex-1 min-w-[260px] font-medium leading-snug">
                          {normalizeNewlines(q.questionText) || (prefix || suffix ? `${prefix} ____ ${suffix}` : '')}
                        </div>
                      </div>
                      <div className="ml-10 flex flex-col gap-1">
                        {allowMulti ? (
                          (q.options || []).map((opt: any, idx: number) => {
                            const letter = opt.option_letter || opt.letter || String.fromCharCode(65 + idx);
                            const label = opt.option_text || opt.text || '';
                            const checked = selectedLetters.includes(letter);
                            return (
                              <label
                                key={letter}
                                className={`flex items-start gap-2 text-sm px-3 py-2 border rounded cursor-pointer select-none transition-colors ${checked ? (darkMode ? 'bg-blue-700 border-blue-600 text-white' : 'bg-blue-100 border-blue-300') : (darkMode ? 'bg-gray-800 border-gray-600 hover:bg-gray-700' : 'bg-white border-gray-300 hover:bg-gray-50')}`}
                                onClick={() => {
                                  let next = [...selectedLetters];
                                  if (checked) next = next.filter(l => l !== letter);
                                  else if (next.length < selectCount) next.push(letter);
                                  else next[next.length - 1] = letter; // replace last
                                  handleAnswerChange(q.id, next);
                                }}
                              >
                                <input type="checkbox" className={'mt-1 ' + (darkMode ? 'accent-blue-500':'')} checked={checked} readOnly />
                                <span className="flex-1">{letter}. {label}</span>
                              </label>
                            );
                          })
                        ) : dropdownMode ? (
                          <div className="flex items-center gap-2">
                            <select
                              className={`text-sm px-3 py-2 rounded border w-full ${darkMode ? 'bg-gray-800 border-gray-600 text-gray-100' : 'bg-white border-gray-300 text-gray-900'} focus:outline-none focus:ring-2 focus:ring-blue-500`}
                              value={typeof answers[q.id]?.answer === 'string' ? (answers[q.id]?.answer as string) : ''}
                              onChange={(e) => handleAnswerChange(q.id, e.target.value)}
                            >
                              <option value="">-- Select --</option>
                              {(q.options || []).map((opt: any, idx: number) => {
                                const letter = (opt.option_letter || opt.letter || '').toString().trim() || String.fromCharCode(65 + idx);
                                const label = opt.option_text || opt.text || '';
                                return (
                                  <option key={opt.id || `${q.id}_${idx}`} value={letter}>{letter}) {label || `Option ${letter}`}</option>
                                );
                              })}
                            </select>
                          </div>
                        ) : (
                          (q.options || []).map((opt: any, idx: number) => {
                            const letter = opt.option_letter || opt.letter || String.fromCharCode(65 + idx);
                            const label = opt.option_text || opt.text || '';
                            const selected = (answers[q.id]?.answer as string) === letter;
                            return (
                              <label
                                key={letter}
                                className={`flex items-start gap-2 cursor-pointer rounded px-3 py-2 border transition-colors ${selected ? (darkMode ? 'bg-blue-700 border-blue-600 text-white' : 'bg-gray-200 border-gray-300') : (darkMode ? 'border-gray-600 hover:bg-gray-700' : 'border-transparent hover:bg-gray-100')}`}
                                onClick={() => handleAnswerChange(q.id, letter)}
                              >
                                <input
                                  type="radio"
                                  className={'mt-1 ' + (darkMode ? 'accent-blue-500' : '')}
                                  value={letter}
                                  checked={selected}
                                  onChange={() => handleAnswerChange(q.id, letter)}
                                />
                                <span className={'text-sm select-none ' + (darkMode ? 'text-gray-100':'text-gray-900')}>{letter}) {label}</span>
                              </label>
                            );
                          })
                        )}
                        {allowMulti && <div className={'text-[10px] mt-1 ' + (darkMode ? 'text-gray-400' : 'text-gray-500')}>Select {selectCount} answers.</div>}
                      </div>
                    </div>
                  );
                }
                // Multi-select (choose TWO) distinct type
                if (type === 'multi_select') {
                  const current = Array.isArray(answers[q.id]?.answer) ? (answers[q.id]?.answer as string[]) : [];
                  return (
                    <div key={q.id} className="text-sm flex flex-col gap-2">
                      <div className="flex items-start gap-2 flex-wrap">
                        <span data-qnum={qNum} className={(darkMode ? 'bg-gray-800 text-gray-100 border-gray-600' : 'bg-white text-gray-900 border-gray-300') + ' w-8 h-8 inline-flex items-center justify-center font-semibold rounded border text-[13px]'}>{qNum}</span>
                        <div className="flex-1 min-w-[260px] font-medium leading-snug whitespace-pre-wrap">{normalizeNewlines(q.questionText)}</div>
                      </div>
                      <div className="ml-10 flex flex-col gap-1">
                        {(q.options || []).map((opt: any, idx: number) => {
                          const letter = opt.option_letter || opt.letter || String.fromCharCode(65 + idx);
                          const label = opt.option_text || opt.text || '';
                          const checked = current.includes(letter);
                          return (
                            <label
                              key={letter}
                              className={`flex items-start gap-2 text-sm px-3 py-2 border rounded cursor-pointer select-none ${checked ? (darkMode ? 'bg-blue-700 border-blue-600 text-white' : 'bg-blue-100 border-blue-300') : (darkMode ? 'bg-gray-800 border-gray-600 hover:bg-gray-700' : 'bg-white border-gray-300 hover:bg-gray-50')}`}
                              onClick={() => {
                                let next = [...current];
                                if (checked) next = next.filter(l => l !== letter); else if (next.length < 2) next.push(letter); else next = [next[0], letter];
                                handleAnswerChange(q.id, next);
                              }}
                            >
                              <input type="checkbox" className={'mt-1 ' + (darkMode ? 'accent-blue-500':'')} checked={checked} readOnly />
                              <span className="flex-1">{letter}. {label}</span>
                            </label>
                          );
                        })}
                        <div className={'text-[10px] mt-1 ' + (darkMode ? 'text-gray-400' : 'text-gray-500')}>Choose TWO answers.</div>
                      </div>
                    </div>
                  );
                }
                if (type === 'true_false') {
                  return (
                    <div key={q.id} className="text-sm flex flex-col gap-2">
                      <div className="flex items-start gap-2 flex-wrap">
                        <span data-qnum={qNum} className={(darkMode ? 'bg-gray-800 text-gray-100 border-gray-600' : 'bg-white text-gray-900 border-gray-300') + ' w-8 h-8 inline-flex items-center justify-center font-semibold rounded border text-[13px]'}>{qNum}</span>
                        <div className="flex-1 min-w-[260px] font-medium leading-snug whitespace-pre-wrap">{normalizeNewlines(q.questionText)}</div>
                      </div>
                      <div className="ml-10 flex gap-2 flex-wrap">
                        {['True','False','Not Given'].map(val => {
                          const selected = (answers[q.id]?.answer as string) === val;
                          return (
                            <button key={val} type="button" onClick={()=> handleAnswerChange(q.id, val)} className={`px-3 py-1.5 rounded border text-xs ${selected ? 'bg-blue-600 text-white border-blue-600' : (darkMode ? 'border-gray-600 text-gray-200 hover:bg-gray-700' : 'border-gray-300 text-gray-700 hover:bg-gray-50')}`}>{val}</button>
                          );
                        })}
                      </div>
                    </div>
                  );
                }
                // Default fill-in-the-blank / note completion
                const answerValues = getBlankValues(q.id);
                const rawQuestion = normalizeNewlines((q.questionText || '').trim());
                // Detect inline placeholder tokens in question text (___ or {answerX}) and bind each blank to its own state slot.
                let contentNode: React.ReactNode;
                if (rawQuestion) {
                  const tokenRegex = /(\{answer\d*\}|_{3,})/gi;
                  if (tokenRegex.test(rawQuestion)) {
                    const parts = rawQuestion.split(tokenRegex);
                    let blankIndex = 0;
                    contentNode = (
                      <span className="flex flex-wrap items-center gap-2">
                        {parts.map((p: string, i: number) => {
                          if (/^(\{answer\d*\}|_{3,})$/i.test(p)) {
                            const idxLocal = blankIndex;
                            const val = answerValues[idxLocal] || '';
                            let overlayNumber: number | undefined;
                            const overlayList = blankNumberMap[q.id];
                            if (overlayList && overlayList.length > idxLocal) {
                              const isMulti = overlayList.length > 1;
                              if (!((q.metadata?.singleNumber || q.metadata?.combineBlanks) && isMulti)) {
                                overlayNumber = overlayList[idxLocal];
                              }
                            }
                            blankIndex += 1;
                            return (
                              <span key={`blank-${q.id}-${idxLocal}`} className="relative inline-flex mx-1">
                                <input
                                  type="text"
                                  value={val}
                                  onChange={(e)=> handleAnswerChange(q.id, e.target.value, idxLocal)}
                                  className={'px-2 py-1 rounded border text-center text-sm font-medium tracking-wide min-w-[110px] ' + (darkMode ? 'bg-gray-900 border-gray-600 text-gray-100 focus:ring-2 focus:ring-blue-500' : 'bg-white border-gray-400 text-gray-900 focus:ring-2 focus:ring-blue-500')}
                                  data-qnum={overlayNumber !== undefined ? overlayNumber : undefined}
                                />
                                {!val && overlayNumber !== undefined && (
                                  <span className={'pointer-events-none absolute inset-0 flex items-center justify-center text-[12px] font-semibold ' + (darkMode ? 'text-gray-500':'text-gray-600')}>
                                    {overlayNumber}
                                  </span>
                                )}
                              </span>
                            );
                          }
                          return <span key={`txt-${q.id}-${i}`}>{p}</span>;
                        })}
                      </span>
                    );
                  } else {
                    contentNode = <span className="font-medium leading-snug whitespace-pre-wrap">{rawQuestion}</span>;
                  }
                } else if (prefix || suffix) {
                  const singleValue = answerValues[0] || '';
                  const overlayList = blankNumberMap[q.id];
                  const overlayNumber = overlayList && overlayList.length ? overlayList[0] : (typeof q.questionNumber === 'number' ? q.questionNumber : undefined);
                  contentNode = (
                    <span className="flex items-center gap-2">
                      {prefix && <span className={secondaryTextClass}>{prefix}</span>}
                      <span className="relative inline-flex">
                        <input
                          type="text"
                          value={singleValue}
                          onChange={(e) => handleAnswerChange(q.id, e.target.value, 0)}
                          className={'px-2 py-1 rounded border text-center text-sm font-medium tracking-wide min-w-[110px] ' + (darkMode ? 'bg-gray-900 border-gray-600 text-gray-100 focus:ring-2 focus:ring-blue-500' : 'bg-white border-gray-400 text-gray-900 focus:ring-2 focus:ring-blue-500')}
                          data-qnum={overlayNumber !== undefined ? overlayNumber : undefined}
                        />
                        {!singleValue && overlayNumber !== undefined && (
                          <span className={'pointer-events-none absolute inset-0 flex items-center justify-center text-[12px] font-semibold ' + (darkMode ? 'text-gray-500':'text-gray-600')}>
                            {overlayNumber}
                          </span>
                        )}
                      </span>
                      {suffix && <span className={secondaryTextClass}>{suffix}</span>}
                    </span>
                  );
                } else {
                  contentNode = null;
                }
                  return (
                  <div key={q.id} className="text-sm flex flex-col">
                    <div className="flex items-start gap-2 flex-wrap">
                      <span data-qnum={qNum} className={(darkMode ? 'bg-gray-800 text-gray-100 border-gray-600' : 'bg-white text-gray-900 border-gray-300') + ' w-8 h-8 inline-flex items-center justify-center font-semibold rounded border text-[13px]'}>{qNum}</span>
                      <div className="flex-1 min-w-[220px] flex items-center flex-wrap gap-2">
                        {contentNode ? contentNode : (
                          <span className="flex items-center gap-2">
                            {prefix && <span className={secondaryTextClass}>{prefix}</span>}
                            {(() => {
                              const fallbackValue = answerValues[0] || '';
                              const overlayList = blankNumberMap[q.id];
                              const overlayNumber = overlayList && overlayList.length ? overlayList[0] : (typeof q.questionNumber === 'number' ? q.questionNumber : undefined);
                              return (
                                <span className="relative inline-flex">
                                  <input
                                    type="text"
                                    value={fallbackValue}
                                    onChange={(e)=> handleAnswerChange(q.id, e.target.value, 0)}
                                    className={'px-2 py-1 rounded border text-center text-sm font-medium tracking-wide min-w-[110px] ' + (darkMode ? 'bg-gray-900 border-gray-600 text-gray-100 focus:ring-2 focus:ring-blue-500' : 'bg-white border-gray-400 text-gray-900 focus:ring-2 focus:ring-blue-500')}
                                    data-qnum={overlayNumber !== undefined ? overlayNumber : qNum}
                                  />
                                  {!fallbackValue && overlayNumber !== undefined && (
                                    <span className={'pointer-events-none absolute inset-0 flex items-center justify-center text-[12px] font-semibold ' + (darkMode ? 'text-gray-500':'text-gray-600')}>
                                      {overlayNumber}
                                    </span>
                                  )}
                                </span>
                              );
                            })()}
                            {suffix && <span className={secondaryTextClass}>{suffix}</span>}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
                  })()}
                </React.Fragment>
              );
            });
          })()}
        </div>
        {/* Floating prev/next navigator (listening) */}
        {(() => {
          // Build numbers across ALL listening parts/sections so chevrons cross part boundaries (e.g., 10 -> 11)
          const container = listeningScrollRef.current as HTMLElement | null;
          const getFocusedQnum = (): number | undefined => {
            if (!container) return undefined;
            const focused = container.querySelector(':focus') as HTMLElement | null;
            let cur: HTMLElement | null = focused;
            while (cur && cur !== container) {
              const attr = cur.getAttribute?.('data-qnum');
              if (attr && !isNaN(Number(attr))) return Number(attr);
              cur = cur.parentElement as HTMLElement | null;
            }
            return undefined;
          };

          // Map numbers and where they belong
          const sectionIndexById: Record<string, number> = {};
          (exam?.sections || []).forEach((s:any, i:number) => { sectionIndexById[s.id] = i; });
          const numsMap: Record<number, boolean> = {};
          const mark = (n:number, ans:boolean) => { if (!(n in numsMap)) numsMap[n] = false; if (ans) numsMap[n] = true; };
          const numToRegular = new Map<number, { sectionIdx: number, questionNumber: number }>();
          const numToTableSection = new Map<number, number>();

          const listeningSecs = multiSectionListening ? listeningSections : [currentSection].filter(Boolean);
          listeningSecs.forEach((sec:any) => {
            const sIdx = sectionIndexById[sec.id];
            (sec.questions || []).forEach((q:any) => {
              let meta = q.metadata; if (meta && typeof meta === 'string') { try { meta = JSON.parse(meta); } catch { meta = {}; } }
              if (q.questionType === 'simple_table') {
                extractSimpleTableNumbersFromQuestion({ ...q, metadata: meta }).forEach(({num, answered}) => {
                  mark(num, answered);
                  if (!numToRegular.has(num) && !numToTableSection.has(num)) numToTableSection.set(num, sIdx);
                });
                return;
              }
              if (typeof q.questionNumber === 'number') {
                mark(q.questionNumber, !!(answers[q.id]?.answer));
                if (!numToRegular.has(q.questionNumber)) numToRegular.set(q.questionNumber, { sectionIdx: sIdx, questionNumber: q.questionNumber });
              }
            });
          });

          const numbers = Object.keys(numsMap).map(n => Number(n)).sort((a,b)=> a-b);
          const currentByFocus = getFocusedQnum();
          const currentByIndex = listeningPartQuestions[currentQuestionIndex]?.questionNumber;
          const currentByRef = listeningCurrentNumRef.current ?? undefined;
          const currentNum = (currentByRef !== undefined ? currentByRef : (currentByFocus !== undefined ? currentByFocus : currentByIndex)) as number | undefined;
          const curIdx = currentNum !== undefined ? numbers.indexOf(currentNum) : -1;
          const hasPrev = curIdx > 0;
          const hasNext = curIdx !== -1 ? curIdx < numbers.length - 1 : numbers.length > 0;

          const goToNum = (targetNum: number) => {
            const reg = numToRegular.get(targetNum);
            const targetSectionIdx = reg?.sectionIdx ?? numToTableSection.get(targetNum) ?? currentSectionIndex;

            if (multiSectionListening) {
              // Switch section if needed
              if (targetSectionIdx !== currentSectionIndex) changeSection(targetSectionIdx, 'manual');
              // For regular questions, set index by sorting that section's non-table questions
              if (reg) {
                const sec = (exam?.sections || [])[targetSectionIdx];
                const list = (sec?.questions || []).filter((qq:any) => qq.questionType !== 'simple_table').sort((a:any,b:any)=> (a.questionNumber||0)-(b.questionNumber||0));
                const idxLocal = list.findIndex((qq:any) => qq.questionNumber === targetNum);
                if (idxLocal !== -1) { setCurrentQuestionIndex(idxLocal); listeningCurrentNumRef.current = targetNum; return; }
              }
              // Table cell or fallback: scroll to data-qnum after render
              setTimeout(() => { scrollAndFocusByQnum(targetNum, listeningScrollRef.current); }, 120);
              listeningCurrentNumRef.current = targetNum;
              return;
            }

            // Single-section listening: set part and index (suppress auto part sync to avoid loop)
            const targetPart = Math.ceil(targetNum / 10);
            if (currentListeningPart !== targetPart) {
              suppressPartSyncRef.current = true;
              setCurrentListeningPart(targetPart);
              // Keep UI index aligned with the new part if we're not landing on a regular numbered question
              const listAll = (currentSection?.questions || []).filter((qq:any) => qq.questionType !== 'simple_table');
              const listForPart = listAll.filter((qq:any) => (qq?.metadata?.listeningPart || (qq.questionNumber ? Math.ceil(qq.questionNumber/10) : 1)) === targetPart)
                                         .sort((a:any,b:any)=> (a.questionNumber||0)-(b.questionNumber||0));
              if (listForPart.length) {
                const idxNearest = Math.max(0, listForPart.findIndex((qq:any) => qq.questionNumber === targetNum));
                setCurrentQuestionIndex(idxNearest === -1 ? 0 : idxNearest);
              }
              // Release suppression after a brief delay to let effects settle
              setTimeout(() => { suppressPartSyncRef.current = false; }, 120);
            }
            if (reg) {
              // compute index within the target part's question list
              const listAll = (currentSection?.questions || []).filter((qq:any) => qq.questionType !== 'simple_table');
              const listForPart = listAll.filter((qq:any) => (qq?.metadata?.listeningPart || (qq.questionNumber ? Math.ceil(qq.questionNumber/10) : 1)) === targetPart)
                                         .sort((a:any,b:any)=> (a.questionNumber||0)-(b.questionNumber||0));
              const idxLocal = listForPart.findIndex((qq:any) => qq.questionNumber === targetNum);
              if (idxLocal !== -1) { setCurrentQuestionIndex(idxLocal); listeningCurrentNumRef.current = targetNum; return; }
            }
            // Table cell or fallback: scroll to data-qnum within current section (after part switch re-render)
            setTimeout(() => { scrollAndFocusByQnum(targetNum, listeningScrollRef.current); }, 140);
            listeningCurrentNumRef.current = targetNum;
          };
          return (
      <div className="fixed right-4 bottom-16 z-40 flex gap-2">
              <button
                type="button"
                aria-label="Previous"
                disabled={!hasPrev}
                onClick={() => {
                  const cur = (listeningCurrentNumRef.current ?? getFocusedQnum() ?? listeningPartQuestions[currentQuestionIndex]?.questionNumber) as number | undefined;
                  if (cur === undefined) return;
                  const idx = numbers.indexOf(cur);
                  if (idx > 0) goToNum(numbers[idx - 1]);
                }}
        tabIndex={-1}
                onMouseDown={(e) => { e.preventDefault(); }}
                onFocus={(e) => { try { (e.currentTarget as HTMLButtonElement).blur(); } catch {} }}
                className={(darkMode ? 'bg-gray-800 text-gray-100' : 'bg-gray-800 text-white') + ' w-9 h-9 rounded flex items-center justify-center disabled:opacity-40'}
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                type="button"
                aria-label="Next"
                disabled={!hasNext}
                onClick={() => {
                  const cur = (listeningCurrentNumRef.current ?? getFocusedQnum() ?? listeningPartQuestions[currentQuestionIndex]?.questionNumber) as number | undefined;
                  const idx = cur !== undefined ? numbers.indexOf(cur) : -1;
                  const nextNum = (idx !== -1 ? numbers[idx + 1] : numbers[0]);
                  if (nextNum !== undefined) goToNum(nextNum);
                }}
        tabIndex={-1}
                onMouseDown={(e) => { e.preventDefault(); }}
                onFocus={(e) => { try { (e.currentTarget as HTMLButtonElement).blur(); } catch {} }}
                className={(darkMode ? 'bg-gray-800 text-gray-100' : 'bg-gray-800 text-white') + ' w-9 h-9 rounded flex items-center justify-center disabled:opacity-40'}
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          );
        })()}
        {/* Bottom part navigation */}
        <div className={(darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white') + ' border-t px-4 py-2 flex items-center justify-between text-xs'}>
          <div className="flex items-center gap-2">
            {(() => {
              // Helper: extract per-blank numbers & answered status from a simple_table question
              const extractSimpleTableBlanks = (q:any): { num:number; answered:boolean }[] => {
                let meta:any = q.metadata; if (meta && typeof meta === 'string') { try { meta = JSON.parse(meta); } catch { meta = {}; } }
                const rows: any[][] = meta?.simpleTable?.rows || [];
                const out: { num:number; answered:boolean }[] = [];
                const seqStart: number | undefined = meta?.simpleTable?.sequenceStart;
                let derivedCounter = seqStart || 0;
                rows.forEach((row:any[], ri:number) => row.forEach((cell:any, ci:number) => {
                  if (cell?.type !== 'question') return; // skip pure text cells
                  const baseKey = `${q.id}_${ri}_${ci}`;
                  const effectiveType = cell?.questionType || 'fill_blank';
                  // Mirror renderer logic for assigning a displayNumber
                  let displayNumber: number | undefined = cell?.questionNumber;
                  if (displayNumber === undefined && seqStart !== undefined) {
                    // Sequential numbering across question cells
                    displayNumber = derivedCounter;
                    derivedCounter += 1;
                  }
                  if (effectiveType === 'fill_blank') {
                    const raw: string = cell?.content || '';
                    const matches = raw.match(/\{answer\d*\}|_{3,}/gi) || [];
                    const hasInline = matches.length > 0;
                    let blanks = matches.length || 1;
                    if (Array.isArray(cell.multiNumbers) && cell.multiNumbers.length > blanks) blanks = cell.multiNumbers.length; // ensure enough slots for provided numbers
                    const numbers: number[] = Array.isArray(cell.multiNumbers) && cell.multiNumbers.length >= blanks
                      ? cell.multiNumbers.slice(0, blanks)
                      : (displayNumber !== undefined ? Array.from({length: blanks}, (_,_i)=> displayNumber! + _i) : []);
                    numbers.forEach((num, bi) => {
                      if (typeof num !== 'number') return;
                      const keySingleInline = `${baseKey}_b0`;
                      const key = blanks>1 ? `${baseKey}_b${bi}` : (hasInline ? keySingleInline : baseKey);
                      let ans = answers[key]?.answer;
                      if (!ans && blanks === 1) {
                        const altKey = hasInline ? baseKey : keySingleInline;
                        ans = answers[altKey]?.answer;
                      }
                      out.push({ num, answered: !!ans });
                    });
                  } else {
                    // Non fill-in question cell (future types) just uses its single number
                    if (displayNumber !== undefined) {
                      const ans = answers[baseKey]?.answer;
                      out.push({ num: displayNumber, answered: !!ans });
                    }
                  }
                }));
                return out;
              };
              const computePartProgress = (partNumber:number, aggregateAcrossSections:boolean) => {
                const resultNumbers: Record<number, boolean> = {};
                const mark = (num:number, yes:boolean) => { if (!(num in resultNumbers)) resultNumbers[num] = false; if (yes) resultNumbers[num] = true; };
                const questionPool = aggregateAcrossSections
                  ? allQuestionsForPart(partNumber)
                  : (currentSection?.questions || []).filter((q:any)=> (q.metadata?.listeningPart || (q.questionNumber ? Math.ceil(q.questionNumber/10):1)) === partNumber);
                questionPool.forEach((q:any) => {
                  let meta = q.metadata; if (meta && typeof meta === 'string') { try { meta = JSON.parse(meta); } catch { meta = {}; } }
                  if (q.questionType === 'simple_table') {
                    extractSimpleTableBlanks(q).forEach(entry => { if (Math.ceil(entry.num/10) === partNumber) mark(entry.num, entry.answered); });
                    return;
                  }
                  if (q.questionType === 'fill_blank') {
                    const text = normalizeNewlines(q.questionText || '');
                    const curly = (text.match(/\{answer\d+\}/gi) || []).length;
                    const underscores = (text.match(/_{3,}/g) || []).length;
                    const combine = !!(meta?.singleNumber || meta?.combineBlanks);
                    const blanks = combine ? 1 : (curly || underscores || 1);
                    const answerValues = getBlankValues(q.id);
                    for (let i = 0; i < blanks; i++) {
                      const num = (q.questionNumber || 0) + (blanks > 1 ? i : 0);
                      const value = combine
                        ? (answerValues[0] ?? '')
                        : (answerValues[i] ?? '');
                      mark(num, !!value);
                    }
                  } else if (typeof q.questionNumber === 'number') {
                    mark(q.questionNumber, !!(answers[q.id]?.answer));
                  }
                });
                const nums = Object.keys(resultNumbers).map(n=> Number(n)).sort((a,b)=> a-b);
                return { total: nums.length, answered: nums.filter(n=> resultNumbers[n]).length };
              };
              // Attach helpers to window for quick dev inspection (optional)
              (window as any)._listeningPartProgressHelpers = { computePartProgress };
              return null;
            })()}
            {listeningParts.map((p, idx) => {
              if (multiSectionListening) {
                const { total, answered } = (window as any)._listeningPartProgressHelpers.computePartProgress(p, true);
                const targetSection = listeningSections[idx];
                return (
                  <button
                    key={p}
                    onClick={() => {
                      // switch to that section
                      const globalIndex = (exam?.sections || []).findIndex((s: any) => s.id === targetSection.id);
                      if (globalIndex !== -1) changeSection(globalIndex, 'manual');
                      setCurrentQuestionIndex(0);
                    }}
                    className={'px-3 py-1.5 rounded border font-medium ' + (p === effectiveListeningPart ? 'bg-blue-600 border-blue-600 text-white' : (darkMode ? 'bg-gray-900 border-gray-600 text-gray-300 hover:bg-gray-700' : 'bg-gray-50 border-gray-300 text-gray-600 hover:bg-gray-100'))}
                  >Part {p} <span className="opacity-70 ml-1">{answered} / {total}</span></button>
                );
              }
              const { total, answered } = (window as any)._listeningPartProgressHelpers.computePartProgress(p, false);
              return (
                <button
                  key={p}
                  onClick={() => { setCurrentListeningPart(p); setCurrentQuestionIndex(0); }}
                  className={'px-3 py-1.5 rounded border font-medium ' + (p === effectiveListeningPart ? 'bg-blue-600 border-blue-600 text-white' : (darkMode ? 'bg-gray-900 border-gray-600 text-gray-300 hover:bg-gray-700' : 'bg-gray-50 border-gray-300 text-gray-600 hover:bg-gray-100'))}
                >Part {p} <span className="opacity-70 ml-1">{answered} / {total}</span></button>
              );
            })}
          </div>
          <div className="flex items-center gap-1">
            {(() => {
              // Build complete list of numbers for this part (including simple_table cells)
              const numsMap: Record<number, boolean> = {};
              const mark = (n:number, ans:boolean) => { if (!(n in numsMap)) numsMap[n] = false; if (ans) numsMap[n] = true; };
              const numBelongsToCurrentPart = (num:number) => Math.ceil(num / 10) === effectiveListeningPart;
              const inThisPartByQuestion = (q:any) => {
                const part = q?.metadata?.listeningPart || (q.questionNumber ? Math.ceil(q.questionNumber/10) : undefined);
                return part === effectiveListeningPart;
              };
              (currentSection?.questions || []).forEach((q:any) => {
                let meta = q.metadata; if (meta && typeof meta === 'string') { try { meta = JSON.parse(meta); } catch { meta = {}; } }
                if (q.questionType === 'simple_table') {
                  // Only include numbers from tables belonging to current part
                  const explicitPart = Number((meta as any)?.listeningPart);
                  const rows:any[][] = (meta as any)?.simpleTable?.rows || [];
                  let firstNum = Number((meta as any)?.simpleTable?.sequenceStart);
                  if (!firstNum || isNaN(firstNum)) {
                    const nums:number[] = [];
                    rows.forEach((row:any[]) => row.forEach((cell:any) => { if (cell?.type==='question' && typeof cell.questionNumber==='number') nums.push(cell.questionNumber); }));
                    if (nums.length) firstNum = Math.min(...nums);
                  }
                  const inferredPart = firstNum ? Math.ceil(firstNum / 10) : undefined;
                  const part = explicitPart || inferredPart;
                  if (part === effectiveListeningPart) {
                    extractSimpleTableNumbersFromQuestion({ ...q, metadata: meta }).forEach(({num, answered}) => { if (numBelongsToCurrentPart(num)) mark(num, answered); });
                  }
                  return;
                }
                if (!inThisPartByQuestion({ ...q, metadata: meta })) return;
                if (q.questionType === 'fill_blank') {
                  const text = normalizeNewlines(q.questionText || '');
                  const curly = (text.match(/\{answer\d+\}/gi) || []).length;
                  const underscores = (text.match(/_{3,}/g) || []).length;
                  const combine = !!(meta?.singleNumber || meta?.combineBlanks);
                  const blanks = combine ? 1 : (curly || underscores || 1);
                  const answerValues = getBlankValues(q.id);
                  for (let i = 0; i < blanks; i++) {
                    const num = (q.questionNumber || 0) + (blanks > 1 ? i : 0);
                    const value = combine
                      ? (answerValues[0] ?? '')
                      : (answerValues[i] ?? '');
                    mark(num, !!value);
                  }
                } else if (typeof q.questionNumber === 'number') {
                  mark(q.questionNumber, !!(answers[q.id]?.answer));
                }
              });
              const sorted = Object.keys(numsMap).map(n=> Number(n)).sort((a,b)=> a-b);
              return sorted.map((num:number) => (
                <button
                  key={num}
                  onClick={() => {
                    // If this num belongs to a regular question in the part, move index so effect focuses first control
                    const idxLocal = listeningPartQuestions.findIndex((qq:any) => qq.questionNumber === num);
                    if (idxLocal !== -1) {
                      setCurrentQuestionIndex(idxLocal);
                      listeningCurrentNumRef.current = num;
                      return;
                    }
                    // Otherwise, it's likely a table cell — scroll and focus the exact input
                    const container = listeningScrollRef.current;
                    if (!container) return;
                    const target = container.querySelector(`[data-qnum="${num}"]`) as HTMLElement | null;
                    if (target) {
                      target.scrollIntoView({ block: 'center', behavior: 'smooth' });
                      setTimeout(() => { try { (target as any).focus?.(); } catch {} }, 120);
                    }
                    listeningCurrentNumRef.current = num;
                  }}
                  title={`Question ${num}`}
                  className={'w-7 h-7 rounded border text-[11px] flex items-center justify-center ' + (numsMap[num] ? (darkMode ? 'bg-green-700 border-green-600 text-white' : 'bg-green-100 border-green-300 text-green-800') : (darkMode ? 'bg-gray-900 border-gray-600 text-gray-400 hover:bg-gray-800' : 'bg-white border-gray-300 text-gray-600 hover:bg-gray-50'))}
                >{num}</button>
              ));
            })()}
          </div>
        </div>
        {showConfirmSubmit && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className={(darkMode ? 'bg-gray-900 text-gray-100' : 'bg-white text-gray-900') + ' rounded-lg p-6 w-full max-w-sm'}>
              <h3 className="text-base font-semibold mb-2 flex items-center gap-2"><AlertTriangle className="h-5 w-5 text-red-500" /> Submit Listening Section</h3>
              <p className={"text-sm mb-4 " + secondaryTextClass}>Are you sure you want to submit? This will finalize your answers.</p>
              <div className="flex gap-2">
                <button onClick={()=> setShowConfirmSubmit(false)} className={(darkMode ? 'bg-gray-800 hover:bg-gray-700 border-gray-600 text-gray-200' : 'bg-gray-100 hover:bg-gray-200 text-gray-700 border-gray-300') + ' flex-1 px-3 py-2 rounded border text-sm'}>Cancel</button>
                <button disabled={!sessionId || submit.isPending} onClick={()=> sessionId && submit.mutate(sessionId)} className={'flex-1 px-3 py-2 rounded text-sm font-medium ' + (submit.isPending ? 'bg-blue-400 text-white' : 'bg-red-600 hover:bg-red-700 text-white')}>{submit.isPending ? 'Submitting…' : 'Submit'}</button>
              </div>
            </div>
          </div>
        )}
        {transitionOverlay}
      </div>
    );
  }

  return (
  <div className={(darkMode ? 'dark ' : '') + "h-screen flex flex-col overflow-hidden select-text " + (darkMode ? 'bg-gray-900 text-gray-100' : 'bg-gray-50 text-gray-900') }>
      {/* Local component animation styles */}
      <style>{`
        @keyframes tokenPop {0%{transform:scale(.5);opacity:0;}60%{transform:scale(1.06);opacity:1;}100%{transform:scale(1);opacity:1;}}
        .token-pop { animation: tokenPop .35s cubic-bezier(.34,1.56,.64,1); }
        @keyframes dropPulse {0%{box-shadow:0 0 0 0 rgba(59,130,246,.55);}70%{box-shadow:0 0 0 8px rgba(59,130,246,0);}100%{box-shadow:0 0 0 0 rgba(59,130,246,0);} }
        .drop-pulse { animation: dropPulse .55s ease-out; }
        .drag-token-shadow { box-shadow:0 4px 14px -4px rgba(59,130,246,.45), 0 0 0 1px rgba(59,130,246,.5); }
        .dark .drag-token-shadow { box-shadow:0 4px 14px -4px rgba(96,165,250,.55), 0 0 0 1px rgba(96,165,250,.55); }
        .drop-target-bright { transition: background-color .18s, transform .18s, box-shadow .18s; }
        .drop-target-bright.is-valid:not(.has-token){ background:linear-gradient(135deg, rgba(96,165,250,0.18), rgba(59,130,246,0.10)); }
        .dark .drop-target-bright.is-valid:not(.has-token){ background:linear-gradient(135deg, rgba(59,130,246,0.28), rgba(29,78,216,0.15)); }
        .drop-target-bright.is-over { transform:scale(1.07); }
      `}</style>
      {examLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-white/70 z-50">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
        </div>
      )}
      {notFound && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="text-center">
            <h2 className="text-2xl font-bold text-red-600 mb-4">Exam Not Found</h2>
            <p className="text-gray-600">The exam you're looking for doesn't exist.</p>
          </div>
        </div>
      )}
      {/* Exam header (navigation hidden globally) */}
      <div className={(darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white') + " border-b z-30 px-4 py-2 flex items-center justify-between shadow-sm"}>
        <div className="flex flex-col">
          <span className={"text-sm " + secondaryTextClass}>{user?.firstName} {user?.lastName}</span>
          <h1 className={"text-base font-semibold " + primaryTextClass}>{exam?.title || (examLoading ? 'Loading…' : 'Unknown Exam')}</h1>
          {exam && <p className={"text-xs " + secondaryTextClass}>Section {currentSectionIndex + 1} of {examSectionsLength}: {currentSection?.title || currentSection?.sectionType}</p>}
        </div>
        <div className="flex items-center gap-4">
          <button onClick={() => setShowSettings(s => !s)} className={(showSettings ? 'ring-2 ring-blue-500 ' : '') + "px-3 py-2 rounded text-sm border transition-colors " + (darkMode ? 'border-gray-600 bg-gray-700 hover:bg-gray-600 text-gray-100' : 'border-gray-300 bg-white hover:bg-gray-100 text-gray-700')}>Settings</button>
          {/* Per-section timer (Reading/Writing/etc.) */}
          <Timer key={`timer-${timerKey}`} darkMode={darkMode} duration={sectionTimerDuration || 60} onTimeUp={handleTimeUp} isPaused={isPaused} />
          {exam && <button onClick={() => setShowConfirmSubmit(true)} className="px-4 py-2 text-sm bg-red-600 text-white rounded hover:bg-red-700">Submit</button>}
        </div>
      </div>
      {showSettings && (
        <div className={(darkMode ? 'bg-gray-800/95 backdrop-blur border-gray-700 text-gray-200' : 'bg-white/95 backdrop-blur') + " border-b px-4 py-4 text-sm"}>
          <div className="flex flex-wrap gap-6 items-start">
            <div className="flex flex-col w-40">
              <label className="text-[11px] uppercase tracking-wide font-semibold opacity-70 mb-1">Font Size</label>
              <input type="range" min={14} max={24} value={prefFontSize} onChange={(e)=> setPrefFontSize(Number(e.target.value))} className="w-full accent-purple-600" />
              <div className="mt-1 text-xs font-mono">{prefFontSize}px</div>
            </div>
            <div className="flex flex-col w-48">
              <label className="text-[11px] uppercase tracking-wide font-semibold opacity-70 mb-1">Font Family</label>
              <select value={prefFontFamily} onChange={(e)=> setPrefFontFamily(e.target.value)} className={"border rounded px-2 py-2 text-sm focus:ring-2 focus:ring-blue-500 " + (darkMode ? 'bg-gray-900 border-gray-600 text-gray-100' : 'bg-white border-gray-300 text-gray-800')}>
                <option value="serif">Serif (IELTS style)</option>
                <option value="sans">Sans</option>
                <option value="mono">Mono</option>
              </select>
            </div>
            <div className="flex flex-col w-32">
              <label className="text-[11px] uppercase tracking-wide font-semibold opacity-70 mb-2">Theme</label>
              <button
                onClick={()=> setDarkMode(d => !d)}
                className={"relative inline-flex items-center h-8 px-3 rounded border text-xs font-medium transition-colors " + (darkMode ? 'bg-gray-900 border-gray-600 text-gray-100 hover:bg-gray-700' : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-100')}
              >{darkMode ? 'Dark Mode ✓' : 'Light Mode'}</button>
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-[11px] uppercase tracking-wide font-semibold opacity-70 mb-1">Quick</label>
              <div className="flex gap-2">
                <button onClick={()=> { setPrefFontSize(16); setPrefFontFamily('serif'); }} className="px-3 py-1.5 text-xs rounded border border-blue-500 text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/30">IELTS Default</button>
                <button onClick={()=> { setPrefFontSize(18); setPrefFontFamily('sans'); }} className="px-3 py-1.5 text-xs rounded border border-gray-400 hover:bg-gray-50 dark:border-gray-600 dark:hover:bg-gray-700/50">Readable</button>
                <button onClick={()=> { setPrefFontSize(16); setPrefFontFamily('serif'); setDarkMode(false); }} className="px-3 py-1.5 text-xs rounded border border-red-500 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/30">Reset</button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-hidden min-h-0">
        {/* Responsive: stacked on small screens, resizable flex on lg+ */}
        <div className="h-full w-full flex flex-col lg:flex-row gap-0">
          {/* Left Pane */}
          <div
            className={(darkMode ? 'bg-gray-900 border-gray-700 text-gray-100' : 'bg-white') + " min-h-0 flex flex-col border-b lg:border-b-0 lg:border-r shadow-sm"}
            style={window.innerWidth >= 1024 ? { width: `${leftWidthPct}%` } : undefined}
          >
            <div className="flex flex-col h-full overflow-hidden min-h-0">
              <div className="p-2 md:p-3 flex-1 overflow-auto min-h-0">
                {(currentSection?.sectionType || '').toLowerCase() === 'reading' ? (
                  <>
                    <h3 className="font-semibold text-gray-900 mb-3">Reading Passage</h3>
                    {/* Matching drag & drop paragraphs */}
                    {/* Always show passage text (if any) */}
                    {isMatchingSection && passageParagraphs.length > 0 && matchingQuestionsSorted.length > 0 ? (
                      <div className="mb-6">
                        {(() => {
                          const hasExplicitMarkers = passageParagraphs.some(p => p.index !== undefined);
                          if (hasExplicitMarkers) {
                            // Map by explicit paragraph index to matching question with same metadata.paragraphIndex
                            return passageParagraphs.map((paraObj, idxAll) => {
                              const para = paraObj.text;
                              const mq = matchingQuestionsSorted.find(q => q.metadata?.paragraphIndex === paraObj.index);
                              const sharedStyle: React.CSSProperties = {
                                fontSize: prefFontSize,
                                lineHeight: 1.55,
                                fontFamily: prefFontFamily === 'serif'
                                  ? 'Georgia, Cambria, Times New Roman, Times, serif'
                                  : prefFontFamily === 'mono'
                                    ? 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace'
                                    : 'system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell, Noto Sans, sans-serif'
                              };
                              const paragraphClass = (darkMode ? 'text-gray-200' : 'text-gray-800') + ' prose max-w-none whitespace-pre-wrap text-sm leading-relaxed';
                              if (!mq) {
                                return (
                                  <div key={`unbound-${idxAll}`} className="mb-6 pb-4 border-b last:border-0 last:pb-0">
                                    <div className="text-xs text-gray-500 mb-1">Paragraph {paraObj.index}</div>
                                    <div className={paragraphClass} style={sharedStyle}>{para}</div>
                                  </div>
                                );
                              }
                              const qAnswer = (answers[mq.id]?.answer as string) || '';
                              return (
                                <div key={mq.id} className="mb-6 pb-4 border-b last:border-0 last:pb-0">
                                  <div
                                    className={`mb-2 px-3 py-2 border rounded flex items-center gap-3 min-h-[44px] ${darkMode ? 'bg-gray-800' : 'bg-white'} transition-colors text-sm ${draggingHeading ? 'border-blue-500 ring-1 ring-blue-300' : (darkMode ? 'border-gray-600' : 'border-gray-300')}`}
                                    onDragOver={(e) => { e.preventDefault(); }}
                                    onDrop={(e) => { e.preventDefault(); const letter = e.dataTransfer.getData('text/plain'); if (letter) assignHeadingToQuestion(letter, mq.id); setDraggingHeading(null); }}
                                  >
                                    <span className="text-[11px] font-semibold text-gray-500 w-6 text-center select-none">{mq.questionNumber || ''}</span>
                                    {qAnswer ? (
                                      <>
                                        <span className={(darkMode ? 'text-gray-100' : 'text-gray-900') + ' flex-1 font-medium leading-snug'}>{resolveHeadingText(qAnswer)}</span>
                                        <button onClick={() => clearHeadingFromQuestion(mq.id)} className="ml-auto text-[11px] text-red-600 hover:underline" type="button">✕</button>
                                      </>
                                    ) : (
                                      <span className="flex-1 text-gray-400 italic">Drop heading here</span>
                                    )}
                                  </div>
                                  <div className="text-xs text-gray-500 mb-1">Paragraph {paraObj.index}</div>
                                  <div className={paragraphClass} style={sharedStyle}>{para}</div>
                                </div>
                              );
                            });
                          }
                          // Lettered fallback
                          const lettered = passageParagraphs.filter(p => p.letter);
                          return passageParagraphs.map((paraObj, idxAll) => {
                            const para = paraObj.text;
                            const sharedStyle: React.CSSProperties = {
                              fontSize: prefFontSize,
                              lineHeight: 1.55,
                              fontFamily: prefFontFamily === 'serif'
                                ? 'Georgia, Cambria, Times New Roman, Times, serif'
                                : prefFontFamily === 'mono'
                                  ? 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace'
                                  : 'system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell, Noto Sans, sans-serif'
                            };
                            const paragraphClass = (darkMode ? 'text-gray-200' : 'text-gray-800') + ' prose max-w-none whitespace-pre-wrap text-sm leading-relaxed';
                            if (!paraObj.letter) {
                              return (
                                <div key={`intro-${idxAll}`} className="mb-6 pb-4 border-b last:border-0 last:pb-0">
                                  <div className={paragraphClass} style={sharedStyle}>{para}</div>
                                </div>
                              );
                            }
                            const idx = lettered.indexOf(paraObj);
                            const mq = matchingQuestionsSorted[idx];
                            if (!mq) return null;
                            const qAnswer = (answers[mq.id]?.answer as string) || '';
                            return (
                              <div key={mq.id} className="mb-6 pb-4 border-b last:border-0 last:pb-0">
                                <div
                                  className={`mb-2 px-3 py-2 border rounded flex items-center gap-3 min-h-[44px] ${darkMode ? 'bg-gray-800' : 'bg-white'} transition-colors text-sm ${draggingHeading ? 'border-blue-500 ring-1 ring-blue-300' : (darkMode ? 'border-gray-600' : 'border-gray-300')}`}
                                  onDragOver={(e) => { e.preventDefault(); }}
                                  onDrop={(e) => { e.preventDefault(); const letter = e.dataTransfer.getData('text/plain'); if (letter) assignHeadingToQuestion(letter, mq.id); setDraggingHeading(null); }}
                                >
                                  <span className="text-[11px] font-semibold text-gray-500 w-6 text-center select-none">{mq.questionNumber || ''}</span>
                                  {qAnswer ? (
                                    <>
                                      <span className={(darkMode ? 'text-gray-100' : 'text-gray-900') + ' flex-1 font-medium leading-snug'}>{resolveHeadingText(qAnswer)}</span>
                                      <button onClick={() => clearHeadingFromQuestion(mq.id)} className="ml-auto text-[11px] text-red-600 hover:underline" type="button">✕</button>
                                    </>
                                  ) : (
                                    <span className="flex-1 text-gray-400 italic">Drop heading here</span>
                                  )}
                                </div>
                                <div className="text-xs text-gray-500 mb-1">Paragraph {paraObj.letter}</div>
                                <div className={paragraphClass} style={sharedStyle}>{para}</div>
                              </div>
                            );
                          });
                        })()}
                      </div>
                    ) : null}
                    {/* Fallback passage for matching sections when detection failed */}
                    {isMatchingSection && (!passageParagraphs.length || !matchingQuestionsSorted.length) && currentSection?.passageText && (
                      <div
                        className={(darkMode ? 'text-gray-200' : 'text-gray-800') + ' prose max-w-none whitespace-pre-wrap mb-6'}
                        style={{
                          fontSize: prefFontSize,
                          lineHeight: 1.55,
                          fontFamily: prefFontFamily === 'serif' ? 'Georgia, Cambria, Times New Roman, Times, serif' : prefFontFamily === 'mono' ? 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace' : 'system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell, Noto Sans, sans-serif'
                        }}
                      >{currentSection.passageText.replace(/\[\[(?:p|paragraph)\s*\d+\]\]/gi,'').trim()}</div>
                    )}
                    {/* Image labeling shared image (if any image_labeling questions exist in this section) */}
                    {(() => {
                      const labelQs = (currentSection?.questions || []).filter((q:any)=> q.questionType === 'image_labeling');
                      if (!labelQs.length) return null;
                      const sharedUrl = labelQs[0]?.imageUrl as string | undefined;
                      if (!sharedUrl) return null;
                      const apiFull = (import.meta.env.VITE_API_URL || 'http://localhost:7000/api');
                      const apiOrigin = apiFull.replace(/\/?api\/?$/, '');
                      const src = sharedUrl.startsWith('http') ? sharedUrl : `${apiOrigin}${sharedUrl}`;
                      return (
                        <div className="mb-4">
                          <div className="text-sm font-medium mb-1">Label the locations</div>
                          <div className="relative inline-block border rounded overflow-hidden" style={{ width: '50vw', minWidth: '30vw', maxWidth: '80vw', overflow: 'auto', resize: 'horizontal' as any }}>
                            {/* Fixed-scale inner layer fits image to container */}
                            <div className="relative">
                              <img src={src} alt="Labeling" className="max-h-[80vh] w-full" style={{ objectFit: 'contain', display: 'block' }} />
                              {labelQs.map((q:any) => {
                                let meta: any = q.metadata; if (meta && typeof meta === 'string') { try { meta = JSON.parse(meta); } catch {} }
                                const ax = meta?.anchor?.x ?? 0.5;
                                const ay = meta?.anchor?.y ?? 0.5;
                                const val = (answers[q.id]?.answer as string) || '';
                                const placeLeft = ax > 0.85; // avoid overflowing right edge
                                return (
                                  <div key={`anch-${q.id}`} className="absolute" style={{ left: `${ax*100}%`, top: `${ay*100}%`, transform: 'translate(-50%, -50%)' }}>
                                    <div className={"flex items-center gap-1 " + (placeLeft ? 'flex-row-reverse' : '')}>
                                      <span className="inline-block w-2.5 h-2.5 rounded-full bg-blue-600 border border-white shadow" />
                                      <textarea
                                        draggable={false}
                                        rows={1}
                                        value={val}
                                        onChange={(e)=> handleAnswerChange(q.id, e.target.value)}
                                        placeholder={`Q${q.questionNumber || ''}`}
                                        className={'px-2 py-1 rounded text-xs border min-h-[24px] leading-snug ' + (darkMode ? 'bg-gray-900 border-gray-600 text-gray-100' : 'bg-white border-gray-300 text-gray-900')}
                                        style={{ fontSize: prefFontSize, resize: 'horizontal', overflow: 'auto', width: '200px' }}
                                        onDragStart={(e)=> e.preventDefault()}
                                      />
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        </div>
                      );
                    })()}

                    {(() => {
                      // Image Drag & Drop (image_dnd) — one anchor per question, one token per question
                      const dndQs = (currentSection?.questions || []).filter((q:any)=> q.questionType === 'image_dnd');
                      if (!dndQs.length) return null;
                      const sharedUrl = dndQs[0]?.imageUrl as string | undefined;
                      if (!sharedUrl) return null;
                      const apiFull = (import.meta.env.VITE_API_URL || 'http://localhost:7000/api');
                      const apiOrigin = apiFull.replace(/\/?api\/?$/, '');
                      const src = sharedUrl.startsWith('http') ? sharedUrl : `${apiOrigin}${sharedUrl}`;
                      // Token bank: prefer first token in metadata.tokens, fallback to anchor id or questionNumber
                      const tokens: { id: string }[] = dndQs.map((q:any)=> {
                        let meta: any = q.metadata; if (meta && typeof meta === 'string') { try { meta = JSON.parse(meta); } catch {} }
                        const token = Array.isArray(meta?.tokens) && meta.tokens.length > 0 ? meta.tokens[0] : (meta?.anchors?.[0]?.id) || String(q.questionNumber||'');
                        return { id: String(token) };
                      });
                      return (
                        <div className="mb-4">
                          <div className="text-sm font-medium mb-1">Drag the labels onto the image</div>
                          <div className="relative inline-block border rounded overflow-hidden" style={{ width: '50vw', minWidth: '30vw', maxWidth: '80vw', overflow: 'auto', resize: 'horizontal' as any }}>
                            {/* Fixed-scale inner layer fits image to container */}
                            <div className="relative">
                              <img src={src} alt="Drag/Drop" className="max-h-[80vh] w-full select-none" style={{ objectFit: 'contain', display: 'block' }} draggable={false} />
                              {/* Anchors (drop targets) */}
                              {dndQs.map((q:any)=>{
                              let meta: any = q.metadata; if (meta && typeof meta === 'string') { try { meta = JSON.parse(meta); } catch {} }
                              const anchor = Array.isArray(meta?.anchors) && meta.anchors.length > 0 ? meta.anchors[0] : { id: 'A', x: 0.5, y: 0.5 };
                              const aid = String(anchor.id || 'A');
                              const ax = typeof anchor.x === 'number' ? anchor.x : 0.5; const ay = typeof anchor.y === 'number' ? anchor.y : 0.5;
                              let placed: string | undefined = undefined; try { const a = (answers[q.id]?.answer as string)||''; const j = JSON.parse(a||'{}'); placed = j?.placements?.[aid]; } catch {}
                              return (
                                  <div key={`dnd-anch-${q.id}`} className="absolute -translate-x-1/2 -translate-y-1/2"
                                  style={{ left: `${ax*100}%`, top: `${ay*100}%` }}
                                  onDragOver={(e)=> e.preventDefault()}
                                  onDrop={(e)=>{ e.preventDefault(); const tok = e.dataTransfer.getData('text/token'); if (!tok) return; const payload = { placements: { [aid]: tok } }; handleAnswerChange(q.id, JSON.stringify(payload)); }}
                                >
                                  <div className={'px-2 py-1 rounded text-xs border font-semibold ' + (darkMode ? 'bg-gray-900 border-gray-600 text-gray-100' : 'bg-white border-gray-300 text-gray-900')}>
                                    {placed ? placed : aid}
                                  </div>
                                </div>
                                );
                              })}
                            </div>
                            {/* Token bank overlay (top-left) */}
                            <div className={'absolute left-2 top-2 z-20 flex gap-2 flex-wrap p-2 rounded ' + (darkMode ? 'bg-gray-900/70' : 'bg-white/80 border border-gray-200')}>
                              {tokens.map((t, idx)=> (
                                <div key={`tok-${idx}`} draggable onDragStart={(e)=>{ e.dataTransfer.setData('text/token', t.id); }} className={'px-2 py-1 rounded text-xs cursor-move select-none ' + (darkMode ? 'bg-blue-800 text-blue-100' : 'bg-blue-600 text-white')}>
                                  {t.id}
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      );
                    })()}

                    {/* Non-matching reading section passage */}
                    {!isMatchingSection && currentSection?.passageText && (
                      <div
                        className={(darkMode ? 'text-gray-200' : 'text-gray-800') + ' prose max-w-none whitespace-pre-wrap mb-6'}
                        style={{
                          fontSize: prefFontSize,
                          lineHeight: 1.55,
                          fontFamily: prefFontFamily === 'serif' ? 'Georgia, Cambria, Times New Roman, Times, serif' : prefFontFamily === 'mono' ? 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace' : 'system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell, Noto Sans, sans-serif'
                        }}
                      >{currentSection.passageText}</div>
                    )}
                  </>
                ) : (
                  <>
                    {/* Writing / Listening / other section contextual area */}
                    <div className={(darkMode ? 'text-gray-300' : 'text-gray-700') + ' text-sm leading-relaxed'}
                      style={{
                        fontSize: prefFontSize,
                        lineHeight: 1.52,
                        fontFamily: prefFontFamily === 'serif'
                          ? 'Georgia, Cambria, Times New Roman, Times, serif'
                          : prefFontFamily === 'mono'
                            ? 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace'
                            : 'system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell, Noto Sans, sans-serif'
                      }}>
                      {isWritingSection ? (
                        <div className="space-y-3">
                          {writingParts.length > 1 && (
                            <div className="flex items-center gap-2">
                              {writingParts.map((p:number) => (
                                <button
                                  key={p}
                                  onClick={() => setCurrentWritingPart(p)}
                                  className={(p===currentWritingPart ? 'bg-blue-600 text-white border-blue-600' : (darkMode ? 'bg-gray-800 text-gray-200 border-gray-600' : 'bg-white text-gray-800 border-gray-300')) + ' px-3 py-1.5 text-xs rounded border'}
                                >Part {p}</button>
                              ))}
                            </div>
                          )}
                          {activeWritingQuestion ? (
                            <div className="space-y-3">
                              {/* Task heading shown before instructions */}
                              <div className="text-sm font-semibold">
                                {getWritingPart(activeWritingQuestion) === 1 ? 'Writing Task 1' : 'Writing Task 2'}
                              </div>
                              {/* Section-level instructions (optional) */}
                              {currentSection?.instructions && (
                                <div className={(darkMode ? 'bg-yellow-900/30 text-yellow-200 border-yellow-800' : 'bg-yellow-50 text-yellow-800 border-yellow-200') + ' text-xs border rounded p-2 whitespace-pre-wrap'} style={{ fontSize: prefFontSize }}>
                                  {currentSection.instructions}
                                </div>
                              )}
                              {/* Writing task guidance (shown only on left, above image) */}
                              {activeWritingQuestion?.metadata?.guidance && (
                                <div className={(darkMode ? 'bg-blue-900/40 text-blue-200' : 'bg-blue-50 text-blue-700') + ' text-xs rounded px-3 py-2 whitespace-pre-wrap'} style={{ fontSize: prefFontSize }}>
                                  {activeWritingQuestion.metadata.guidance}
                                </div>
                              )}
                              {/* Question text shown above image (skip generic labels) */}
                              {(() => {
                                const qt = (activeWritingQuestion?.questionText || '').trim();
                                const lc = qt.toLowerCase();
                                if (!qt || lc === 'writing task 1' || lc === 'writing task 2') return null;
                                return (
                                  <div className={(darkMode ? 'text-gray-100' : 'text-gray-900') + ' whitespace-pre-wrap'} style={{ fontSize: prefFontSize }}>{qt}</div>
                                );
                              })()}
                              {/* Prompt-specific media */}
                              {activeWritingQuestion.imageUrl && (() => { const apiFull = (import.meta.env.VITE_API_URL || 'http://localhost:7000/api'); const apiOrigin = apiFull.replace(/\/?api\/?$/, ''); const src = activeWritingQuestion.imageUrl.startsWith('http') ? activeWritingQuestion.imageUrl : `${apiOrigin}${activeWritingQuestion.imageUrl}`; return (
                                <div>
                                  <img src={src} alt="Writing prompt" className="max-w-full rounded border border-gray-300" />
                                </div>
                              ); })()}
                              {/* Attachments (if author provided) */}
                              {Array.isArray(activeWritingQuestion?.metadata?.attachments) && activeWritingQuestion.metadata.attachments.length > 0 && (
                                <div className="text-xs">
                                  <div className="font-semibold mb-1">Attachments</div>
                                  <ul className="list-disc pl-5 space-y-1">
                                    {activeWritingQuestion.metadata.attachments.map((att: any, idx: number) => (
                                      <li key={idx}><a href={att.url || att} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">{att.name || att.url || String(att)}</a></li>
                                    ))}
                                  </ul>
                                </div>
                              )}
                              {/* Question text already rendered above image */}
                              {/* Removed "Jump to Answer" as the textarea is visible on the right */}
                            </div>
                          ) : (
                            <div className="italic opacity-70">No writing task found in this section.</div>
                          )}
                        </div>
                      ) : (
                        <>
                          {(() => {
                            const labelQs = (currentSection?.questions || []).filter((q:any)=> q.questionType === 'image_labeling');
                            if (!labelQs.length) return null;
                            const sharedUrl = labelQs[0]?.imageUrl as string | undefined;
                            if (!sharedUrl) return null;
                            const apiFull = (import.meta.env.VITE_API_URL || 'http://localhost:7000/api');
                            const apiOrigin = apiFull.replace(/\/?api\/?$/, '');
                            const src = sharedUrl.startsWith('http') ? sharedUrl : `${apiOrigin}${sharedUrl}`;
                            return (
                              <div className="mb-4">
                                <div className="text-sm font-medium mb-1">Label the locations</div>
                                <div className="relative inline-block border rounded overflow-hidden">
                                  <img src={src} alt="Labeling" className="max-h-96" />
                                  {labelQs.map((q:any) => {
                                    let meta: any = q.metadata; if (meta && typeof meta === 'string') { try { meta = JSON.parse(meta); } catch {} }
                                    const ax = meta?.anchor?.x ?? 0.5;
                                    const ay = meta?.anchor?.y ?? 0.5;
                                    const val = (answers[q.id]?.answer as string) || '';
                                    return (
                                      <div key={`anch-${q.id}`} className="absolute -translate-x-1/2 -translate-y-1/2" style={{ left: `${ax*100}%`, top: `${ay*100}%` }}>
                                        <div className="flex items-center gap-1">
                                          <span className="inline-block w-2.5 h-2.5 rounded-full bg-blue-600 border border-white shadow" />
                                          <input
                                            type="text"
                                            value={val}
                                            onChange={(e)=> handleAnswerChange(q.id, e.target.value)}
                                            placeholder={`Q${q.questionNumber || ''}`}
                                            className={'px-2 py-1 rounded text-xs border ' + (darkMode ? 'bg-gray-900 border-gray-600 text-gray-100' : 'bg-white border-gray-300 text-gray-900')}
                                            style={{ fontSize: prefFontSize }}
                                          />
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            );
                          })()}
                          {currentSection?.passageText ? (
                            <div className="whitespace-pre-wrap">{currentSection.passageText}</div>
                          ) : (
                            <div className="italic opacity-70">Adjust font size, family, or theme in Settings. Questions appear on the right.</div>
                          )}
                        </>
                      )}
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
          {/* Divider handle (lg+) */}
          <div
            className="hidden lg:block w-1 relative cursor-col-resize group"
            role="separator"
            aria-orientation="vertical"
            aria-valuenow={Math.round(leftWidthPct)}
            aria-valuemin={20}
            aria-valuemax={80}
            tabIndex={0}
            onPointerDown={startDrag}
          >
            <div className="absolute inset-0 bg-gray-200 group-hover:bg-gray-300 transition-colors"></div>
            <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-0.5 bg-gray-300"></div>
          </div>
          {/* Right Pane */}
          <div
            className={(darkMode ? 'bg-gray-900 text-gray-100' : 'bg-white') + " min-h-0 flex flex-col shadow-sm"}
            style={window.innerWidth >= 1024 ? { width: `${100 - leftWidthPct}%` } : undefined}
          >
            <div className="flex flex-col h-full overflow-hidden min-h-0 border-l">
              <div ref={rightScrollRef} className="p-2 md:p-3 flex-1 overflow-auto relative min-h-0">
                {debugTables && (
                  <div className="mb-3 p-2 border rounded bg-yellow-50 text-[10px] text-gray-700 space-y-1 max-h-56 overflow-auto">
                    <div className="font-semibold">[Debug] Question Inventory (Ctrl+Shift+D to toggle)</div>
                    {(currentSection?.questions || []).map((dq:any) => {
                      let meta: any = dq.metadata;
                      if (meta && typeof meta === 'string') { try { meta = JSON.parse(meta); } catch {} }
                      const keys = meta ? Object.keys(meta) : [];
                      const hasTable = !!meta?.table;
                      const hasLegacy = !!meta?.tableBlock;
                      if ((dq.questionType==='table_fill_blank' || dq.questionType==='table_drag_drop')) {
                        // eslint-disable-next-line no-console
                        console.log('[debugTables] table container', { id:dq.id, qnum:dq.questionNumber, type:dq.questionType, hasTable, keys });
                      }
                      return (
                        <div key={dq.id} className="flex gap-2 items-center">
                          <span className="font-mono">Q{dq.questionNumber}</span>
                          <span>{dq.questionType}</span>
                          <span className={hasTable? 'text-green-600':'text-red-600'}>table:{hasTable? 'Y':'N'}</span>
                          {hasLegacy && <span className="text-purple-600">legacyBlock</span>}
                          <span>metaKeys:[{keys.join(',')}]</span>
                        </div>
                      );
                    })}
                    <div className="pt-1 text-[9px] text-gray-600">Add ?debugTables=1 to URL or press Ctrl+Shift+D. Reload keeps state via localStorage.</div>
                  </div>
                )}
                {isMatchingSection && headingOptions.length > 0 && (
                  <div className="mb-4 space-y-2">
                    {(() => { const gi = matchingQuestions[0]?.metadata?.groupInstruction; return gi ? <div className={"text-xs whitespace-pre-wrap border rounded p-2 " + (darkMode ? 'bg-gray-800 border-gray-700 text-gray-300' : 'bg-gray-50 text-gray-600 border-gray-200')}>{gi}</div> : null; })()}
                    <div className={"text-sm font-medium " + (darkMode ? 'text-gray-200' : 'text-gray-700')}>List of Headings</div>
                    <div className="flex flex-col gap-2">
                      {headingOptions.map((opt: any, idx: number) => {
                        const letter = opt.letter || opt.option_letter || String.fromCharCode(65 + idx);
                        const text = opt.text || opt.option_text || '';
                        const used = matchingQuestions.some((mq: any) => (answers[mq.id]?.answer as string) === letter);
                        return (
                          <div
                            key={letter}
                            draggable
                            onDragStart={(e) => { e.dataTransfer.setData('text/plain', letter); setDraggingHeading(letter); }}
                            onDragEnd={() => setDraggingHeading(null)}
                            className={`px-3 py-1.5 rounded border text-sm cursor-move select-none leading-snug transition-colors ${used ? (darkMode ? 'bg-gray-700 text-gray-500 line-through border-gray-600' : 'bg-gray-200 text-gray-500 line-through border-gray-300') : (darkMode ? 'bg-gray-800 border-gray-600 text-gray-200 hover:bg-gray-700' : 'bg-white border-gray-300 hover:bg-gray-50')}`}
                            title={text + (used ? ' (already used)' : '')}
                          >
                            {text}
                          </div>
                        );
                      })}
                    </div>
                    <div className={"text-[10px] mt-1 " + (darkMode ? 'text-gray-400' : 'text-gray-500')}>Drag a heading text onto a paragraph drop zone on the left. Each heading can be used once.</div>
                  </div>
                )}
                {/* Table container rendered (if any) before question list */}
                {tableContainer && (() => {
                  const q = tableContainer;

                  // Simple Table Rendering
                  if (q.questionType === 'simple_table') {
                    // Ensure metadata parsed (backend may return JSON string)
                    let meta: any = q.metadata;
                    if (meta && typeof meta === 'string') {
                      try { meta = JSON.parse(meta); } catch { meta = {}; }
                    }
                    const tableMeta = meta?.simpleTable || {};
                    const rows: any[][] = Array.isArray(tableMeta.rows) ? tableMeta.rows : [];

                    if (!rows.length) {
                      return (
                        <div className="mb-8 pb-4 border-b border-dashed border-gray-300 dark:border-gray-700">
                          {q.questionText && <div className="mb-2 font-medium text-sm whitespace-pre-wrap leading-snug">{normalizeNewlines(q.questionText)}</div>}
                          <div className="text-xs text-gray-500 italic">Table not configured yet (no rows). If you recently edited, ensure you clicked Save in the table editor.</div>
                          {debugTables && <div className="mt-2 text-[10px] text-red-600">[Debug] simple_table metadata parsed but rows empty. Raw meta keys: {Object.keys(meta||{}).join(', ') || 'none'}</div>}
                        </div>
                      );
                    }

                    return (
                      <div className="mb-8 pb-4 border-b border-dashed border-gray-300 dark:border-gray-700">
                        {q.questionText && <div className="mb-2 font-medium text-sm whitespace-pre-wrap leading-snug">{normalizeNewlines(q.questionText)}</div>}
                        <div className="overflow-auto">
                          <table className={'text-sm min-w-[480px] border ' + (darkMode ? 'border-gray-600' : 'border-gray-300')}>
                            <tbody>
                              {rows.map((row, ri) => (
                                <tr key={ri} className={darkMode ? 'border-b border-gray-700 last:border-b-0' : 'border-b border-gray-200 last:border-b-0'}>
                                  {row.map((cell, ci) => (
                                    <td key={ci} className={(darkMode ? 'border-r border-gray-700' : 'border-r border-gray-200') + ' last:border-r-0 p-3 align-top'}>
                                      {cell?.type === 'text' ? (
                                        <div className="whitespace-pre-wrap">{cell?.content || ''}</div>
                                      ) : cell?.type === 'question' ? (
                                        <div className="space-y-2">
                                          {cell?.content && (
                                            <div className="text-sm font-medium">{cell.content}</div>
                                          )}
                                          {cell?.questionType === 'fill_blank' && (() => {
                                            // Detect multiple blanks inside a single cell content using {answer} tokens or runs of ___ (3+ underscores)
                                            const raw: string = cell?.content || '';
                                            const blankMatches = raw.match(/\{answer\}|_{3,}/gi) || [];
                                            let blanks = blankMatches.length || 1;
                                            // If author provided multiNumbers (e.g. [6,7,8]) but content is missing placeholders, still render that many blanks
                                            if (Array.isArray(cell.multiNumbers) && cell.multiNumbers.length > blanks) {
                                              blanks = cell.multiNumbers.length;
                                            }
                                            if (blanks === 1) {
                                              const key = `${q.id}_${ri}_${ci}`;
                                              const val = (answers[key]?.answer as string) || '';
                                              const placeholderNum = (Array.isArray(cell?.multiNumbers) && cell.multiNumbers.length > 0)
                                                ? cell.multiNumbers[0]
                                                : (cell?.questionNumber !== undefined ? cell.questionNumber : undefined);
                                              return (
                                                <span className="relative inline-flex w-full">
                                                  <input
                                                    type="text"
                                                    value={val}
                                                    onChange={(e) => handleAnswerChange(key, e.target.value)}
                                                    className={'w-full px-2 py-1 rounded border focus:ring-2 ' + (darkMode ? 'bg-gray-700 text-white border-gray-600 focus:ring-blue-500' : 'bg-white text-gray-900 border-gray-300 focus:ring-blue-300')}
                                                    placeholder={placeholderNum !== undefined ? String(placeholderNum) : 'Answer...'}
                                                    data-qnum={placeholderNum !== undefined ? placeholderNum : undefined}
                                                  />
                                                  {!val && placeholderNum !== undefined && (
                                                    <span className={'pointer-events-none absolute inset-0 flex items-center justify-center text-[11px] font-semibold ' + (darkMode ? 'text-gray-500' : 'text-gray-600')}>{placeholderNum}</span>
                                                  )}
                                                </span>
                                              );
                                            }
                                            // Multi-blank: render separate inputs; use synthetic IDs with _b index for aggregation
                                            const numbers: number[] = Array.isArray(cell.multiNumbers) && cell.multiNumbers.length >= blanks
                                              ? cell.multiNumbers.slice(0, blanks)
                                              : (() => { const base = cell.questionNumber || 0; return Array.from({ length: blanks }, (_, i) => base + i); })();
                                            return (
                                              <div className="flex flex-wrap gap-1">
                                                {Array.from({ length: blanks }).map((_, bi) => {
                                                  const id = `${q.id}_${ri}_${ci}_b${bi}`;
                                                  const val = (answers[id]?.answer as string) || '';
                                                  const placeholderNum = numbers[bi];
                  return (
                                                    <span key={id} className="relative inline-flex">
                                                      <input
                                                        type="text"
                                                        value={val}
                                                        onChange={(e) => handleAnswerChange(id, e.target.value)}
                                                        className={'px-2 py-1 rounded border text-center w-[70px] focus:ring-2 text-[13px] font-medium tracking-wide ' + (darkMode ? 'bg-gray-700 text-white border-gray-600 focus:ring-blue-500' : 'bg-white text-gray-900 border-gray-300 focus:ring-blue-300')}
                    data-qnum={placeholderNum !== undefined ? placeholderNum : undefined}
                                                      />
                                                      {!val && placeholderNum !== undefined && (
                                                        <span className={'pointer-events-none absolute inset-0 flex items-center justify-center text-[11px] font-semibold ' + (darkMode ? 'text-gray-500' : 'text-gray-600')}>{placeholderNum}</span>
                                                      )}
                                                    </span>
                                                  );
                                                })}
                                              </div>
                                            );
                                          })()}
                                          {cell?.questionType === 'multiple_choice' && cell?.content && (
                                            <div className="space-y-1">
                                              {cell.content.split(/[A-D]\)/).slice(1).map((option: string, oi: number) => {
                                                const letter = String.fromCharCode(65 + oi);
                                                const selected = (answers[`${q.id}_${ri}_${ci}`]?.answer as string) === letter;
                                                return (
                                                  <label
                                                    key={letter}
                                                    className={`flex items-start gap-2 cursor-pointer rounded px-2 py-1 border transition-colors ${selected ? (darkMode ? 'bg-blue-700 border-blue-600 text-white' : 'bg-gray-200 border-gray-300') : (darkMode ? 'border-gray-600 hover:bg-gray-700' : 'border-transparent hover:bg-gray-100')}`}
                                                    onClick={() => handleAnswerChange(`${q.id}_${ri}_${ci}`, letter)}
                                                  >
                                                    <input
                                                      type="radio"
                                                      className={'mt-1 ' + (darkMode ? 'accent-blue-500' : '')}
                                                      name={`question-${q.id}_${ri}_${ci}`}
                                                      value={letter}
                                                      checked={selected}
                                                      onChange={() => handleAnswerChange(`${q.id}_${ri}_${ci}`, letter)}
                                                    />
                                                    <span className={'text-sm select-none ' + (darkMode ? 'text-gray-100' : 'text-gray-900')}>
                                                      {letter}) {option.trim()}
                                                    </span>
                                                  </label>
                                                );
                                              })}
                                            </div>
                                          )}
                                          {cell?.questionType === 'true_false' && (
                                            <div className="flex gap-2">
                                              {['True', 'False', 'Not Given'].map((val) => {
                                                const selected = (answers[`${q.id}_${ri}_${ci}`]?.answer as string) === val;
                                                return (
                                                  <button
                                                    key={val}
                                                    onClick={() => handleAnswerChange(`${q.id}_${ri}_${ci}`, val)}
                                                    className={`px-2 py-1 rounded border text-xs ${selected ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-300 text-gray-700 hover:bg-gray-50'}`}
                                                  >{val}</button>
                                                );
                                              })}
                                            </div>
                                          )}
                                          {cell?.questionType === 'short_answer' && (
                                            <input
                                              type="text"
                                              value={(answers[`${q.id}_${ri}_${ci}`]?.answer as string) || ''}
                                              onChange={(e) => handleAnswerChange(`${q.id}_${ri}_${ci}`, e.target.value)}
                                              className={'w-full px-2 py-1 rounded border focus:ring-2 ' + (darkMode ? 'bg-gray-700 text-white border-gray-600 focus:ring-blue-500' : 'bg-white text-gray-900 border-gray-300 focus:ring-blue-300')}
                                              placeholder="Short answer..."
                                              maxLength={50}
                                            />
                                          )}
                                          {cell?.points && (
                                            <div className="text-xs text-gray-500">({cell.points} point{cell.points !== 1 ? 's' : ''})</div>
                                          )}
                                        </div>
                                      ) : (
                                        <div className="text-gray-500 italic">Unknown cell type</div>
                                      )}
                                    </td>
                                  ))}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        <div className="text-xs text-gray-500 mt-2">Answer the questions directly in the table above.</div>
                      </div>
                    );
                  }

                  // Legacy Table Rendering (existing complex system)
                  const isLegacy = q.questionType === 'essay' && q.metadata?.tableBlock;
                  const tableMeta = isLegacy ? (q.metadata?.tableBlock || {}) : (q.metadata?.table || {});
                  const rows: string[][] = tableMeta.rows || [];
                  if (!rows.length) {
                    return debugTables ? (<div className="mb-6 text-xs text-red-600 border border-red-300 rounded p-2">[Debug] Table container Q{q.questionNumber} has empty rows array.</div>) : null;
                  }
                  return (
                    <div className="mb-8 pb-4 border-b border-dashed border-gray-300 dark:border-gray-700">
                      {q.questionText && <div className="mb-2 font-medium text-sm whitespace-pre-wrap leading-snug">{normalizeNewlines(q.questionText)}</div>}
                      <div className="overflow-auto">
                        <table className={'text-xs min-w-[480px] border ' + (darkMode ? 'border-gray-600' : 'border-gray-300')}>
                          <tbody>
                            {rows.map((r, ri) => (
                              <tr key={ri} className={darkMode ? 'border-b border-gray-700 last:border-b-0' : 'border-b border-gray-200 last:border-b-0'}>
                                {r.map((cell, ci) => {
                                  const parts = String(cell||'').split(/(\[\[\d+\]\])/g).filter(Boolean);
                                  return (
                                    <td key={ci} className={(darkMode ? 'border-r border-gray-700' : 'border-r border-gray-200') + ' last:border-r-0 p-2 align-top whitespace-pre-wrap'}>
                                      {parts.map((p, pi) => {
                                        const mm = p.match(/^\[\[(\d+)\]\]$/);
                                        if (mm) {
                                          const num = Number(mm[1]);
                                          const related = (currentSection?.questions || []).find((qq:any)=> qq.questionNumber === num);
                                          if (related) {
                                            if (['fill_blank','short_answer'].includes(related.questionType)) {
                                              const val = (answers[related.id]?.answer as string) || '';
                        return (
                                                <input
                                                  key={pi}
                                                  type="text"
                                                  value={val}
                                                  onChange={(e)=> handleAnswerChange(related.id, e.target.value)}
                                                  className={'mx-0.5 inline-block px-2 py-0.5 rounded text-[11px] font-semibold text-center focus:ring-2 ' + (darkMode ? 'bg-gray-700 text-white focus:ring-blue-500' : 'bg-white border border-gray-300 focus:ring-blue-300')}
                                                  placeholder={String(num)}
                                                  style={{ width: Math.max(34, Math.min(140, val.length*9 + 26)) }}
                          data-qnum={num}
                                                />
                                              );
                                            }
                                            if (related.questionType === 'drag_drop') {
                                              const currentTok = (answers[related.id]?.answer as string) || '';
                                              return (
                                                <span key={pi} className={'mx-0.5 inline-flex items-center justify-center rounded border px-2 py-0.5 text-[11px] min-w-[34px] ' + (currentTok ? (darkMode ? 'bg-blue-700 border-blue-600 text-white' : 'bg-blue-600 border-blue-600 text-white') : (darkMode ? 'border-gray-600 bg-gray-700 text-gray-300' : 'border-gray-300 bg-gray-100 text-gray-700'))}>
                                                  {currentTok || num}
                                                </span>
                                              );
                                            }
                                          }
                                          return <span key={pi} className="inline-block bg-purple-600 text-white text-[11px] px-2 py-0.5 rounded mx-0.5">{num}</span>;
                                        }
                                        return <span key={pi}>{p}</span>;
                                      })}
                                    </td>
                                  );
                                })}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  );
                })()}
                {(() => {
                  const lastInstructionPerType: Record<string, string | undefined> = {};
                  // Fallback cache for fill_blank group instructions when only group members (groupMemberOf) or range tail questions show.
                  const resolvedGroupInstructionForAnchor: Record<string, string | undefined> = {};
                  const allQuestionsFlat: any[] = (currentSection?.questions || []).map((qq:any)=> {
                    if (qq && qq.metadata && typeof qq.metadata === 'string') { try { return { ...qq, metadata: JSON.parse(qq.metadata) }; } catch {} }
                    return qq;
                  });
                  const locateAnchorInstruction = (anchorId: string): string | undefined => {
                    if (resolvedGroupInstructionForAnchor[anchorId] !== undefined) return resolvedGroupInstructionForAnchor[anchorId];
                    const anchor = allQuestionsFlat.find(q=> q.id === anchorId);
                    let instr: string | undefined = anchor?.metadata?.groupInstruction;
                    // If anchor absent in this section, search previous sections (cross-section groups)
                    if (!instr && exam?.sections) {
                      for (const sec of exam.sections) {
                        for (const q of (sec.questions||[])) {
                          let meta = q.metadata; if (meta && typeof meta === 'string') { try { meta = JSON.parse(meta); } catch { meta = {}; } }
                          if (q.id === anchorId) { instr = meta?.groupInstruction; break; }
                        }
                        if (instr) break;
                      }
                    }
                    resolvedGroupInstructionForAnchor[anchorId] = instr;
                    return instr;
                  };
                  // Preprocess composite fill_blank templates: identify referenced question numbers and skip rule
                  const fillBlankByNumber: Record<number, any> = {};
                  (currentSection?.questions || []).forEach((q: any) => { if (q.questionType === 'fill_blank' && q.questionNumber) fillBlankByNumber[q.questionNumber] = q; });
                  const renderedCompositeNumbers = new Set<number>();
                  // Preprocess for listening: inject explicit instruction marker objects before each new fill_blank groupInstruction block
                  const renderQuestions: any[] = (() => {
                    if (!isListeningSection) return visibleQuestions;
                    const list = [...visibleQuestions].sort((a:any,b:any)=> (a.questionNumber||0)-(b.questionNumber||0));
                    const out: any[] = []; let lastGI: string | undefined;
                    for (const q of list) {
                      const gi = (q.questionType === 'fill_blank') ? q.metadata?.groupInstruction : undefined;
                      if (gi && gi !== lastGI) {
                        out.push({ __instruction: gi, __key: 'gi-'+q.id });
                        lastGI = gi;
                      }
                      out.push(q);
                    }
                    return out;
                  })();
                  return renderQuestions.map((q: any, idx: number) => {
                  if (q.__instruction) {
                    return (
                      <div key={q.__key} className={"mb-3 text-sm font-semibold rounded p-3 whitespace-pre-wrap leading-snug tracking-normal "+warningPanel}>{q.__instruction}</div>
                    );
                  }
                  // Writing: only show the active part's question on the right
                  if (isWritingSection && (q.questionType === 'writing_task1' || q.questionType === 'essay')) {
                    try {
                      if (getWritingPart(q) !== currentWritingPart) return null;
                    } catch {}
                  }
                  let metaAny: any = q.metadata;
                  if (metaAny && typeof metaAny === 'string') {
                    try { metaAny = JSON.parse(metaAny); } catch { metaAny = {}; }
                  }
                  if (!metaAny || typeof metaAny !== 'object') metaAny = {};
                  if (q.metadata !== metaAny) {
                    q.metadata = metaAny;
                  }
                  const dropdownRaw = metaAny?.displayMode ?? metaAny?.display_mode ?? metaAny?.renderMode ?? metaAny?.dropdown ?? q.displayMode ?? q.renderMode ?? (typeof q.dropdown !== 'undefined' ? q.dropdown : undefined);
                  const dropdownMode = dropdownRaw === true
                    || dropdownRaw === 'dropdown'
                    || dropdownRaw === 'Dropdown'
                    || (typeof dropdownRaw === 'string' && dropdownRaw.toLowerCase() === 'dropdown')
                    || (typeof dropdownRaw === 'string' && dropdownRaw.toLowerCase() === 'true');
                  if (typeof window !== 'undefined') {
                    const dbg = (window as any).__dropdownDebug || ((window as any).__dropdownDebug = {});
                    dbg[q.id] = {
                      qnum: q.questionNumber,
                      dropdownRaw,
                      dropdownMode,
                      metadata: metaAny,
                    };
                    if (dropdownMode) {
                      console.log('[DropdownRender]', q.id, q.questionNumber, dropdownRaw, metaAny);
                    }
                  }
                  const displayNumber = (blankNumberMap[q.id]?.[0]) || q.questionNumber || (idx + 1);
                  // Interactive fill_blank: support placeholders {answer1} OR runs of underscores ___ inline.
                  let renderedQuestionText: React.ReactNode = normalizeNewlines(q.questionText) || q.text;
                  let hasInlinePlaceholders = false;
                  // Composite template support: metadata.compositeTemplate containing tokens [[34]] or [[Q34]] referencing other fill_blank question numbers.
                  if (q.questionType === 'fill_blank' && q.metadata?.compositeTemplate) {
                    const template: string = q.metadata.compositeTemplate;
                    const tokenRegex = /\[\[(?:Q)?(\d+)\]\]/g;
                    const referencedNums: number[] = [];
                    let m: RegExpExecArray | null;
                    while ((m = tokenRegex.exec(template)) !== null) {
                      referencedNums.push(Number(m[1]));
                    }
                    if (referencedNums.length) {
                      const minNum = Math.min(...referencedNums);
                      // Only render once for the lowest referenced question to avoid duplication
                      if (displayNumber !== minNum) {
                        // Mark this number as rendered by composite anchor so it's skipped
                        renderedCompositeNumbers.add(displayNumber);
                        return null;
                      }
                      // Build nodes replacing tokens with inputs bound to individual questions
                      const parts: React.ReactNode[] = [];
                      let lastIndex = 0; let match;
                      tokenRegex.lastIndex = 0; // reset
                      while ((match = tokenRegex.exec(template)) !== null) {
                        const before = template.slice(lastIndex, match.index);
                        if (before) parts.push(before);
                        const num = Number(match[1]);
                        const targetQ = fillBlankByNumber[num];
                        if (targetQ) {
                          renderedCompositeNumbers.add(num);
                          const blankNumbers = blankNumberMap[targetQ.id] || [];
                          const idxLocal = (() => {
                            if (!blankNumbers.length) return 0;
                            const idx = blankNumbers.indexOf(num);
                            if (idx >= 0) return idx;
                            const base = typeof targetQ.questionNumber === 'number' ? targetQ.questionNumber : num;
                            const offset = num - base;
                            return offset >= 0 ? offset : 0;
                          })();
                          const values = getBlankValues(targetQ.id);
                          const val = values[idxLocal] || '';
                          parts.push(
                            <span key={`comp-${targetQ.id}`} className="mx-1 inline-block align-middle">
                              <span className="relative inline-flex">
                                <input
                                  type="text"
                                  className="px-2 py-1 border border-gray-400 rounded-sm text-sm min-w-[110px] focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-center font-medium tracking-wide"
                                  value={val}
                                  onChange={(e) => handleAnswerChange(targetQ.id, e.target.value, idxLocal)}
                                  data-qnum={blankNumbers.length > idxLocal ? blankNumbers[idxLocal] : num}
                                />
                                {!val && (
                                  <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-[13px] font-semibold text-gray-700 select-none">{num}</span>
                                )}
                              </span>
                            </span>
                          );
                        } else {
                          parts.push(<span key={`missing-${num}`} className="text-red-600 font-semibold">[{num}?]</span>);
                        }
                        lastIndex = match.index + match[0].length;
                      }
                      const tail = template.slice(lastIndex);
                      if (tail) parts.push(tail);
                      renderedQuestionText = <span className="leading-relaxed flex flex-wrap items-center">{parts}</span>;
                    }
                  }
                  if (q.questionType === 'fill_blank' && renderedCompositeNumbers.has(displayNumber) && !(q.metadata?.compositeTemplate && q.questionNumber === Math.min(...Array.from(renderedCompositeNumbers.values())))) {
                    // Skip separately rendered composite members
                    // (Non-anchor members already skipped earlier return null path)
                  }
                  if (q.questionType === 'fill_blank' && typeof (q.questionText || '') === 'string') {
                    const hasComposite = !!q.metadata?.compositeTemplate; // compositeTemplate manages its own referenced blanks
                    // Normalize duplicate / non-sequential {answerX} tokens client-side so each blank maps to its own index.
                    // We DO NOT persist this change; it's only for rendering + answer array indexing.
                    // Rationale: authors sometimes copy/paste and leave {answer1} repeated which previously caused
                    // multiple inputs to bind to index 0 (mirrored typing). We rewrite to {answer1}{answer2}... left-to-right.
                    let text = q.questionText as string;
                    const placeholderMatches = hasComposite ? [] : [...text.matchAll(/\{answer(\d+)\}/gi)];
                    if (placeholderMatches.length) {
                      // Determine whether indices are strictly 1..n; if not, rewrite.
                      let needsRewrite = false;
                      for (let i = 0; i < placeholderMatches.length; i++) {
                        const rawIdx = Number(placeholderMatches[i][1]);
                        if (isNaN(rawIdx) || rawIdx !== i + 1) { needsRewrite = true; break; }
                      }
                      if (needsRewrite) {
                        let counter = 1;
                        text = text.replace(/\{answer(\d+)\}/gi, () => `{answer${counter++}}`);
                        try {
                          const dbg = (window as any).__placeholderDebug || ((window as any).__placeholderDebug = {});
                          dbg[q.id] = { original: q.questionText, normalized: text };
                        } catch {}
                      }
                    }
                    const hasCurly = /\{answer\d+\}/i.test(text);
                    const hasUnderscore = /_{3,}/.test(text);
                    if (hasCurly || hasUnderscore) {
                      hasInlinePlaceholders = true;
                      // Conversation style: split on newlines with speaker labels (e.g., MAN:, WOMAN:, M: ) and keep tighter spacing
                      const isConversation = !!q.metadata?.conversation;
                      const speakerRegex = /^(?:[A-Z][A-Za-z']{0,12}|Man|Woman|Boy|Girl|Host|Speaker|Student|Tutor|Agent|Caller|Customer|Professor|Lecturer|Guide)\s*:/;
                      const nodes: React.ReactNode[] = [];
                      const answerArray = getBlankValues(q.id);
                      if (hasCurly) {
                        const regex = /\{(answer\d+)\}/gi;
                        let lastIndex = 0; let match; let blankIndex = 0;
                        while ((match = regex.exec(text)) !== null) {
                          const before = text.slice(lastIndex, match.index);
                          if (before) nodes.push(before);
                          const idxLocal = blankIndex;
                          const val = answerArray[idxLocal] || '';
                          let overlayNumber: number | undefined;
                          const overlayList = blankNumberMap[q.id];
                          if (overlayList && overlayList.length > idxLocal) {
                            const isMulti = overlayList.length > 1;
                            if (!((q.metadata?.singleNumber || q.metadata?.combineBlanks) && isMulti)) {
                              overlayNumber = overlayList[idxLocal];
                            }
                          }
                          nodes.push(
                            <span key={`blank-${q.id}-${idxLocal}`} className="mx-1 inline-block align-middle">
                              <span className="relative inline-flex">
                                <input
                                  type="text"
                                  className={"px-2 py-1 rounded-sm text-sm min-w-[110px] focus:ring-2 text-center font-medium tracking-wide transition-colors " + inputBase + ' ' + blankInputExtra}
                                  value={val}
                                  onChange={(e) => handleAnswerChange(q.id, e.target.value, idxLocal)}
                                  data-qnum={(() => { const nums = blankNumberMap[q.id]; return (nums && nums.length > idxLocal) ? nums[idxLocal] : undefined; })()}
                                />
                                {!val && overlayNumber !== undefined && (
                                  <span className={"pointer-events-none absolute inset-0 flex items-center justify-center text-[13px] font-semibold select-none " + (darkMode ? 'text-gray-500' : 'text-gray-700')}>{overlayNumber}</span>
                                )}
                              </span>
                            </span>
                          );
                          blankIndex++;
                          lastIndex = regex.lastIndex;
                        }
                        const tail = text.slice(lastIndex);
                        if (tail) nodes.push(tail);
                      } else if (hasUnderscore) {
                        const uRegex = /_{3,}/g;
                        let lastIndexU = 0; let matchU; let blankIndex = 0;
                        while ((matchU = uRegex.exec(text)) !== null) {
                          const before = text.slice(lastIndexU, matchU.index);
                          if (before) nodes.push(before);
                          const idxLocal = blankIndex;
                          const val = answerArray[idxLocal] || '';
                          let overlayNumber: number | undefined;
                          const overlayList = blankNumberMap[q.id];
                          if (overlayList && overlayList.length > idxLocal) {
                            const isMulti = overlayList.length > 1;
                            if (!((q.metadata?.singleNumber || q.metadata?.combineBlanks) && isMulti)) {
                              overlayNumber = overlayList[idxLocal];
                            }
                          }
                          nodes.push(
                            <span key={`ublank-${q.id}-${idxLocal}`} className="mx-1 inline-block align-middle">
                              <span className="relative inline-flex">
                                <input
                                  type="text"
                                  className={"px-2 py-1 rounded-sm text-sm min-w-[110px] focus:ring-2 text-center font-medium tracking-wide transition-colors " + inputBase + ' ' + blankInputExtra}
                                  value={val}
                                  onChange={(e) => handleAnswerChange(q.id, e.target.value, idxLocal)}
                                  data-qnum={(() => { const nums = blankNumberMap[q.id]; return (nums && nums.length > idxLocal) ? nums[idxLocal] : undefined; })()}
                                />
                                {!val && overlayNumber !== undefined && (
                                  <span className={"pointer-events-none absolute inset-0 flex items-center justify-center text-[13px] font-semibold select-none " + (darkMode ? 'text-gray-500' : 'text-gray-700')}>{overlayNumber}</span>
                                )}
                              </span>
                            </span>
                          );
                          blankIndex++;
                          lastIndexU = uRegex.lastIndex;
                        }
                        const tail = text.slice(lastIndexU);
                        if (tail) nodes.push(tail);
                      }
                      if (isConversation) {
                        // Reconstruct full string with placeholder markers replaced by inputs already in nodes order.
                        // Simplify: treat nodes as sequence already including inputs & text fragments.
                        renderedQuestionText = <div className="flex flex-col gap-1 text-[15px] font-normal" style={{lineHeight:1.4}}>{
                          // Convert flat nodes array into lines separated by original \n tokens we preserved in text fragments
                          (()=> {
                            // nodes currently doesn't preserve newlines explicitly; rebuild by re-processing original text again but injecting input components sequentially.
                            const rebuilt: React.ReactNode[] = [];
                            let blankCursor = 0;
                            const pattern = hasCurly ? /\{answer\d+\}/gi : /_{3,}/g;
                            let lastIndex = 0; let match; let lineBuffer: React.ReactNode[] = [];
                            const flush = () => { if (lineBuffer.length) { rebuilt.push(<div key={'line-'+rebuilt.length} className="whitespace-pre-wrap">
                              {lineBuffer.map((n,i)=> <React.Fragment key={i}>{n}</React.Fragment>)}
                            </div>); lineBuffer = []; } };
                            while ((match = pattern.exec(text)) !== null) {
                              const before = text.slice(lastIndex, match.index);
                              const parts = before.split(/(\n)/);
                              for (const part of parts) {
                                if (part === '\n') { flush(); continue; }
                                if (part) {
                                  // Detect speaker label
                                  if (speakerRegex.test(part.trim())) {
                                    const [label, rest] = part.split(':');
                                    lineBuffer.push(<span key={'sp-'+rebuilt.length+'-'+lineBuffer.length} className="font-semibold mr-2 text-blue-700 dark:text-blue-300">{label.trim()}:</span>);
                                    if (rest) lineBuffer.push(rest);
                                  } else {
                                    lineBuffer.push(part);
                                  }
                                }
                              }
                              // Insert input component aligned center small
                              const idxLocal = blankCursor;
                              const val = answerArray[idxLocal] || '';
                              let overlayNumber: number | undefined;
                              const overlayList = blankNumberMap[q.id];
                              if (overlayList && overlayList.length > idxLocal) {
                                const isMulti = overlayList.length > 1;
                                if (!((q.metadata?.singleNumber || q.metadata?.combineBlanks) && isMulti)) {
                                  overlayNumber = overlayList[idxLocal];
                                }
                              }
                              lineBuffer.push(
                                <span key={'convblank-'+idxLocal} className="mx-1 inline-block align-middle">
                                  <span className="relative inline-flex">
                                    <input
                                      type="text"
                                      className={"px-2 py-1 rounded-sm text-sm min-w-[90px] focus:ring-2 text-center font-medium tracking-wide transition-colors " + inputBase + ' ' + blankInputExtra}
                                      value={val}
                                      onChange={(e) => handleAnswerChange(q.id, e.target.value, idxLocal)}
                                      data-qnum={(() => { const nums = blankNumberMap[q.id]; return (nums && nums.length > idxLocal) ? nums[idxLocal] : undefined; })()}
                                    />
                                    {!val && overlayNumber !== undefined && (
                                      <span className={"pointer-events-none absolute inset-0 flex items-center justify-center text-[12px] font-semibold select-none " + (darkMode ? 'text-gray-500' : 'text-gray-700')}>{overlayNumber}</span>
                                    )}
                                  </span>
                                </span>
                              );
                              blankCursor++;
                              lastIndex = pattern.lastIndex;
                            }
                            const tail = text.slice(lastIndex);
                            if (tail) {
                              tail.split(/(\n)/).forEach((part: string) => {
                                if (part === '\n') { flush(); return; }
                                if (part) {
                                  if (speakerRegex.test(part.trim())) {
                                    const [label, rest] = part.split(':');
                                    lineBuffer.push(<span key={'sp-tail-'+rebuilt.length+'-'+lineBuffer.length} className="font-semibold mr-2 text-blue-700 dark:text-blue-300">{label.trim()}:</span>);
                                    if (rest) lineBuffer.push(rest);
                                  } else lineBuffer.push(part);
                                }
                              });
                            }
                            flush();
                            return rebuilt;
                          })()
                        }</div>;
                      } else {
                        renderedQuestionText = <span className="leading-relaxed flex flex-wrap items-center">{nodes}</span>;
                      }
                    }
                  }
                    let groupInstruction: string | undefined = q.metadata?.groupInstruction;
                    let showGroupInstruction = false;
                    // Alternative injection for listening: if this question starts a new instruction block per listeningInstructionMap, use it.
                    let debugReasons: string[] = [];
                    if (isListeningSection && q.questionNumber && listeningInstructionMap[q.questionNumber]) {
                      groupInstruction = listeningInstructionMap[q.questionNumber];
                      showGroupInstruction = true;
                      debugReasons.push('listeningInstructionMap match');
                    } else if (groupInstruction) {
                      if (q.questionType === 'fill_blank') {
                        // Reading: show instruction only once per group (anchor or first occurrence)
                        if (!isListeningSection) {
                          const isMember = !!q.metadata?.groupMemberOf;
                          if (!isMember && groupInstruction !== lastInstructionPerType['fill_blank']) {
                            showGroupInstruction = true;
                            lastInstructionPerType['fill_blank'] = groupInstruction;
                            debugReasons.push('fill_blank anchor/new instruction');
                          }
                        }
                        // Listening handled earlier via listeningInstructionMap/__instruction injection
                      } else if (groupInstruction !== lastInstructionPerType[q.questionType]) {
                        showGroupInstruction = true;
                        lastInstructionPerType[q.questionType] = groupInstruction;
                        debugReasons.push('direct new type instruction');
                      }
                    } else if (!groupInstruction) {
                      // Fallback: if this question is member of a group OR falls within a group range tail, surface the anchor's instruction once.
                      const meta = q.metadata || {};
                      const anchorId: string | undefined = meta.groupMemberOf;
                      // Range tail scenario: current questionNumber lies between some anchor questionNumber and its groupRangeEnd.
                      let rangeAnchorId: string | undefined;
                      if (!anchorId && typeof q.questionNumber === 'number') {
                        for (const cand of allQuestionsFlat) {
                          if (cand?.metadata?.groupRangeEnd && cand.id !== q.id && typeof cand.questionNumber === 'number') {
                            if (q.questionNumber > cand.questionNumber && q.questionNumber <= cand.metadata.groupRangeEnd) {
                              rangeAnchorId = cand.id; break;
                            }
                          }
                        }
                      }
                      const effectiveAnchor = anchorId || rangeAnchorId;
                      if (effectiveAnchor) {
                        let instr = locateAnchorInstruction(effectiveAnchor);
                        // Extra fallback: if anchor lacks instruction, look at its members for one.
                        if (!instr) {
                          const memberWithInstr = allQuestionsFlat.find(m => m?.metadata?.groupMemberOf === effectiveAnchor && m?.metadata?.groupInstruction);
                          if (memberWithInstr) instr = memberWithInstr.metadata.groupInstruction;
                        }
                        if (instr) {
                          groupInstruction = instr;
                          if (lastInstructionPerType['fill_blank'] !== instr) {
                            showGroupInstruction = true;
                            lastInstructionPerType['fill_blank'] = instr;
                            debugReasons.push('anchor/member fallback (once)');
                          }
                        }
                      }
                    }
                    // Remove absolute fallback for fill_blank to avoid repeating instructions per question in reading sections
                    if (instructionDebug && q.questionType === 'fill_blank') {
                      console.debug('[InstrDebug] Q', q.questionNumber, q.id, 'showInstruction=', showGroupInstruction, 'reasons=', debugReasons, 'groupInstructionSnippet=', (groupInstruction||'').slice(0,60));
                    }
                  return (
                  <div ref={el => { if (el) questionRefs.current[q.id] = el; }} key={q.id} className="mb-3 pb-3 border-b last:border-0 last:pb-0">
                    {showGroupInstruction && (
                      <div className={"mb-3 text-sm font-semibold rounded p-3 whitespace-pre-wrap leading-snug tracking-normal " + warningPanel}>
                        {groupInstruction}
                      </div>
                    )}
                    {(() => {
                      // For single blank fill_blank show number inside the blank (already via overlayNumber) and hide heading number.
                      let singleInlineBlank = false;
                      if (q.questionType === 'fill_blank') {
                        const qt = q.questionText || '';
                        const curly = (qt.match(/\{answer\d+\}/gi) || []).length;
                        const underscores = (qt.match(/_{3,}/g) || []).length;
                        const blanks = curly || underscores || 1;
                        singleInlineBlank = blanks === 1;
                      }
                      const isRangeAnchor = !!q.metadata?.groupRangeEnd;
                      const hasGroupInstruction = !!q.metadata?.groupInstruction;
                      // Previously we hid the header number for ANY single blank fill_blank question. This caused range anchors (e.g. Questions 19–20) and
                      // instruction-carrying single blanks to merge visually with the preceding question (no "Questions X–Y" heading). We now always show
                      // the heading when the item defines a range (groupRangeEnd) or carries a groupInstruction, even if it has only one blank.
                      const hideHeaderNumber = q.questionType === 'fill_blank' && singleInlineBlank && !isRangeAnchor && !hasGroupInstruction;
                      return (
                        <div className={"mb-2 " + (hideHeaderNumber ? 'mt-2' : '')}>
                          <h3 className={"text-base font-medium flex flex-wrap items-start gap-1 " + primaryTextClass}>
                            {!hideHeaderNumber && (
                              <span className={secondaryTextClass}>
                                {(() => {
                                  if (q.metadata?.groupRangeEnd) return `Questions ${q.questionNumber}–${q.metadata.groupRangeEnd}`;
                                  const nums = blankNumberMap[q.id];
                                  if (q.questionType === 'fill_blank' && nums && nums.length > 1 && !q.metadata?.singleNumber) return `Questions ${nums[0]}–${nums[nums.length - 1]}`;
                                  if (q.questionType === 'fill_blank' && nums && nums.length > 1 && !(q.metadata?.singleNumber || q.metadata?.combineBlanks)) return `Questions ${nums[0]}–${nums[nums.length - 1]}`;
                                  return `Question ${displayNumber}`;
                                })()} -
                              </span>
                            )}
                            <span className={"font-medium " + primaryTextClass}>{renderedQuestionText}</span>
                          </h3>
                        </div>
                      );
                    })()}

                    {/* Inline per-section audio removed; centralized exam-level audio player used */}

                    {(q.passage) && (
                      <div className={(darkMode ? 'bg-gray-700' : 'bg-gray-50') + ' p-3 rounded mb-3'}>
                        <h4 className={(darkMode ? 'text-gray-100' : 'text-gray-900') + ' font-medium mb-2'}>Passage:</h4>
                        <div className={(darkMode ? 'text-gray-200' : 'text-gray-700') + ' leading-relaxed'}>{q.passage}</div>
                      </div>
                    )}

                    {(q.questionType === 'multiple_choice' || q.type === 'multiple_choice' || q.questionType === 'drag_drop') && (
                      <div className="mb-2">
                        {q.questionType === 'multiple_choice' && q.metadata?.allowMultiSelect ? (
                          <div className="space-y-1">
                            {(q.options || []).map((opt: any, oIdx: number) => {
                              const letter = opt.letter || opt.option_letter || String.fromCharCode(65 + oIdx);
                              const label = opt.text || opt.option_text || '';
                              const current = Array.isArray(answers[q.id]?.answer) ? (answers[q.id]?.answer as string[]) : [];
                              const checked = current.includes(letter);
                              const maxSel = Number(q.metadata.selectCount) || 2;
                              return (
                                <div
                                  key={letter}
                                  className={`flex items-start gap-2 text-sm px-3 py-2 border rounded cursor-pointer select-none transition-colors ${checked ? (darkMode ? 'bg-blue-700 border-blue-600 text-white' : 'bg-blue-100 border-blue-300') : (darkMode ? 'bg-gray-800 border-gray-600 hover:bg-gray-700' : 'bg-white border-gray-300 hover:bg-gray-50 active:bg-gray-100')}`}
                                  onClick={() => {
                                    let next = [...current];
                                    if (checked) {
                                      next = next.filter(l => l !== letter);
                                    } else if (next.length < maxSel) {
                                      next.push(letter);
                                    } else {
                                      next[next.length - 1] = letter;
                                    }
                                    handleAnswerChange(q.id, next);
                                  }}
                                  role="checkbox"
                                  aria-checked={checked}
                                  tabIndex={0}
                                  onKeyDown={(e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}
                                >
                                  <span className={`mt-0.5 inline-flex w-4 h-4 border rounded-sm items-center justify-center text-[10px] font-semibold ${checked ? 'bg-blue-500 border-blue-500 text-white' : (darkMode ? 'border-gray-500 text-transparent' : 'border-gray-400 text-transparent')}`}>✓</span>
                                  <span className="flex-1">{label}</span>
                                </div>
                              );
                            })}
                            <div className={'text-[10px] mt-1 ' + (darkMode ? 'text-gray-400' : 'text-gray-500')}>Select {q.metadata.selectCount || 2} answers.</div>
                          </div>
                        ) : (
                          <div className="space-y-1">
                    {dropdownMode ? (
                      <div className="flex items-center gap-2">
                        <select
                          className={`text-sm px-3 py-2 rounded border w-full ${darkMode ? 'bg-gray-800 border-gray-600 text-gray-100' : 'bg-white border-gray-300 text-gray-900'} focus:outline-none focus:ring-2 focus:ring-blue-500`}
                          value={typeof answers[q.id]?.answer === 'string' ? (answers[q.id]?.answer as string) : ''}
                          onChange={(e) => handleAnswerChange(q.id, e.target.value)}
                        >
                          <option value="">-- Select --</option>
                          {(q.options || []).map((option: any, index: number) => {
                            const letter = (option.letter || option.option_letter || '').toString().trim() || (index < 26 ? String.fromCharCode(65 + index) : String(index + 1));
                            const text = option.text || option.option_text || '';
                            return <option key={option.id || `${q.id}_${index}`} value={letter}>{letter}) {text || `Option ${letter}`}</option>;
                          })}
                        </select>
                      </div>
                    ) : (
                              (q.options || []).map((option: any, index: number) => {
                                const rawValue = option.value ?? option.letter ?? option.option_letter ?? option.text ?? option;
                                const value = typeof rawValue === 'string' ? rawValue : String(rawValue ?? '');
                                const optionLetter = (option.letter || option.option_letter || '').toString().trim();
                                const indicator = optionLetter ? optionLetter.toUpperCase() : (index < 26 ? String.fromCharCode(65 + index) : String(index + 1));
                                const baseText = option.text || option.option_text || (typeof option === 'string' ? option : '');
                                const label = baseText || value;
                                const currentRaw = answers[q.id]?.answer;
                                const current = typeof currentRaw === 'string' ? currentRaw : '';
                                const isSelected = current === value;
                                return (
                                  <div
                                    key={option.id || `${q.id}_${index}`}
                                    className={`flex items-center gap-3 text-sm px-3 py-2 border rounded cursor-pointer select-none transition-colors ${isSelected ? (darkMode ? 'bg-blue-700 border-blue-600 text-white' : 'bg-blue-100 border-blue-300') : (darkMode ? 'bg-gray-800 border-gray-600 hover:bg-gray-700' : 'bg-white border-gray-300 hover:bg-gray-50 active:bg-gray-100')}`}
                                    onClick={() => handleAnswerChange(q.id, value)}
                                    role="radio"
                                    aria-checked={isSelected}
                                    tabIndex={0}
                                    onKeyDown={(e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}
                                  >
                                    <span className={`mt-0.5 inline-flex w-6 h-6 border rounded-full items-center justify-center text-[11px] font-semibold ${isSelected ? (darkMode ? 'bg-blue-500 border-blue-500 text-white' : 'bg-blue-500 border-blue-500 text-white') : (darkMode ? 'border-gray-500 text-gray-300' : 'border-gray-400 text-gray-700')}`}>
                                      {indicator}
                                    </span>
                                    <span className="flex-1 text-left">
                                      {label}
                                    </span>
                                  </div>
                                );
                              })
                            )}
                          </div>
                        )}
                      </div>
                    )}

                    {q.questionType === 'multi_select' && (
                      <div className="mb-2 space-y-1">
                        {(q.options || []).map((opt: any, idx: number) => {
                          const letter = opt.letter || opt.option_letter || String.fromCharCode(65 + idx);
                          const label = opt.option_text || opt.text || '';
                          const current = Array.isArray(answers[q.id]?.answer) ? (answers[q.id]?.answer as string[]) : [];
                          const checked = current.includes(letter);
                          return (
                            <label
                              key={letter}
                              className={`flex items-start gap-2 text-sm px-3 py-2 border rounded cursor-pointer select-none ${checked ? (darkMode ? 'bg-blue-700 border-blue-600 text-white' : 'bg-blue-100 border-blue-300') : (darkMode ? 'bg-gray-800 border-gray-600 hover:bg-gray-700' : 'bg-white border-gray-300 hover:bg-gray-50')}`}
                              onClick={() => {
                                let next = [...current];
                                if (checked) next = next.filter(l => l !== letter); else if (next.length < 2) next.push(letter); else {
                                  // Replace the second selection keeping the first
                                  next = [next[0], letter];
                                }
                                handleAnswerChange(q.id, next);
                              }}
                            >
                              <input type="checkbox" className={'mt-1 ' + (darkMode ? 'accent-blue-500' : '')} checked={checked} readOnly />
                              <span className="flex-1">{label}</span>
                            </label>
                          );
                        })}
                        <div className={'text-[10px] ' + (darkMode ? 'text-gray-400' : 'text-gray-500')}>Choose TWO answers.</div>
                      </div>
                    )}

                    {/* Matching dropdown removed in favor of drag & drop UI on left */}

                    {/* Assign selected heading button removed */}

                    {(q.questionType === 'true_false') && (
                      <div className="space-y-1">
                        {['TRUE','FALSE','NOT GIVEN'].map((raw, idx) => {
                          const label = raw.replace('NOT GIVEN','Not Given').replace('TRUE','True').replace('FALSE','False');
                          const selected = (typeof answers[q.id]?.answer === 'string' ? (answers[q.id]?.answer as string) : '').toLowerCase() === label.toLowerCase();
                          return (
                            <label
                              key={idx}
                              className={`flex items-start gap-2 cursor-pointer rounded px-3 py-2 border transition-colors ${selected ? (darkMode ? 'bg-blue-700 border-blue-600 text-white' : 'bg-gray-200 border-gray-300') : (darkMode ? 'border-gray-600 hover:bg-gray-700' : 'border-transparent hover:bg-gray-100')}`}
                              onClick={() => handleAnswerChange(q.id, label)}
                            >
                              <input
                                type="radio"
                                className={'mt-1 ' + (darkMode ? 'accent-blue-500' : '')}
                                name={`question-${q.id}`}
                                value={label}
                                checked={selected}
                                onChange={() => handleAnswerChange(q.id, label)}
                              />
                              <span className={'text-sm select-none ' + (darkMode ? 'text-gray-100' : 'text-gray-900')}>{label}</span>
                            </label>
                          );
                        })}
                      </div>
                    )}

                    {/* Table containers: new types (table_fill_blank, table_drag_drop) or legacy essay with metadata.tableBlock */}
                    {/* Diagnostic log for table containers */}
                    {(() => {
                      if (q.questionType && (q.questionType === 'table_fill_blank' || q.questionType === 'table_drag_drop')) {
                        try {
                          // Log once per question id
                          if (!(window as any).__loggedTableIds) (window as any).__loggedTableIds = new Set();
                          if (!(window as any).__loggedTableIds.has(q.id)) {
                            (window as any).__loggedTableIds.add(q.id);
                            // eslint-disable-next-line no-console
                            console.debug('[ExamTaking] Table container detected', {
                              id: q.id, qnum: q.questionNumber, type: q.questionType, hasTable: !!q.metadata?.table, metadataKeys: q.metadata ? Object.keys(q.metadata) : []
                            });
                          }
                        } catch {}
                      }
                      return null;
                    })()}
                    {(((q.questionType === 'table_fill_blank' || q.questionType === 'table_drag_drop') && (q.metadata?.table || q.questionNumber === 1)) || (q.questionType === 'essay' && q.metadata?.tableBlock)) && (() => {
                      const tableData = (q.questionType === 'table_fill_blank' || q.questionType === 'table_drag_drop') ? q.metadata.table : q.metadata.tableBlock;
                      const tableRows: string[][] = tableData?.rows || [];
                      // Collect placeholder numbers [[n]] appearing anywhere in table to prep drag_drop token palettes
                      const placeholderNums = Array.from(new Set(
                        tableRows.flatMap(row => row.join(' ').match(/\[\[(\d+)\]\]/g) || [])
                          .map(t => Number(t.replace(/[^0-9]/g,'')))
                          .filter(n => !isNaN(n))
                      ));
                      // Build drag_drop groups for any drag_drop question numbers referenced
                      const allQs = (currentSection?.questions || []);
                      const dragMembers = allQs.filter((qq:any) => placeholderNums.includes(qq.questionNumber) && qq.questionType === 'drag_drop');
                      interface DragGroup { anchor: any; members: any[] }
                      const groupsMap: Record<string, DragGroup> = {};
                      dragMembers.forEach((m: any) => {
                        const anchorId = m.metadata?.groupMemberOf || m.id;
                        if (!groupsMap[anchorId]) {
                          const anchor = allQs.find((a:any) => a.id === anchorId) || m; // fallback to self
                          groupsMap[anchorId] = { anchor, members: [] };
                        }
                        if (m.id !== groupsMap[m.metadata?.groupMemberOf || m.id].anchor.id) groupsMap[anchorId].members.push(m);
                      });
                      const dragGroups = Object.values(groupsMap);
                      return (
                        <div className="space-y-3 text-sm">
                          {/* Token palettes for drag_drop groups */}
                          {dragGroups.length > 0 && (
                            <div className="space-y-2">
                              {dragGroups.map(g => {
                                const tokens: string[] = g.anchor.metadata?.tokens || [];
                                const used = new Set(g.members.map(m => (answers[m.id]?.answer as string) || '').filter(Boolean));
                                const available = tokens.filter(t => !used.has(t));
                                return (
                                  <div key={g.anchor.id} className="border rounded p-2 bg-gray-50 dark:bg-gray-800/40">
                                    <div className="flex items-center justify-between mb-1">
                                      <span className="text-[11px] font-semibold">Drag & Drop Tokens (Q{g.anchor.questionNumber}{g.anchor.metadata?.groupRangeEnd ? `–${g.anchor.metadata.groupRangeEnd}` : ''})</span>
                                      <span className="text-[10px] text-gray-500">{available.length} available</span>
                                    </div>
                                    <div className="flex flex-wrap gap-2">
                                      {available.map(tok => (
                                        <button
                                          key={tok}
                                          type="button"
                                          draggable
                                          onDragStart={(e)=> { e.dataTransfer.setData('text/token', JSON.stringify({ token: tok, anchorId: g.anchor.id })); setDraggingTokenAnchor(g.anchor.id); (e.currentTarget as HTMLElement).classList.add('drag-token-shadow'); }}
                                          onDragEnd={(e)=> { setDraggingTokenAnchor(null); setDragOverDragDropQuestion(null); (e.currentTarget as HTMLElement).classList.remove('drag-token-shadow'); }}
                                          className={'px-2 py-1 text-[11px] rounded border font-medium cursor-grab active:cursor-grabbing transition-all duration-200 ' + (darkMode ? 'bg-gray-700 border-gray-600 text-gray-100 hover:bg-gray-600' : 'bg-white border-gray-300 text-gray-800 hover:bg-gray-100')}
                                          style={{ transformOrigin:'center center' }}
                                        >{tok}</button>
                                      ))}
                                      {!available.length && <span className="text-[10px] italic text-gray-500">All placed</span>}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                          {/* Optional question text with inline references */}
                          {q.questionText && (
                            <div className={'text-sm font-medium whitespace-pre-wrap leading-snug ' + (darkMode ? 'text-gray-200' : 'text-gray-800')}>
                              {q.questionText.split(/(\[\[\d+\]\])/g).map((seg:string,i:number)=> {
                                const m = seg.match(/^\[\[(\d+)\]\]$/);
                                if (m) {
                                  const num = Number(m[1]);
                                  const related = allQs.find((qq:any)=> qq.questionNumber === num);
                                  if (related && ['fill_blank','short_answer'].includes(related.questionType)) {
                                    const val = (answers[related.id]?.answer as string) || '';
                    return (
                                      <input
                                        key={i}
                                        type="text"
                                        value={val}
                                        onChange={(e)=> handleAnswerChange(related.id, e.target.value)}
                                        className={'mx-1 inline-block px-2 py-0.5 rounded text-[11px] font-semibold text-center focus:ring-2 ' + (darkMode ? 'bg-gray-700 text-white focus:ring-blue-500' : 'bg-white border border-gray-300 focus:ring-blue-300')}
                                        placeholder={String(num)}
                                        style={{ width: Math.max(34, Math.min(120, val.length*10 + 24)) }}
                      data-qnum={num}
                                      />
                                    );
                                  }
                                  return <span key={i} className="inline-block bg-purple-600 text-white text-[11px] px-2 py-0.5 rounded mx-0.5">{num}</span>;
                                }
                                return <span key={i}>{seg}</span>;
                              })}
                            </div>
                          )}
                          <div className="overflow-auto">
                            <table className={'text-xs min-w-[480px] border ' + (darkMode ? 'border-gray-600' : 'border-gray-300')}>
                              <tbody>
                                {tableRows.map((row, ri) => {
                                  const sizeRow = (tableData?.sizes && tableData.sizes[ri]) || [];
                                  return (
                                    <tr key={ri} className={darkMode ? 'border-b border-gray-700 last:border-b-0' : 'border-b border-gray-200 last:border-b-0'}>
                                      {row.map((cell, ci) => {
                                        const sz = sizeRow[ci] || {};
                                        const width = sz.w ? Number(sz.w) : undefined;
                                        const height = sz.h ? Number(sz.h) : undefined;
                                        const parts = cell.split(/(\[\[\d+\]\])/g).filter(Boolean);
                                        return (
                                          <td key={ci} style={width ? { width, minWidth: width } : {}} className={(darkMode ? 'border-r border-gray-700' : 'border-r border-gray-200') + ' last:border-r-0 p-2 align-top whitespace-pre-wrap'}>
                                            <div style={height ? { minHeight: height } : {}} className="w-full">
                                              {parts.map((p, pi) => {
                                                const mm = p.match(/^\[\[(\d+)\]\]$/);
                                                if (mm) {
                                                  const num = Number(mm[1]);
                                                  const related = allQs.find((qq:any)=> qq.questionNumber === num);
                                                  if (related) {
                                                    if (['fill_blank','short_answer'].includes(related.questionType)) {
                                                      const val = (answers[related.id]?.answer as string) || '';
                            return (
                                                        <input
                                                          key={pi}
                                                          type="text"
                                                          value={val}
                                                          onChange={(e)=> handleAnswerChange(related.id, e.target.value)}
                                                          className={'mx-0.5 inline-block px-2 py-0.5 rounded text-[11px] font-semibold text-center focus:ring-2 ' + (darkMode ? 'bg-gray-700 text-white focus:ring-blue-500' : 'bg-white border border-gray-300 focus:ring-blue-300')}
                                                          placeholder={String(num)}
                                                          style={{ width: Math.max(34, Math.min(140, val.length*9 + 26)) }}
                              data-qnum={num}
                                                        />
                                                      );
                                                    } else if (related.questionType === 'drag_drop') {
                                                      const anchorId = related.metadata?.groupMemberOf || related.id;
                                                      const currentTok = (answers[related.id]?.answer as string) || '';
                                                      return (
                                                        <span
                                                          key={pi}
                                                          onDragOver={(e)=> { if (draggingTokenAnchor === anchorId) e.preventDefault(); }}
                                                          onDragEnter={(e)=> { if (draggingTokenAnchor === anchorId) { e.preventDefault(); setDragOverDragDropQuestion(related.id); } }}
                                                          onDragLeave={()=> { if (dragOverDragDropQuestion === related.id) setDragOverDragDropQuestion(null); }}
                                                          onDrop={(e)=> {
                                                            e.preventDefault();
                                                            try {
                                                              const data = JSON.parse(e.dataTransfer.getData('text/token') || '{}');
                                                              if (!data.token) return;
                                                              if (data.anchorId !== anchorId) return; // wrong group
                                                              // ensure uniqueness within group
                                                              allQs.filter((qq:any)=> qq.questionType==='drag_drop' && (qq.metadata?.groupMemberOf || qq.id)===anchorId).forEach((m:any)=> {
                                                                if ((answers[m.id]?.answer as string) === data.token && m.id !== related.id) {
                                                                  handleAnswerChange(m.id, '');
                                                                }
                                                              });
                                                              handleAnswerChange(related.id, data.token);
                                                              setRecentDropQuestion(related.id);
                                                              setTimeout(()=> { setRecentDropQuestion(qid=> qid===related.id ? null : qid); }, 650);
                                                            } catch {}
                                                            setDraggingTokenAnchor(null);
                                                            setDragOverDragDropQuestion(null);
                                                          }}
                                                          className={(function(){
                                                            const base = 'mx-0.5 inline-flex items-center justify-center rounded border px-2 py-0.5 text-[11px] min-w-[34px] min-h-[22px] transition-all duration-150 drop-target-bright ';
                                                            const state = currentTok ? (darkMode ? 'bg-blue-700 border-blue-600 text-white' : 'bg-blue-600 border-blue-600 text-white') : (darkMode ? 'border-gray-600 bg-gray-700 text-gray-300' : 'border-gray-300 bg-gray-100 text-gray-700');
                                                            const valid = draggingTokenAnchor === anchorId && !currentTok;
                                                            const over = dragOverDragDropQuestion === related.id;
                                                            const ring = over ? ' ring-2 ring-offset-1 ' + (darkMode ? 'ring-blue-400 ring-offset-gray-800' : 'ring-blue-500 ring-offset-white') : valid ? ' ring-1 ' + (darkMode ? 'ring-blue-400' : 'ring-blue-300') : '';
                                                            const pulse = (recentDropQuestion === related.id && currentTok) ? ' drop-pulse token-pop ' : '';
                                                            const flags = (valid ? ' is-valid' : '') + (over ? ' is-over' : '') + (currentTok ? ' has-token' : '');
                                                            return base + state + ring + pulse + flags;
                                                          })()}
                                                        >
                                                          {currentTok || num}
                                                          {currentTok && (
                                                            <button
                                                              type="button"
                                                              onClick={(e)=> { e.preventDefault(); e.stopPropagation(); handleAnswerChange(related.id, ''); }}
                                                              className={'ml-1 text-[10px] ' + (darkMode ? 'text-white/80 hover:text-white' : 'text-white/80 hover:text-white')}
                                                            >×</button>
                                                          )}
                                                        </span>
                                                      );
                                                    } else {
                                                      const answered = (answers[related.id]?.answer as string) || '';
                                                      return (
                                                        <span key={pi} className="inline-flex mx-0.5 relative">
                                                          <span className={(answered? 'bg-blue-600 text-white':'bg-gray-200 text-gray-700') + ' rounded px-2 py-0.5 text-[11px] font-semibold select-none'}>{num}</span>
                                                        </span>
                                                      );
                                                    }
                                                  }
                                                  return <span key={pi} className="inline-block bg-gray-300 text-gray-700 rounded px-1.5 py-0.5 text-[11px] font-semibold">{num}</span>;
                                                }
                                                return <span key={pi}>{p}</span>;
                                              })}
                                            </div>
                                          </td>
                                        );
                                      })}
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                          <div className={'text-[10px] ' + (darkMode ? 'text-gray-500':'text-gray-500')}>Enter answers directly into the inline fields above.</div>
                        </div>
                      );
                    })()}

                    {(q.questionType === 'essay' || q.questionType === 'writing_task1' || q.type === 'text' || q.questionType === 'speaking_task') && !q.metadata?.tableBlock && (
                      <div className="space-y-2">
                        <textarea
                          value={(answers[q.id]?.answer as string) || ''}
                          onChange={(e) => {
                            handleAnswerChange(q.id, e.target.value);
                            try {
                              const el = e.currentTarget;
                              el.style.height = 'auto';
                              el.style.height = Math.min(el.scrollHeight, 2000) + 'px';
                            } catch {}
                          }}
                          placeholder={q.questionType === 'speaking_task' ? 'Type key points you would say...' : 'Enter your answer...'}
                          className={'w-full p-3 rounded focus:ring-2 resize-y font-medium tracking-wide text-sm ' + inputBase}
                          style={{ fontSize: prefFontSize }}
                          rows={q.questionType === 'speaking_task' ? 4 : (q.questionType === 'writing_task1' ? 12 : 10)}
                          data-writing-qid={['writing_task1','essay'].includes(q.questionType) ? q.id : undefined}
                        />
                        {(() => { const txt = (answers[q.id]?.answer as string)||''; const wc = txt.trim()? txt.trim().split(/\s+/).length:0; const minW = q.metadata?.minWords || (q.questionType==='essay'?250:150); const maxW = q.metadata?.maxWords || (q.questionType==='essay'?400:220); const color = wc===0? (darkMode?'text-gray-500':'text-gray-500') : wc<minW? 'text-amber-600':'text-green-600'; return <div className={'text-xs flex items-center justify-between '+color}><span>Words: {wc} (target {minW}+)</span><span>{wc>maxW && <span className="text-red-600">Over recommended limit ({maxW})</span>}</span></div>; })()}
                      </div>
                    )}

                    {(q.questionType === 'short_answer') && (
                      <div className="mt-2">
                        <input
                          type="text"
                          value={(answers[q.id]?.answer as string) || ''}
                          onChange={(e) => {
                            const v = e.target.value;
                            const words = v.trim().split(/\s+/).filter(Boolean);
                            if (words.length <= (q.metadata?.maxWords || 3)) handleAnswerChange(q.id, v);
                          }}
                          placeholder={`Answer (max ${(q.metadata?.maxWords||3)} words)`}
                          className={'px-3 py-2 rounded-sm text-sm min-w-[220px] focus:ring-2 ' + inputBase}
                        />
                      </div>
                    )}
        {(q.questionType === 'fill_blank' || q.type === 'number') && !hasInlinePlaceholders && (() => {
                      const singleValue = getBlankValues(q.id)[0] || '';
                      const overlayNum = (blankNumberMap[q.id]?.[0]) || q.questionNumber || undefined;
                      return (
                        <div className="mt-2">
                          <span className="relative inline-flex">
                            <input
                              type="text"
                              value={singleValue}
                              onChange={(e) => handleAnswerChange(q.id, e.target.value)}
                              className={'px-3 py-2 rounded-sm text-sm min-w-[140px] focus:ring-2 text-center font-medium tracking-wide transition-colors ' + inputBase + ' ' + blankInputExtra}
                              data-qnum={overlayNum}
                            />
                            {!singleValue && overlayNum !== undefined && (
                              <span className={'pointer-events-none absolute inset-0 flex items-center justify-center text-[13px] font-semibold select-none ' + (darkMode ? 'text-gray-500' : 'text-gray-700')}>
                                {overlayNum}
                              </span>
                            )}
                          </span>
                        </div>
                      );
                    })()}
                  </div>
                );});})()}
              </div>
              <div className="p-4 border-t flex items-center gap-2">
                <button
                  onClick={() => {
                    const ids = (currentSection?.questions || []).map((qq: any) => qq.id);
                    setAnswers(prev => {
                      const next = { ...prev } as typeof prev;
                      ids.forEach((qid: string) => { if (next[qid]) delete next[qid]; });
                      return next;
                    });
                  }}
                  className="px-4 py-2 text-gray-700 border border-gray-300 rounded hover:bg-gray-50"
                >
                  Reset Answers
                </button>
                <button onClick={() => setShowConfirmSubmit(true)} className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700">Submit Answers</button>
              </div>
            </div>
          </div>
        </div>
      </div>
      {/* Bottom navigation integrated inside flex (no outer page scroll) */}
      {/* Floating prev/next navigator (non-listening) */}
      {(() => {
        const container = rightScrollRef.current as HTMLElement | null;
        const getFocusedQnum = (): number | undefined => {
          if (!container) return undefined;
          const focused = container.querySelector(':focus') as HTMLElement | null;
          let cur: HTMLElement | null = focused;
          while (cur && cur !== container) {
            const attr = cur.getAttribute?.('data-qnum');
            if (attr && !isNaN(Number(attr))) return Number(attr);
            cur = cur.parentElement as HTMLElement | null;
          }
          return undefined;
        };
        const numsMap: Record<number, boolean> = {};
        const mark = (n:number, ans:boolean) => { if (!(n in numsMap)) numsMap[n] = false; if (ans) numsMap[n] = true; };
        const secQs = (currentSection?.questions || []).map((q:any) => {
          if (q && q.metadata && typeof q.metadata === 'string') { try { return { ...q, metadata: JSON.parse(q.metadata) }; } catch {} }
          return q;
        });
        secQs.forEach((q:any) => {
          if (q.questionType === 'simple_table') {
            extractSimpleTableNumbersFromQuestion(q).forEach(({num, answered}) => mark(num, answered));
            return;
          }
          if (q.questionType === 'fill_blank') {
            const text = normalizeNewlines(q.questionText || '');
            const curly = (text.match(/\{answer\d+\}/gi) || []).length;
            const underscores = (text.match(/_{3,}/g) || []).length;
            const combine = !!(q.metadata?.singleNumber || q.metadata?.combineBlanks);
            const blanks = combine ? 1 : (curly || underscores || 1);
            const answerValues = getBlankValues(q.id);
            for (let i = 0; i < blanks; i++) {
              const num = (q.questionNumber || 0) + (blanks > 1 ? i : 0);
              const value = combine
                ? (answerValues[0] ?? '')
                : (answerValues[i] ?? '');
              mark(num, !!value);
            }
          } else if (typeof q.questionNumber === 'number') {
            mark(q.questionNumber, !!(answers[q.id]?.answer));
          }
        });
        const numbers = Object.keys(numsMap).map(n => Number(n)).sort((a,b)=> a-b);
  const currentByFocus = getFocusedQnum();
  const currentByIndex = visibleQuestions[currentQuestionIndex]?.questionNumber;
  const currentByRef = sectionCurrentNumRef.current ?? undefined;
  const currentNum = (currentByRef !== undefined ? currentByRef : (currentByFocus !== undefined ? currentByFocus : currentByIndex)) as number | undefined;
        const curIdx = currentNum !== undefined ? numbers.indexOf(currentNum) : -1;
        const hasPrev = curIdx > 0;
        const hasNext = curIdx !== -1 ? curIdx < numbers.length - 1 : numbers.length > 0;
        const nextSection = (exam?.sections || [])[currentSectionIndex + 1];
        const nextSectionVisible = (nextSection?.questions || []).filter((qq:any)=> !qq.metadata?.groupMemberOf && qq.questionType !== 'matching');
        const hasNextAcrossSections = hasNext || (!!nextSection && nextSectionVisible.length > 0);
          const goToNum = (targetNum: number) => {
          const idxByNum = visibleQuestions.findIndex((vq:any) => vq.questionNumber === targetNum);
          if (idxByNum !== -1) { goToQuestion(currentSectionIndex, idxByNum); sectionCurrentNumRef.current = targetNum; return; }
          scrollAndFocusByQnum(targetNum, rightScrollRef.current);
          sectionCurrentNumRef.current = targetNum;
        };
        return (
          <div className="fixed right-5 bottom-20 z-40 flex gap-2">
            <button
              type="button"
              aria-label="Previous"
              disabled={!hasPrev}
              onClick={() => {
                const cur = (sectionCurrentNumRef.current ?? getFocusedQnum() ?? visibleQuestions[currentQuestionIndex]?.questionNumber) as number | undefined;
                if (cur === undefined) return;
                const idx = numbers.indexOf(cur);
                if (idx > 0) goToNum(numbers[idx - 1]);
              }}
              tabIndex={-1}
              onMouseDown={(e) => { e.preventDefault(); }}
              onFocus={(e) => { try { (e.currentTarget as HTMLButtonElement).blur(); } catch {} }}
              className={(darkMode ? 'bg-gray-800 text-gray-100' : 'bg-gray-800 text-white') + ' w-9 h-9 rounded flex items-center justify-center disabled:opacity-40'}
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              type="button"
              aria-label="Next"
              disabled={!hasNextAcrossSections}
              onClick={() => {
                const cur = (sectionCurrentNumRef.current ?? getFocusedQnum() ?? visibleQuestions[currentQuestionIndex]?.questionNumber) as number | undefined;
                const idx = cur !== undefined ? numbers.indexOf(cur) : -1;
                const nextNum = (idx !== -1 ? numbers[idx + 1] : numbers[0]);
                if (nextNum !== undefined) { goToNum(nextNum); return; }
                // No next inside this section; go to first question of next section
                if (nextSection && nextSectionVisible.length) {
                  goToQuestion(currentSectionIndex + 1, 0);
                }
              }}
              tabIndex={-1}
              onMouseDown={(e) => { e.preventDefault(); }}
              onFocus={(e) => { try { (e.currentTarget as HTMLButtonElement).blur(); } catch {} }}
              className={(darkMode ? 'bg-gray-800 text-gray-100' : 'bg-gray-800 text-white') + ' w-9 h-9 rounded flex items-center justify-center disabled:opacity-40'}
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        );
      })()}
  <div className={(darkMode ? 'border-gray-700 bg-gray-800' : 'bg-white') + " border-t p-3"}>
        <div className="flex items-center gap-2">
          <button
            onClick={goToPreviousQuestion}
            className={"px-3 py-2 text-sm rounded border " + (darkMode ? 'bg-gray-700 border-gray-600 text-gray-200 hover:bg-gray-600' : 'bg-white border-gray-300 hover:bg-gray-50 text-gray-700')}
            disabled={currentSectionIndex === 0 && currentQuestionIndex === 0}
          >Prev</button>
          <div className="flex-1 flex flex-wrap gap-1 overflow-y-auto max-h-20">
            {(() => {
              // Build unified number map for current section including simple_table cells
              const numsMap: Record<number, boolean> = {};
              const mark = (n:number, ans:boolean) => { if (!(n in numsMap)) numsMap[n] = false; if (ans) numsMap[n] = true; };
              const secQs = (currentSection?.questions || []).map((q:any) => {
                if (q && q.metadata && typeof q.metadata === 'string') { try { return { ...q, metadata: JSON.parse(q.metadata) }; } catch { } }
                return q;
              });
              secQs.forEach((q:any) => {
                if (q.questionType === 'simple_table') {
                  extractSimpleTableNumbersFromQuestion(q).forEach(({num, answered}) => mark(num, answered));
                  return;
                }
                if (q.questionType === 'fill_blank') {
                  const text = normalizeNewlines(q.questionText || '');
                  const curly = (text.match(/\{answer\d+\}/gi) || []).length;
                  const underscores = (text.match(/_{3,}/g) || []).length;
                  const combine = !!(q.metadata?.singleNumber || q.metadata?.combineBlanks);
                  const blanks = combine ? 1 : (curly || underscores || 1);
                  const answerValues = getBlankValues(q.id);
                  for (let i = 0; i < blanks; i++) {
                    const num = (q.questionNumber || 0) + (blanks > 1 ? i : 0);
                    const value = combine
                      ? (answerValues[0] ?? '')
                      : (answerValues[i] ?? '');
                    mark(num, !!value);
                  }
                } else if ((q.questionType === 'multiple_choice' && q.metadata?.allowMultiSelect) || q.questionType === 'multi_select') {
                  const required = Number(q.metadata?.selectCount) || 2;
                  const current = Array.isArray(answers[q.id]?.answer) ? (answers[q.id]?.answer as any[]) : [];
                  const full = current.length >= required;
                  for (let i = 0; i < required; i++) {
                    const num = (q.questionNumber || 0) + i;
                    mark(num, full);
                  }
                } else if (typeof q.questionNumber === 'number') {
                  mark(q.questionNumber, !!(answers[q.id]?.answer));
                }
              });
              const sorted = Object.keys(numsMap).map(n=> Number(n)).sort((a,b)=> a-b);
              return sorted.map((num:number) => (
                <button
                  key={`sec-${num}`}
                  title={`Question ${num}`}
                  onClick={() => {
                    // First try to find exact question index with this number
                    const idxByNum = visibleQuestions.findIndex((vq:any) => vq.questionNumber === num);
                    if (idxByNum !== -1) {
                      goToQuestion(currentSectionIndex, idxByNum);
                      // focus will be handled by useEffect after index change
                      // Also attempt direct focus by data-qnum in case UI does not re-render quickly
                      scrollAndFocusByQnum(num, rightScrollRef.current);
                      sectionCurrentNumRef.current = num;
                      return;
                    }
                    // If number belongs to table cell, just scroll/focus by data attribute
                    scrollAndFocusByQnum(num, rightScrollRef.current as any);
                    sectionCurrentNumRef.current = num;
                  }}
                  className={`w-8 h-8 text-[11px] rounded border flex items-center justify-center ${chipClass(false, !!numsMap[num])}`}
                >{num}</button>
              ));
            })()}
          </div>
          <button
            onClick={goToNextQuestion}
            className="px-3 py-2 text-sm rounded border border-blue-600 bg-blue-600 text-white hover:bg-blue-700"
    disabled={(currentSectionIndex === (examSectionsLength || 1) - 1) && (currentQuestionIndex === ((currentSection?.questions?.length || 1) - 1))}
          >Next</button>
        </div>
      </div>

      {showConfirmSubmit && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
            <div className="flex items-center mb-4">
              <AlertTriangle className="h-6 w-6 text-red-600 mr-2" />
              <h3 className="text-lg font-semibold">Submit Exam</h3>
            </div>
            <p className="text-gray-600 mb-6">Are you sure you want to submit your exam? This action cannot be undone.</p>
            <div className="flex space-x-3">
              <button onClick={() => setShowConfirmSubmit(false)} className="flex-1 px-4 py-2 text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50">Cancel</button>
              <button onClick={() => sessionId && submit.mutate(sessionId)} disabled={submit.isPending} className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50">
                {submit.isPending ? 'Submitting...' : 'Submit Exam'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ExamTaking;
