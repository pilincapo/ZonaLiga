import { describe, expect, it } from 'vitest';
import { hashPanelPassword, verifyPanelPassword } from '../src/lib/users.ts';

describe('contraseñas de los usuarios del panel', () => {
  it('guarda la contraseña cifrada, nunca en claro', async () => {
    const stored = await hashPanelPassword('una-clave-buena-2026');
    expect(stored.startsWith('pbkdf2:')).toBe(true);
    expect(stored).not.toContain('una-clave-buena-2026');
    expect(stored.split(':')).toHaveLength(4);
  });

  it('la contraseña correcta verifica y la equivocada no', async () => {
    const stored = await hashPanelPassword('clave-de-prueba');
    expect(await verifyPanelPassword('clave-de-prueba', stored)).toBe(true);
    expect(await verifyPanelPassword('clave-de-prueba-2', stored)).toBe(false);
    expect(await verifyPanelPassword('', stored)).toBe(false);
  });

  it('dos hash de la misma contraseña no son iguales (sal distinta)', async () => {
    const a = await hashPanelPassword('misma-clave');
    const b = await hashPanelPassword('misma-clave');
    expect(a).not.toBe(b);
    expect(await verifyPanelPassword('misma-clave', a)).toBe(true);
    expect(await verifyPanelPassword('misma-clave', b)).toBe(true);
  });

  it('un hash corrupto se rechaza en vez de romper el login', async () => {
    expect(await verifyPanelPassword('x', 'no-es-un-hash')).toBe(false);
    expect(await verifyPanelPassword('x', 'pbkdf2:abc:def:ghi')).toBe(false);
    expect(await verifyPanelPassword('x', 'sha1:1:aaaa:bbbb')).toBe(false);
  });
});
