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
}

const Timer: React.FC<TimerProps> = ({ duration, onTimeUp, isPaused }) => {
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

  return (
    <div className="flex items-center space-x-2 font-mono text-lg font-semibold text-gray-900">
      <Clock className="h-5 w-5" />
      <span>{minutes}:{seconds.toString().padStart(2, '0')}</span>
      {isPaused && <span className="text-sm text-gray-500">(Paused)</span>}
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
  const passageParagraphs: PassageParagraph[] = React.useMemo(() => {
    if (!currentSection?.passageText) return [];
    const raw = currentSection.passageText.replace(/\r\n/g, '\n');
    const lines = raw.split(/\n/);
    const paras: PassageParagraph[] = [];
    let current: { letter?: string; buffer: string[] } | null = null;
    const pushCurrent = () => {
      if (!current) return;
      const text = current.buffer.join('\n').trim();
      if (text) paras.push({ letter: current.letter, text });
      current = null;
    };
    for (let i = 0; i < lines.length; i++) {
      const rawLine = lines[i];
      const line = rawLine.trim();
      const singleLetter = /^[A-Z]$/.test(line);
      const inlineLetter = /^([A-Z])\s+/.exec(line); // captures first letter when followed by space
      if (singleLetter) {
        pushCurrent();
        current = { letter: line, buffer: [] };
        continue;
      } else if (inlineLetter && (current === null || current.buffer.length === 0)) {
        // treat as new paragraph start with inline letter; remove letter token
        pushCurrent();
        current = { letter: inlineLetter[1], buffer: [rawLine.slice(rawLine.indexOf(inlineLetter[1]) + 1).trimStart()] };
        continue;
      }
      if (!current) current = { buffer: [], letter: undefined };
      current.buffer.push(rawLine);
    }
    pushCurrent();
    // Validate detection quality; if fewer than 2 paragraphs, fallback
    if (paras.length < 2) {
      const parts = raw.split(/\n{2,}/).map((p: string) => p.trim()).filter((p: string) => p.length > 0);
      return parts.map((p: string) => ({ text: p }));
    }
    // Normalize letters without shifting first lettered paragraph index.
    const firstLetterIndex = paras.findIndex(p => !!p.letter);
    const used = new Set<string>();
    paras.forEach((p, idx) => {
      if (p.letter) {
        if (used.has(p.letter)) {
          // duplicate letter: assign next free
            let code = 65; while (used.has(String.fromCharCode(code))) code++; p.letter = String.fromCharCode(code);
        }
        used.add(p.letter);
      } else if (firstLetterIndex !== -1 && idx > firstLetterIndex) {
        // letterless paragraph after letters started -> assign next free
        let code = 65; while (used.has(String.fromCharCode(code))) code++; p.letter = String.fromCharCode(code); used.add(p.letter);
      }
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
    if (currentQuestionIndex < (currentSection?.questions?.length || 0) - 1) {
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
      const prevLen = exam?.sections?.[currentSectionIndex - 1]?.questions?.length || 1;
      setCurrentSectionIndex(prev => prev - 1);
      setCurrentQuestionIndex(prevLen - 1);
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
    const targetQuestion = section.questions?.[currentQuestionIndex];
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
  }, [currentQuestionIndex, currentSectionIndex, currentSection]);

  const examSectionsLength = exam?.sections?.length || 0;
  const notFound = !exam && !examLoading;
  return (
    <div className="h-screen flex flex-col bg-gray-50 overflow-hidden select-text">
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
      <div className="bg-white border-b z-30 px-4 py-2 flex items-center justify-between shadow-sm">
        <div className="flex flex-col">
          <span className="text-sm text-gray-500">{user?.firstName} {user?.lastName}</span>
          <h1 className="text-base font-semibold text-gray-900">{exam?.title || (examLoading ? 'Loading…' : 'Unknown Exam')}</h1>
          {exam && <p className="text-xs text-gray-600">Section {currentSectionIndex + 1} of {examSectionsLength}: {currentSection?.title || currentSection?.sectionType}</p>}
        </div>
        <div className="flex items-center gap-4">
          <Timer duration={currentSection?.durationMinutes || exam?.durationMinutes || 60} onTimeUp={handleTimeUp} isPaused={isPaused} />
          {exam && <button onClick={() => setShowConfirmSubmit(true)} className="px-4 py-2 text-sm bg-red-600 text-white rounded hover:bg-red-700">Submit</button>}
        </div>
      </div>

      <div className="flex-1 overflow-hidden min-h-0">
        {/* Responsive: stacked on small screens, resizable flex on lg+ */}
        <div className="h-full w-full flex flex-col lg:flex-row gap-0">
          {/* Left Pane */}
          <div
            className="min-h-0 flex flex-col border-b lg:border-b-0 lg:border-r bg-white shadow-sm"
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
                          const lettered = passageParagraphs.filter(p => p.letter);
                          return passageParagraphs.map((paraObj, idxAll) => {
                            const para = paraObj.text;
                            if (!paraObj.letter) {
                              // Intro or unlabeled paragraph
                              return (
                                <div key={`intro-${idxAll}`} className="mb-6 pb-4 border-b last:border-0 last:pb-0">
                                  <div className="prose max-w-none text-gray-800 whitespace-pre-wrap text-sm leading-relaxed">{para}</div>
                                </div>
                              );
                            }
                            const idx = lettered.indexOf(paraObj);
                            const mq = matchingQuestionsSorted[idx];
                            if (!mq) return null;
                            const qAnswer = (answers[mq.id]?.answer as string) || '';
                            const paragraphLetter = paraObj.letter;
                            return (
                              <div key={mq.id} className="mb-6 pb-4 border-b last:border-0 last:pb-0">
                                <div
                                  className={`mb-2 px-3 py-2 border rounded flex items-center gap-3 min-h-[44px] bg-white transition-colors text-sm ${draggingHeading ? 'border-blue-500 ring-1 ring-blue-300' : 'border-gray-300'}`}
                                  onDragOver={(e) => { e.preventDefault(); }}
                                  onDrop={(e) => { e.preventDefault(); const letter = e.dataTransfer.getData('text/plain'); if (letter) assignHeadingToQuestion(letter, mq.id); setDraggingHeading(null); }}
                                >
                                  <span className="text-[11px] font-semibold text-gray-500 w-6 text-center select-none">{mq.questionNumber || ''}</span>
                                  {qAnswer ? (
                                    <>
                                      <span className="flex-1 text-gray-900 font-medium leading-snug">{resolveHeadingText(qAnswer)}</span>
                                      <button onClick={() => clearHeadingFromQuestion(mq.id)} className="ml-auto text-[11px] text-red-600 hover:underline" type="button">✕</button>
                                    </>
                                  ) : (
                                    <span className="flex-1 text-gray-400 italic">Drop heading here</span>
                                  )}
                                </div>
                                <div className="text-xs text-gray-500 mb-1">Paragraph {paragraphLetter}</div>
                                <div className="prose max-w-none text-gray-800 whitespace-pre-wrap text-sm leading-relaxed">{para}</div>
                              </div>
                            );
                          });
                        })()}
                      </div>
                    ) : (
                      // Fallback: show entire passage if no auto-detect possible
                      currentSection?.passageText && (
                        <div className="prose max-w-none text-gray-800 whitespace-pre-wrap mb-6">{currentSection.passageText}</div>
                      )
                    )}
                    {/* Non-matching passage text (if provided) */}
                    {!isMatchingSection && (
                      <div className="prose max-w-none text-gray-800 whitespace-pre-wrap">
                        {currentSection?.passageText || 'No passage text set for this section.'}
                      </div>
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
            className="min-h-0 flex flex-col bg-white shadow-sm"
            style={window.innerWidth >= 1024 ? { width: `${100 - leftWidthPct}%` } : undefined}
          >
            <div className="flex flex-col h-full overflow-hidden min-h-0 border-l">
              <div ref={rightScrollRef} className="p-2 md:p-3 flex-1 overflow-auto relative min-h-0">
                {isMatchingSection && headingOptions.length > 0 && (
                  <div className="mb-4 space-y-2">
                    {(() => { const gi = matchingQuestions[0]?.metadata?.groupInstruction; return gi ? <div className="text-xs text-gray-600 whitespace-pre-wrap border rounded p-2 bg-gray-50">{gi}</div> : null; })()}
                    <div className="text-sm font-medium text-gray-700">List of Headings</div>
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
                            className={`px-3 py-1.5 rounded border text-sm cursor-move select-none leading-snug ${used ? 'bg-gray-200 text-gray-500 line-through' : 'bg-white hover:bg-gray-50'} border-gray-300`}
                            title={text + (used ? ' (already used)' : '')}
                          >
                            {text}
                          </div>
                        );
                      })}
                    </div>
                    <div className="text-[10px] text-gray-500">Drag a heading text onto a paragraph drop zone on the left. Each heading can be used once.</div>
                  </div>
                )}
                {(() => {
                  const lastInstructionPerType: Record<string, string | undefined> = {};
                  return (currentSection?.questions || []).filter((q: any) => q.questionType !== 'matching').map((q: any, idx: number) => {
                  const displayNumber = q.questionNumber || (idx + 1);
                  // Interactive fill_blank: support placeholders {answer1} OR runs of underscores ___ inline.
                  let renderedQuestionText: React.ReactNode = q.questionText || q.text;
                  let hasInlinePlaceholders = false;
                  if (q.questionType === 'fill_blank' && typeof (q.questionText || '') === 'string') {
                    const text = q.questionText;
                    const hasCurly = /\{answer\d+\}/i.test(text);
                    const hasUnderscore = /_{3,}/.test(text);
                    if (hasCurly || hasUnderscore) {
                      hasInlinePlaceholders = true;
                      const nodes: React.ReactNode[] = [];
                      const answerArray = Array.isArray(answers[q.id]?.answer) ? answers[q.id]?.answer as string[] : [];
                      const baseNum = Number(q.questionNumber) || (idx + 1);
                      if (hasCurly) {
                        const regex = /\{(answer\d+)\}/gi;
                        let lastIndex = 0; let match; let blankIndex = 0;
                        while ((match = regex.exec(text)) !== null) {
                          const before = text.slice(lastIndex, match.index);
                          if (before) nodes.push(before);
                          const idxLocal = blankIndex;
                          const val = answerArray[idxLocal] || '';
                          const blankNumber = baseNum + idxLocal;
                          nodes.push(
                            <span key={`blank-${q.id}-${idxLocal}`} className="mx-1 inline-block align-middle">
                              <span className="relative inline-flex">
                                <input
                                  type="text"
                                  className="px-2 py-1 border border-gray-400 rounded-sm text-sm min-w-[110px] focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-center font-medium tracking-wide"
                                  value={val}
                                  onChange={(e) => {
                                    const prev = Array.isArray(answers[q.id]?.answer) ? [...(answers[q.id]?.answer as string[])] : [];
                                    while (prev.length <= idxLocal) prev.push('');
                                    prev[idxLocal] = e.target.value;
                                    handleAnswerChange(q.id, prev);
                                  }}
                                />
                                {!val && (
                                  <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-[13px] font-semibold text-gray-700 select-none">{blankNumber}</span>
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
                          const blankNumber = baseNum + idxLocal;
                          nodes.push(
                            <span key={`ublank-${q.id}-${idxLocal}`} className="mx-1 inline-block align-middle">
                              <span className="relative inline-flex">
                                <input
                                  type="text"
                                  className="px-2 py-1 border border-gray-400 rounded-sm text-sm min-w-[110px] focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-center font-medium tracking-wide"
                                  value={val}
                                  onChange={(e) => {
                                    const prev = Array.isArray(answers[q.id]?.answer) ? [...(answers[q.id]?.answer as string[])] : [];
                                    while (prev.length <= idxLocal) prev.push('');
                                    prev[idxLocal] = e.target.value;
                                    handleAnswerChange(q.id, prev);
                                  }}
                                />
                                {!val && (
                                  <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-[13px] font-semibold text-gray-700 select-none">{blankNumber}</span>
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
                      renderedQuestionText = <span className="leading-relaxed flex flex-wrap items-center">{nodes}</span>;
                    }
                  }
                    const groupInstruction: string | undefined = q.metadata?.groupInstruction;
                    const showGroupInstruction = !!groupInstruction && groupInstruction !== lastInstructionPerType[q.questionType];
                    if (showGroupInstruction) lastInstructionPerType[q.questionType] = groupInstruction;
                  return (
                  <div ref={el => { if (el) questionRefs.current[q.id] = el; }} key={q.id} className="mb-3 pb-3 border-b last:border-0 last:pb-0">
                    {showGroupInstruction && (
                      <div className="mb-2 text-xs text-gray-600 bg-gray-50 border rounded p-2 whitespace-pre-wrap">
                        {groupInstruction}
                      </div>
                    )}
                    <div className="mb-2">
                      <h3 className="text-base font-medium text-gray-900 flex flex-wrap items-start gap-1">
                        <span className="text-gray-600">Question {displayNumber} -</span>
                        <span className="font-medium text-gray-900">{renderedQuestionText}</span>
                      </h3>
                    </div>

                    {(currentSection?.sectionType || '').toLowerCase() === 'listening' && currentSection?.audioUrl && idx === 0 && (
                      <div className="mb-3">
                        <audio controls src={currentSection.audioUrl} className="w-full">
                          Your browser does not support the audio element.
                        </audio>
                      </div>
                    )}

                    {(q.passage) && (
                      <div className="bg-gray-50 p-3 rounded mb-3">
                        <h4 className="font-medium text-gray-900 mb-2">Passage:</h4>
                        <div className="text-gray-700 leading-relaxed">{q.passage}</div>
                      </div>
                    )}

                    {(q.questionType === 'multiple_choice' || q.type === 'multiple_choice' || q.questionType === 'drag_drop') && (
                      <div className="mb-2">
                        <select
                          className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
                          value={(answers[q.id]?.answer as string) || ''}
                          onChange={(e) => handleAnswerChange(q.id, e.target.value)}>
                          <option value="">Select an answer</option>
                          {(q.options || []).map((option: any, index: number) => {
                            const value = option.letter || option.text || option;
                            const label = option.letter ? `${option.letter}. ${option.text}` : option.text || option;
                            return <option key={index} value={value}>{label}</option>;
                          })}
                        </select>
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
                              className={`flex items-start gap-2 text-sm px-3 py-2 border rounded cursor-pointer select-none ${checked ? 'bg-blue-100 border-blue-300' : 'bg-white border-gray-300 hover:bg-gray-50'}`}
                              onClick={() => {
                                let next = [...current];
                                if (checked) next = next.filter(l => l !== letter); else if (next.length < 2) next.push(letter); else {
                                  // Replace the second selection keeping the first
                                  next = [next[0], letter];
                                }
                                handleAnswerChange(q.id, next);
                              }}
                            >
                              <input type="checkbox" className="mt-1" checked={checked} readOnly />
                              <span className="flex-1">{label}</span>
                            </label>
                          );
                        })}
                        <div className="text-[10px] text-gray-500">Choose TWO answers.</div>
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
                              className={`flex items-start gap-2 cursor-pointer rounded px-3 py-2 border border-transparent hover:bg-gray-100 transition-colors ${selected ? 'bg-gray-200' : ''}`}
                              onClick={() => handleAnswerChange(q.id, label)}
                            >
                              <input
                                type="radio"
                                className="mt-1"
                                name={`question-${q.id}`}
                                value={label}
                                checked={selected}
                                onChange={() => handleAnswerChange(q.id, label)}
                              />
                              <span className="text-sm text-gray-900 select-none">{label}</span>
                            </label>
                          );
                        })}
                      </div>
                    )}

                    {(q.questionType === 'essay' || q.type === 'text' || q.questionType === 'speaking_task') && (
                      <textarea
                        value={(answers[q.id]?.answer as string) || ''}
                        onChange={(e) => handleAnswerChange(q.id, e.target.value)}
                        placeholder={q.questionType === 'speaking_task' ? 'Type key points you would say...' : 'Enter your answer...'}
                        className="w-full p-3 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-none"
                        rows={q.questionType === 'speaking_task' ? 4 : 6}
                      />
                    )}

                    {(q.questionType === 'fill_blank' || q.type === 'number') && !hasInlinePlaceholders && (
                      <div className="mt-2">
                        <span className="relative inline-flex">
                          <input
                            type="text"
                            value={(answers[q.id]?.answer as string) || ''}
                            onChange={(e) => handleAnswerChange(q.id, e.target.value)}
                            className="px-3 py-2 border border-gray-400 rounded-sm text-sm min-w-[140px] focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-center font-medium tracking-wide"
                          />
                          {!(answers[q.id]?.answer) && (
                            <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-[13px] font-semibold text-gray-700 select-none">
                              {q.questionNumber || ''}
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
  <div className="border-t bg-white p-3">
        <div className="flex items-center gap-2">
          <button
            onClick={goToPreviousQuestion}
            className="px-3 py-2 text-sm rounded border border-gray-300 bg-white hover:bg-gray-50"
            disabled={currentSectionIndex === 0 && currentQuestionIndex === 0}
          >Prev</button>
          <div className="flex-1 flex flex-wrap gap-1 overflow-y-auto max-h-20">
    {(currentSection?.questions || []).map((q: any, idx: number) => {
              const isAnswered = answers[q.id];
              const isCurrent = idx === currentQuestionIndex;
              return (
                <button key={q.id} onClick={() => goToQuestion(currentSectionIndex, idx)} className={`w-8 h-8 text-xs rounded border flex items-center justify-center ${isCurrent ? 'bg-blue-600 text-white border-blue-600' : isAnswered ? 'bg-green-100 text-green-800 border-green-300' : 'bg-gray-50 text-gray-600 border-gray-300 hover:bg-gray-100'}`}>
                  {q.questionNumber || idx + 1}
                </button>
              );
            })}
          </div>
          <button
            onClick={goToNextQuestion}
            className="px-3 py-2 text-sm rounded border border-blue-300 bg-blue-600 text-white hover:bg-blue-700"
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
