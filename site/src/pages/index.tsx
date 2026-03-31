import React, { MouseEvent, useState, useEffect, useRef } from 'react';
import Link from '@docusaurus/Link';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import Layout from '@theme/Layout';
import styles from './index.module.css';

/* ── TYPES ─────────────────────────────────────────────── */
interface Layer { num: string; name: string; userQ: string; answer: string; desc: string; href: string; }

/* ── DATA ──────────────────────────────────────────────── */

const REALITY_ITEMS = [
  'AI reads partial context',
  "Chooses paths you didn't intend",
  'Modifies unrelated modules',
  'Leaves no explainable trace',
];

const WHO_ITEMS = [
  { n: '01', title: 'Large codebases', body: 'Hundreds of interdependent modules where one unscoped change cascades.' },
  { n: '02', title: 'Multi-agent workflows', body: 'Multiple agents sharing a codebase without enforced execution boundaries.' },
  { n: '03', title: 'Regulated environments', body: 'Financial, healthcare, and infrastructure systems that require auditable AI decisions.' },
  { n: '04', title: 'Critical systems', body: 'Production code where a wrong AI decision costs more than the sprint.' },
];

const OUTCOMES = [
  'You know the exact scope before execution',
  'AI cannot modify outside declared boundaries',
  'Every decision is traceable and replayable',
  'Failures are explainable, not mysterious',
];

const MECHANICS = [
  {
    n: '01',
    title: 'Execution Context Object',
    sub: 'Context',
    body: 'Parse the live codebase with tree-sitter and ast-grep. Produce a precision-scored ECO — a verified map of every symbol, dependency, and file relevant to the task. The agent never guesses at scope.',
  },
  {
    n: '02',
    title: 'Task Execution Envelope',
    sub: 'Constraints',
    body: 'Wrap the task in a TEE: allowed modules, blocked files, max line scope. The agent sees only what it is permitted to see. Writes outside scope are rejected before they touch the codebase.',
  },
  {
    n: '03',
    title: 'Controlled Execution',
    sub: 'Execution',
    body: 'The agent executes inside declared bounds. Violations fail loudly, not silently. Confidence scoring flags uncertainty before execution — not after deployment.',
  },
  {
    n: '04',
    title: 'Decision Ledger',
    sub: 'Trace',
    body: 'Every decision — what was read, what was chosen, what was written — is logged under a single trace_id. Replay any failure in isolation. Root cause in minutes, not days.',
  },
];

const PROOF_ITEMS = [
  { label: 'Deterministic pipeline', sub: 'Same inputs produce the same execution bounds — every time.' },
  { label: 'Explicit constraints', sub: 'Allowed modules, blocked files, and max scope are declared before any agent acts.' },
  { label: 'Append-only decision ledger', sub: 'Every decision is written once, immutable, replayable from any point.' },
  { label: 'Evidence-based gating', sub: 'Classification requires a verified parse graph. Guesses are structurally impossible.' },
];

const WITHOUT_ITEMS = [
  "Agent guesses at execution context",
  "No scope enforcement — agent decides what to touch",
  "Output looks correct until it isn't",
  "No audit trail — decisions are invisible",
  "Root cause: days of manual triage",
];

const WITH_ITEMS = [
  "Verified parse graph — exact scope, not guesses",
  "Task Execution Envelope — out-of-scope writes rejected",
  "Explicit confidence score flags uncertainty before shipping",
  "Full decision trace — replay any step from trace_id",
  "Root cause in minutes — full chain available",
];

const LAYERS: Layer[] = [
  {
    num: '01', name: 'Knowledge Engine',
    userQ: 'Can I trust what the agent sees?',
    answer: 'Yes — it reads the real parse graph, not a text search.',
    desc: 'Runs tree-sitter, ast-grep, and ctags against the live codebase. Produces a reliability-scored Execution Context Object before any agent activates. The agent never guesses at scope.',
    href: '/docs/knowledge-engine/overview',
  },
  {
    num: '02', name: 'Task Orchestrator',
    userQ: 'Can I control what it touches?',
    answer: 'Yes — writes outside declared scope are rejected.',
    desc: 'Assigns Task Execution Envelopes with explicit allowed_modules, blocked_files, and max_lines. The agent operates inside those constraints. Violations fail loudly, not silently.',
    href: '/docs/task-pipeline/overview',
  },
  {
    num: '03', name: 'Decision Ledger',
    userQ: 'Can I debug why it failed?',
    answer: 'Yes — every decision is logged, traced, and replayable.',
    desc: 'A single trace_id connects every stage from spec to output. Replay any failure in isolation. 5% ground truth sampling closes the loop between what the system believed and what was true.',
    href: '/docs/decision-ledger/overview',
  },
];

const DEMO_BEFORE = [
  { label: 'Task', value: 'Update payment validation flow' },
  { label: 'Scope', value: 'Unknown — agent decides at runtime' },
  { label: 'Files touched', value: '12 files across 4 modules' },
  { label: 'Trace', value: 'None' },
  { label: 'Outcome', value: 'Regression in 3 unrelated modules' },
];

const DEMO_AFTER = [
  { label: 'Task', value: 'Update payment validation flow' },
  { label: 'Scope', value: 'payment/validator.ts · payment/schema.ts · tests/payment.spec.ts' },
  { label: 'Files touched', value: '2 of 3 declared — 1 unchanged' },
  { label: 'Trace', value: 'trace_id: pay-val-0491 · full decision log' },
  { label: 'Outcome', value: 'Change applied. Zero unintended writes.' },
];

/* ── COMPONENTS ────────────────────────────────────────── */

/* ── VIDEO MODAL ── */
const VIDEO_URL = 'https://github.com/user-attachments/assets/ab7ffbfe-fa29-44b9-be6e-34fbfd810116';

function VideoModal({ open, onClose }: { open: boolean; onClose: () => void }): React.JSX.Element | null {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (!open && videoRef.current) {
      videoRef.current.pause();
      videoRef.current.currentTime = 0;
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  if (!open) return null;

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        background: 'rgba(0,0,0,0.92)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '24px',
        animation: 'nirnex-fade-in 0.15s ease',
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Product demo video"
    >
      <button
        onClick={onClose}
        aria-label="Close video"
        style={{
          position: 'absolute', top: '20px', right: '24px',
          background: 'transparent', border: '1px solid rgba(255,255,255,0.2)',
          color: '#ffffff', cursor: 'pointer',
          width: '40px', height: '40px',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '20px', lineHeight: 1, fontFamily: 'var(--font-display)',
          transition: 'border-color 0.15s, background 0.15s',
        }}
        onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.1)'; }}
        onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
      >
        ✕
      </button>

      <div style={{
        position: 'absolute', top: '22px', left: '24px',
        fontSize: '12px', fontWeight: 700, letterSpacing: '0.2em',
        textTransform: 'uppercase', color: '#D63318',
        fontFamily: 'var(--font-display)',
      }}>
        Nirnex explainer
      </div>

      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: '1100px',
          boxShadow: '0 32px 80px rgba(0,0,0,0.8)',
          border: '1px solid rgba(255,255,255,0.08)',
          background: '#000',
          animation: 'nirnex-scale-in 0.18s ease',
        }}
      >
        <video
          ref={videoRef}
          src={VIDEO_URL}
          controls
          autoPlay
          playsInline
          style={{ width: '100%', display: 'block', maxHeight: '80vh' }}
        />
      </div>

      <style>{`
        @keyframes nirnex-fade-in {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        @keyframes nirnex-scale-in {
          from { transform: scale(0.96); opacity: 0; }
          to   { transform: scale(1);    opacity: 1; }
        }
      `}</style>
    </div>
  );
}

/* ── LABEL ── */
function SectionLabel({ text, dark }: { text: string; dark?: boolean }): React.JSX.Element {
  return (
    <div style={{
      fontSize: '12px', fontWeight: 700, letterSpacing: '0.22em',
      textTransform: 'uppercase',
      color: dark ? 'rgba(214,51,24,0.8)' : '#D63318',
      marginBottom: '1rem',
    }}>{text}</div>
  );
}

/* 1 ── HERO ─────────────────────────────────────────────── */
function HomepageHero(): React.JSX.Element {
  const [videoOpen, setVideoOpen] = useState(false);
  return (
    <section style={{
      background: 'var(--lp-hero-bg)',
      color: 'var(--lp-h1)',
      padding: '7vw 4vw 6vw',
      position: 'relative',
      overflow: 'hidden',
      borderBottom: '1px solid var(--lp-border-sub)',
    }}>
      {/* Watermark */}
      <div aria-hidden="true" style={{
        position: 'absolute', top: '-4vw', right: '-2vw',
        fontSize: '22vw', fontWeight: 900, color: 'var(--lp-watermark)',
        lineHeight: 1, letterSpacing: '-0.04em', pointerEvents: 'none',
        textTransform: 'uppercase', fontFamily: 'Space Grotesk, sans-serif',
        userSelect: 'none',
      }}>N</div>

      <div className={styles.heroGrid}>
        {/* Left: copy */}
        <div>
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: '8px',
            fontSize: '12px', fontWeight: 700, letterSpacing: '0.18em',
            textTransform: 'uppercase', color: 'var(--lp-muted)', marginBottom: '1.75rem',
          }}>
            <span style={{ width: '20px', height: '1px', background: '#D63318', display: 'inline-block', flexShrink: 0 }} />
            Decision control for AI execution
          </div>

          <h1 style={{
            fontSize: 'clamp(2.4rem,5vw,5rem)', fontWeight: 900, lineHeight: 0.95,
            textTransform: 'uppercase', letterSpacing: '-0.03em',
            marginBottom: '1.5rem', color: 'var(--lp-h1)',
          }}>
            You are letting AI<br />modify your code<br />
            <span style={{ color: '#D63318' }}>without knowing<br />what it will touch.</span>
          </h1>

          <p style={{
            fontSize: '17px', fontWeight: 400, lineHeight: 1.75,
            color: 'var(--lp-hero-body)', marginBottom: '2.5rem',
          }}>
            Nirnex enforces scope, validates decisions, and records every action — before execution.
          </p>

          <div style={{ display: 'flex', gap: 0, flexWrap: 'wrap' }}>
            <button
              onClick={() => setVideoOpen(true)}
              style={{
                background: '#D63318', color: '#FFFFFF',
                padding: '14px 32px', fontSize: '12px', fontWeight: 700,
                letterSpacing: '0.2em', textTransform: 'uppercase',
                border: 'none', cursor: 'pointer', display: 'inline-flex',
                alignItems: 'center', gap: '10px', fontFamily: 'var(--font-display)',
              }}
            >
              <i style={{ width: '22px', height: '22px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="18" height="18">
                  <path d="M8 5v14l11-7z" />
                </svg>
              </i>
              See How It Works
            </button>
            <Link to="/docs/intro/overview" style={{
              background: 'transparent', color: 'var(--lp-h1)',
              padding: '14px 32px', fontSize: '12px', fontWeight: 700,
              letterSpacing: '0.2em', textTransform: 'uppercase', textDecoration: 'none',
              border: '1px solid var(--lp-ghost-btn-border)', borderLeft: 'none',
              display: 'inline-block',
            }}>Access the Architecture →</Link>
          </div>
        </div>

        {/* Right: static flow diagram */}
        <div>
          <div style={{
            border: '1px solid var(--lp-border)',
            fontFamily: 'var(--font-mono)',
          }}>
            <div style={{
              padding: '10px 16px',
              borderBottom: '1px solid var(--lp-border)',
              fontSize: '12px', fontWeight: 700, letterSpacing: '0.15em',
              textTransform: 'uppercase', color: '#D63318',
            }}>Nirnex — Execution Signal</div>

            {[
              { step: 'PROMPT', detail: 'Update payment validation flow', status: 'received' },
              { step: 'CONTEXT', detail: 'Scoped to 3 files · 47 symbols verified', status: 'built' },
              { step: 'CONSTRAINTS', detail: 'max_lines: 200 · blocked: legacy/*', status: 'applied' },
              { step: 'EXECUTION', detail: '2 files modified · 0 scope violations', status: 'complete' },
              { step: 'TRACE', detail: 'trace_id: pay-val-0491 · logged', status: 'stored' },
            ].map((row, i, arr) => (
              <div key={i}>
                <div style={{
                  display: 'flex', alignItems: 'flex-start', gap: '12px',
                  padding: '14px 16px',
                  borderBottom: i < arr.length - 1 ? '1px solid var(--lp-border-sub)' : 'none',
                  background: i === 3 ? 'rgba(214,51,24,0.04)' : 'transparent',
                }}>
                  <span style={{
                    fontSize: '12px', fontWeight: 700, letterSpacing: '0.12em',
                    textTransform: 'uppercase', color: '#D63318',
                    minWidth: '80px', paddingTop: '2px',
                  }}>{row.step}</span>
                  <span style={{ fontSize: '12px', color: 'var(--lp-body)', lineHeight: 1.5, flex: 1 }}>
                    {row.detail}
                  </span>
                  <span style={{
                    fontSize: '12px', fontWeight: 700, letterSpacing: '0.1em',
                    textTransform: 'uppercase', color: 'var(--lp-muted)',
                    whiteSpace: 'nowrap',
                  }}>↳ {row.status}</span>
                </div>
                {i < arr.length - 1 && (
                  <div style={{
                    padding: '2px 16px 2px 20px',
                    fontSize: '12px', color: '#D63318',
                    fontFamily: 'var(--font-mono)',
                  }}>↓</div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      <VideoModal open={videoOpen} onClose={() => setVideoOpen(false)} />
    </section>
  );
}

/* 2 ── REALITY CHECK ─────────────────────────────────────── */
function RealityCheckSection(): React.JSX.Element {
  return (
    <section style={{
      background: '#111111',
      color: '#FFFFFF',
      padding: '5vw 4vw',
      borderBottom: '1px solid rgba(255,255,255,0.06)',
    }}>
      <div className={styles.insightGrid}>
        <div>
          <SectionLabel text="What actually happens today" dark />
          <h2 style={{
            fontSize: 'clamp(1.8rem,3.5vw,3rem)', fontWeight: 900, textTransform: 'uppercase',
            letterSpacing: '-0.03em', lineHeight: 1.05, color: '#FFFFFF',
            border: 'none', padding: 0, margin: '0 0 1rem',
          }}>
            You only discover it<br />after deployment.
          </h2>
        </div>
        <div>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {REALITY_ITEMS.map((item, i) => (
              <li key={i} style={{
                display: 'flex', alignItems: 'flex-start', gap: '14px',
                padding: '16px 0',
                borderBottom: i < REALITY_ITEMS.length - 1 ? '1px solid rgba(255,255,255,0.07)' : 'none',
              }}>
                <span style={{ color: '#D63318', fontWeight: 700, flexShrink: 0, fontSize: '14px', paddingTop: '2px' }}>→</span>
                <span style={{ fontSize: '16px', color: 'rgba(255,255,255,0.75)', lineHeight: 1.6 }}>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

/* 3 ── POSITIONING ───────────────────────────────────────── */
function PositioningSection(): React.JSX.Element {
  return (
    <section style={{
      background: 'linear-gradient(160deg, #1A0503 0%, #2B0805 100%)',
      color: '#FFFFFF',
      padding: '6vw 4vw',
      borderBottom: '1px solid rgba(214,51,24,0.2)',
    }}>
      <div className={styles.insightGrid}>
        <div>
          <div style={{
            fontSize: '12px', fontWeight: 700, letterSpacing: '0.22em',
            textTransform: 'uppercase', color: 'rgba(214,51,24,0.7)', marginBottom: '1.25rem',
          }}>What Nirnex Is</div>
          <h2 style={{
            fontSize: 'clamp(2rem,4vw,3.5rem)', fontWeight: 900, textTransform: 'uppercase',
            letterSpacing: '-0.03em', lineHeight: 1.0, color: '#FFFFFF',
            border: 'none', padding: 0, margin: '0 0 1rem',
          }}>
            Nirnex is not<br />an AI tool.
          </h2>
          <p style={{
            fontSize: '18px', fontWeight: 700, color: '#D63318',
            lineHeight: 1.4, margin: 0,
          }}>
            It is a decision control system<br />for AI execution.
          </p>
        </div>
        <div>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {[
              'It decides what AI is allowed to see',
              'It decides what AI is allowed to change',
              'It proves why a decision was made',
            ].map((item, i) => (
              <li key={i} style={{
                display: 'flex', alignItems: 'flex-start', gap: '18px',
                padding: '22px 0',
                borderBottom: i < 2 ? '1px solid rgba(214,51,24,0.12)' : 'none',
              }}>
                <span style={{
                  fontSize: '11px', fontWeight: 700, letterSpacing: '0.15em',
                  textTransform: 'uppercase', color: '#D63318',
                  paddingTop: '4px', flexShrink: 0, minWidth: '20px',
                }}>0{i + 1}</span>
                <span style={{ fontSize: '17px', fontWeight: 600, color: 'rgba(255,255,255,0.9)', lineHeight: 1.5 }}>
                  {item}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

/* 4 ── WHO THIS IS FOR ───────────────────────────────────── */
function WhoSection(): React.JSX.Element {
  return (
    <section style={{ background: 'var(--lp-pain-bg)', borderBottom: '1px solid var(--lp-border-sub)' }}>
      <div style={{ padding: '5vw 4vw 3vw', borderBottom: '1px solid var(--lp-border-sub)' }}>
        <SectionLabel text="Who This Is For" />
        <h2 style={{
          fontSize: 'clamp(1.8rem,3.5vw,3rem)', fontWeight: 900, textTransform: 'uppercase',
          letterSpacing: '-0.03em', lineHeight: 1, color: 'var(--lp-h2)',
          border: 'none', padding: 0, margin: 0,
        }}>
          This is for teams<br />where mistakes matter.
        </h2>
      </div>
      <div className={styles.principlesGrid}>
        {WHO_ITEMS.map((item, i) => (
          <div key={i} className={styles.principleItem}>
            <div style={{
              fontSize: '12px', fontWeight: 700, letterSpacing: '0.2em',
              textTransform: 'uppercase', color: '#D63318', marginBottom: '1.25rem',
            }}>{item.n} ·</div>
            <div style={{
              fontSize: 'clamp(1rem,1.8vw,1.3rem)', fontWeight: 900, textTransform: 'uppercase',
              letterSpacing: '-0.01em', lineHeight: 1.1, color: 'var(--lp-h2)',
              marginBottom: '0.875rem',
            }}>{item.title}</div>
            <p style={{
              fontSize: '14px', fontWeight: 400, color: 'var(--lp-principle-body)', lineHeight: 1.75, margin: 0,
            }}>{item.body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

/* 5 ── OUTCOME ───────────────────────────────────────────── */
function OutcomeSection(): React.JSX.Element {
  return (
    <section style={{
      background: 'var(--lp-solution-bg)',
      padding: '6vw 4vw',
      borderBottom: '1px solid var(--lp-border-sub)',
    }}>
      <SectionLabel text="What Changes When You Use Nirnex" />
      <div className={styles.insightGrid}>
        <div>
          <h2 style={{
            fontSize: 'clamp(2rem,4vw,3.5rem)', fontWeight: 900, textTransform: 'uppercase',
            letterSpacing: '-0.03em', lineHeight: 1.0, color: 'var(--lp-h2)',
            border: 'none', padding: 0, margin: 0,
          }}>
            Predictable.<br />Bounded.<br />Explainable.
          </h2>
        </div>
        <div>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {OUTCOMES.map((item, i) => (
              <li key={i} style={{
                display: 'flex', alignItems: 'flex-start', gap: '16px',
                padding: '18px 0',
                borderBottom: i < OUTCOMES.length - 1 ? '1px solid var(--lp-border-sub)' : 'none',
              }}>
                <span style={{ color: '#D63318', fontWeight: 700, flexShrink: 0, fontSize: '16px', paddingTop: '2px' }}>✓</span>
                <span style={{ fontSize: '16px', color: 'var(--lp-body)', lineHeight: 1.6, fontWeight: 500 }}>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

/* 6 ── HOW IT WORKS ──────────────────────────────────────── */
function HowSection(): React.JSX.Element {
  return (
    <section style={{ background: 'var(--lp-layers-bg)', borderBottom: '1px solid var(--lp-border-sub)' }}>
      <div style={{ padding: '5vw 4vw 3vw', borderBottom: '1px solid var(--lp-border-sub)' }}>
        <SectionLabel text="How It Works" />
        <h2 style={{
          fontSize: 'clamp(1.5rem,2.5vw,2.2rem)', fontWeight: 900, textTransform: 'uppercase',
          letterSpacing: '-0.02em', lineHeight: 1, color: 'var(--lp-h2)',
          border: 'none', padding: 0, margin: '0 0 0.75rem',
        }}>Context → Constraints → Execution → Trace</h2>
        <p style={{ fontSize: '14px', color: 'var(--lp-muted)', lineHeight: 1.7, margin: 0 }}>
          Four steps. No guesswork. Every action declared before it runs.
        </p>
      </div>
      <div className={styles.mechanicsGrid}>
        {MECHANICS.map((m, i) => (
          <div key={i} className={styles.mechanicStep}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '1.25rem',
            }}>
              <span style={{
                fontSize: '12px', fontWeight: 700, letterSpacing: '0.2em',
                textTransform: 'uppercase', color: '#D63318',
              }}>{m.n} ·</span>
              <span style={{
                fontSize: '11px', fontWeight: 700, letterSpacing: '0.15em',
                textTransform: 'uppercase', color: 'var(--lp-muted)',
                border: '1px solid var(--lp-border-sub)', padding: '2px 6px',
              }}>{m.sub}</span>
            </div>
            <div style={{
              fontSize: 'clamp(1rem,1.6vw,1.15rem)', fontWeight: 900, textTransform: 'uppercase',
              letterSpacing: '-0.01em', lineHeight: 1.1, color: 'var(--lp-h2)',
              marginBottom: '0.875rem',
            }}>{m.title}</div>
            <p style={{
              fontSize: '14px', fontWeight: 400, color: 'var(--lp-body)', lineHeight: 1.75, margin: 0,
            }}>{m.body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

/* 7 ── LAYERS ───────────────────────────────────────────── */
function LayersSection(): React.JSX.Element {
  const handleMouseEnter = (e: MouseEvent<HTMLAnchorElement>): void => {
    const t = e.currentTarget;
    t.style.background = '#D63318';
    t.style.color = '#fff';
    t.querySelectorAll('[data-muted]').forEach(el => { (el as HTMLElement).style.color = 'rgba(255,255,255,0.6)'; });
  };

  const handleMouseLeave = (e: MouseEvent<HTMLAnchorElement>): void => {
    const t = e.currentTarget;
    t.style.background = '';
    t.style.color = '';
    t.querySelectorAll('[data-muted]').forEach(el => { (el as HTMLElement).style.color = ''; });
  };

  return (
    <section style={{ background: 'var(--lp-layers-bg)', borderBottom: '1px solid var(--lp-border-sub)' }}>
      <div style={{ padding: '4vw 4vw 0', borderBottom: '1px solid var(--lp-border-sub)' }}>
        <SectionLabel text="Under the Hood" />
        <h2 style={{
          fontSize: 'clamp(1.5rem,2.5vw,2.2rem)', fontWeight: 900, textTransform: 'uppercase',
          letterSpacing: '-0.02em', lineHeight: 1, color: 'var(--lp-h2)',
          border: 'none', padding: '0 0 2rem', margin: 0,
        }}>Three Layers. One Control Surface.</h2>
      </div>
      <div className={styles.layersGrid}>
        {LAYERS.map((l: Layer, i: number) => (
          <Link key={i} to={l.href} className={styles.layerItem} onMouseEnter={handleMouseEnter} onMouseLeave={handleMouseLeave}>
            <div style={{
              fontSize: '12px', fontWeight: 700, letterSpacing: '0.22em',
              textTransform: 'uppercase', color: '#D63318', marginBottom: '1.5rem',
            }}>Layer {l.num} ·</div>
            <div style={{
              fontSize: '14px', fontWeight: 600, color: 'var(--lp-layer-question)',
              marginBottom: '0.5rem', fontStyle: 'italic',
            }} data-muted="">{l.userQ}</div>
            <div style={{
              fontSize: '12px', fontWeight: 700, color: '#D63318', marginBottom: '1.25rem',
              textTransform: 'uppercase', letterSpacing: '0.05em',
            }} data-muted="">{l.answer}</div>
            <div style={{
              fontSize: 'clamp(1.1rem,2vw,1.6rem)', fontWeight: 900, textTransform: 'uppercase',
              letterSpacing: '-0.02em', lineHeight: 1, color: 'var(--lp-h2)', marginBottom: '0.875rem',
            }}>{l.name}</div>
            <p style={{
              fontSize: '14px', fontWeight: 400, lineHeight: 1.75, color: 'var(--lp-layer-body)', margin: 0,
            }} data-muted="">{l.desc}</p>
          </Link>
        ))}
      </div>
    </section>
  );
}

/* 8 ── PROOF ─────────────────────────────────────────────── */
function ProofSection(): React.JSX.Element {
  return (
    <section style={{
      background: 'var(--lp-trust-bg)',
      borderBottom: '1px solid rgba(255,255,255,0.06)',
    }}>
      <div style={{ padding: '4vw 4vw 2.5vw', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <div style={{
          fontSize: '12px', fontWeight: 700, letterSpacing: '0.22em',
          textTransform: 'uppercase', color: '#D63318', marginBottom: '1rem',
        }}>This Is Not Probabilistic Control</div>
        <h2 style={{
          fontSize: 'clamp(1.5rem,2.5vw,2.2rem)', fontWeight: 900, textTransform: 'uppercase',
          letterSpacing: '-0.02em', lineHeight: 1, color: '#FFFFFF',
          border: 'none', padding: 0, margin: 0,
        }}>Deterministic by design.</h2>
      </div>
      <div className={styles.mechanicsGrid}>
        {PROOF_ITEMS.map((item, i) => (
          <div key={i} className={styles.mechanicStep} style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <span style={{ color: '#D63318', fontSize: '16px', fontWeight: 700, lineHeight: 1.4 }}>—</span>
            <div style={{
              fontSize: '13px', fontWeight: 700, letterSpacing: '0.04em',
              textTransform: 'uppercase', color: 'var(--lp-trust-text)',
              marginBottom: '4px',
            }}>{item.label}</div>
            <div style={{ fontSize: '13px', color: 'var(--lp-trust-muted)', lineHeight: 1.6 }}>{item.sub}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

/* 9 ── BEFORE / AFTER ────────────────────────────────────── */
function ComparisonSection(): React.JSX.Element {
  return (
    <section style={{ borderBottom: '1px solid var(--lp-border-sub)' }}>
      <div className={styles.beforeAfterGrid}>
        {/* Without Nirnex */}
        <div className={styles.beforePanel} style={{ padding: '4vw', background: 'var(--lp-compare-without-bg)' }}>
          <div style={{
            fontSize: '12px', fontWeight: 700, letterSpacing: '0.2em',
            textTransform: 'uppercase', color: 'var(--lp-compare-without-lbl)', marginBottom: '0.5rem',
          }}>Without Nirnex</div>
          <div style={{
            fontSize: '13px', color: 'var(--lp-compare-without-sub)',
            fontStyle: 'italic', marginBottom: '1.75rem',
          }}>Unpredictable.</div>
          <ul className={styles.compareList}>
            {WITHOUT_ITEMS.map((item, i) => (
              <li key={i}>
                <span style={{ color: 'var(--lp-compare-without-lbl)', fontWeight: 700, flexShrink: 0 }}>✕</span>
                <span style={{ color: 'var(--lp-compare-without-val)' }}>{item}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* With Nirnex */}
        <div style={{ padding: '4vw', background: 'var(--lp-compare-with-bg)' }}>
          <div style={{
            fontSize: '12px', fontWeight: 700, letterSpacing: '0.2em',
            textTransform: 'uppercase', color: '#D63318', marginBottom: '0.5rem',
          }}>With Nirnex</div>
          <div style={{
            fontSize: '13px', color: 'var(--lp-compare-with-sub)',
            fontStyle: 'italic', marginBottom: '1.75rem',
          }}>Controlled + explainable.</div>
          <ul className={styles.compareList}>
            {WITH_ITEMS.map((item, i) => (
              <li key={i}>
                <span style={{ color: '#D63318', fontWeight: 700, flexShrink: 0 }}>✓</span>
                <span style={{ color: 'var(--lp-compare-with-val)', fontWeight: 500 }}>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

/* 10 ── OBJECTION ────────────────────────────────────────── */
function ObjectionSection(): React.JSX.Element {
  return (
    <section style={{
      background: 'var(--lp-pain-bg)',
      padding: '6vw 4vw',
      borderBottom: '1px solid var(--lp-border-sub)',
    }}>
      <div className={styles.insightGrid}>
        <div>
          <SectionLabel text="The Objection" />
          <h2 style={{
            fontSize: 'clamp(1.5rem,3vw,2.5rem)', fontWeight: 900, textTransform: 'uppercase',
            letterSpacing: '-0.03em', lineHeight: 1.05, color: 'var(--lp-h2)',
            border: 'none', padding: 0, margin: 0,
          }}>
            "I already have<br />tests and<br />code review."
          </h2>
        </div>
        <div>
          <p style={{
            fontSize: '15px', fontWeight: 400, color: 'var(--lp-body)',
            lineHeight: 1.8, marginBottom: '1.5rem',
          }}>
            Tests validate outcomes. Code review validates intent.
            Neither validates <em>decision correctness</em> — whether the agent was operating on the
            right context, inside the right boundaries, for the right reasons.
          </p>
          <div style={{ borderLeft: '3px solid #D63318', paddingLeft: '1rem' }}>
            <p style={{
              fontSize: '15px', fontWeight: 600, color: 'var(--lp-h2)',
              lineHeight: 1.7, margin: '0 0 0.75rem',
            }}>
              Tests catch what went wrong after the fact.
            </p>
            <p style={{
              fontSize: '15px', fontWeight: 600, color: 'var(--lp-h2)',
              lineHeight: 1.7, margin: 0,
            }}>
              Nirnex prevents invalid execution before it happens.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

/* 11 ── DEMO ─────────────────────────────────────────────── */
function DemoSection(): React.JSX.Element {
  return (
    <section style={{
      background: 'var(--lp-solution-bg)',
      borderBottom: '1px solid var(--lp-border-sub)',
      padding: '5vw 4vw',
    }}>
      <SectionLabel text="See It in Action" />
      <h2 style={{
        fontSize: 'clamp(1.5rem,2.5vw,2.2rem)', fontWeight: 900, textTransform: 'uppercase',
        letterSpacing: '-0.02em', lineHeight: 1, color: 'var(--lp-h2)',
        border: 'none', padding: 0, margin: '0 0 0.75rem',
      }}>Update payment validation flow.</h2>
      <p style={{
        fontSize: '14px', color: 'var(--lp-muted)', lineHeight: 1.7, marginBottom: '3rem',
      }}>
        Same task. Unscoped agent versus Nirnex.
      </p>

      <div className={styles.demoGrid}>
        {/* Before */}
        <div className={styles.demoPanel} style={{ background: 'var(--lp-compare-without-bg)' }}>
          <div style={{
            fontSize: '12px', fontWeight: 700, letterSpacing: '0.2em',
            textTransform: 'uppercase', color: 'var(--lp-compare-without-lbl)',
            marginBottom: '1.25rem',
          }}>Without Nirnex</div>
          {DEMO_BEFORE.map((row, i) => (
            <div key={i} className={styles.demoPanelRow}>
              <span style={{
                fontSize: '12px', fontWeight: 700, letterSpacing: '0.1em',
                textTransform: 'uppercase', color: 'var(--lp-compare-without-lbl)',
                minWidth: '100px', flexShrink: 0,
              }}>{row.label}</span>
              <span style={{ color: 'var(--lp-compare-without-val)' }}>{row.value}</span>
            </div>
          ))}
        </div>

        {/* After */}
        <div className={styles.demoPanel} style={{ background: 'var(--lp-compare-with-bg)', borderColor: 'rgba(214,51,24,0.2)' }}>
          <div style={{
            fontSize: '12px', fontWeight: 700, letterSpacing: '0.2em',
            textTransform: 'uppercase', color: '#D63318', marginBottom: '1.25rem',
          }}>With Nirnex</div>
          {DEMO_AFTER.map((row, i) => (
            <div key={i} className={styles.demoPanelRow}>
              <span style={{
                fontSize: '12px', fontWeight: 700, letterSpacing: '0.1em',
                textTransform: 'uppercase', color: 'var(--lp-compare-with-lbl)',
                minWidth: '100px', flexShrink: 0,
              }}>{row.label}</span>
              <span style={{ color: 'var(--lp-compare-with-val)', fontWeight: 500 }}>{row.value}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* 12 ── CTA ── Always dark */
function CtaSection(): React.JSX.Element {
  return (
    <section className={styles.ctaGrid} style={{
      background: '#0D0D0D',
      color: '#FFFFFF',
      padding: '8vw 4vw',
      borderTop: '1px solid rgba(255,255,255,0.06)',
    }}>
      <div>
        <div style={{
          fontSize: '12px', fontWeight: 700, letterSpacing: '0.22em',
          textTransform: 'uppercase', color: '#D63318', marginBottom: '1.25rem',
        }}>
          For CTOs · Staff Engineers · AI Platform Teams
        </div>
        <h2 style={{
          fontSize: 'clamp(2rem,5vw,4.5rem)', fontWeight: 900, textTransform: 'uppercase',
          letterSpacing: '-0.03em', lineHeight: 1, color: '#fff',
          border: 'none', padding: 0, margin: '0 0 1rem',
        }}>
          Stop letting<br />AI guess.
        </h2>
        <p style={{
          fontSize: '15px', fontWeight: 300, color: 'rgba(255,255,255,0.55)',
          maxWidth: '480px', margin: 0, lineHeight: 1.75,
        }}>
          Built for regulated enterprises and engineering organizations where a wrong AI
          decision costs more than the sprint. Read the full architecture specification.
        </p>
      </div>
      <div className={styles.ctaButtons}>
        <Link to="/docs/intro/overview" style={{
          background: '#D63318', color: '#FFFFFF',
          padding: '16px 36px', fontSize: '12px', fontWeight: 700,
          letterSpacing: '0.2em', textTransform: 'uppercase', textDecoration: 'none',
          whiteSpace: 'nowrap', display: 'inline-block', textAlign: 'center',
        }}>Read the Architecture →</Link>
        <Link to="/docs/business/executive-summary" style={{
          background: 'transparent', color: 'rgba(255,255,255,0.55)',
          padding: '16px 36px', fontSize: '12px', fontWeight: 700,
          letterSpacing: '0.2em', textTransform: 'uppercase', textDecoration: 'none',
          border: '1px solid rgba(255,255,255,0.12)',
          whiteSpace: 'nowrap', display: 'inline-block', textAlign: 'center',
        }}>Business Case</Link>
      </div>
    </section>
  );
}

/* ── PAGE ──────────────────────────────────────────────── */
export default function Home(): React.JSX.Element {
  const { siteConfig } = useDocusaurusContext();
  return (
    <Layout
      title="Nirnex — You are letting AI modify your code without knowing what it will touch."
      description="Nirnex enforces scope, validates decisions, and records every action — before execution."
    >
      <HomepageHero />
      <RealityCheckSection />
      <PositioningSection />
      <WhoSection />
      <OutcomeSection />
      <HowSection />
      <LayersSection />
      <ProofSection />
      <ComparisonSection />
      <ObjectionSection />
      <DemoSection />
      <CtaSection />
    </Layout>
  );
}
