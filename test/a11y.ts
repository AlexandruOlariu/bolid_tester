/** Accessibility checks for component tests (plan 20, docs/accessibility.md). `jest-expo` has no
 *  `toBeAccessible`, so this walks the rendered tree itself:
 *
 *  - every element with an `onPress` handler has an accessible name — its `accessibilityLabel`
 *    (or `aria-label`), else the text inside it. An icon-only button without a label fails;
 *  - and a role (`button`, `radio`, `switch`, `link`, …) on itself or the native view it renders,
 *    so a pressable card or row is announced as something you can activate;
 *  - and is one accessibility element (`accessible`), so the screen reader focuses the control,
 *    not the text inside it (every Tamagui `Button` gets it from the config's `defaultProps`);
 *  - every text input has an `accessibilityLabel` (a placeholder is not a name: it disappears once
 *    the field has text, and TalkBack reads it only as a hint);
 *  - every switch / radio / checkbox reports its `checked` state.
 *
 *  `a11yProblems(root)` returns one plain-English line per problem, so a failing test prints which
 *  control is unnamed and where it sits. */
/** The part of react-test-renderer's `ReactTestInstance` the walker reads (the package ships no
 *  types here); `screen.root` satisfies it. */
export interface A11yNode {
  type: unknown;
  props: Record<string, unknown>;
  children: (A11yNode | string)[];
  parent: A11yNode | null;
  findAll(predicate: (node: A11yNode) => boolean): A11yNode[];
}

type Node = A11yNode;

const labelOf = (node: Node): string | undefined => {
  const label = node.props.accessibilityLabel ?? node.props['aria-label'];
  return typeof label === 'string' && label.trim() !== '' ? label.trim() : undefined;
};

/** The text a screen reader would read inside `node`: string children, depth first. Subtrees hidden
 *  from accessibility are skipped. */
export function textContent(node: Node | string): string {
  if (typeof node === 'string') return node;
  if (node.props.accessibilityElementsHidden || node.props['aria-hidden'] === true) return '';
  if (node.props.importantForAccessibility === 'no-hide-descendants') return '';
  return node.children
    .map((c) => textContent(c))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** `accessibilityLabel`, else the text content (the name RN gives a button with a text child). */
export function accessibleName(node: Node): string {
  return labelOf(node) ?? textContent(node);
}

const roleOf = (node: Node): unknown => node.props.role ?? node.props.accessibilityRole;

/** The role a screen reader gets: set on the element, or on the first native view it renders
 *  (Tamagui's `Button` sets `role="button"` on its frame). */
function effectiveRole(node: Node): unknown {
  let n: Node | string | undefined = node;
  while (n && typeof n !== 'string') {
    const role = roleOf(n);
    if (role) return role;
    if (typeof n.type === 'string') return undefined;
    n = n.children[0];
  }
  return undefined;
}

/** Whether a screen reader can focus `node` as one element: `accessible` set on it or on the
 *  first native view it renders. A pressable that is not one is never focused on iOS, and on
 *  Android focus lands on the text inside it, which has no action. */
function isAccessibilityElement(node: Node): boolean {
  let n: Node | string | undefined = node;
  while (n && typeof n !== 'string') {
    if (n.props.accessible === true) return true;
    if (n.props.accessible === false) return false;
    if (typeof n.type === 'string') return false;
    n = n.children[0];
  }
  return false;
}

/** A short description of where `node` is: its component name, testID and the nearest ancestor
 *  that has a testID or a name. */
function describe(node: Node): string {
  const typeName = (n: Node) =>
    typeof n.type === 'string'
      ? n.type
      : ((n.type as { displayName?: string; name?: string }).displayName ??
        (n.type as { name?: string }).name ??
        'Component');
  let where = '';
  for (let p = node.parent; p; p = p.parent) {
    const id = p.props.testID;
    if (typeof id === 'string') {
      where = ` in testID="${id}"`;
      break;
    }
    const nearby = textContent(p);
    if (nearby) {
      where = ` near "${nearby.slice(0, 60)}"`;
      break;
    }
  }
  const id = typeof node.props.testID === 'string' ? ` testID="${node.props.testID}"` : '';
  return `<${typeName(node)}${id}>${where}`;
}

/** One entry per control. A pressable composite (`<Button onPress>`) passes `onPress` down through
 *  the wrapper components it is built from before it renders its native view, so those wrappers
 *  are the same control and only the outermost is checked. A pressable below a native view of
 *  another pressable is a separate control — an Edit button inside a pressable card, a delete
 *  button inside a row — and is checked on its own. */
function controls(nodes: Node[]): Node[] {
  const set = new Set(nodes);
  return nodes.filter((n) => {
    for (let p = n.parent; p; p = p.parent) {
      if (typeof p.type === 'string') return true;
      if (set.has(p)) return false;
    }
    return true;
  });
}

/** Roles sit on native views, and a Tamagui frame renders a native view whose first child is
 *  another native view carrying the same props. A role element reached from a role ancestor only
 *  through first children is that ancestor's own view; anything else (a switch inside a row) is a
 *  separate control. */
function roleControls(nodes: Node[]): Node[] {
  const set = new Set(nodes);
  return nodes.filter((n) => {
    for (let c: Node = n, p = n.parent; p; c = p, p = p.parent) {
      if (p.children[0] !== c) return true;
      if (set.has(p)) return false;
    }
    return true;
  });
}

export function a11yProblems(root: Node): string[] {
  const problems: string[] = [];

  const pressables = controls(root.findAll((n) => typeof n.props.onPress === 'function'));
  for (const p of pressables) {
    if (p.props.accessible === false) continue;
    if (accessibleName(p) === '') problems.push(`Pressable without a name: ${describe(p)}`);
    else if (!effectiveRole(p))
      problems.push(`Pressable "${accessibleName(p).slice(0, 50)}" without a role: ${describe(p)}`);
    else if (!isAccessibilityElement(p))
      problems.push(
        `Pressable "${accessibleName(p).slice(0, 50)}" is not an accessibility element (set accessible): ${describe(p)}`,
      );
  }

  const inputs = root.findAll((n) => n.type === 'TextInput');
  for (const input of inputs) {
    if (!labelOf(input) && !input.props['aria-labelledby'] && !input.props.accessibilityLabelledBy)
      problems.push(
        `Text input without accessibilityLabel (placeholder "${String(input.props.placeholder ?? '')}"): ${describe(input)}`,
      );
  }

  const toggles = roleControls(
    root.findAll((n) => {
      const role = roleOf(n);
      return role === 'switch' || role === 'radio' || role === 'checkbox';
    }),
  );
  for (const t of toggles) {
    const state = t.props.accessibilityState as
      | { checked?: unknown; selected?: unknown }
      | undefined;
    const checked = state?.checked ?? t.props['aria-checked'] ?? t.props['aria-selected'];
    if (checked === undefined)
      problems.push(`${String(roleOf(t))} without a checked state: ${describe(t)}`);
    if (accessibleName(t) === '')
      problems.push(`${String(roleOf(t))} without a name: ${describe(t)}`);
  }

  return problems;
}
