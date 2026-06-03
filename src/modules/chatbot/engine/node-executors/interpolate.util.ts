/** Substitui {{variavel}} pelos valores da sessão. Mantém {{x}} literal se faltar. */
export function interpolate(template: string, variables: Record<string, any>): string {
  return (template || '').replace(/\{\{(\w+)\}\}/g, (_, key) =>
    variables[key] ?? `{{${key}}}`,
  );
}
