// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, useEffect, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useLatest } from '@/lib/useLatest';

// A listener registered once must see the state of the latest committed
// render through the ref, and the ref must be current by the time any
// event can fire — i.e. right after commit, not one tick later.

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

describe('useLatest', () => {
  it('gives a once-registered listener the latest committed value', async () => {
    const seen: number[] = [];
    let setCount: (n: number) => void = () => {};
    function Probe() {
      const [count, set] = useState(0);
      setCount = set;
      const countRef = useLatest(count);
      useEffect(() => {
        const onPing = () => seen.push(countRef.current);
        window.addEventListener('ping', onPing);
        return () => window.removeEventListener('ping', onPing);
      }, [countRef]);
      return null;
    }
    await act(async () => {
      root = createRoot(container);
      root.render(<Probe />);
    });
    window.dispatchEvent(new Event('ping'));
    await act(async () => setCount(3));
    window.dispatchEvent(new Event('ping'));
    expect(seen).toEqual([0, 3]);
  });

  it('is already current inside a passive effect of the same commit', async () => {
    const seen: string[] = [];
    let setLabel: (s: string) => void = () => {};
    function Probe() {
      const [label, set] = useState('a');
      setLabel = set;
      const labelRef = useLatest(label);
      useEffect(() => {
        seen.push(labelRef.current);
      }, [label, labelRef]);
      return null;
    }
    await act(async () => {
      root = createRoot(container);
      root.render(<Probe />);
    });
    await act(async () => setLabel('b'));
    expect(seen).toEqual(['a', 'b']);
  });
});
