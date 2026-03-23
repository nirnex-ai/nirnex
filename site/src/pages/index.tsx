import React, { MouseEvent } from 'react';
import Link from '@docusaurus/Link';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import Layout from '@theme/Layout';
import styles from './index.module.css';

/* ── TYPES ─────────────────────────────────────────────── */
interface Layer { num: string; name: string; userQ: string; answer: string; desc: string; href: string; }
interface Principle { n: string; title: string; body: string; }

/* ── DATA ──────────────────────────────────────────────── */
const TRUST_ITEMS = [
  { icon: '—', label: 'No blind execution',           sub: 'Every agent action is scoped before it runs.' },
  { icon: '—', label: 'Every decision is auditable',  sub: 'A trace_id connects every step end-to-end.' },
  { icon: '—', label: 'AI acts inside defined boundaries', sub: 'Out-of-scope writes are rejected at runtime.' },
];

const PROBLEMS = [
  {
    n: '01',
    title: 'Context is guessed',
    body: 'Agents read what they can reach, not what is relevant. Scope is assumed, not verified. The context window is filled with noise.',
  },
  {
    n: '02',
    title: 'Decisions are untraceable',
    body: 'No log of what the agent read, which version, or why it chose it. Post-mortems are guesswork. The same mistake repeats.',
  },
  {
    n: '03',
    title: 'Safety is post-hoc',
    body: 'You find out what the agent touched after it\'s done. Rollback is manual. Blast radius is invisible until it isn\'t.',
  },
];

const MECHANICS = [
  {
    n: '01',
    title: 'Build execution context',
    body: 'Parse the live codebase with tree-sitter and ast-grep. Produce a precision-scored map of every symbol, dependency, and file relevant to the task.',
  },
  {
    n: '02',
    title: 'Apply constraints',
    body: 'Wrap the task in a Task Execution Envelope: allowed modules, blocked files, max line scope. The agent sees only what it is permitted to see.',
  },
  {
    n: '03',
    title: 'Orchestrate execution',
    body: 'The agent executes inside declared bounds. Writes outside scope are rejected before they touch the codebase. Violations fail loudly.',
  },
  {
    n: '04',
    title: 'Generate trace',
    body: 'Every decision — what was read, what was chosen, what was written — is logged under a single trace_id. Replay any failure in isolation.',
  },
];

const WITHOUT_ITEMS = [
  'Agent guesses at execution context',
  'No scope enforcement — agent decides what to touch',
  'Output looks correct until it isn\'t',
  'No audit trail — decisions are invisible',
  'Root cause: days of manual triage',
  'Same mistake, different file, next sprint',
];

const WITH_ITEMS = [
  'Verified parse graph — exact scope, not guesses',
  'Task Execution Envelope — out-of-scope writes rejected',
  'Explicit confidence score flags uncertainty before shipping',
  'Full decision trace — replay any step from trace_id',
  'Root cause in minutes — full chain available',
  'Ground truth sampling closes the loop automatically',
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

const PRINCIPLES: Principle[] = [
  {
    n: '01',
    title: 'Classification After Evidence',
    body: 'Spec → Knowledge Query → ECO → Classification. Classification cannot proceed without evidence. Agents never guess at scope.',
  },
  {
    n: '02',
    title: 'Every Decision Is Auditable',
    body: 'A single trace_id connects the initial requirement through every stage to completion. When something goes wrong, read the trace chain backwards.',
  },
  {
    n: '03',
    title: 'Visible at rest. Unmissable under load.',
    body: 'Lane A developers should forget this system exists. Lane C developers should find it indispensable. Value is earned through Lane B/C — not Lane A friction.',
  },
  {
    n: '04',
    title: 'Code wins on facts, not intent.',
    body: 'For "what exists?" — code is ground truth. For "what should exist?" — spec wins but must be validated. When ambiguous: escalate, never assume.',
  },
];

const USE_CASES = [
  {
    n: '01',
    title: 'Large codebases',
    sub: 'AI works on what it can actually reach.',
    body: 'When a codebase has hundreds of interdependent modules, unscoped agents create cascading changes. Nirnex constrains execution to the verified dependency graph of the task.',
  },
  {
    n: '02',
    title: 'Multi-agent workflows',
    sub: 'Each agent constrained to its lane.',
    body: 'Orchestrating multiple agents without shared execution context produces conflicts and silent overwrites. Nirnex assigns each agent a scoped envelope with no overlap.',
  },
  {
    n: '03',
    title: 'Regulated systems',
    sub: 'Every decision auditable for compliance.',
    body: 'In financial, healthcare, and infrastructure systems, AI changes require evidence. Every Nirnex execution produces a replayable trace suitable for audit and review.',
  },
];

const DEMO_BEFORE = [
  { label: 'Task',       value: 'Update payment validation flow' },
  { label: 'Scope',      value: 'Unknown — agent decides at runtime' },
  { label: 'Files touched', value: '12 files across 4 modules' },
  { label: 'Trace',      value: 'None' },
  { label: 'Outcome',    value: 'Regression in 3 unrelated modules' },
];

const DEMO_AFTER = [
  { label: 'Task',       value: 'Update payment validation flow' },
  { label: 'Scope',      value: 'payment/validator.ts · payment/schema.ts · tests/payment.spec.ts' },
  { label: 'Files touched', value: '2 of 3 declared — 1 unchanged' },
  { label: 'Trace',      value: 'trace_id: pay-val-0491 · full decision log' },
  { label: 'Outcome',    value: 'Change applied. Zero unintended writes.' },
];

/* ── COMPONENTS ────────────────────────────────────────── */

/* ── LABEL ── */
function SectionLabel({ text }: { text: string }): React.JSX.Element {
  return (
    <div style={{
      fontSize: '10px', fontWeight: 700, letterSpacing: '0.22em',
      textTransform: 'uppercase', color: '#D63318', marginBottom: '1rem',
    }}>{text}</div>
  );
}

/* 1 ── HERO ─────────────────────────────────────────────── */
function HomepageHero(): React.JSX.Element {
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
            fontSize: '10px', fontWeight: 700, letterSpacing: '0.18em',
            textTransform: 'uppercase', color: 'var(--lp-muted)', marginBottom: '1.75rem',
          }}>
            <span style={{ width: '20px', height: '1px', background: '#D63318', display: 'inline-block', flexShrink: 0 }} />
            Decision intelligence for software delivery
          </div>

          <h1 style={{
            fontSize: 'clamp(2.4rem,5vw,5rem)', fontWeight: 900, lineHeight: 0.95,
            textTransform: 'uppercase', letterSpacing: '-0.03em',
            marginBottom: '1.5rem', color: 'var(--lp-h1)',
          }}>
            AI is changing<br />your code.<br />
            <span style={{ color: '#D63318' }}>You don't know why.</span>
          </h1>

          <p style={{
            fontSize: '17px', fontWeight: 400, lineHeight: 1.75,
            color: 'var(--lp-hero-body)', marginBottom: '0.75rem',
          }}>
            Nirnex makes every AI-driven change traceable, constrained, and safe.
          </p>
          <p style={{
            fontSize: '15px', fontWeight: 400, lineHeight: 1.75,
            color: 'var(--lp-muted)', marginBottom: '2.5rem',
          }}>
            Control what AI can touch, how it executes, and how every decision is recorded.
          </p>

          <div style={{ display: 'flex', gap: 0, flexWrap: 'wrap' }}>
            <Link to="/docs/intro/overview" style={{
              background: '#D63318', color: '#FFFFFF',
              padding: '14px 32px', fontSize: '11px', fontWeight: 700,
              letterSpacing: '0.2em', textTransform: 'uppercase', textDecoration: 'none',
              display: 'inline-block',
            }}>See How It Works</Link>
            <Link to="/docs/intro/overview" style={{
              background: 'transparent', color: 'var(--lp-h1)',
              padding: '14px 32px', fontSize: '11px', fontWeight: 700,
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
            {/* Header */}
            <div style={{
              padding: '10px 16px',
              borderBottom: '1px solid var(--lp-border)',
              fontSize: '10px', fontWeight: 700, letterSpacing: '0.15em',
              textTransform: 'uppercase', color: '#D63318',
            }}>Nirnex — Execution Signal</div>

            {[
              { step: 'PROMPT',     detail: 'Update payment validation flow',       status: 'received' },
              { step: 'CONTEXT',    detail: 'Scoped to 3 files · 47 symbols verified', status: 'built'    },
              { step: 'CONSTRAINTS', detail: 'max_lines: 200 · blocked: legacy/*',   status: 'applied'  },
              { step: 'EXECUTION',  detail: '2 files modified · 0 scope violations', status: 'complete' },
              { step: 'TRACE',      detail: 'trace_id: pay-val-0491 · logged',       status: 'stored'   },
            ].map((row, i, arr) => (
              <div key={i}>
                <div style={{
                  display: 'flex', alignItems: 'flex-start', gap: '12px',
                  padding: '14px 16px',
                  borderBottom: i < arr.length - 1 ? '1px solid var(--lp-border-sub)' : 'none',
                  background: i === 3 ? 'rgba(214,51,24,0.04)' : 'transparent',
                }}>
                  <span style={{
                    fontSize: '9px', fontWeight: 700, letterSpacing: '0.12em',
                    textTransform: 'uppercase', color: '#D63318',
                    minWidth: '80px', paddingTop: '2px',
                  }}>{row.step}</span>
                  <span style={{ fontSize: '12px', color: 'var(--lp-body)', lineHeight: 1.5, flex: 1 }}>
                    {row.detail}
                  </span>
                  <span style={{
                    fontSize: '9px', fontWeight: 700, letterSpacing: '0.1em',
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
    </section>
  );
}

/* 2 ── TRUST STRIP ──────────────────────────────────────── */
function TrustStrip(): React.JSX.Element {
  return (
    <section style={{
      background: 'var(--lp-trust-bg)',
      borderBottom: '1px solid rgba(255,255,255,0.06)',
    }}>
      <div className={styles.trustStrip}>
        {TRUST_ITEMS.map((item, i) => (
          <div key={i} className={styles.trustItem}>
            <span style={{ color: '#D63318', fontSize: '16px', fontWeight: 700, flexShrink: 0, lineHeight: 1.4 }}>
              {item.icon}
            </span>
            <div>
              <div style={{
                fontSize: '13px', fontWeight: 700, letterSpacing: '0.04em',
                textTransform: 'uppercase', color: 'var(--lp-trust-text)',
                marginBottom: '4px',
              }}>{item.label}</div>
              <div style={{ fontSize: '13px', color: 'var(--lp-trust-muted)', lineHeight: 1.6 }}>{item.sub}</div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

/* 3 ── PROBLEM ──────────────────────────────────────────── */
function ProblemSection(): React.JSX.Element {
  return (
    <section style={{ background: 'var(--lp-pain-bg)', borderBottom: '1px solid var(--lp-border-sub)' }}>
      <div style={{ padding: '5vw 4vw 3vw', borderBottom: '1px solid var(--lp-border-sub)' }}>
        <SectionLabel text="The Problem" />
        <h2 style={{
          fontSize: 'clamp(1.8rem,3.5vw,3rem)', fontWeight: 900, textTransform: 'uppercase',
          letterSpacing: '-0.03em', lineHeight: 1, color: 'var(--lp-h2)',
          border: 'none', padding: 0, margin: 0,
        }}>
          Agents don't know what<br />they're touching.
        </h2>
      </div>
      <div className={styles.problemGrid}>
        {PROBLEMS.map((p, i) => (
          <div key={i} className={styles.problemCard}>
            <div style={{
              fontSize: '10px', fontWeight: 700, letterSpacing: '0.2em',
              textTransform: 'uppercase', color: '#D63318', marginBottom: '1.25rem',
            }}>{p.n} ·</div>
            <div style={{
              fontSize: 'clamp(1rem,1.8vw,1.3rem)', fontWeight: 900, textTransform: 'uppercase',
              letterSpacing: '-0.01em', lineHeight: 1.1, color: 'var(--lp-pain-scenario)',
              marginBottom: '1rem',
            }}>{p.title}</div>
            <p style={{
              fontSize: '14px', fontWeight: 400, color: 'var(--lp-pain-detail)',
              lineHeight: 1.75, margin: 0,
            }}>{p.body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

/* 4 ── BELIEF ── Always dark maroon — brand moment */
function BeliefSection(): React.JSX.Element {
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
            fontSize: '10px', fontWeight: 700, letterSpacing: '0.22em',
            textTransform: 'uppercase', color: 'rgba(214,51,24,0.7)', marginBottom: '1.25rem',
          }}>The Core Belief</div>
          <h2 style={{
            fontSize: 'clamp(2rem,4vw,3.5rem)', fontWeight: 900, textTransform: 'uppercase',
            letterSpacing: '-0.03em', lineHeight: 1.0, color: '#D63318',
            border: 'none', padding: 0, margin: 0,
          }}>
            You cannot<br />control what<br />you cannot trace.
          </h2>
        </div>
        <div>
          <p style={{
            fontSize: '17px', fontWeight: 400, color: 'rgba(255,255,255,0.75)',
            lineHeight: 1.8, marginBottom: '1rem',
          }}>
            AI agents are non-deterministic. You cannot unit-test a language model.
            Prompt engineering is not a control surface — it's a hint.
          </p>
          <p style={{
            fontSize: '17px', fontWeight: 400, color: 'rgba(255,255,255,0.75)',
            lineHeight: 1.8, marginBottom: '1.25rem',
          }}>
            The only reliable lever is{' '}
            <strong style={{ color: '#FFFFFF' }}>controlling the inputs the agent operates on,
            bounding what it can write, and recording every step of its reasoning</strong> — before
            it acts, during execution, and after completion.
          </p>
          <p style={{
            fontSize: '16px', fontWeight: 700, color: '#FFFFFF', lineHeight: 1.5,
            margin: 0, borderLeft: '3px solid #D63318', paddingLeft: '1rem',
          }}>
            Without a trace, you don't have an explanation.<br />You have a fragility problem.
          </p>
        </div>
      </div>
    </section>
  );
}

/* 5 ── SOLUTION OVERVIEW ─────────────────────────────────── */
function SolutionSection(): React.JSX.Element {
  return (
    <section style={{
      background: 'var(--lp-solution-bg)',
      borderBottom: '1px solid var(--lp-border-sub)',
      padding: '5vw 4vw',
    }}>
      <SectionLabel text="How It Works" />
      <div className={styles.solutionGrid}>
        {/* Left: explanation */}
        <div>
          <h2 style={{
            fontSize: 'clamp(1.8rem,3.5vw,3rem)', fontWeight: 900, textTransform: 'uppercase',
            letterSpacing: '-0.03em', lineHeight: 1, color: 'var(--lp-h2)',
            border: 'none', padding: 0, margin: '0 0 1.5rem',
          }}>
            A runtime layer that<br />controls AI execution.
          </h2>
          <p style={{
            fontSize: '16px', fontWeight: 600, color: 'var(--lp-h2)',
            lineHeight: 1.65, marginBottom: '1rem',
            borderLeft: '3px solid #D63318', paddingLeft: '1rem',
          }}>
            Before an agent sees your codebase, Nirnex decides what it's allowed to see —
            and records every action it takes.
          </p>
          <p style={{
            fontSize: '15px', lineHeight: 1.8, color: 'var(--lp-body)', marginBottom: '0.875rem',
          }}>
            A verified parse graph maps the exact symbols, dependencies, and files relevant to the
            task. The agent operates inside that map — nothing more. Writes outside declared
            scope are rejected before they touch the codebase.
          </p>
          <p style={{ fontSize: '15px', lineHeight: 1.8, color: 'var(--lp-body)', margin: 0 }}>
            Every decision is logged under a single trace_id you can replay in isolation.
            Root cause in minutes, not days.
          </p>
        </div>

        {/* Right: vertical flow diagram */}
        <div className={styles.flowDiagram}>
          {[
            { label: 'Prompt',             sub: 'Incoming change request or spec' },
            { label: 'Execution Context',  sub: 'Parse graph · scored relevance · exact scope' },
            { label: 'Constraints',        sub: 'Allowed modules · blocked files · max scope' },
            { label: 'Controlled Execution', sub: 'Agent acts inside bounds · violations rejected', highlight: true },
            { label: 'Trace',              sub: 'trace_id · full decision log · replayable' },
          ].map((step, i, arr) => (
            <React.Fragment key={i}>
              <div className={styles.flowStep} style={step.highlight ? { borderColor: '#D63318', background: 'rgba(214,51,24,0.04)' } : {}}>
                <span style={{
                  fontSize: '9px', fontWeight: 700, letterSpacing: '0.15em',
                  textTransform: 'uppercase', color: step.highlight ? '#D63318' : 'var(--lp-muted)',
                  minWidth: '16px',
                }}>{String(i + 1).padStart(2, '0')}</span>
                <div>
                  <div style={{
                    fontSize: '12px', fontWeight: 700, textTransform: 'uppercase',
                    letterSpacing: '0.06em', color: step.highlight ? '#D63318' : 'var(--lp-h2)',
                    marginBottom: '2px',
                  }}>{step.label}</div>
                  <div style={{ fontSize: '12px', color: 'var(--lp-muted)', lineHeight: 1.4 }}>{step.sub}</div>
                </div>
              </div>
              {i < arr.length - 1 && (
                <div className={styles.flowConnector}>↓</div>
              )}
            </React.Fragment>
          ))}
        </div>
      </div>
    </section>
  );
}

/* 6 ── MECHANICS ─────────────────────────────────────────── */
function MechanicsSection(): React.JSX.Element {
  return (
    <section style={{ background: 'var(--lp-layers-bg)', borderBottom: '1px solid var(--lp-border-sub)' }}>
      <div style={{ padding: '5vw 4vw 3vw', borderBottom: '1px solid var(--lp-border-sub)' }}>
        <SectionLabel text="The Mechanics" />
        <h2 style={{
          fontSize: 'clamp(1.5rem,2.5vw,2.2rem)', fontWeight: 900, textTransform: 'uppercase',
          letterSpacing: '-0.02em', lineHeight: 1, color: 'var(--lp-h2)',
          border: 'none', padding: 0, margin: 0,
        }}>Four steps. No guesswork.</h2>
      </div>
      <div className={styles.mechanicsGrid}>
        {MECHANICS.map((m, i) => (
          <div key={i} className={styles.mechanicStep}>
            <div style={{
              fontSize: '10px', fontWeight: 700, letterSpacing: '0.2em',
              textTransform: 'uppercase', color: '#D63318', marginBottom: '1.25rem',
            }}>{m.n} ·</div>
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

/* 7 ── BEFORE / AFTER ────────────────────────────────────── */
function ComparisonSection(): React.JSX.Element {
  return (
    <section style={{ borderBottom: '1px solid var(--lp-border-sub)' }}>
      <div className={styles.beforeAfterGrid}>
        {/* Without Nirnex */}
        <div className={styles.beforePanel} style={{ padding: '4vw', background: 'var(--lp-compare-without-bg)' }}>
          <div style={{
            fontSize: '10px', fontWeight: 700, letterSpacing: '0.2em',
            textTransform: 'uppercase', color: 'var(--lp-compare-without-lbl)', marginBottom: '0.5rem',
          }}>Without Nirnex</div>
          <div style={{
            fontSize: '13px', color: 'var(--lp-compare-without-sub)',
            fontStyle: 'italic', marginBottom: '1.75rem',
          }}>Random outputs. Silent failures. Guesswork.</div>
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
            fontSize: '10px', fontWeight: 700, letterSpacing: '0.2em',
            textTransform: 'uppercase', color: '#D63318', marginBottom: '0.5rem',
          }}>With Nirnex</div>
          <div style={{
            fontSize: '13px', color: 'var(--lp-compare-with-sub)',
            fontStyle: 'italic', marginBottom: '1.75rem',
          }}>Controlled outputs. Full trace. Root cause in minutes.</div>
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

/* 8 ── LAYERS ───────────────────────────────────────────── */
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
              fontSize: '10px', fontWeight: 700, letterSpacing: '0.22em',
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

/* 9 ── PRINCIPLES ───────────────────────────────────────── */
function PrinciplesSection(): React.JSX.Element {
  return (
    <section style={{
      padding: '6vw 4vw', background: 'var(--lp-principles-bg)',
      borderBottom: '1px solid var(--lp-border-sub)',
    }}>
      <div style={{ marginBottom: '3rem' }}>
        <SectionLabel text="Non-Negotiables" />
        <h2 style={{
          fontSize: 'clamp(2rem,4vw,3.5rem)', fontWeight: 900, textTransform: 'uppercase',
          letterSpacing: '-0.03em', lineHeight: 1, color: 'var(--lp-h2)',
          border: 'none', padding: 0, margin: 0,
        }}>What We Won't Compromise On</h2>
      </div>
      <div className={styles.principlesGrid}>
        {PRINCIPLES.map((p: Principle, i: number) => (
          <div key={i} className={styles.principleItem}>
            <div style={{
              fontSize: '10px', fontWeight: 700, letterSpacing: '0.22em',
              textTransform: 'uppercase', color: '#D63318', marginBottom: '1rem',
            }}>{p.n} ·</div>
            <div style={{
              fontSize: 'clamp(1rem,1.8vw,1.3rem)', fontWeight: 900, textTransform: 'uppercase',
              letterSpacing: '-0.01em', lineHeight: 1.1, color: 'var(--lp-h2)', marginBottom: '0.875rem',
            }}>{p.title}</div>
            <p style={{
              fontSize: '15px', fontWeight: 400, color: 'var(--lp-principle-body)', lineHeight: 1.75, margin: 0,
            }}>{p.body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

/* 10 ── USE CASES ────────────────────────────────────────── */
function UseCasesSection(): React.JSX.Element {
  return (
    <section style={{ background: 'var(--lp-pain-bg)', borderBottom: '1px solid var(--lp-border-sub)' }}>
      <div style={{ padding: '5vw 4vw 3vw', borderBottom: '1px solid var(--lp-border-sub)' }}>
        <SectionLabel text="Where It Works" />
        <h2 style={{
          fontSize: 'clamp(1.5rem,2.5vw,2.2rem)', fontWeight: 900, textTransform: 'uppercase',
          letterSpacing: '-0.02em', lineHeight: 1, color: 'var(--lp-h2)',
          border: 'none', padding: 0, margin: 0,
        }}>Built for teams where a wrong AI<br />decision has consequences.</h2>
      </div>
      <div className={styles.useCasesGrid}>
        {USE_CASES.map((uc, i) => (
          <div key={i} className={styles.useCaseCard}>
            <div style={{
              fontSize: '10px', fontWeight: 700, letterSpacing: '0.2em',
              textTransform: 'uppercase', color: '#D63318', marginBottom: '1.25rem',
            }}>{uc.n} ·</div>
            <div style={{
              fontSize: 'clamp(1rem,1.8vw,1.3rem)', fontWeight: 900, textTransform: 'uppercase',
              letterSpacing: '-0.01em', lineHeight: 1.1, color: 'var(--lp-h2)', marginBottom: '0.5rem',
            }}>{uc.title}</div>
            <div style={{
              fontSize: '12px', fontWeight: 700, textTransform: 'uppercase',
              letterSpacing: '0.06em', color: '#D63318', marginBottom: '0.875rem',
            }}>{uc.sub}</div>
            <p style={{
              fontSize: '14px', fontWeight: 400, color: 'var(--lp-pain-detail)', lineHeight: 1.75, margin: 0,
            }}>{uc.body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

/* 11 ── DEMO / PROOF ─────────────────────────────────────── */
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
            fontSize: '10px', fontWeight: 700, letterSpacing: '0.2em',
            textTransform: 'uppercase', color: 'var(--lp-compare-without-lbl)',
            marginBottom: '1.25rem',
          }}>Without Nirnex</div>
          {DEMO_BEFORE.map((row, i) => (
            <div key={i} className={styles.demoPanelRow}>
              <span style={{
                fontSize: '10px', fontWeight: 700, letterSpacing: '0.1em',
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
            fontSize: '10px', fontWeight: 700, letterSpacing: '0.2em',
            textTransform: 'uppercase', color: '#D63318', marginBottom: '1.25rem',
          }}>With Nirnex</div>
          {DEMO_AFTER.map((row, i) => (
            <div key={i} className={styles.demoPanelRow}>
              <span style={{
                fontSize: '10px', fontWeight: 700, letterSpacing: '0.1em',
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

/* 12 ── CTA ── Always dark — the closing brand statement */
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
          fontSize: '10px', fontWeight: 700, letterSpacing: '0.22em',
          textTransform: 'uppercase', color: '#D63318', marginBottom: '1.25rem',
        }}>
          For CTOs · Staff Engineers · AI Platform Teams
        </div>
        <h2 style={{
          fontSize: 'clamp(2rem,5vw,4.5rem)', fontWeight: 900, textTransform: 'uppercase',
          letterSpacing: '-0.03em', lineHeight: 1, color: '#fff',
          border: 'none', padding: 0, margin: '0 0 1rem',
        }}>
          Ready to control what<br />your agents touch?
        </h2>
        <p style={{
          fontSize: '15px', fontWeight: 300, color: 'rgba(255,255,255,0.55)',
          maxWidth: '480px', margin: 0, lineHeight: 1.75,
        }}>
          Built for regulated enterprises and engineering organizations where a wrong AI
          decision costs more than the sprint. Read the full v9 architecture specification.
        </p>
      </div>
      <div className={styles.ctaButtons}>
        <Link to="/docs/intro/overview" style={{
          background: '#D63318', color: '#FFFFFF',
          padding: '16px 36px', fontSize: '11px', fontWeight: 700,
          letterSpacing: '0.2em', textTransform: 'uppercase', textDecoration: 'none',
          whiteSpace: 'nowrap', display: 'inline-block', textAlign: 'center',
        }}>Read the Architecture →</Link>
        <Link to="/docs/business/executive-summary" style={{
          background: 'transparent', color: 'rgba(255,255,255,0.55)',
          padding: '16px 36px', fontSize: '11px', fontWeight: 700,
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
      title="Nirnex — AI is changing your code. You don't know why."
      description="Nirnex makes every AI-driven change traceable, constrained, and safe. Control what AI can touch, how it executes, and how every decision is recorded."
    >
      <HomepageHero />
      <TrustStrip />
      <ProblemSection />
      <BeliefSection />
      <SolutionSection />
      <MechanicsSection />
      <ComparisonSection />
      <LayersSection />
      <PrinciplesSection />
      <UseCasesSection />
      <DemoSection />
      <CtaSection />
    </Layout>
  );
}
