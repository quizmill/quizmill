// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, useState } from 'react';
import { createRoot, hydrateRoot, type Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { useClientState, useMounted } from '@/lib/useMounted';

// The two hooks behind every "read it after mount" value: the server render
// and the hydration pass must agree, so they see the fallback; the first
// client-only render sees the browser.

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

describe('useMounted', () => {
  it('is false on the server', () => {
    function Probe() {
      return <span>{useMounted() ? 'client' : 'server'}</span>;
    }
    expect(renderToString(<Probe />)).toContain('server');
  });

  it('hydrates with the server value, then flips to true', async () => {
    const seen: boolean[] = [];
    function Probe() {
      const mounted = useMounted();
      seen.push(mounted);
      return <span>{mounted ? 'client' : 'server'}</span>;
    }
    container.innerHTML = renderToString(<Probe />);
    await act(async () => {
      root = hydrateRoot(container, <Probe />);
    });
    // The hydration pass agreed with the markup; the next render didn't.
    expect(seen[0]).toBe(false);
    expect(seen.at(-1)).toBe(true);
    expect(container.textContent).toBe('client');
  });

  it('is true from the first render of a plain client mount', async () => {
    const seen: boolean[] = [];
    function Probe() {
      seen.push(useMounted());
      return null;
    }
    await act(async () => {
      root = createRoot(container);
      root.render(<Probe />);
    });
    expect(seen).toEqual([true]);
  });
});

describe('useClientState', () => {
  it('shows the fallback on the server and the loaded value on the client', async () => {
    const load = vi.fn(() => 'stored');
    function Probe() {
      const [value] = useClientState(load, 'fallback');
      return <span>{value}</span>;
    }
    const html = renderToString(<Probe />);
    expect(html).toContain('fallback');
    expect(load).not.toHaveBeenCalled();

    container.innerHTML = html;
    await act(async () => {
      root = hydrateRoot(container, <Probe />);
    });
    expect(container.textContent).toBe('stored');
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('lets the setter take over, and never re-reads storage for it', async () => {
    const load = vi.fn(() => 1);
    let setValue: (n: number) => void = () => {};
    function Probe() {
      const [value, set] = useClientState(load, 0);
      setValue = set;
      return <span>{value}</span>;
    }
    await act(async () => {
      root = createRoot(container);
      root.render(<Probe />);
    });
    expect(container.textContent).toBe('1');
    await act(async () => {
      setValue(5);
    });
    expect(container.textContent).toBe('5');
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('reads once, not on every render, when load is stable', async () => {
    const load = vi.fn(() => 'x');
    let rerender: () => void = () => {};
    function Probe() {
      const [value] = useClientState(load, '');
      const [n, setN] = useState(0);
      rerender = () => setN(n + 1);
      return (
        <span>
          {value}
          {n}
        </span>
      );
    }
    await act(async () => {
      root = createRoot(container);
      root.render(<Probe />);
    });
    await act(async () => rerender());
    await act(async () => rerender());
    expect(container.textContent).toBe('x2');
    expect(load).toHaveBeenCalledTimes(1);
  });
});
