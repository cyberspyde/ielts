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
  const [darkMode, setDarkMode] = useState<boolean>(() => localStorage.getItem('readingDarkMode') === '1');
  useEffect(() => { localStorage.setItem('readingFontSize', String(prefFontSize)); }, [prefFontSize]);
  useEffect(() => { localStorage.setItem('readingFontFamily', prefFontFamily); }, [prefFontFamily]);
  useEffect(() => { localStorage.setItem('readingDarkMode', darkMode ? '1' : '0'); }, [darkMode]);
  
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
      const payload = Object.values(answers).map(a => ({ questionId: a.questionId, studentAnswer: a.answer }));
      return apiService.post(`/exams/sessions/${sid}/submit`, { answers: payload });
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
  // Visible questions (exclude group member questions and matching which are handled in passage area)
  const visibleQuestions = React.useMemo(() => {
    const all = currentSection?.questions || [];
    return all.filter((q: any) => !q.metadata?.groupMemberOf && q.questionType !== 'matching');
  }, [currentSection]);
  // blankNumberMap: questionId -> assigned sequential numbers for blanks.
  // Modes:
  //   Default (no metadata.singleNumber): multi-blank fill_blank consumes one number per blank (displayed as a range Questions X–Y).
  //   If metadata.singleNumber === true: consumes only ONE number; all blanks share that number (IELTS style for certain tasks).
  const blankNumberMap = React.useMemo(() => {
    const map: Record<string, number[]> = {};
    const list = [...visibleQuestions].sort((a: any,b: any)=> (a.questionNumber||0)-(b.questionNumber||0));
    if (!list.length) return map;
    let cursor = list.reduce((min, q) => q.questionNumber && q.questionNumber < min ? q.questionNumber : min, list[0].questionNumber || 1);
    for (const q of list) {
      if (q.questionNumber && q.questionNumber > cursor) cursor = q.questionNumber;
      if (q.metadata?.groupRangeEnd) { cursor = q.metadata.groupRangeEnd + 1; continue; }
      if (q.questionType === 'fill_blank') {
        const text = q.questionText || '';
        const curly = (text.match(/\{answer\d+\}/gi) || []).length;
        const underscores = (text.match(/_{3,}/g) || []).length;
        const blanks = curly || underscores || 1;
        if (blanks <= 1 || q.metadata?.singleNumber) {
          map[q.id] = [cursor];
          cursor += 1;
        } else {
          const nums: number[] = []; for (let i=0;i<blanks;i++) nums.push(cursor + i);
          map[q.id] = nums; cursor += blanks;
        }
      } else {
        map[q.id] = [cursor]; cursor += 1;
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
            {currentSection?.audioUrl && (
              <div className="flex items-center text-xs font-medium gap-1">
                <span className={"inline-block w-2 h-2 rounded-full animate-pulse " + (darkMode ? 'bg-green-400' : 'bg-green-600')}></span>
                <span className={secondaryTextClass}>Audio is playing</span>
              </div>
            )}
            <Timer darkMode={darkMode} duration={currentSection?.durationMinutes || exam?.durationMinutes || 30} onTimeUp={handleTimeUp} isPaused={isPaused} />
            <button onClick={() => setShowConfirmSubmit(true)} className="px-3 py-2 text-xs bg-red-600 text-white rounded hover:bg-red-700">Submit</button>
          </div>
        </div>
        {/* Part banner */}
        <div className={(darkMode ? 'bg-gray-1000' : 'bg-gray-100') + ' border-b px-4 py-2 text-sm'}>
          <span className="font-semibold">Part {currentListeningPart}</span>
          <span className="ml-4">Listen and answer questions {(currentListeningPart -1)*10 + 1}–{(currentListeningPart -1)*10 + listeningPartQuestions.length}.</span>
        </div>
        {/* Audio player sticky */}
        {currentSection?.audioUrl && (
          <div className={(darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200') + ' border-b px-4 py-3'}>
            <audio controls preload="auto" src={currentSection.audioUrl} className="w-full" />
          </div>
        )}
        {/* Questions area */}
        <div className="flex-1 overflow-auto px-4 py-4 space-y-10">
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
          <Timer darkMode={darkMode} duration={currentSection?.durationMinutes || exam?.durationMinutes || 60} onTimeUp={handleTimeUp} isPaused={isPaused} />
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
                  <div className="text-sm text-gray-500">Navigate questions using the chips below.</div>
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

                    {(currentSection?.sectionType || '').toLowerCase() === 'listening' && currentSection?.audioUrl && idx === 0 && (
                      <div className="mb-3">
                        <audio controls src={currentSection.audioUrl} className="w-full">
                          Your browser does not support the audio element.
                        </audio>
                      </div>
                    )}

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

                    {(q.questionType === 'essay' || q.questionType === 'writing_task1' || q.type === 'text' || q.questionType === 'speaking_task') && (
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
