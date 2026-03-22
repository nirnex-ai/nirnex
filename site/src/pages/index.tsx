import React, { MouseEvent } from 'react';
import Link from '@docusaurus/Link';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import Layout from '@theme/Layout';
import styles from './index.module.css';

/* ── TYPES ─────────────────────────────────────────────── */
interface Stat {
  num: string;
  label: string;
  sub: string;
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
const STATS: Stat[] = [
  { num: '0', label: 'LLM calls', sub: 'Lane A — 80% of commits' },
  { num: '5', label: 'ECO dimensions', sub: 'Coverage · Freshness · Mapping · Conflict · Graph' },
  { num: '~200ms', label: 'Index latency', sub: 'Atomic post-commit hook' },
  { num: '100%', label: 'Decisions traced', sub: 'Unified schema, full replay' },
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
function HomepageHero(): React.JSX.Element {
  return (
    <section style={{
      background: '#0D0D0D', color: '#FFFFFF',
      padding: '10vw 4vw 6vw', position: 'relative', overflow: 'hidden',
      borderBottom: '1px solid rgba(255,255,255,0.06)',
    }}>
      {/* Watermark */}
      <div style={{
        position: 'absolute', top: '-4vw', right: '-2vw',
        fontSize: '22vw', fontWeight: 900, color: 'rgba(255,255,255,0.03)',
        lineHeight: 1, letterSpacing: '-0.04em', pointerEvents: 'none',
        textTransform: 'uppercase', fontFamily: 'Space Grotesk, sans-serif',
      }}>OS</div>

      {/* Eyebrow */}
      <div style={{
        display: 'inline-block', fontSize: '10px', fontWeight: 700,
        letterSpacing: '0.22em', textTransform: 'uppercase',
        color: '#D63318', border: '1px solid #D63318',
        padding: '4px 12px', marginBottom: '2.5rem',
      }}>v9.0 — Implementation-Ready · March 2026</div>

      {/* Headline */}
      <h1 style={{
        fontSize: 'clamp(3rem,7vw,7rem)', fontWeight: 900, lineHeight: 0.95,
        textTransform: 'uppercase', letterSpacing: '-0.03em',
        marginBottom: '1.5rem', maxWidth: '16ch',
      }}>
        Evidence-Backed<br />
        <span style={{ color: '#D63318' }}>AI Delivery.</span>
      </h1>

      <p style={{
        fontSize: '14px', fontWeight: 300, lineHeight: 1.75,
        color: '#888888', maxWidth: '520px', marginBottom: '3rem',
      }}>
        AI Delivery OS is a three-layer operating system for AI-assisted software delivery.
        It constrains agent decisions to evidence-backed boundaries — and records every decision
        for debugging and calibration.
      </p>

      <div style={{ display: 'flex', gap: 0 }}>
        <Link to="/docs/intro/overview" style={{
          background: '#D63318', color: '#FFFFFF',
          padding: '14px 32px', fontSize: '11px', fontWeight: 700,
          letterSpacing: '0.2em', textTransform: 'uppercase', textDecoration: 'none',
          display: 'inline-block',
        }}>Read the Architecture</Link>
        <Link to="/docs/business/executive-summary" style={{
          background: 'transparent', color: '#FFFFFF',
          padding: '14px 32px', fontSize: '11px', fontWeight: 700,
          letterSpacing: '0.2em', textTransform: 'uppercase', textDecoration: 'none',
          border: '1px solid rgba(255,255,255,0.18)', borderLeft: 'none',
          display: 'inline-block',
        }}>Business Case →</Link>
      </div>

      {/* Stats row */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)',
        borderTop: '1px solid rgba(255,255,255,0.08)',
        marginTop: '6rem',
      }}>
        {STATS.map((s: Stat, i: number) => (
          <div key={i} style={{
            padding: '2rem 0', paddingRight: '2rem',
            borderRight: i < 3 ? '1px solid rgba(255,255,255,0.08)' : 'none',
            paddingLeft: i > 0 ? '2rem' : 0,
          }}>
            <div style={{ fontSize: 'clamp(1.8rem,3vw,3rem)', fontWeight: 900, color: '#D63318', lineHeight: 1 }}>{s.num}</div>
            <div style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '0.18em', textTransform: 'uppercase', color: '#555', marginTop: '0.5rem' }}>{s.label}</div>
            <div style={{ fontSize: '11px', fontWeight: 300, color: '#444', marginTop: '4px' }}>{s.sub}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

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
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)' }}>
        {LAYERS.map((l: Layer, i: number) => (
          <Link
            key={i}
            to={l.href}
            style={{
              padding: '4vw 3vw', textDecoration: 'none', color: 'inherit',
              borderRight: i < 2 ? '1px solid rgba(0,0,0,0.12)' : 'none',
              display: 'block',
            }}
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
          >
            <div style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '0.22em', textTransform: 'uppercase', color: '#D63318', marginBottom: '2.5rem' }}>Layer {l.num} ·</div>
            <div style={{ fontSize: 'clamp(1.3rem,2.5vw,2rem)', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '-0.02em', lineHeight: 1, marginBottom: '0.75rem' }}>{l.name}</div>
            <div style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '0.18em', textTransform: 'uppercase', color: '#999', marginBottom: '1.25rem' }}>{l.sub}</div>
            <p style={{ fontSize: '12px', fontWeight: 300, lineHeight: 1.75, color: '#555', margin: 0 }}>{l.desc}</p>
          </Link>
        ))}
      </div>
    </section>
  );
}

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
            <p style={{ fontSize: '12px', fontWeight: 300, color: '#666', lineHeight: 1.75, margin: 0 }}>{p.body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function CtaSection(): React.JSX.Element {
  return (
    <section style={{
      background: '#D63318', color: '#FFFFFF',
      padding: '8vw 4vw',
      display: 'grid', gridTemplateColumns: '1fr auto',
      gap: '4vw', alignItems: 'center',
    }}>
      <div>
        <h2 style={{ fontSize: 'clamp(2rem,5vw,4.5rem)', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '-0.03em', lineHeight: 1, color: '#fff', border: 'none', padding: 0, margin: '0 0 1rem' }}>Stop Letting Agents Guess.</h2>
        <p style={{ fontSize: '13px', fontWeight: 300, color: 'rgba(255,255,255,0.65)', maxWidth: '480px', margin: 0 }}>
          Built for regulated enterprises and large engineering organizations where the cost of wrong AI plans is real. Request access to the v9 architecture specification.
        </p>
      </div>
      <Link to="/docs/intro/overview" style={{
        background: '#FFFFFF', color: '#000000',
        padding: '18px 40px', fontSize: '12px', fontWeight: 700,
        letterSpacing: '0.2em', textTransform: 'uppercase', textDecoration: 'none',
        whiteSpace: 'nowrap', display: 'inline-block', flexShrink: 0,
      }}>Read the Docs →</Link>
    </section>
  );
}

/* ── PAGE ──────────────────────────────────────────────── */
export default function Home(): React.JSX.Element {
  const { siteConfig } = useDocusaurusContext();
  return (
    <Layout title="AI Delivery OS" description="Evidence-backed AI-assisted software delivery. Three-layer operating system: Knowledge Engine, Task Orchestrator, Decision Ledger.">
      <HomepageHero />
      <LayersSection />
      <PrinciplesSection />
      <CtaSection />
    </Layout>
  );
}