// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QrCode, qrModules } from '@/components/QrCode';

// A QR code has a hard capacity (version 40 at level M holds ~2.3 KB in
// byte mode). A value past it must not take the page down: the component
// steps aside for a caller-supplied fallback instead of throwing from
// render — a sheet too long for a QR still opens and prints.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root | undefined;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });
  root = undefined;
  container.remove();
});

async function render(el: React.ReactElement) {
  await act(async () => {
    root = createRoot(container);
    root.render(el);
  });
}

const SHORT = 'https://demo.quizmill.dev/paper/mark/#s=2.abc';
// Comfortably past what any QR version holds.
const TOO_LONG = `https://demo.quizmill.dev/paper/mark/#s=2.${'x'.repeat(3200)}`;

describe('qrModules', () => {
  it('lays out a value that fits', () => {
    const modules = qrModules(SHORT);
    expect(modules).not.toBeNull();
    expect(modules!.size).toBeGreaterThan(8);
    expect(modules!.path).toMatch(/^M4 4h1/);
  });

  it('is null for a value no QR version can hold', () => {
    expect(qrModules(TOO_LONG)).toBeNull();
  });
});

describe('QrCode', () => {
  it('renders the symbol for a value that fits', async () => {
    await render(<QrCode value={SHORT} fallback={<span>no code</span>} />);
    expect(container.querySelector('svg')).not.toBeNull();
    expect(container.textContent).not.toContain('no code');
  });

  it('renders the fallback, not an error, for a value past QR capacity', async () => {
    await render(<QrCode value={TOO_LONG} fallback={<span>no code</span>} />);
    expect(container.querySelector('svg')).toBeNull();
    expect(container.textContent).toContain('no code');
  });

  it('renders nothing at all past capacity when no fallback is given', async () => {
    await render(<QrCode value={TOO_LONG} />);
    expect(container.innerHTML).toBe('');
  });
});
