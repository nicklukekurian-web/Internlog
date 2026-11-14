'use strict';
// escapeHtml lives in browser code (public/app.js), which is not a module and needs a DOM
// (it serializes through a <div>). This loads the real file into jsdom and tests the real function.
const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');

function loadEscapeHtml() {
  for (const file of fs.readdirSync(PUBLIC_DIR).filter((f) => f.endsWith('.js'))) {
    const dom = new JSDOM('<!doctype html><html><body></body></html>', { runScripts: 'outside-only' });
    try { dom.window.eval(fs.readFileSync(path.join(PUBLIC_DIR, file), 'utf8')); }
    catch { /* page-specific top-level code may fail without the page's elements; declarations still load */ }
    if (typeof dom.window.escapeHtml === 'function') return { dom, escapeHtml: dom.window.escapeHtml, file };
  }
  return null;
}

describe('escapeHtml (wraps every user-controlled value before it goes into innerHTML)', () => {
  let dom; let escapeHtml; let render;
  before(() => {
    const found = loadEscapeHtml();
    assert.ok(found, 'escapeHtml was not found in any public/*.js file');
    ({ dom, escapeHtml } = found);
    // Render markup the way the pages do: assign to innerHTML, then inspect the resulting DOM.
    render = (html) => { const host = dom.window.document.createElement('div'); host.innerHTML = html; return host; };
  });

  const payloads = [
    '<script>alert(1)</script>',
    '<img src=x onerror=alert(1)>',
    '"><svg onload=alert(1)>',
    `x" onmouseover="alert(1)`,
    `x' onfocus='alert(1)`,
    '&lt;b&gt; already-encoded &amp;'
  ];

  test('in element content, hostile strings stay inert text (no elements are created)', () => {
    for (const p of payloads) {
      const host = render(`<p>${escapeHtml(p)}</p>`);
      assert.equal(host.querySelectorAll('*').length, 1, `payload created extra elements: ${p}`);
      assert.equal(host.querySelector('p').textContent, p, `text was altered: ${p}`);
    }
  });

  test('inside a double-quoted attribute, hostile strings cannot add attributes or break out', () => {
    // This is exactly how submit.html builds its company <datalist>: value="${escapeHtml(name)}"
    for (const p of payloads) {
      const host = render(`<option value="${escapeHtml(p)}"></option>`);
      const option = host.querySelector('option');
      assert.deepEqual(option.getAttributeNames(), ['value'], `extra attribute injected by: ${p}`);
      assert.equal(option.getAttribute('value'), p, `attribute value was altered: ${p}`);
      assert.equal(host.querySelectorAll('*').length, 1);
    }
  });

  test('inside a single-quoted attribute, hostile strings cannot add attributes either', () => {
    for (const p of payloads) {
      const host = render(`<option value='${escapeHtml(p)}'></option>`);
      const option = host.querySelector('option');
      assert.deepEqual(option.getAttributeNames(), ['value'], `extra attribute injected by: ${p}`);
      assert.equal(option.getAttribute('value'), p);
    }
  });

  test('null and undefined render as an empty string, numbers as digits', () => {
    assert.equal(escapeHtml(null), '');
    assert.equal(escapeHtml(undefined), '');
    assert.equal(escapeHtml(7), '7');
  });

  test('ordinary text passes through unchanged', () => {
    assert.equal(escapeHtml('Software Engineering Intern, Dallas'), 'Software Engineering Intern, Dallas');
  });
});
