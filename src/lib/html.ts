// Escapes HTML y helpers de atributos para las vistas SSR.

export function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Escapa para atributo de URL (href/src). */
export function escUrl(s: string): string {
  return esc(s).replace(/`/g, '%60');
}
