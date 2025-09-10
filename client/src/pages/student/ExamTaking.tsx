import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Clock, AlertTriangle } from 'lucide-react';
import { toast } from 'react-toastify';
import { apiService } from '../../services/api';
import { useAuth } from '../../contexts/AuthContext';

interface TimerProps {
  duration: number;
  onTimeUp: () => void;
  isPaused: boolean;
  darkMode?: boolean;
}

const Timer: React.FC<TimerProps> = ({ duration, onTimeUp, isPaused, darkMode }) => {
  const [timeLeft, setTimeLeft] = useState(duration * 60);

  useEffect(() => {
    if (isPaused) return;
    const timer = setInterval(() => {
      setTimeLeft((prev) => {
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

const ExamTaking: React.FC = () => {
  const { examId } = useParams<{ examId: string }>();
  const [searchParams] = useSearchParams();
  const sectionParam = searchParams.get('section') || undefined;
  const sidFromUrl = searchParams.get('sid') || undefined;
  const navigate = useNavigate();

  const [currentSectionIndex, setCurrentSectionIndex] = useState(0);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, { questionId: string; answer: string | string[] }>>({});
  const [isPaused] = useState(false);
  const [showConfirmSubmit, setShowConfirmSubmit] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  // UI preferences
  const [showSettings, setShowSettings] = useState(false);
  const [prefFontSize, setPrefFontSize] = useState<number>(() => {
    const saved = localStorage.getItem('readingFontSize');
    return saved ? Number(saved) : 16;
  });
  const [prefFontFamily, setPrefFontFamily] = useState<string>(() => localStorage.getItem('readingFontFamily') || 'serif');
  // Default to light mode; previous implementation forced dark by stored localStorage key
  const [darkMode, setDarkMode] = useState<boolean>(() => localStorage.getItem('examDarkMode') === '1');
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
  // (moved after currentSection definition to avoid TDZ)

  // Start session on load
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
    onSuccess: (res: any) => {
      setShowConfirmSubmit(false);
      const id = (res?.data as any)?.sessionId || sessionId;
      if (id) {
        navigate(`/results/${id}`);
      } else {
        toast.success('Exam submitted');
      }
    },
    onError: (err: any) => {
      toast.error(err?.message || 'Failed to submit exam');
    }
  });

  const currentSection = exam?.sections?.[currentSectionIndex];
  useEffect(() => {
    if (debugTables && currentSection?.questions) {
      // eslint-disable-next-line no-console
      console.log('[ExamTaking][debugTables] section questions', currentSection.questions.map((q:any)=> ({ id:q.id, num:q.questionNumber, type:q.questionType, metaType: typeof q.metadata })));
    }
  }, [debugTables, currentSection]);
  const isListeningSection = (currentSection?.sectionType || '').toLowerCase() === 'listening';
  // Listening part helpers (IELTS style: 4 parts of up to 10 questions each)
  const listeningParts: number[] = React.useMemo(() => {
    if (!isListeningSection) return [];
    const qs = currentSection?.questions || [];
    const partsSet = new Set<number>();
    qs.forEach((q: any) => {
      const part = q.metadata?.listeningPart || (q.questionNumber ? Math.ceil(q.questionNumber / 10) : 1);
      partsSet.add(Math.min(4, Math.max(1, part)));
    });
    const arr = Array.from(partsSet).sort((a,b)=>a-b);
    // Ensure continuity 1..n for UI
    for (let i=1;i<=4;i++) { if (!arr.includes(i) && i <= (arr[arr.length-1]||0)) arr.push(i); }
    return arr.sort((a,b)=>a-b);
  }, [isListeningSection, currentSection]);
  const [currentListeningPart, setCurrentListeningPart] = useState<number>(1);
  useEffect(()=> { if (isListeningSection) {
    // Auto-sync part to current question index range if user used bottom chips
    const q = (currentSection?.questions || [])[currentQuestionIndex];
    if (q?.questionNumber) {
      const inferred = q.metadata?.listeningPart || Math.ceil(q.questionNumber / 10);
      if (inferred !== currentListeningPart) setCurrentListeningPart(inferred);
    }
  } }, [isListeningSection, currentQuestionIndex, currentSection, currentListeningPart]);
  // Questions for active listening part (1-based)
  const listeningPartQuestions = React.useMemo(() => {
    if (!isListeningSection) return [] as any[];
    return (currentSection?.questions || [])
      .filter((q: any) => {
        const part = q.metadata?.listeningPart || (q.questionNumber ? Math.ceil(q.questionNumber / 10) : 1);
  // Exclude simple_table container itself from generic question listings to avoid stray extra blank below table
  if (q.questionType === 'simple_table') return false;
  return part === currentListeningPart;
      })
      .sort((a: any,b: any)=> (a.questionNumber||0)-(b.questionNumber||0));
  }, [isListeningSection, currentSection, currentListeningPart]);
  // Group listening questions by metadata.noteGroupTitle to render note-completion style blocks
  const listeningGroups = React.useMemo(() => {
    if (!isListeningSection) return [] as { title?: string; items: any[] }[];
    const map = new Map<string|undefined, any[]>();
  listeningPartQuestions.forEach((q: any) => {
      const key = q.metadata?.noteGroupTitle || undefined;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(q);
    });
    return Array.from(map.entries()).map(([title, items]) => ({ title, items }));
  }, [isListeningSection, listeningPartQuestions]);
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
  //   If metadata.singleNumber === true: consumes only ONE number; all blanks share that number (IELTS style for certain tasks).
  const blankNumberMap = React.useMemo(() => {
    const map: Record<string, number[]> = {};
    const list = [...visibleQuestions];
    if (!list.length) return map;
    // We now trust backend assigned questionNumber; do not resequence. Only map blanks for quick placeholder display.
    for (const q of list) {
      if (q.questionType === 'fill_blank') {
        const text = q.questionText || '';
        const curly = (text.match(/\{answer\d+\}/gi) || []).length;
        const underscores = (text.match(/_{3,}/g) || []).length;
        const blanks = curly || underscores || 1;
        // Use existing questionNumber as anchor; if multi-blank allocate synthetic subsequent numbers just for display (not persisted)
        const base = q.questionNumber || 0;
        if (blanks <=1 || q.metadata?.singleNumber) map[q.id] = [base];
        else {
          const nums: number[] = []; for (let i=0;i<blanks;i++) nums.push(base + i); map[q.id] = nums;
        }
      }
    }
    return map;
  }, [visibleQuestions]);
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
  };

  const resolveHeadingText = (letter: string | undefined) => {
    if (!letter) return '';
    const found = headingOptions.find((o: any) => (o.letter || o.option_letter) === letter);
    return found?.text || found?.option_text || letter;
  };

  const goToQuestion = (sectionIndex: number, questionIndex: number) => {
    setCurrentSectionIndex(sectionIndex);
    setCurrentQuestionIndex(questionIndex);
  };

  const goToNextQuestion = () => {
    if (currentQuestionIndex < visibleQuestions.length - 1) {
      setCurrentQuestionIndex(prev => prev + 1);
    } else if (currentSectionIndex < (exam?.sections?.length || 0) - 1) {
      setCurrentSectionIndex(prev => prev + 1);
      setCurrentQuestionIndex(0);
    }
  };

  const goToPreviousQuestion = () => {
    if (currentQuestionIndex > 0) {
      setCurrentQuestionIndex(prev => prev - 1);
    } else if (currentSectionIndex > 0) {
      // Move to previous section last visible question
      const prevSection = exam?.sections?.[currentSectionIndex - 1];
      const prevVisible = (prevSection?.questions || []).filter((q: any) => !q.metadata?.groupMemberOf && q.questionType !== 'matching');
      setCurrentSectionIndex(prev => prev - 1);
      setCurrentQuestionIndex(prevVisible.length ? prevVisible.length - 1 : 0);
    }
  };

  // Keyboard navigation (Left/Right arrows)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') { e.preventDefault(); goToNextQuestion(); }
      if (e.key === 'ArrowLeft') { e.preventDefault(); goToPreviousQuestion(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [goToNextQuestion, goToPreviousQuestion]);

  const handleAnswerChange = (questionId: string, answer: string | string[]) => {
    setAnswers(prev => ({ ...prev, [questionId]: { questionId, answer } }));
  };

  const handleTimeUp = () => { if (sessionId) submit.mutate(sessionId); };

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
  const questionRefs = useRef<Record<string, HTMLDivElement | null>>({});

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
    }
  }, [currentQuestionIndex, currentSectionIndex, currentSection, visibleQuestions]);

  // Ensure currentQuestionIndex stays in range when section or filters change
  useEffect(() => {
    if (currentQuestionIndex > visibleQuestions.length - 1) {
      setCurrentQuestionIndex(visibleQuestions.length ? visibleQuestions.length - 1 : 0);
    }
  }, [visibleQuestions, currentQuestionIndex]);

  const examSectionsLength = exam?.sections?.length || 0;
  const notFound = !exam && !examLoading;
  // Dedicated Listening layout (overrides default two-pane UI)
  // Centralized exam-level listening audio (single player & optional single-play enforcement)
  // Listening audio control (single, unstoppable playback)
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [audioStarted, setAudioStarted] = useState(false);
  const [audioEnded, setAudioEnded] = useState(false);
  const [autoplayBlocked, setAutoplayBlocked] = useState(false);
  const [isAudioPlaying, setIsAudioPlaying] = useState(false);
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
    // Attempt autoplay
    el.play().then(() => setAutoplayBlocked(false)).catch(() => setAutoplayBlocked(true));
    return () => {
      el.removeEventListener('play', onPlay);
      el.removeEventListener('pause', onPause);
      el.removeEventListener('ended', onEnded);
    };
  }, [isListeningSection, examAudioUrl]);

  if (isListeningSection) {
    return (
      <div className={"h-screen flex flex-col overflow-hidden select-text " + (darkMode ? 'bg-gray-900 text-gray-100' : 'bg-gray-50 text-gray-900')}>
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
                {audioEnded && (
                  <>
                    <span className={"inline-block w-2 h-2 rounded-full " + (darkMode ? 'bg-gray-500' : 'bg-gray-500')} />
                    <span className={secondaryTextClass}>Audio finished</span>
                  </>
                )}
              </div>
            )}
            {/* Use global exam duration only (ignore per-section durations) */}
            <Timer darkMode={darkMode} duration={exam?.durationMinutes || 30} onTimeUp={handleTimeUp} isPaused={isPaused} />
            <button onClick={() => setShowConfirmSubmit(true)} className="px-3 py-2 text-xs bg-red-600 text-white rounded hover:bg-red-700">Submit</button>
          </div>
        </div>
        {/* Part banner */}
        <div className={(darkMode ? 'bg-gray-1000' : 'bg-gray-100') + ' border-b px-4 py-2 text-sm'}>
          <span className="font-semibold">Part {currentListeningPart}</span>
          <span className="ml-4">Listen and answer questions {(currentListeningPart -1)*10 + 1}–{(currentListeningPart -1)*10 + listeningPartQuestions.length}.</span>
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
        <div className="flex-1 overflow-auto px-4 py-4 space-y-10">
          {/* Simple Tables (listening layout) */}
          {(() => {
            const simpleTables = (currentSection?.questions || []).filter((q:any)=> q.questionType==='simple_table').sort((a:any,b:any)=> (a.questionNumber||0)-(b.questionNumber||0));
            if (!simpleTables.length) return null;
            return simpleTables.map((q:any) => {
              let meta: any = q.metadata;
              if (meta && typeof meta === 'string') { try { meta = JSON.parse(meta); } catch { meta = {}; } }
              const rows: any[][] = meta?.simpleTable?.rows || [];
              const seqStart: number | undefined = meta?.simpleTable?.sequenceStart;
              // Build mapping cell -> assigned question number (prefer explicit cell.questionNumber, else derive sequentially if seqStart defined)
              let derivedCounter = seqStart || 0;
              if (!rows.length) return null;
              return (
                <div key={q.id} className="space-y-3 border-b pb-6 border-dashed border-gray-300 dark:border-gray-700">
                  {q.questionText && <div className="font-semibold text-sm">{q.questionText}</div>}
                  <div className="overflow-auto">
                    <table className={'text-sm min-w-[480px] border ' + (darkMode ? 'border-gray-600' : 'border-gray-300')}>
                      <tbody>
                        {rows.map((row, ri) => (
                          <tr key={ri} className={darkMode ? 'border-b border-gray-700 last:border-b-0' : 'border-b border-gray-200 last:border-b-0'}>
                            {row.map((cell:any, ci:number) => {
                              const answerKey = `${q.id}_${ri}_${ci}`; // synthetic key for now
                              let displayNumber: number | undefined = cell?.questionNumber;
                              if (displayNumber === undefined && cell?.type==='question' && seqStart) {
                                if (derivedCounter === seqStart) { /* first use value as provided */ }
                                if (!cell.__numberAssigned) {
                                  // assign sequential on the fly (no mutation, display only)
                                  displayNumber = derivedCounter;
                                  derivedCounter += 1;
                                  cell.__numberAssigned = displayNumber; // cache in runtime
                                } else displayNumber = cell.__numberAssigned;
                              }
                              const baseTd = (darkMode ? 'border-r border-gray-700' : 'border-r border-gray-200') + ' last:border-r-0 p-3 align-top';
                              if (cell?.type === 'text') {
                                return <td key={ci} className={baseTd}><div className="whitespace-pre-wrap">{cell?.content || ''}</div></td>;
                              }
                              if (cell?.type === 'question') {
                                // Treat missing questionType as fill_blank by default
                                const effectiveType = cell?.questionType || 'fill_blank';
                                const isFill = effectiveType === 'fill_blank';
                                const rawContent: string = cell?.content || '';
                                const inlinePatternGlobal = /_{3,}|\{answer\}/gi;
                                const hasInlineBlank = isFill && inlinePatternGlobal.test(rawContent);
                                inlinePatternGlobal.lastIndex = 0; // reset after test
                                const multiNumbers: number[] | undefined = cell.multiNumbers;
                                return (
                                  <td key={ci} className={baseTd}>
                                    <div className="space-y-2">
                                      {!hasInlineBlank && rawContent && <div className="text-sm font-medium whitespace-pre-wrap">{rawContent}</div>}
                                      {isFill && hasInlineBlank && (() => {
                                        // Replace each blank with an input; if multiNumbers provided use them; else sequential fallback.
                                        const parts: React.ReactNode[] = [];
                                        let lastIndex = 0; let blankIdx = 0;
                                        const matches = [...rawContent.matchAll(inlinePatternGlobal)];
                                        matches.forEach((m, i) => {
                                          const idx = m.index || 0;
                                          if (idx > lastIndex) parts.push(rawContent.slice(lastIndex, idx));
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
                                              />
                                              {!val && num !== undefined && (
                                                <span className={'pointer-events-none absolute inset-0 flex items-center justify-center text-[11px] font-semibold select-none ' + (darkMode ? 'text-gray-500' : 'text-gray-600')}>{num}</span>
                                              )}
                                            </span>
                                          );
                                          lastIndex = idx + m[0].length;
                                          blankIdx++;
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
                                          />
                                          {!(answers[answerKey]?.answer) && displayNumber !== undefined && (
                                            <span className={'pointer-events-none absolute inset-0 flex items-center justify-center text-[12px] font-semibold select-none ' + (darkMode ? 'text-gray-500' : 'text-gray-600')}>{displayNumber}</span>
                                          )}
                                        </span>
                                      )}
                                      {effectiveType === 'multiple_choice' && cell?.content && (
                                        <div className="space-y-1">
                                          {cell.content.split(/[A-D]\)/).slice(1).map((opt:string, oi:number) => {
                                            const letter = String.fromCharCode(65+oi);
                                            const selected = (answers[answerKey]?.answer as string) === letter;
                                            return (
                                              <label key={letter} className={`flex items-start gap-2 cursor-pointer rounded px-2 py-1 border transition-colors ${selected ? (darkMode ? 'bg-blue-700 border-blue-600 text-white' : 'bg-gray-200 border-gray-300') : (darkMode ? 'border-gray-600 hover:bg-gray-700' : 'border-transparent hover:bg-gray-100')}`}
                                                onClick={()=> handleAnswerChange(answerKey, letter)}>
                                                <input type="radio" className={'mt-1 ' + (darkMode ? 'accent-blue-500':'')} checked={selected} onChange={()=> handleAnswerChange(answerKey, letter)} />
                                                <span className={'text-sm select-none ' + (darkMode ? 'text-gray-100':'text-gray-900')}>{letter}) {opt.trim()}</span>
                                              </label>
                                            );
                                          })}
                                        </div>
                                      )}
                                      {effectiveType === 'true_false' && (
                                        <div className="flex gap-2 flex-wrap">
                                          {['True','False','Not Given'].map(val => {
                                            const selected = (answers[answerKey]?.answer as string) === val;
                                            return (
                                              <button key={val} type="button" onClick={()=> handleAnswerChange(answerKey, val)} className={`px-2 py-1 rounded border text-xs ${selected ? 'bg-blue-600 text-white border-blue-600' : (darkMode ? 'border-gray-600 text-gray-200 hover:bg-gray-700' : 'border-gray-300 text-gray-700 hover:bg-gray-50')}`}>{val}</button>
                                            );
                                          })}
                                        </div>
                                      )}
                                      {effectiveType === 'short_answer' && (
                                        <input
                                          type="text"
                                          value={(answers[answerKey]?.answer as string) || ''}
                                          onChange={(e)=> handleAnswerChange(answerKey, e.target.value)}
                                          className={'w-full px-2 py-1 rounded border focus:ring-2 ' + (darkMode ? 'bg-gray-700 text-white border-gray-600 focus:ring-blue-500' : 'bg-white text-gray-900 border-gray-300 focus:ring-blue-300')}
                                          placeholder="Short answer..."
                                          maxLength={60}
                                        />
                                      )}
                                      <div className="flex items-center justify-between">
                                        {cell?.points && <div className="text-xs text-gray-500">({cell.points} pt{cell.points!==1?'s':''})</div>}
                                        {displayNumber !== undefined && !multiNumbers && <div className="text-[10px] text-gray-400">Q{displayNumber}</div>}
                                        {/* Range label suppressed for multi-blank cells to avoid duplicate numbering */}
                                      </div>
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
            });
          })()}
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
                    <div className="text-sm font-semibold">{anchor.questionText || `Questions ${members[0]?.questionNumber || ''}–${members[members.length-1]?.questionNumber || ''}`}</div>
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
                  <div className="text-sm font-semibold">{anchor.questionText || `Questions ${members[0]?.questionNumber || ''}–${members[members.length-1]?.questionNumber || ''}`}</div>
                  <div className="flex flex-col md:flex-row gap-10">
                    <div className="flex-1 space-y-3">
                      {members.map((m:any) => {
                        const val = (answers[m.id]?.answer as string) || '';
                        return (
                          <div key={m.id} className="flex items-center gap-3 text-sm">
                            <span className={(darkMode ? 'bg-gray-800 text-gray-100 border-gray-600' : 'bg-white text-gray-900 border-gray-300') + ' inline-flex items-center justify-center font-semibold rounded border px-2 h-8 text-[13px]'}>{m.questionNumber}</span>
                            <span className="w-48 max-w-[50%] truncate" title={m.questionText}>{m.questionText}</span>
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

          {/* Note-completion style single blanks */}
          {listeningGroups.map((g, gi) => (
            <div key={gi} className="space-y-4">
              {g.title && <div className="font-semibold mb-2 text-sm uppercase tracking-wide">{g.title}</div>}
              {g.items.map((q: any) => {
                const qNum = q.questionNumber || '';
                const val = (answers[q.id]?.answer as string) || '';
                const prefix = q.metadata?.notePrefix || '';
                const suffix = q.metadata?.noteSuffix || '';
                return (
                  <div key={q.id} className="text-sm flex flex-col">
                    <div className="flex items-start gap-2 flex-wrap">
                      <span className={(darkMode ? 'bg-gray-800 text-gray-100 border-gray-600' : 'bg-white text-gray-900 border-gray-300') + ' w-8 h-8 inline-flex items-center justify-center font-semibold rounded border text-[13px]'}>{qNum}</span>
                      <div className="flex-1 min-w-[220px] flex items-center flex-wrap gap-2">
                        {prefix && <span className={secondaryTextClass}>{prefix}</span>}
                        <input
                          type="text"
                          value={val}
                          onChange={(e)=> handleAnswerChange(q.id, e.target.value)}
                          className={'px-2 py-1 rounded border text-center text-sm font-medium tracking-wide min-w-[110px] ' + (darkMode ? 'bg-gray-900 border-gray-600 text-gray-100 focus:ring-2 focus:ring-blue-500' : 'bg-white border-gray-400 text-gray-900 focus:ring-2 focus:ring-blue-500')}
                        />
                        {suffix && <span className={secondaryTextClass}>{suffix}</span>}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
        {/* Bottom part navigation */}
        <div className={(darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white') + ' border-t px-4 py-2 flex items-center justify-between text-xs'}>
          <div className="flex items-center gap-2">
            {listeningParts.map(p => {
              const total = (currentSection?.questions || []).filter((q: any)=> (q.metadata?.listeningPart || Math.ceil((q.questionNumber||0)/10)) === p).length;
              const answered = (currentSection?.questions || []).filter((q: any)=> ((q.metadata?.listeningPart || Math.ceil((q.questionNumber||0)/10)) === p) && answers[q.id]) .length;
              return (
                <button
                  key={p}
                  onClick={() => { setCurrentListeningPart(p); setCurrentQuestionIndex(0); }}
                  className={'px-3 py-1.5 rounded border font-medium ' + (p === currentListeningPart ? 'bg-blue-600 border-blue-600 text-white' : (darkMode ? 'bg-gray-900 border-gray-600 text-gray-300 hover:bg-gray-700' : 'bg-gray-50 border-gray-300 text-gray-600 hover:bg-gray-100'))}
                >Part {p} <span className="opacity-70 ml-1">{answered} / {total}</span></button>
              );
            })}
          </div>
          <div className="flex items-center gap-1">
            {listeningPartQuestions.map((q: any) => {
              const isAns = !!answers[q.id];
              return (
                <button
                  key={q.id}
                  onClick={() => {
                    // focus by virtual index inside part
                    const idxLocal = listeningPartQuestions.findIndex((qq: any)=>qq.id===q.id);
                    if (idxLocal !== -1) setCurrentQuestionIndex(idxLocal);
                  }}
                  title={`Question ${q.questionNumber}`}
                  className={'w-7 h-7 rounded border text-[11px] flex items-center justify-center ' + (isAns ? (darkMode ? 'bg-green-700 border-green-600 text-white' : 'bg-green-100 border-green-300 text-green-800') : (darkMode ? 'bg-gray-900 border-gray-600 text-gray-400 hover:bg-gray-800' : 'bg-white border-gray-300 text-gray-600 hover:bg-gray-50'))}
                >{q.questionNumber}</button>
              );
            })}
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
      </div>
    );
  }

  return (
  <div className={"h-screen flex flex-col overflow-hidden select-text " + (darkMode ? 'bg-gray-900 text-gray-100' : 'bg-gray-50 text-gray-900') }>
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
          {/* Global timer only (ignore per-section durations) */}
          <Timer darkMode={darkMode} duration={exam?.durationMinutes || 60} onTimeUp={handleTimeUp} isPaused={isPaused} />
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
                    {/* Listening / other section contextual area (instructions, transcript placeholders, future audio notes) */}
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
                      {currentSection?.passageText ? (
                        <div className="whitespace-pre-wrap">{currentSection.passageText}</div>
                      ) : (
                        <div className="italic opacity-70">Adjust font size, family, or theme in Settings. Questions appear on the right.</div>
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
                          {q.questionText && <div className="mb-2 font-medium text-sm">{q.questionText}</div>}
                          <div className="text-xs text-gray-500 italic">Table not configured yet (no rows). If you recently edited, ensure you clicked Save in the table editor.</div>
                          {debugTables && <div className="mt-2 text-[10px] text-red-600">[Debug] simple_table metadata parsed but rows empty. Raw meta keys: {Object.keys(meta||{}).join(', ') || 'none'}</div>}
                        </div>
                      );
                    }
                    
                    return (
                      <div className="mb-8 pb-4 border-b border-dashed border-gray-300 dark:border-gray-700">
                        {q.questionText && <div className="mb-2 font-medium text-sm">{q.questionText}</div>}
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
                                            const blanks = blankMatches.length || 1;
                                            if (blanks === 1) {
                                              return (
                                                <input
                                                  type="text"
                                                  value={(answers[`${q.id}_${ri}_${ci}`]?.answer as string) || ''}
                                                  onChange={(e) => handleAnswerChange(`${q.id}_${ri}_${ci}`, e.target.value)}
                                                  className={'w-full px-2 py-1 rounded border focus:ring-2 ' + (darkMode ? 'bg-gray-700 text-white border-gray-600 focus:ring-blue-500' : 'bg-white text-gray-900 border-gray-300 focus:ring-blue-300')}
                                                  placeholder="Answer..."
                                                />
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
                      {q.questionText && <div className="mb-2 font-medium text-sm">{q.questionText}</div>}
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
                  // Preprocess composite fill_blank templates: identify referenced question numbers and skip rule
                  const fillBlankByNumber: Record<number, any> = {};
                  (currentSection?.questions || []).forEach((q: any) => { if (q.questionType === 'fill_blank' && q.questionNumber) fillBlankByNumber[q.questionNumber] = q; });
                  const renderedCompositeNumbers = new Set<number>();
                  return visibleQuestions.map((q: any, idx: number) => {
                  const displayNumber = (blankNumberMap[q.id]?.[0]) || q.questionNumber || (idx + 1);
                  // Interactive fill_blank: support placeholders {answer1} OR runs of underscores ___ inline.
                  let renderedQuestionText: React.ReactNode = q.questionText || q.text;
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
                          const val = (answers[targetQ.id]?.answer as string) || '';
                          parts.push(
                            <span key={`comp-${targetQ.id}`} className="mx-1 inline-block align-middle">
                              <span className="relative inline-flex">
                                <input
                                  type="text"
                                  className="px-2 py-1 border border-gray-400 rounded-sm text-sm min-w-[110px] focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-center font-medium tracking-wide"
                                  value={val}
                                  onChange={(e) => handleAnswerChange(targetQ.id, e.target.value)}
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
                    const text = q.questionText;
                    const hasCurly = /\{answer\d+\}/i.test(text);
                    const hasUnderscore = /_{3,}/.test(text);
                    if (hasCurly || hasUnderscore) {
                      hasInlinePlaceholders = true;
                      // Conversation style: split on newlines with speaker labels (e.g., MAN:, WOMAN:, M: ) and keep tighter spacing
                      const isConversation = !!q.metadata?.conversation;
                      const speakerRegex = /^(?:[A-Z][A-Za-z']{0,12}|Man|Woman|Boy|Girl|Host|Speaker|Student|Tutor|Agent|Caller|Customer|Professor|Lecturer|Guide)\s*:/;
                      const nodes: React.ReactNode[] = [];
                      const answerArray = Array.isArray(answers[q.id]?.answer) ? answers[q.id]?.answer as string[] : [];
                      if (hasCurly) {
                        const regex = /\{(answer\d+)\}/gi;
                        let lastIndex = 0; let match; let blankIndex = 0;
                        while ((match = regex.exec(text)) !== null) {
                          const before = text.slice(lastIndex, match.index);
                          if (before) nodes.push(before);
                          const idxLocal = blankIndex;
                          const val = answerArray[idxLocal] || '';
                          let overlayNumber: number | undefined = undefined;
                          if (blankNumberMap[q.id]) {
                            const isMulti = blankNumberMap[q.id].length > 1;
                            if (!(q.metadata?.singleNumber && isMulti)) overlayNumber = blankNumberMap[q.id][idxLocal];
                          }
                          nodes.push(
                            <span key={`blank-${q.id}-${idxLocal}`} className="mx-1 inline-block align-middle">
                              <span className="relative inline-flex">
                                <input
                                  type="text"
                                  className={"px-2 py-1 rounded-sm text-sm min-w-[110px] focus:ring-2 text-center font-medium tracking-wide transition-colors " + inputBase + ' ' + blankInputExtra}
                                  value={val}
                                  onChange={(e) => {
                                    const prev = Array.isArray(answers[q.id]?.answer) ? [...(answers[q.id]?.answer as string[])] : [];
                                    while (prev.length <= idxLocal) prev.push('');
                                    prev[idxLocal] = e.target.value;
                                    handleAnswerChange(q.id, prev);
                                  }}
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
                          let overlayNumber: number | undefined = undefined;
                          if (blankNumberMap[q.id]) {
                            const isMulti = blankNumberMap[q.id].length > 1;
                            if (!(q.metadata?.singleNumber && isMulti)) overlayNumber = blankNumberMap[q.id][idxLocal];
                          }
                          nodes.push(
                            <span key={`ublank-${q.id}-${idxLocal}`} className="mx-1 inline-block align-middle">
                              <span className="relative inline-flex">
                                <input
                                  type="text"
                                  className={"px-2 py-1 rounded-sm text-sm min-w-[110px] focus:ring-2 text-center font-medium tracking-wide transition-colors " + inputBase + ' ' + blankInputExtra}
                                  value={val}
                                  onChange={(e) => {
                                    const prev = Array.isArray(answers[q.id]?.answer) ? [...(answers[q.id]?.answer as string[])] : [];
                                    while (prev.length <= idxLocal) prev.push('');
                                    prev[idxLocal] = e.target.value;
                                    handleAnswerChange(q.id, prev);
                                  }}
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
                              const val = answerArray[blankCursor] || '';
                              let overlayNumber: number | undefined = undefined;
                              if (blankNumberMap[q.id]) {
                                const isMulti = blankNumberMap[q.id].length > 1;
                                if (!(q.metadata?.singleNumber && isMulti)) overlayNumber = blankNumberMap[q.id][blankCursor];
                              }
                              lineBuffer.push(
                                <span key={'convblank-'+blankCursor} className="mx-1 inline-block align-middle">
                                  <span className="relative inline-flex">
                                    <input
                                      type="text"
                                      className={"px-2 py-1 rounded-sm text-sm min-w-[90px] focus:ring-2 text-center font-medium tracking-wide transition-colors " + inputBase + ' ' + blankInputExtra}
                                      value={val}
                                      onChange={(e) => {
                                        const prev = Array.isArray(answers[q.id]?.answer) ? [...(answers[q.id]?.answer as string[])] : [];
                                        while (prev.length <= blankCursor) prev.push('');
                                        prev[blankCursor] = e.target.value;
                                        handleAnswerChange(q.id, prev);
                                      }}
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
                    const groupInstruction: string | undefined = q.metadata?.groupInstruction;
                    const showGroupInstruction = !!groupInstruction && groupInstruction !== lastInstructionPerType[q.questionType];
                    if (showGroupInstruction) lastInstructionPerType[q.questionType] = groupInstruction;
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
                      const hideHeaderNumber = q.questionType === 'fill_blank' && singleInlineBlank;
                      return (
                        <div className="mb-2">
                          <h3 className={"text-base font-medium flex flex-wrap items-start gap-1 " + primaryTextClass}>
                            {!hideHeaderNumber && (
                              <span className={secondaryTextClass}>
                                {(() => {
                                  if (q.metadata?.groupRangeEnd) return `Questions ${q.questionNumber}–${q.metadata.groupRangeEnd}`;
                                  const nums = blankNumberMap[q.id];
                                  if (q.questionType === 'fill_blank' && nums && nums.length > 1 && !q.metadata?.singleNumber) return `Questions ${nums[0]}–${nums[nums.length - 1]}`;
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
                          <select
                            className={'w-full rounded px-3 py-2 text-sm ' + inputBase}
                            value={(answers[q.id]?.answer as string) || ''}
                            onChange={(e) => handleAnswerChange(q.id, e.target.value)}>
                            <option value="">Select an answer</option>
                            {(q.options || []).map((option: any, index: number) => {
                              const value = option.letter || option.text || option;
                              const label = option.letter ? `${option.letter}. ${option.text}` : option.text || option;
                              return <option key={index} value={value}>{label}</option>;
                            })}
                          </select>
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
                            <div className={'text-sm font-medium ' + (darkMode ? 'text-gray-200' : 'text-gray-800')}>
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
                        {q.questionType === 'writing_task1' && (
                          <div className={'text-xs rounded px-3 py-2 ' + (darkMode ? 'bg-blue-900/40 text-blue-200' : 'bg-blue-50 text-blue-700')}>
                            {q.metadata?.guidance || (q.metadata?.variant === 'gt_letter' ? 'Write a letter of at least 150 words.' : 'Summarize the information given in the visual(s) in at least 150 words.')}
                          </div>
                        )}
                        <textarea
                          value={(answers[q.id]?.answer as string) || ''}
                          onChange={(e) => handleAnswerChange(q.id, e.target.value)}
                          placeholder={q.questionType === 'speaking_task' ? 'Type key points you would say...' : 'Enter your answer...'}
                          className={'w-full p-3 rounded focus:ring-2 resize-none font-medium tracking-wide text-sm ' + inputBase}
                          rows={q.questionType === 'speaking_task' ? 4 : (q.questionType === 'writing_task1' ? 12 : 10)}
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
                    {(q.questionType === 'fill_blank' || q.type === 'number') && !hasInlinePlaceholders && (
                      <div className="mt-2">
                        <span className="relative inline-flex">
                          <input
                            type="text"
                            value={(answers[q.id]?.answer as string) || ''}
                            onChange={(e) => handleAnswerChange(q.id, e.target.value)}
                            className={'px-3 py-2 rounded-sm text-sm min-w-[140px] focus:ring-2 text-center font-medium tracking-wide transition-colors ' + inputBase + ' ' + blankInputExtra}
                          />
                          {!(answers[q.id]?.answer) && (
                            <span className={'pointer-events-none absolute inset-0 flex items-center justify-center text-[13px] font-semibold select-none ' + (darkMode ? 'text-gray-500' : 'text-gray-700')}>
                              {(blankNumberMap[q.id]?.[0]) || q.questionNumber || ''}
                            </span>
                          )}
                        </span>
                      </div>
                    )}
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
  <div className={(darkMode ? 'border-gray-700 bg-gray-800' : 'bg-white') + " border-t p-3"}>
        <div className="flex items-center gap-2">
          <button
            onClick={goToPreviousQuestion}
            className={"px-3 py-2 text-sm rounded border " + (darkMode ? 'bg-gray-700 border-gray-600 text-gray-200 hover:bg-gray-600' : 'bg-white border-gray-300 hover:bg-gray-50 text-gray-700')}
            disabled={currentSectionIndex === 0 && currentQuestionIndex === 0}
          >Prev</button>
          <div className="flex-1 flex flex-wrap gap-1 overflow-y-auto max-h-20">
    {visibleQuestions.map((q: any, idx: number) => {
      const isAnswered = answers[q.id];
      const isCurrent = idx === currentQuestionIndex;
      // Hide chip for pure table container (no direct response; new types & legacy) - but keep navigation clickable if desired
      const isTableContainer = (q.questionType === 'table_fill_blank' || q.questionType === 'table_drag_drop' || q.questionType === 'simple_table' || (q.questionType==='essay' && q.metadata?.tableBlock));
      if (isTableContainer) return null;
      const label = q.questionNumber || idx + 1;
      const title = q.metadata?.groupRangeEnd ? `Questions ${q.questionNumber}–${q.metadata.groupRangeEnd}` : `Question ${label}`;
      return (
        <button key={q.id} title={title} onClick={() => goToQuestion(currentSectionIndex, idx)} className={`w-8 h-8 text-[11px] rounded border flex items-center justify-center ${chipClass(isCurrent, !!isAnswered)}`}>
          {label}
        </button>
      );
    })}
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
