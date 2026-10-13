// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { McqMarkdown } from '@/components/McqMarkdown';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function render(text: string, linkify?: boolean) {
  await act(async () => {
    root = createRoot(container);
    root.render(<McqMarkdown text={text} linkify={linkify} />);
  });
}

const texts = (selector: string) =>
  Array.from(container.querySelectorAll(selector)).map((el) => el.textContent);

describe('McqMarkdown emphasis', () => {
  it('renders **bold** as <strong> without the asterisks', async () => {
    await render('**Why the other options are wrong:** Venus is second.');
    expect(texts('strong')).toEqual(['Why the other options are wrong:']);
    expect(container.textContent).toBe(
      'Why the other options are wrong: Venus is second.',
    );
  });

  it('renders *italic* as <em>', async () => {
    await render('Pluto is *round*; size is not the test.');
    expect(texts('em')).toEqual(['round']);
    expect(container.textContent).toBe('Pluto is round; size is not the test.');
  });

  it('handles several runs and bold wrapping italic', async () => {
    await render('**first** and **second *nested* run**');
    expect(texts('strong')).toEqual(['first', 'second nested run']);
    expect(texts('strong em')).toEqual(['nested']);
    expect(container.textContent).toBe('first and second nested run');
  });

  it('keeps emphasis around inline code and URLs', async () => {
    await render('The **`description`** field, see **https://example.com/x**.');
    expect(texts('strong')).toEqual(['description', 'https://example.com/x']);
    expect(texts('strong code')).toEqual(['description']);
    expect(texts('strong a')).toEqual(['https://example.com/x']);
  });

  it('still emphasises with linkify off (option text inside a button)', async () => {
    await render('**bold** https://example.com', false);
    expect(texts('strong')).toEqual(['bold']);
    expect(container.querySelector('a')).toBeNull();
  });

  it('leaves asterisks inside inline code and code blocks alone', async () => {
    await render('Python: `2**3` and\n```py\nx = a * b ** c\n```\n');
    expect(container.querySelector('strong')).toBeNull();
    expect(container.querySelector('em')).toBeNull();
    expect(texts('code')).toEqual(['2**3', 'x = a * b ** c\n']);
  });

  it('leaves stray and spaced asterisks literal', async () => {
    const cases = ['3 * 4 * 5', '2 ** 3', 'a*', '*', '** not bold **', '* bullet'];
    for (const text of cases) {
      await render(text);
      expect(container.querySelector('strong'), text).toBeNull();
      expect(container.querySelector('em'), text).toBeNull();
      expect(container.textContent, text).toBe(text);
      await act(async () => root.unmount());
    }
    // afterEach unmounts; give it a mounted root to tear down.
    await render('');
  });

  it('does not let emphasis span lines', async () => {
    await render('**open\nclosed**');
    expect(container.querySelector('strong')).toBeNull();
    expect(container.textContent).toBe('**open\nclosed**');
  });
});
