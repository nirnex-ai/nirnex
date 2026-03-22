import React, { MouseEvent } from 'react';
import Link from '@docusaurus/Link';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import Layout from '@theme/Layout';
import styles from './index.module.css';

/* ── TYPES ─────────────────────────────────────────────── */
interface Failure {
  n: string;
  title: string;
  body: string;
}

interface Layer {
  num: string;
  name: string;
  sub: string;
  desc: string;
  href: string;
}

interface Principle {
  n: string;
  title: string;
  body: string;
}

/* ── DATA ──────────────────────────────────────────────── */
const FAILURES: Failure[] = [
  {
    n: '01',
    title: 'Hallucination Drift',
    body: 'The agent modifies the wrong module because it cannot verify what is actually in scope. Changes accumulate silently against a codebase the agent never fully understood.',
  },
  {
    n: '02',
    title: 'Context Fragmentation',
    body: 'No persistent understanding survives across sessions. Every task starts from zero. Prior decisions, constraints, and dependencies are invisible to the next agent.',
  },
  {
    n: '03',
    title: 'Blast Radius Blindness',
    body: 'A single spec change cascades into 12 unintended files with no warning. The agent does not know — and cannot know — what it is actually touching.',
  },
  {
    n: '04',
    title: 'Debugging Impossibility',
    body: 'When it fails, there is no trace of why the agent made that decision. Post-mortem becomes guesswork. The same mistake happens again next sprint.',
  },
  {
    n: '05',
    title: 'Pipeline Inconsistency',
    body: 'Same task. Same prompt. Different output on every run. Non-determinism with no control surface and no way to narrow the variance.',
  },
];

const LAYERS: Layer[] = [
  {
    num: '01',
    name: 'Knowledge Engine',
    sub: 'Parses · Indexes · Scores',
    desc: 'Builds structured evidence from the codebase. Runs tree-sitter, ast-grep, and ctags. Produces a reliability-scored Execution Context Object before any agent sees the codebase.',
    href: '/docs/knowledge-engine/overview',
  },
  {
    num: '02',
    name: 'Task Orchestrator',
    sub: 'Plans · Constrains · Decomposes',
    desc: 'Turns requirements into bounded execution slices. Assigns Task Execution Envelopes with allowed_modules, blocked_files, and max_lines. Constrained by the ECO — never below it.',
    href: '/docs/task-pipeline/overview',
  },
  {
    num: '03',
    name: 'Decision Ledger',
    sub: 'Records · Replays · Calibrates',
    desc: 'Records why the system believed something, chose something, and did something. Unified trace schema. Replay engine, 5% ground truth sampling, monthly calibration cycles.',
    href: '/docs/decision-ledger/overview',
  },
];

const PRINCIPLES: Principle[] = [
  { n: '01', title: 'Classification After Evidence', body: 'Spec → Knowledge Query → ECO → Classification. Classification cannot proceed without evidence. Agents never guess at scope.' },
  { n: '02', title: 'Every Decision Is Auditable', body: 'A single trace_id connects the initial requirement through every stage to completion. When something goes wrong, read the trace chain backwards.' },
  { n: '03', title: 'Code Wins on Facts. Spec Wins on Intent.', body: 'For "what exists?" — code is ground truth. For "what should exist?" — spec wins but must be validated. Ambiguous: escalate.' },
  { n: '04', title: 'Invisible at Rest. Unmissable Under Load.', body: 'Lane A developers should forget this system exists. Lane C developers should find it indispensable. Value earned through Lane B/C — not Lane A friction.' },
];

/* ── COMPONENTS ────────────────────────────────────────── */

/* 1 ── HERO: problem-first, ICP-clear ─────────────────── */
function HomepageHero(): React.JSX.Element {
  return (
    <section style={{
      background: '#0D0D0D', color: '#FFFFFF',
      padding: '7vw 4vw 6vw', position: 'relative', overflow: 'hidden',
      borderBottom: '1px solid rgba(255,255,255,0.06)',
    }}>
      {/* Watermark */}
      <div style={{
        position: 'absolute', top: '-4vw', right: '-2vw',
        fontSize: '22vw', fontWeight: 900, color: 'rgba(255,255,255,0.03)',
        lineHeight: 1, letterSpacing: '-0.04em', pointerEvents: 'none',
        textTransform: 'uppercase', fontFamily: 'Space Grotesk, sans-serif',
      }}>OS</div>

      <div style={{
        display: 'grid', gridTemplateColumns: '1fr 1fr',
        gap: '5vw', alignItems: 'center', position: 'relative',
      }}>
        {/* Left: copy */}
        <div>
          {/* ICP tag */}
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: '8px',
            fontSize: '10px', fontWeight: 700, letterSpacing: '0.18em',
            textTransform: 'uppercase', color: '#888888',
            marginBottom: '1.75rem',
          }}>
            <span style={{ width: '20px', height: '1px', background: '#D63318', display: 'inline-block', flexShrink: 0 }} />
            For engineering teams shipping with AI agents
          </div>

          {/* Headline — problem-first */}
          <h1 style={{
            fontSize: 'clamp(2.6rem,5.5vw,5.5rem)', fontWeight: 900, lineHeight: 0.95,
            textTransform: 'uppercase', letterSpacing: '-0.03em',
            marginBottom: '1.5rem', color: '#FFFFFF',
          }}>
            Your AI Agents<br />
            <span style={{ color: '#D63318' }}>Are Flying Blind.</span>
          </h1>

          <p style={{
            fontSize: '15px', fontWeight: 400, lineHeight: 1.8,
            color: '#AAAAAA', marginBottom: '0.75rem',
          }}>
            Every broken AI code change has the same root cause — the agent didn't understand
            what it was touching. It guessed. It drifted. It shipped.
          </p>
          <p style={{
            fontSize: '15px', fontWeight: 400, lineHeight: 1.8,
            color: '#AAAAAA', marginBottom: '2.5rem',
          }}>
            Nirnex is the execution control layer that gives agents a structured,
            evidence-backed understanding of your codebase{' '}
            <strong style={{ color: '#FFFFFF', fontWeight: 600 }}>before they make a single change.</strong>
          </p>

          {/* CTAs */}
          <div style={{ display: 'flex', gap: 0 }}>
            <Link to="/docs/intro/overview" style={{
              background: '#D63318', color: '#FFFFFF',
              padding: '14px 32px', fontSize: '11px', fontWeight: 700,
              letterSpacing: '0.2em', textTransform: 'uppercase', textDecoration: 'none',
              display: 'inline-block',
            }}>See How It Works</Link>
            <Link to="/docs/business/executive-summary" style={{
              background: 'transparent', color: '#FFFFFF',
              padding: '14px 32px', fontSize: '11px', fontWeight: 700,
              letterSpacing: '0.2em', textTransform: 'uppercase', textDecoration: 'none',
              border: '1px solid rgba(255,255,255,0.18)', borderLeft: 'none',
              display: 'inline-block',
            }}>Business Case →</Link>
          </div>
        </div>

        {/* Right: YouTube embed */}
        <div style={{ position: 'relative', width: '100%' }}>
          <div style={{
            position: 'relative', paddingBottom: '56.25%',
            height: 0, overflow: 'hidden',
            border: '1px solid rgba(255,255,255,0.08)',
          }}>
            <iframe
              src="https://www.youtube.com/embed/f_U-nj8hNis"
              title="Nirnex — Evidence-Backed AI Delivery"
              frameBorder="0"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowFullScreen
              style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', border: 'none' }}
            />
          </div>
        </div>
      </div>
    </section>
  );
}

/* 2 ── PAIN: 5 failure modes ───────────────────────────── */
function PainSection(): React.JSX.Element {
  return (
    <section style={{ background: '#111111', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
      {/* Header */}
      <div style={{ padding: '5vw 4vw 3vw' }}>
        <div style={{
          fontSize: '10px', fontWeight: 700, letterSpacing: '0.22em',
          textTransform: 'uppercase', color: '#D63318', marginBottom: '1rem',
        }}>The Problem</div>
        <h2 style={{
          fontSize: 'clamp(1.8rem,3.5vw,3rem)', fontWeight: 900,
          textTransform: 'uppercase', letterSpacing: '-0.03em',
          lineHeight: 1, color: '#FFFFFF', border: 'none', padding: 0, margin: '0 0 0.75rem',
        }}>How AI Delivery Fails in Production</h2>
        <p style={{
          fontSize: '14px', fontWeight: 400, color: '#888888',
          lineHeight: 1.75, maxWidth: '560px', margin: 0,
        }}>
          These are not edge cases. They happen on every team shipping with AI agents
          at scale — and they share a single root cause: agents operate without verified
          execution context.
        </p>
      </div>

      {/* Failure modes grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
        {FAILURES.map((f: Failure, i: number) => (
          <div key={i} style={{
            padding: '2.5vw 2vw',
            borderRight: i < 4 ? '1px solid rgba(255,255,255,0.06)' : 'none',
          }}>
            <div style={{
              fontSize: '10px', fontWeight: 700, letterSpacing: '0.2em',
              textTransform: 'uppercase', color: '#D63318', marginBottom: '1rem',
            }}>{f.n} ·</div>
            <div style={{
              fontSize: 'clamp(0.85rem,1.2vw,1rem)', fontWeight: 700,
              textTransform: 'uppercase', letterSpacing: '-0.01em',
              lineHeight: 1.15, color: '#FFFFFF', marginBottom: '0.875rem',
            }}>{f.title}</div>
            <p style={{
              fontSize: '12px', fontWeight: 400, color: '#666666',
              lineHeight: 1.75, margin: 0,
            }}>{f.body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

/* 3 ── INSIGHT: bridge/pivot ───────────────────────────── */
function InsightSection(): React.JSX.Element {
  return (
    <section style={{
      background: '#D63318', color: '#FFFFFF',
      padding: '6vw 4vw',
      borderBottom: '1px solid rgba(0,0,0,0.15)',
    }}>
      <div style={{
        display: 'grid', gridTemplateColumns: '1fr 1fr',
        gap: '6vw', alignItems: 'center',
      }}>
        <div>
          <div style={{
            fontSize: '10px', fontWeight: 700, letterSpacing: '0.22em',
            textTransform: 'uppercase', color: 'rgba(255,255,255,0.6)', marginBottom: '1.25rem',
          }}>The Core Insight</div>
          <h2 style={{
            fontSize: 'clamp(2rem,4vw,3.5rem)', fontWeight: 900,
            textTransform: 'uppercase', letterSpacing: '-0.03em',
            lineHeight: 1.0, color: '#FFFFFF', border: 'none', padding: 0, margin: '0 0 1.5rem',
          }}>
            AI Is Not Code.<br />It's Probabilistic<br />Systems.
          </h2>
        </div>
        <div>
          <p style={{
            fontSize: '15px', fontWeight: 400, color: 'rgba(255,255,255,0.85)',
            lineHeight: 1.8, marginBottom: '1rem',
          }}>
            Code has deterministic output. AI agents don't. You cannot unit-test a language
            model. You cannot rely on prompts alone.
          </p>
          <p style={{
            fontSize: '15px', fontWeight: 400, color: 'rgba(255,255,255,0.85)',
            lineHeight: 1.8, marginBottom: '1rem',
          }}>
            The only reliable lever you have is{' '}
            <strong style={{ color: '#FFFFFF' }}>controlling what the agent sees,
            what it knows, and what it is allowed to touch</strong> — before it acts.
          </p>
          <p style={{
            fontSize: '15px', fontWeight: 400, color: 'rgba(255,255,255,0.7)',
            lineHeight: 1.8, margin: 0,
          }}>
            That is the problem Nirnex was built to solve.
          </p>
        </div>
      </div>
    </section>
  );
}

/* 4 ── SOLUTION: what Nirnex is ───────────────────────── */
function SolutionSection(): React.JSX.Element {
  return (
    <section style={{ borderBottom: '1px solid rgba(0,0,0,0.12)' }}>
      {/* Header row */}
      <div style={{
        padding: '5vw 4vw 4vw',
        borderBottom: '1px solid rgba(0,0,0,0.08)',
      }}>
        <div style={{
          fontSize: '10px', fontWeight: 700, letterSpacing: '0.22em',
          textTransform: 'uppercase', color: '#D63318', marginBottom: '1rem',
        }}>The Solution</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4vw', alignItems: 'start' }}>
          <h2 style={{
            fontSize: 'clamp(1.8rem,3.5vw,3rem)', fontWeight: 900,
            textTransform: 'uppercase', letterSpacing: '-0.03em',
            lineHeight: 1, border: 'none', padding: 0, margin: 0,
          }}>
            Nirnex: The Execution<br />Control Layer
          </h2>
          <div>
            <p style={{ fontSize: '14px', lineHeight: 1.8, color: '#374151', marginBottom: '0.75rem' }}>
              Before an agent sees your codebase, Nirnex builds an{' '}
              <strong>Execution Context Object (ECO)</strong> — a precision-scored map of
              exactly what is relevant to the task: which symbols, which dependencies,
              which files, and which boundaries must not be crossed.
            </p>
            <p style={{ fontSize: '14px', lineHeight: 1.8, color: '#374151', margin: 0 }}>
              The agent operates inside those bounds. Every decision is recorded, traced,
              and replayable. You get deterministic control over a non-deterministic system.
            </p>
          </div>
        </div>
      </div>

      {/* Before / After */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr' }}>
        {/* Without Nirnex */}
        <div style={{
          padding: '4vw',
          borderRight: '1px solid rgba(0,0,0,0.10)',
          background: '#FAFAFA',
        }}>
          <div style={{
            fontSize: '10px', fontWeight: 700, letterSpacing: '0.2em',
            textTransform: 'uppercase', color: '#999999', marginBottom: '1.5rem',
          }}>Without Nirnex</div>
          {[
            'Agent receives spec + raw codebase access',
            'Searches by text similarity — no symbol graph',
            'Guesses which files are in scope',
            'Makes changes across unintended modules',
            'No trace of the reasoning chain',
            'Failure is reproducible but not explainable',
          ].map((item, i) => (
            <div key={i} style={{
              display: 'flex', gap: '10px', alignItems: 'flex-start',
              marginBottom: '0.875rem',
            }}>
              <span style={{
                width: '14px', height: '14px', borderRadius: 0,
                background: '#E5E5E5', color: '#999', fontSize: '9px',
                fontWeight: 700, display: 'flex', alignItems: 'center',
                justifyContent: 'center', flexShrink: 0, marginTop: '1px',
              }}>✕</span>
              <span style={{ fontSize: '13px', color: '#6B7280', lineHeight: 1.6 }}>{item}</span>
            </div>
          ))}
        </div>

        {/* With Nirnex */}
        <div style={{ padding: '4vw', background: '#FFFFFF' }}>
          <div style={{
            fontSize: '10px', fontWeight: 700, letterSpacing: '0.2em',
            textTransform: 'uppercase', color: '#D63318', marginBottom: '1.5rem',
          }}>With Nirnex</div>
          {[
            'ECO built from parse graph before agent activates',
            'Symbol-level dependency map — exact scope, not guesses',
            'Task Execution Envelope constrains allowed files',
            'Writes outside declared scope are rejected',
            'Every decision logged with full trace_id chain',
            'Replay any failure in isolation — root cause in minutes',
          ].map((item, i) => (
            <div key={i} style={{
              display: 'flex', gap: '10px', alignItems: 'flex-start',
              marginBottom: '0.875rem',
            }}>
              <span style={{
                width: '14px', height: '14px', borderRadius: 0,
                background: '#D63318', color: '#FFF', fontSize: '9px',
                fontWeight: 700, display: 'flex', alignItems: 'center',
                justifyContent: 'center', flexShrink: 0, marginTop: '1px',
              }}>✓</span>
              <span style={{ fontSize: '13px', color: '#374151', lineHeight: 1.6 }}>{item}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* 5 ── LAYERS: how it works ────────────────────────────── */
function LayersSection(): React.JSX.Element {
  const handleMouseEnter = (e: MouseEvent<HTMLAnchorElement>): void => {
    const target = e.currentTarget;
    target.style.background = '#0D0D0D';
    target.style.color = '#fff';
    target.querySelectorAll('p').forEach((p: HTMLParagraphElement) => {
      p.style.color = '#888';
    });
  };

  const handleMouseLeave = (e: MouseEvent<HTMLAnchorElement>): void => {
    const target = e.currentTarget;
    target.style.background = '';
    target.style.color = '';
    target.querySelectorAll('p').forEach((p: HTMLParagraphElement) => {
      p.style.color = '';
    });
  };

  return (
    <section style={{ borderBottom: '1px solid rgba(0,0,0,0.12)' }}>
      {/* Section label */}
      <div style={{ padding: '4vw 4vw 0', borderBottom: '1px solid rgba(0,0,0,0.08)' }}>
        <div style={{
          fontSize: '10px', fontWeight: 700, letterSpacing: '0.22em',
          textTransform: 'uppercase', color: '#D63318', marginBottom: '0.75rem',
        }}>Architecture</div>
        <h2 style={{
          fontSize: 'clamp(1.5rem,2.5vw,2.2rem)', fontWeight: 900,
          textTransform: 'uppercase', letterSpacing: '-0.02em',
          lineHeight: 1, border: 'none', padding: '0 0 2rem', margin: 0,
        }}>Three Layers. One Control Surface.</h2>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)' }}>
        {LAYERS.map((l: Layer, i: number) => (
          <Link
            key={i}
            to={l.href}
            style={{
              padding: '3.5vw 3vw', textDecoration: 'none', color: 'inherit',
              borderRight: i < 2 ? '1px solid rgba(0,0,0,0.12)' : 'none',
              display: 'block',
            }}
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
          >
            <div style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '0.22em', textTransform: 'uppercase', color: '#D63318', marginBottom: '2rem' }}>Layer {l.num} ·</div>
            <div style={{ fontSize: 'clamp(1.2rem,2.2vw,1.8rem)', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '-0.02em', lineHeight: 1, marginBottom: '0.6rem' }}>{l.name}</div>
            <div style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '0.18em', textTransform: 'uppercase', color: '#6B7280', marginBottom: '1rem' }}>{l.sub}</div>
            <p style={{ fontSize: '13px', fontWeight: 400, lineHeight: 1.75, color: '#374151', margin: 0 }}>{l.desc}</p>
          </Link>
        ))}
      </div>
    </section>
  );
}

/* 6 ── PRINCIPLES: four absolutes ─────────────────────── */
function PrinciplesSection(): React.JSX.Element {
  return (
    <section style={{ padding: '6vw 4vw', borderBottom: '1px solid rgba(0,0,0,0.12)' }}>
      <div style={{ marginBottom: '3rem' }}>
        <div style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '0.22em', textTransform: 'uppercase', color: '#D63318', marginBottom: '1rem' }}>Design Principles</div>
        <h2 style={{ fontSize: 'clamp(2rem,4vw,3.5rem)', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '-0.03em', lineHeight: 1, border: 'none', padding: 0, margin: 0 }}>Four Absolutes</h2>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0 }}>
        {PRINCIPLES.map((p: Principle, i: number) => (
          <div key={i} style={{
            padding: '3vw',
            borderTop: '1px solid rgba(0,0,0,0.12)',
            borderRight: i % 2 === 0 ? '1px solid rgba(0,0,0,0.12)' : 'none',
          }}>
            <div style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '0.22em', textTransform: 'uppercase', color: '#D63318', marginBottom: '1rem' }}>{p.n} ·</div>
            <div style={{ fontSize: 'clamp(1rem,1.8vw,1.3rem)', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '-0.01em', lineHeight: 1.1, marginBottom: '0.75rem' }}>{p.title}</div>
            <p style={{ fontSize: '13px', fontWeight: 400, color: '#374151', lineHeight: 1.75, margin: 0 }}>{p.body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

/* 7 ── CTA: outcome-focused ────────────────────────────── */
function CtaSection(): React.JSX.Element {
  return (
    <section style={{
      background: '#0D0D0D', color: '#FFFFFF',
      padding: '8vw 4vw',
      display: 'grid', gridTemplateColumns: '1fr auto',
      gap: '4vw', alignItems: 'center',
      borderTop: '1px solid rgba(255,255,255,0.06)',
    }}>
      <div>
        <div style={{
          fontSize: '10px', fontWeight: 700, letterSpacing: '0.22em',
          textTransform: 'uppercase', color: '#D63318', marginBottom: '1.25rem',
        }}>For CTOs · Staff Engineers · AI Platform Teams</div>
        <h2 style={{
          fontSize: 'clamp(2rem,5vw,4.5rem)', fontWeight: 900, textTransform: 'uppercase',
          letterSpacing: '-0.03em', lineHeight: 1, color: '#fff',
          border: 'none', padding: 0, margin: '0 0 1rem',
        }}>
          Ready to control what<br />your agents touch?
        </h2>
        <p style={{ fontSize: '13px', fontWeight: 300, color: 'rgba(255,255,255,0.5)', maxWidth: '480px', margin: 0, lineHeight: 1.75 }}>
          Built for regulated enterprises and engineering organizations where a wrong AI
          decision costs more than the sprint. Read the full v9 architecture specification.
        </p>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', flexShrink: 0 }}>
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
      title="Nirnex — Stop Your AI Agents Flying Blind"
      description="Nirnex is the execution control layer for AI-assisted software delivery. Give your agents verified codebase context before they touch a single file."
    >
      <HomepageHero />
      <PainSection />
      <InsightSection />
      <SolutionSection />
      <LayersSection />
      <PrinciplesSection />
      <CtaSection />
    </Layout>
  );
}
