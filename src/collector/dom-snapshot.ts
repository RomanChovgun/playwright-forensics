export interface DomNode {
  tag: string;
  id?: string;
  className?: string;
  text?: string;
  attributes: Record<string, string>;
  children: DomNode[];
  visible: boolean;
  shadowRoot?: boolean;
  booleanAttrs?: string[];
}

export function collectDomSnapshot(): DomNode {
  const serialize = (node: Element, inShadow: boolean = false): DomNode => {
    const result: DomNode = {
      tag: node.tagName.toLowerCase(),
      id: node.id || undefined,
      className: node.className || undefined,
      text: node.textContent?.trim().slice(0, 500) || undefined,
      attributes: Object.fromEntries(
        Array.from(node.attributes).map(a => [a.name, a.value])
      ),
      children: Array.from(node.children).map(child => serialize(child as Element, false)),
      visible: node.checkVisibility(),
      shadowRoot: inShadow || undefined,
    };

    const bools: string[] = [];
    for (const attr of ['disabled', 'checked', 'readonly', 'required', 'hidden', 'selected', 'multiple', 'open']) {
      if (node.hasAttribute(attr)) bools.push(attr);
    }
    if (bools.length > 0) result.booleanAttrs = bools;

    if (node.shadowRoot && node.shadowRoot.mode === 'open') {
      for (const child of Array.from(node.shadowRoot.children)) {
        result.children.push(serialize(child as Element, true));
      }
    }

    return result;
  };

  return serialize(document.documentElement);
}
