import React, { MouseEvent } from 'react';
import Link from '@docusaurus/Link';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import Layout from '@theme/Layout';
import styles from './index.module.css';

/* ── TYPES ─────────────────────────────────────────────── */
interface Failure { n: string; scenario: string; detail: string; }
interface Layer   { num: string; name: string; userQ: string; answer: string; desc: string; href: string; }
interface Principle { n: string; title: string; body: string; }

/* ── DATA ──────────────────────────────────────────────── */
const FAILURES: Failure[] = [
  {
    n: '01',
    scenario: 'Agent picks outdated policy. Output looks correct.',
    detail: 'Customer gets the wrong result. Three days to find the root cause. No log of what the agent read, or why it chose it.',
  },
  {
    n: '02',
    scenario: "Context doesn't survive the session.",
    detail: 'New session, new agent. All prior decisions and constraints are invisible. The agent starts from zero — again.',
  },
  {
    n: '03',
    scenario: 'One spec change. Twelve unintended files.',
    detail: "The agent touched modules it was never scoped to. You find out in code review. The blast radius was invisible until it wasn't.",
  },
  {
    n: '04',
    scenario: 'Something failed. Post-mortem is guesswork.',
    detail: 'No decision log. No reasoning chain. No replay. Root cause analysis becomes blame distribution. Same mistake next sprint.',
  },
  {
    n: '05',
    scenario: 'Same prompt. Different output. Every run.',
    detail: 'Non-determinism with no control surface. You can reproduce the variance. You cannot narrow it. You cannot ship confidently.',
  },
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
  { n: '01', title: 'Classification After Evidence',      body: 'Spec → Knowledge Query → ECO → Classification. Classification cannot proceed without evidence. Agents never guess at scope.' },
  { n: '02', title: 'Every Decision Is Auditable',        body: 'A single trace_id connects the initial requirement through every stage to completion. When something goes wrong, read the trace chain backwards.' },
  { n: '03', title: 'Code Wins on Facts. Spec Wins on Intent.', body: 'For "what exists?" — code is ground truth. For "what should exist?" — spec wins but must be validated. Ambiguous: escalate.' },
  { n: '04', title: 'Invisible at Rest. Unmissable Under Load.', body: 'Lane A developers should forget this system exists. Lane C developers should find it indispensable. Value earned through Lane B/C — not Lane A friction.' },
];

const WITHOUT_ROWS = [
  ['What the agent reads',  'Raw text search — no symbol graph'],
  ['Scope enforcement',     'None — the agent decides what to touch'],
  ['Failed output',         "Looks correct until it isn't"],
  ['Debug path',            'Manual triage across unlogged decisions'],
  ['Root cause time',       'Days — maybe weeks'],
  ['Next sprint',           'Same mistake, different file'],
] as const;

const WITH_ROWS = [
  ['What the agent reads',  'Verified parse graph — exact scope, not guesses'],
  ['Scope enforcement',     'Task Execution Envelope — out-of-scope writes rejected'],
  ['Failed output',         'Explicit confidence score flags uncertainty before shipping'],
  ['Debug path',            'Replay any decision from trace_id in isolation'],
  ['Root cause time',       'Minutes — full decision chain available'],
  ['Next sprint',           'Ground truth sampling closes the loop automatically'],
] as const;

/* ── COMPONENTS ────────────────────────────────────────── */

/* 1 ── HERO ─────────────────────────────────────────────── */
function HomepageHero(): React.JSX.Element {
  return (
    <section style={{
      background: '#0D0D0D', color: '#FFFFFF',
      padding: '7vw 4vw 6vw', position: 'relative', overflow: 'hidden',
      borderBottom: '1px solid rgba(255,255,255,0.06)',
    }}>
      {/* Watermark — hidden on mobile via font-size scaling */}
      <div aria-hidden="true" style={{
        position: 'absolute', top: '-4vw', right: '-2vw',
        fontSize: '22vw', fontWeight: 900, color: 'rgba(255,255,255,0.03)',
        lineHeight: 1, letterSpacing: '-0.04em', pointerEvents: 'none',
        textTransform: 'uppercase', fontFamily: 'Space Grotesk, sans-serif',
      }}>OS</div>

      <div className={styles.heroGrid}>
        {/* Left: copy */}
        <div>
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: '8px',
            fontSize: '10px', fontWeight: 700, letterSpacing: '0.18em',
            textTransform: 'uppercase', color: '#888888', marginBottom: '1.75rem',
          }}>
            <span style={{ width: '20px', height: '1px', background: '#D63318', display: 'inline-block', flexShrink: 0 }} />
            For engineering teams shipping with AI agents
          </div>

          <h1 style={{
            fontSize: 'clamp(2.4rem,5vw,5rem)', fontWeight: 900, lineHeight: 0.95,
            textTransform: 'uppercase', letterSpacing: '-0.03em',
            marginBottom: '1.5rem', color: '#FFFFFF',
          }}>
            You Can't Debug<br />Why Your AI Made<br />
            <span style={{ color: '#D63318' }}>That Decision.</span>
          </h1>

          <p style={{ fontSize: '15px', fontWeight: 400, lineHeight: 1.8, color: '#AAAAAA', marginBottom: '0.75rem' }}>
            The output looked correct. The customer got the wrong result. Your team spent days
            tracing it. There were no logs. No reasoning chain. No replay.
          </p>
          <p style={{ fontSize: '15px', fontWeight: 400, lineHeight: 1.8, color: '#AAAAAA', marginBottom: '2.5rem' }}>
            Nirnex is a runtime that decides{' '}
            <strong style={{ color: '#FFFFFF', fontWeight: 600 }}>what your AI is allowed to do —
            and records exactly why it did it.</strong>
          </p>

          <div style={{ display: 'flex', gap: 0, flexWrap: 'wrap' }}>
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
            position: 'relative', paddingBottom: '56.25%', height: 0, overflow: 'hidden',
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

/* 2 ── PAIN ─────────────────────────────────────────────── */
function PainSection(): React.JSX.Element {
  return (
    <section style={{ background: '#111111', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
      <div style={{ padding: '5vw 4vw 3vw' }}>
        <div style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '0.22em', textTransform: 'uppercase', color: '#D63318', marginBottom: '1rem' }}>The Problem</div>
        <h2 style={{ fontSize: 'clamp(1.8rem,3.5vw,3rem)', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '-0.03em', lineHeight: 1, color: '#FFFFFF', border: 'none', padding: 0, margin: '0 0 0.875rem' }}>
          Here's What's Actually Happening
        </h2>
        <p style={{ fontSize: '14px', fontWeight: 400, color: '#666666', lineHeight: 1.75, maxWidth: '560px', margin: 0 }}>
          Not hypothetical failure modes. Real scenarios on teams shipping with AI agents today —
          all sharing the same root cause: agents operate without verified execution context.
        </p>
      </div>

      <div className={styles.painGrid}>
        {FAILURES.map((f: Failure, i: number) => (
          <div key={i} className={styles.painItem}>
            <div style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '0.2em', textTransform: 'uppercase', color: '#D63318', marginBottom: '1rem' }}>{f.n} ·</div>
            <div style={{ fontSize: '12px', fontWeight: 600, lineHeight: 1.4, color: '#FFFFFF', marginBottom: '0.875rem', fontStyle: 'italic' }}>
              "{f.scenario}"
            </div>
            <p style={{ fontSize: '12px', fontWeight: 400, color: '#555555', lineHeight: 1.7, margin: 0 }}>{f.detail}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

/* 3 ── INSIGHT ──────────────────────────────────────────── */
function InsightSection(): React.JSX.Element {
  return (
    <section style={{ background: '#D63318', color: '#FFFFFF', padding: '6vw 4vw', borderBottom: '1px solid rgba(0,0,0,0.15)' }}>
      <div className={styles.insightGrid}>
        <div>
          <div style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '0.22em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.55)', marginBottom: '1.25rem' }}>The Core Insight</div>
          <h2 style={{ fontSize: 'clamp(2rem,4vw,3.5rem)', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '-0.03em', lineHeight: 1.0, color: '#FFFFFF', border: 'none', padding: 0, margin: 0 }}>
            You Cannot<br />Control What<br />You Cannot Trace.
          </h2>
        </div>
        <div>
          <p style={{ fontSize: '15px', fontWeight: 400, color: 'rgba(255,255,255,0.85)', lineHeight: 1.8, marginBottom: '1rem' }}>
            AI agents are non-deterministic. You cannot unit-test a language model. Prompt
            engineering is not a control surface — it's a hint.
          </p>
          <p style={{ fontSize: '15px', fontWeight: 400, color: 'rgba(255,255,255,0.85)', lineHeight: 1.8, marginBottom: '1rem' }}>
            The only reliable lever is{' '}
            <strong style={{ color: '#FFFFFF' }}>controlling the inputs the agent operates on,
            bounding what it can write, and recording every step of its reasoning</strong> — before
            it acts, during execution, and after completion.
          </p>
          <p style={{ fontSize: '15px', fontWeight: 700, color: '#FFFFFF', lineHeight: 1.5, margin: 0, borderLeft: '3px solid rgba(255,255,255,0.4)', paddingLeft: '1rem' }}>
            Without a trace, you don't have an AI problem.<br />You have a liability problem.
          </p>
        </div>
      </div>
    </section>
  );
}

/* 4 ── SOLUTION ─────────────────────────────────────────── */
function SolutionSection(): React.JSX.Element {
  return (
    <section style={{ borderBottom: '1px solid rgba(0,0,0,0.12)' }}>
      {/* Header */}
      <div style={{ padding: '5vw 4vw 4vw', borderBottom: '1px solid rgba(0,0,0,0.08)' }}>
        <div style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '0.22em', textTransform: 'uppercase', color: '#D63318', marginBottom: '1rem' }}>The Solution</div>
        <div className={styles.solutionHeaderGrid}>
          <h2 style={{ fontSize: 'clamp(1.8rem,3.5vw,3rem)', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '-0.03em', lineHeight: 1, border: 'none', padding: 0, margin: 0 }}>
            Nirnex: A Runtime<br />for Controlled<br />AI Execution
          </h2>
          <div>
            <p style={{ fontSize: '14px', fontWeight: 600, color: '#111111', lineHeight: 1.7, marginBottom: '1rem', borderLeft: '3px solid #D63318', paddingLeft: '1rem' }}>
              Nirnex decides what your AI is allowed to do — and records exactly why it did it.
            </p>
            <p style={{ fontSize: '14px', lineHeight: 1.8, color: '#374151', marginBottom: '0.75rem' }}>
              Before an agent sees your codebase, Nirnex builds an{' '}
              <strong>Execution Context Object (ECO)</strong> — a precision-scored map of the exact
              symbols, dependencies, and files relevant to the task. Not a search result.
              A verified parse graph.
            </p>
            <p style={{ fontSize: '14px', lineHeight: 1.8, color: '#374151', margin: 0 }}>
              The agent operates inside declared bounds. Writes outside scope are rejected. Every
              decision is logged with a trace_id you can replay in isolation — root cause in
              minutes, not days.
            </p>
          </div>
        </div>
      </div>

      {/* Before / After */}
      <div className={styles.beforeAfterGrid}>
        {/* Without */}
        <div className={styles.beforePanel} style={{ padding: '4vw', background: '#F8F8F8' }}>
          <div style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '0.2em', textTransform: 'uppercase', color: '#999999', marginBottom: '0.5rem' }}>Without Nirnex</div>
          <div style={{ fontSize: '12px', color: '#BBBBBB', fontStyle: 'italic', marginBottom: '1.5rem' }}>Random outputs. Silent failures. Guesswork.</div>
          {WITHOUT_ROWS.map(([label, val], i) => (
            <div key={i} className={`${styles.compareRow} ${i === 0 ? styles.compareRowFirst : ''}`}>
              <span style={{ fontSize: '11px', fontWeight: 600, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{label}</span>
              <span style={{ fontSize: '12px', color: '#9CA3AF' }}>{val}</span>
            </div>
          ))}
        </div>

        {/* With */}
        <div style={{ padding: '4vw', background: '#FFFFFF' }}>
          <div style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '0.2em', textTransform: 'uppercase', color: '#D63318', marginBottom: '0.5rem' }}>With Nirnex</div>
          <div style={{ fontSize: '12px', color: '#9CA3AF', fontStyle: 'italic', marginBottom: '1.5rem' }}>Controlled outputs. Full trace. Root cause in minutes.</div>
          {WITH_ROWS.map(([label, val], i) => (
            <div key={i} className={`${styles.compareRow} ${i === 0 ? styles.compareRowFirst : ''}`}>
              <span style={{ fontSize: '11px', fontWeight: 600, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{label}</span>
              <span style={{ fontSize: '12px', color: '#374151', fontWeight: 500 }}>{val}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* 5 ── LAYERS ───────────────────────────────────────────── */
function LayersSection(): React.JSX.Element {
  const handleMouseEnter = (e: MouseEvent<HTMLAnchorElement>): void => {
    const t = e.currentTarget;
    t.style.background = '#0D0D0D';
    t.style.color = '#fff';
    t.querySelectorAll('[data-muted]').forEach(el => { (el as HTMLElement).style.color = '#666'; });
  };

  const handleMouseLeave = (e: MouseEvent<HTMLAnchorElement>): void => {
    const t = e.currentTarget;
    t.style.background = '';
    t.style.color = '';
    t.querySelectorAll('[data-muted]').forEach(el => { (el as HTMLElement).style.color = ''; });
  };

  return (
    <section style={{ borderBottom: '1px solid rgba(0,0,0,0.12)' }}>
      <div style={{ padding: '4vw 4vw 0', borderBottom: '1px solid rgba(0,0,0,0.08)' }}>
        <div style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '0.22em', textTransform: 'uppercase', color: '#D63318', marginBottom: '0.75rem' }}>Under the Hood</div>
        <h2 style={{ fontSize: 'clamp(1.5rem,2.5vw,2.2rem)', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '-0.02em', lineHeight: 1, border: 'none', padding: '0 0 2rem', margin: 0 }}>
          Three Layers. One Control Surface.
        </h2>
      </div>

      <div className={styles.layersGrid}>
        {LAYERS.map((l: Layer, i: number) => (
          <Link key={i} to={l.href} className={styles.layerItem} onMouseEnter={handleMouseEnter} onMouseLeave={handleMouseLeave}>
            <div style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '0.22em', textTransform: 'uppercase', color: '#D63318', marginBottom: '1.5rem' }}>Layer {l.num} ·</div>
            <div style={{ fontSize: '13px', fontWeight: 600, color: '#6B7280', marginBottom: '0.5rem', fontStyle: 'italic' }} data-muted="">{l.userQ}</div>
            <div style={{ fontSize: '12px', fontWeight: 700, color: '#D63318', marginBottom: '1.25rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{l.answer}</div>
            <div style={{ fontSize: 'clamp(1.1rem,2vw,1.6rem)', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '-0.02em', lineHeight: 1, marginBottom: '0.75rem' }}>{l.name}</div>
            <p style={{ fontSize: '13px', fontWeight: 400, lineHeight: 1.75, color: '#374151', margin: 0 }} data-muted="">{l.desc}</p>
          </Link>
        ))}
      </div>
    </section>
  );
}

/* 6 ── PRINCIPLES ───────────────────────────────────────── */
function PrinciplesSection(): React.JSX.Element {
  return (
    <section style={{ padding: '6vw 4vw', borderBottom: '1px solid rgba(0,0,0,0.12)' }}>
      <div style={{ marginBottom: '3rem' }}>
        <div style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '0.22em', textTransform: 'uppercase', color: '#D63318', marginBottom: '1rem' }}>Non-Negotiables</div>
        <h2 style={{ fontSize: 'clamp(2rem,4vw,3.5rem)', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '-0.03em', lineHeight: 1, border: 'none', padding: 0, margin: 0 }}>
          What We Won't Compromise On
        </h2>
      </div>
      <div className={styles.principlesGrid}>
        {PRINCIPLES.map((p: Principle, i: number) => (
          <div key={i} className={styles.principleItem}>
            <div style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '0.22em', textTransform: 'uppercase', color: '#D63318', marginBottom: '1rem' }}>{p.n} ·</div>
            <div style={{ fontSize: 'clamp(1rem,1.8vw,1.3rem)', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '-0.01em', lineHeight: 1.1, marginBottom: '0.75rem' }}>{p.title}</div>
            <p style={{ fontSize: '13px', fontWeight: 400, color: '#374151', lineHeight: 1.75, margin: 0 }}>{p.body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

/* 7 ── CTA ──────────────────────────────────────────────── */
function CtaSection(): React.JSX.Element {
  return (
    <section className={styles.ctaGrid} style={{
      background: '#0D0D0D', color: '#FFFFFF',
      padding: '8vw 4vw',
      borderTop: '1px solid rgba(255,255,255,0.06)',
    }}>
      <div>
        <div style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '0.22em', textTransform: 'uppercase', color: '#D63318', marginBottom: '1.25rem' }}>
          For CTOs · Staff Engineers · AI Platform Teams
        </div>
        <h2 style={{ fontSize: 'clamp(2rem,5vw,4.5rem)', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '-0.03em', lineHeight: 1, color: '#fff', border: 'none', padding: 0, margin: '0 0 1rem' }}>
          Ready to control what<br />your agents touch?
        </h2>
        <p style={{ fontSize: '13px', fontWeight: 300, color: 'rgba(255,255,255,0.5)', maxWidth: '480px', margin: 0, lineHeight: 1.75 }}>
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
      title="Nirnex — You Can't Debug Why Your AI Made That Decision"
      description="Nirnex is a runtime that decides what your AI agents are allowed to do — and records exactly why they did it. Full trace. Controlled execution. Root cause in minutes."
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
