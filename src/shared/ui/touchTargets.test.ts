import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';

/** Touch targets ≥ 44 pt (plan 20 §3, docs/accessibility.md): a Tamagui `Button` is `size="$4"`
 *  (44 dp), or `size="$3"` (36 dp) with `hitSlop` (8 dp each side). `$1` / `$2` are too small. No
 *  lint rule sees Tamagui sizes, so this scans the source: every `<Button>` imported from
 *  `tamagui` in a non-test `.tsx` file under `src/`. */

const SRC = path.resolve(__dirname, '../..');

function tsxFiles(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) tsxFiles(p, out);
    else if (p.endsWith('.tsx') && !p.endsWith('.test.tsx')) out.push(p);
  }
  return out;
}

function importsTamaguiButton(sf: ts.SourceFile): boolean {
  return sf.statements.some((s) => {
    if (!ts.isImportDeclaration(s) || !ts.isStringLiteral(s.moduleSpecifier)) return false;
    if (s.moduleSpecifier.text !== 'tamagui') return false;
    const nb = s.importClause?.namedBindings;
    return !!nb && ts.isNamedImports(nb) && nb.elements.some((el) => el.name.text === 'Button');
  });
}

/** One line per `<Button>` whose target is under 44 pt. */
function smallTargets(file: string, text = fs.readFileSync(file, 'utf8')): string[] {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  if (!importsTamaguiButton(sf)) return [];
  const problems: string[] = [];
  const visit = (n: ts.Node): void => {
    if (
      (ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) &&
      n.tagName.getText(sf) === 'Button'
    ) {
      const props = n.attributes.properties;
      // A spread may carry size / hitSlop; the owner of those props is checked where it is used.
      if (!props.some(ts.isJsxSpreadAttribute)) {
        const attr = (name: string) =>
          props.find(
            (p): p is ts.JsxAttribute => ts.isJsxAttribute(p) && p.name.getText(sf) === name,
          );
        const size = attr('size')?.initializer;
        const sizeText = size && ts.isStringLiteral(size) ? size.text : null;
        const line = sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
        const where = `${path.relative(SRC, file).replace(/\\/g, '/')}:${line}`;
        if (sizeText === '$1' || sizeText === '$2') problems.push(`${where} size="${sizeText}"`);
        else if (sizeText === '$3' && !attr('hitSlop'))
          problems.push(`${where} size="$3" without hitSlop`);
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return problems;
}

describe('touch targets', () => {
  it('every Tamagui Button is size $4, or size $3 with hitSlop', () => {
    const problems = tsxFiles(SRC).flatMap((f) => smallTargets(f));
    expect(problems).toEqual([]);
  });

  it('flags a small button', () => {
    const problems = smallTargets(
      path.join(SRC, 'X.tsx'),
      [
        "import { Button } from 'tamagui';",
        'export const A = () => <Button size="$2">a</Button>;',
        'export const B = () => <Button size="$3">b</Button>;',
        'export const C = () => <Button size="$3" hitSlop={8}>c</Button>;',
        'export const D = () => <Button size="$4">d</Button>;',
      ].join('\n'),
    );
    expect(problems).toHaveLength(2);
    expect(problems[0]).toMatch(/size="\$2"$/);
    expect(problems[1]).toMatch(/size="\$3" without hitSlop$/);
  });
});
