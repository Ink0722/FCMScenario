import { useState } from 'react';
import { SiteHeader } from '../app/ExperimentLayout';
import { InstructionsPanel } from './InstructionsPanel';
import type { InstructionsResource } from './useInstructions';

export function CodeScreen({ busy, error, onSubmit, instructions }: { busy: boolean; error: string; onSubmit: (code: string) => void; instructions: InstructionsResource }) {
  const [code, setCode] = useState('');
  return <><SiteHeader /><main id="main-content" className="entry-page">
    <header className="entry-heading"><h1>输入测试编码</h1><p>欢迎参与。请输入研究人员提供的编码，查看为你安排的任务。</p></header>
    <div className="entry-layout"><InstructionsPanel resource={instructions} /><div>
    <form className="surface code-form" onSubmit={e => { e.preventDefault(); if (code.trim() && !busy && instructions.data) onSubmit(code); }}>
      <label htmlFor="test-code">测试编码</label>
      <input id="test-code" type="text" value={code} onChange={e => setCode(e.target.value)} placeholder="请输入收到的测试编码" maxLength={80}
        autoComplete="off" autoCapitalize="characters" spellCheck={false} required disabled={busy} autoFocus />
      {error && <div className="error-message" role="alert">{error}</div>}
      <button className="button primary" type="submit" disabled={!code.trim() || busy || !instructions.data}>{busy ? '正在验证…' : '验证并继续'}</button>
    </form>
    <p className="entry-help">如果还没有收到编码，或输入时遇到问题，可以联系研究人员，我们会协助你。</p>
    </div></div>
  </main></>;
}
