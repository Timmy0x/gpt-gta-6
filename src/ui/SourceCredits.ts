export interface Credit { type: string; value: unknown; }
function safeLink(value: string) { try { const u = new URL(value); return u.protocol === 'https:' ? u.href : null; } catch { return null; } }
/** Preserve every attribution; never execute provider HTML or javascript links. */
export function renderCredits(container: HTMLElement, credits: Credit[]) {
  const seen = new Set<string>(); container.replaceChildren();
  for (const credit of credits) {
    if (typeof credit.value !== 'string' || !credit.value.trim()) continue;
    const key = `${credit.type}:${credit.value}`; if (seen.has(key)) continue; seen.add(key);
    const span = document.createElement('span');
    if (credit.type === 'image') {
      const src = safeLink(credit.value); if (!src) continue;
      const img = document.createElement('img'); img.src = src; img.alt = 'Data provider attribution'; img.referrerPolicy = 'no-referrer'; span.append(img);
    } else if (credit.type === 'html') {
      const doc = new DOMParser().parseFromString(credit.value, 'text/html');
      function copy(node: Node, to: Node) {
        if (node.nodeType === Node.TEXT_NODE) { to.appendChild(document.createTextNode(node.textContent ?? '')); return; }
        if (!(node instanceof Element)) return;
        if (['SCRIPT','STYLE','IFRAME','OBJECT','EMBED','SVG','MATH','FORM','INPUT'].includes(node.tagName)) return;
        if (node.tagName === 'IMG') {
          const src = safeLink(node.getAttribute('src') ?? ''); if (!src) return;
          const img = document.createElement('img'); img.src = src; img.alt = node.getAttribute('alt') || 'Data provider attribution'; img.referrerPolicy = 'no-referrer'; to.appendChild(img); return;
        }
        const href = node.tagName === 'A' ? safeLink(node.getAttribute('href') ?? '') : null;
        const target = href ? document.createElement('a') : document.createElement('span');
        if (href && target instanceof HTMLAnchorElement) { target.href = href; target.target = '_blank'; target.rel = 'noopener noreferrer'; }
        for (const child of node.childNodes) copy(child, target); to.appendChild(target);
      }
      for (const child of doc.body.childNodes) copy(child, span);
    } else span.textContent = credit.value;
    container.append(span);
  }
}
