import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, LayoutGroup, motion } from 'framer-motion';
import {
  AlertCircle,
  Bot,
  Maximize2,
  MessageSquare,
  Minus,
  RotateCcw,
  Send,
  Trash2,
  User,
  X,
} from 'lucide-react';
import {
  SUGGESTED_QUESTIONS,
  sendAssistantMessage,
} from '../services/assistantService';

const CLOSED_W = 188;
const CLOSED_H = 44;
const CLOSED_R = 22;
const MINIMIZED_H = 57;
const OPEN_R = 14;

function createWelcomeMessage(stationId) {
  return {
    id: 'msg-welcome',
    role: 'assistant',
    source: 'demo-rule-based',
    timestamp: 'Ready',
    content: `WeatherGuard AI Operations Assistant ready. Grounded in live dashboard state (focused node: ${stationId || 'AWS network'}). Note: Responses currently use rule-based demo summaries over simulated station data until connected to POST /api/chat.`,
  };
}

function getResponsiveShellBounds() {
  if (typeof window === 'undefined') {
    return { openW: 400, openH: 540 };
  }
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const openW = Math.min(410, vw - 24);
  const openH =
    vw <= 640 ? Math.min(520, Math.round(vh * 0.74)) : Math.min(560, vh - 44);
  return { openW, openH };
}

export default function WeatherAssistant({
  selectedStation,
  stations,
  overview,
  anomalies,
  alerts,
  timeline,
  isMockMode,
}) {
  // 'closed' | 'open' | 'minimized' | 'closing'
  const [phase, setPhase] = useState('closed');
  const [closingShrink, setClosingShrink] = useState(false);
  const [bounds, setBounds] = useState(getResponsiveShellBounds);

  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);
  const [lastUserQuery, setLastUserQuery] = useState('');
  const [sendBurstKey, setSendBurstKey] = useState(0);
  const [messages, setMessages] = useState(() => [
    createWelcomeMessage(selectedStation?.stationId),
  ]);

  const scrollEndRef = useRef(null);
  const inputRef = useRef(null);
  const launcherRef = useRef(null);
  const closeTimersRef = useRef([]);

  const clearCloseTimers = useCallback(() => {
    for (const id of closeTimersRef.current) {
      clearTimeout(id);
    }
    closeTimersRef.current = [];
  }, []);

  useEffect(() => {
    const handleResize = () => {
      setBounds(getResponsiveShellBounds());
    };
    window.addEventListener('resize', handleResize, { passive: true });
    return () => {
      window.removeEventListener('resize', handleResize);
      clearCloseTimers();
    };
  }, [clearCloseTimers]);

  const handleOpen = () => {
    clearCloseTimers();
    setClosingShrink(false);
    setPhase('open');
  };

  const handleClose = useCallback(() => {
    if (phase === 'closed' || phase === 'closing') return;
    clearCloseTimers();

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) {
      setClosingShrink(false);
      setPhase('closed');
      requestAnimationFrame(() => launcherRef.current?.focus());
      return;
    }

    // Step 1 (0–110ms): Fade out chatbot content first while keeping shell steady
    setPhase('closing');
    setClosingShrink(false);

    // Step 2 (110–350ms): Shrink shell smoothly back into floating launcher pill
    const shrinkTimer = setTimeout(() => {
      setClosingShrink(true);
    }, 110);

    const finishTimer = setTimeout(() => {
      setClosingShrink(false);
      setPhase('closed');
      requestAnimationFrame(() => launcherRef.current?.focus());
    }, 355);

    closeTimersRef.current = [shrinkTimer, finishTimer];
  }, [clearCloseTimers, phase]);

  useEffect(() => {
    if (phase === 'closed') return undefined;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        handleClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleClose, phase]);

  useEffect(() => {
    if (phase !== 'open') return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    scrollEndRef.current?.scrollIntoView({
      behavior: reduced ? 'auto' : 'smooth',
      block: 'end',
    });
  }, [messages, isLoading, phase]);

  useEffect(() => {
    if (phase === 'open') {
      const timer = setTimeout(() => {
        inputRef.current?.focus();
      }, 360);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [phase]);

  const submitQuery = async (rawText, { isRetry = false } = {}) => {
    const text = rawText.trim();
    if (!text || isLoading || phase === 'closing') return;

    setErrorMsg(null);
    setLastUserQuery(text);
    setSendBurstKey((k) => k + 1);

    const historySnapshot = messages;
    if (!isRetry) {
      const userMsg = {
        id: `usr-${Date.now()}`,
        role: 'user',
        content: text,
        timestamp: new Date().toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
        }),
      };
      setMessages((prev) => [...prev, userMsg]);
      setInput('');
    }

    setIsLoading(true);
    try {
      const result = await sendAssistantMessage({
        message: text,
        history: historySnapshot,
        context: {
          selectedStation,
          stations,
          overview,
          anomalies,
          alerts,
          timeline,
        },
      });

      const assistantMsg = {
        id: `ast-${Date.now()}`,
        role: 'assistant',
        content: result.reply,
        source: result.source,
        timestamp: result.timestamp,
      };
      setMessages((prev) => [...prev, assistantMsg]);
    } catch (err) {
      setErrorMsg(err.message || 'Unable to reach the WeatherGuard assistant service.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleFormSubmit = (e) => {
    e.preventDefault();
    submitQuery(input);
  };

  const handleClear = () => {
    setErrorMsg(null);
    setLastUserQuery('');
    setMessages([createWelcomeMessage(selectedStation?.stationId)]);
  };

  const handleRetry = () => {
    const queryToRetry =
      lastUserQuery ||
      [...messages].reverse().find((m) => m.role === 'user')?.content;
    if (queryToRetry) {
      submitQuery(queryToRetry, { isRetry: true });
    }
  };

  const isShrunkToPill =
    phase === 'closed' || (phase === 'closing' && closingShrink);
  const isContentVisible = phase === 'open' || phase === 'minimized';
  const showBody = phase === 'open';

  const targetWidth = isShrunkToPill ? CLOSED_W : bounds.openW;
  const targetHeight = isShrunkToPill
    ? CLOSED_H
    : phase === 'minimized'
      ? MINIMIZED_H
      : bounds.openH;
  const targetRadius = isShrunkToPill ? CLOSED_R : OPEN_R;

  const shellTransition =
    phase === 'closing'
      ? { duration: 0.24, ease: [0.4, 0, 0.2, 1] }
      : { type: 'spring', stiffness: 230, damping: 25, mass: 0.9 };

  return (
    <LayoutGroup id="weatherguard-assistant-morph">
      <div className="wa-assistant-root">
        <motion.div
          layoutId="wa-morph-shell"
          className={`wa-morph-shell ${
            phase === 'closed' ? 'wa-shell-closed' : 'wa-shell-expanded'
          }`}
          style={{ originX: 1, originY: 1 }}
          initial={false}
          animate={{
            width: targetWidth,
            height: targetHeight,
            borderRadius: targetRadius,
          }}
          transition={shellTransition}
          role={phase === 'closed' ? undefined : 'dialog'}
          aria-label={
            phase === 'closed' ? undefined : 'WeatherGuard AI Weather Assistant'
          }
        >
          {phase === 'closed' ? (
            <motion.button
              ref={launcherRef}
              type="button"
              className="wa-launcher-btn"
              whileHover={{ y: -2 }}
              whileTap={{ scale: 0.96 }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
              onClick={handleOpen}
              aria-expanded={false}
              aria-label="Open AI Weather Assistant"
            >
              <motion.span
                layoutId="wa-morph-icon"
                className="wa-launcher-icon-wrap"
                initial={{ rotate: 18 }}
                animate={{ rotate: 0 }}
                transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
              >
                <MessageSquare size={17} className="wa-launcher-icon" />
              </motion.span>
              <span className="wa-launcher-label">Weather Assistant</span>
            </motion.button>
          ) : (
            <motion.div
              className="wa-panel-inner"
              aria-hidden={!isContentVisible}
              style={{
                pointerEvents: isContentVisible ? 'auto' : 'none',
              }}
              animate={{
                opacity: isContentVisible ? 1 : 0,
              }}
              transition={{
                duration: phase === 'closing' ? 0.11 : 0.16,
                ease: 'easeOut',
              }}
            >
              {/* Stage 1: Header (stagger 80ms) */}
              <motion.header
                className="wa-header"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: isContentVisible ? 1 : 0, y: isContentVisible ? 0 : 4 }}
                transition={{
                  duration: 0.22,
                  delay: phase === 'open' ? 0.08 : 0,
                  ease: [0.22, 1, 0.36, 1],
                }}
              >
                <div className="wa-header-brand">
                  <motion.div
                    layoutId="wa-morph-icon"
                    className="wa-brand-icon"
                    initial={{ rotate: -18, scale: 0.92 }}
                    animate={{ rotate: 0, scale: 1 }}
                    transition={{ duration: 0.42, ease: [0.22, 1, 0.36, 1] }}
                  >
                    <MessageSquare size={16} />
                  </motion.div>
                  <div>
                    <div className="wa-header-title">WeatherGuard AI</div>
                    <div className="wa-header-meta">
                      <span>{isMockMode ? 'Demo Rule-Based' : 'Live /api/chat'}</span>
                      <span>·</span>
                      <span>{selectedStation?.stationId || 'Fleet'}</span>
                    </div>
                  </div>
                </div>

                <div className="wa-header-actions">
                  <button
                    type="button"
                    className="wa-icon-btn wa-btn-retry"
                    onClick={handleRetry}
                    disabled={!isContentVisible || isLoading || (!lastUserQuery && messages.length <= 1)}
                    tabIndex={isContentVisible ? 0 : -1}
                    title="Retry last question"
                    aria-label="Retry last question"
                  >
                    <RotateCcw size={14} />
                  </button>
                  <button
                    type="button"
                    className="wa-icon-btn wa-btn-clear"
                    onClick={handleClear}
                    disabled={!isContentVisible || isLoading}
                    tabIndex={isContentVisible ? 0 : -1}
                    title="Clear conversation"
                    aria-label="Clear conversation"
                  >
                    <Trash2 size={14} />
                  </button>
                  <button
                    type="button"
                    className="wa-icon-btn wa-btn-min"
                    onClick={() =>
                      setPhase((prev) => (prev === 'minimized' ? 'open' : 'minimized'))
                    }
                    disabled={!isContentVisible}
                    tabIndex={isContentVisible ? 0 : -1}
                    title={phase === 'minimized' ? 'Restore assistant' : 'Minimize assistant'}
                    aria-label={phase === 'minimized' ? 'Restore assistant' : 'Minimize assistant'}
                  >
                    {phase === 'minimized' ? <Maximize2 size={14} /> : <Minus size={14} />}
                  </button>
                  <button
                    type="button"
                    className="wa-icon-btn wa-btn-close"
                    onClick={handleClose}
                    disabled={!isContentVisible}
                    tabIndex={isContentVisible ? 0 : -1}
                    title="Close assistant"
                    aria-label="Close assistant"
                  >
                    <X size={15} />
                  </button>
                </div>
              </motion.header>

              {showBody && (
                <>
                  {/* Stage 2: Message Stream & Welcome (stagger 160ms) */}
                  <motion.div
                    className="wa-messages"
                    role="log"
                    aria-live="polite"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{
                      duration: 0.24,
                      delay: 0.16,
                      ease: [0.22, 1, 0.36, 1],
                    }}
                  >
                    <AnimatePresence initial={false}>
                      {messages.map((msg) => {
                        const isUser = msg.role === 'user';
                        return (
                          <motion.div
                            key={msg.id}
                            initial={{ opacity: 0, y: 8 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
                            className={`wa-msg-row ${isUser ? 'wa-msg-user' : 'wa-msg-assistant'}`}
                          >
                            <div className="wa-msg-avatar" aria-hidden="true">
                              {isUser ? <User size={13} /> : <Bot size={13} />}
                            </div>
                            <div className="wa-msg-content-wrap">
                              <div className="wa-bubble">
                                {msg.content.split('\n').map((line, i) => (
                                  <p key={`${msg.id}-ln-${i}`}>{line}</p>
                                ))}
                              </div>
                              <div className="wa-msg-foot">
                                <span>{msg.timestamp}</span>
                                {!isUser && msg.source === 'demo-rule-based' && (
                                  <span className="wa-demo-tag">Rule-Based Demo</span>
                                )}
                              </div>
                            </div>
                          </motion.div>
                        );
                      })}
                    </AnimatePresence>

                    {isLoading && (
                      <motion.div
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="wa-msg-row wa-msg-assistant"
                      >
                        <div className="wa-msg-avatar" aria-hidden="true">
                          <Bot size={13} />
                        </div>
                        <div className="wa-bubble wa-typing-bubble" aria-label="Assistant is typing">
                          <span className="wa-typing-dot" />
                          <span className="wa-typing-dot" />
                          <span className="wa-typing-dot" />
                        </div>
                      </motion.div>
                    )}

                    {errorMsg && (
                      <div className="wa-error-banner" role="alert">
                        <AlertCircle size={15} />
                        <span>{errorMsg}</span>
                        <button
                          type="button"
                          className="wa-retry-inline"
                          onClick={handleRetry}
                        >
                          Retry
                        </button>
                      </div>
                    )}

                    <div ref={scrollEndRef} />
                  </motion.div>

                  {/* Stage 3: Suggested Quick-Action Questions (stagger 240ms) */}
                  <motion.div
                    className="wa-suggestions"
                    aria-label="Suggested questions"
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{
                      duration: 0.22,
                      delay: 0.24,
                      ease: [0.22, 1, 0.36, 1],
                    }}
                  >
                    {SUGGESTED_QUESTIONS.map((question) => (
                      <button
                        key={question}
                        type="button"
                        className="wa-suggestion-chip"
                        disabled={isLoading}
                        onClick={() => submitQuery(question)}
                      >
                        {question}
                      </button>
                    ))}
                  </motion.div>

                  {/* Stage 4: Input Bar (stagger 320ms) */}
                  <motion.form
                    className="wa-input-bar"
                    onSubmit={handleFormSubmit}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{
                      duration: 0.22,
                      delay: 0.32,
                      ease: [0.22, 1, 0.36, 1],
                    }}
                  >
                    <input
                      ref={inputRef}
                      type="text"
                      className="wa-input"
                      placeholder={`Ask about ${selectedStation?.stationId || 'stations'}, anomalies, or alerts...`}
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      disabled={isLoading}
                      aria-label="Message WeatherGuard AI Assistant"
                    />
                    <motion.button
                      key={`send-${sendBurstKey}`}
                      type="submit"
                      className="wa-send-btn"
                      disabled={isLoading || !input.trim()}
                      whileTap={{ scale: 0.92 }}
                      initial={sendBurstKey > 0 ? { scale: 0.9 } : false}
                      animate={{ scale: 1 }}
                      transition={{ duration: 0.2 }}
                      aria-label="Send message"
                    >
                      <motion.span
                        className="wa-send-icon-wrap"
                        initial={
                          sendBurstKey > 0
                            ? { x: 4, y: -4, opacity: 0.5 }
                            : false
                        }
                        animate={{ x: 0, y: 0, opacity: 1 }}
                        transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
                      >
                        <Send size={15} />
                      </motion.span>
                    </motion.button>
                  </motion.form>
                </>
              )}
            </motion.div>
          )}
        </motion.div>
      </div>
    </LayoutGroup>
  );
}
