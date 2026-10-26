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

  it('caps emphasis nesting depth; deeper delimiters stay literal', async () => {
    // 12 openers (`*a` after a space) then 12 closers (`a*` before a space):
    // without a cap this nests <em> 12 deep and the render recursion follows.
    const depth = 12;
    await render('*a '.repeat(depth) + 'core' + ' a*'.repeat(depth));
    const nesting = Math.max(
      ...Array.from(container.querySelectorAll('em')).map((el) => {
        let d = 0;
        for (let n: Element | null = el; n; n = n.parentElement) if (n.tagName === 'EM') d++;
        return d;
      }),
    );
    expect(nesting).toBeLessThanOrEqual(8);
    // No text is lost or invented: the asterisks that didn't pair stay visible.
    expect(container.textContent?.replace(/\*/g, '')).toBe(
      ('a '.repeat(depth) + 'core' + ' a'.repeat(depth)),
    );
    expect(container.textContent?.split('*').length - 1).toBe((depth - 8) * 2);
  });

  it('parses a large malformed string in linear time (runtime packs are unbounded)', async () => {
    // ~220 KB of unmatched openers followed by as many closers: the shape
    // that made the opener lookup quadratic.
    const n = 24_000;
    const text = '*a '.repeat(n) + ' a*'.repeat(n);
    const started = performance.now();
    await render(text);
    const elapsed = performance.now() - started;
    expect(container.textContent?.match(/a/g)?.length).toBe(2 * n);
    expect(elapsed, `took ${elapsed.toFixed(0)}ms`).toBeLessThan(1000);
  });
});

describe('McqMarkdown wrapping', () => {
  // A bare URL or a long code span has no break opportunity, so on a phone
  // it ran past the feedback card's edge (#231). `wrap-anywhere`
  // (overflow-wrap: anywhere) lets it break mid-token instead.
  it('lets long unbroken tokens wrap inside the card', async () => {
    await render(
      'Read more: https://docs.aws.amazon.com/bedrock/latest/userguide/security_iam_id-based-policy-examples.html and `averyveryveryverylongidentifier`',
    );
    const wrapped = (el: Element | null) => !!el?.closest('.wrap-anywhere');
    expect(wrapped(container.querySelector('a'))).toBe(true);
    expect(wrapped(container.querySelector('code'))).toBe(true);
  });
});
