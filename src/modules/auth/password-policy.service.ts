import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import * as crypto from 'node:crypto';
// zxcvbn é CommonJS puro · `import x from 'zxcvbn'` quebra em prod sem esModuleInterop:true.
// require() funciona consistente entre dev/prod sem mexer em tsconfig global.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const zxcvbn = require('zxcvbn') as (
  password: string,
  userInputs?: string[],
) => { score: number; feedback: { warning: string; suggestions: string[] } };

/**
 * Cyber Onda 1 · S1.7 · Política de senhas.
 *
 * Regras:
 *   - mínimo 10 caracteres
 *   - score zxcvbn ≥ 3 (de 0-4 · "safely unguessable" · ~10^10 guesses)
 *   - bloqueia top-N senhas vazadas via HIBP Pwned Passwords API (k-anonymity)
 *
 * HIBP é opcional (pode dar timeout · não bloqueante por padrão · `strictHibp`
 * vira true quando quiser exigir 100% online check).
 */
@Injectable()
export class PasswordPolicyService {
  private readonly logger = new Logger(PasswordPolicyService.name);
  private readonly MIN_LEN = 10;
  private readonly MIN_ZXCVBN = 3;
  private readonly HIBP_TIMEOUT_MS = 1500;

  /**
   * Valida a senha. Lança BadRequestException com mensagem clara se inválida.
   * @param userInputs nome/email/etc do user pra penalizar uso de info pessoal
   */
  async assertStrong(
    password: string,
    userInputs: string[] = [],
    strictHibp = false,
  ): Promise<void> {
    if (typeof password !== 'string' || password.length < this.MIN_LEN) {
      throw new BadRequestException(
        `Senha precisa ter no mínimo ${this.MIN_LEN} caracteres.`,
      );
    }

    const result = zxcvbn(password, userInputs);
    if (result.score < this.MIN_ZXCVBN) {
      const sugestoes = (result.feedback?.suggestions ?? []).join(' · ');
      const aviso =
        result.feedback?.warning ||
        'Senha previsível · use uma frase longa com palavras aleatórias';
      throw new BadRequestException(
        `Senha fraca · ${aviso}${sugestoes ? ' · ' + sugestoes : ''}`,
      );
    }

    const breached = await this.isPwned(password);
    if (breached === true) {
      throw new BadRequestException(
        'Essa senha apareceu em vazamentos públicos · escolha outra que você nunca tenha usado em outros sites.',
      );
    }
    if (breached === null && strictHibp) {
      throw new BadRequestException(
        'Não foi possível validar a senha contra base de vazamentos · tente novamente em alguns segundos.',
      );
    }
  }

  /**
   * Consulta HIBP Pwned Passwords via k-anonymity (envia só os primeiros
   * 5 chars do SHA1 · resposta lista todos os sufixos com contagem).
   *
   * Retorna:
   *   true · senha vazou
   *   false · não vazou (ou pouco vazada · menos de threshold)
   *   null · não conseguiu consultar (timeout/rede)
   */
  private async isPwned(password: string): Promise<boolean | null> {
    try {
      const sha1 = crypto
        .createHash('sha1')
        .update(password)
        .digest('hex')
        .toUpperCase();
      const prefix = sha1.slice(0, 5);
      const suffix = sha1.slice(5);

      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), this.HIBP_TIMEOUT_MS);
      const res = await fetch(
        `https://api.pwnedpasswords.com/range/${prefix}`,
        { signal: ctrl.signal, headers: { 'Add-Padding': 'true' } },
      ).catch(() => null);
      clearTimeout(t);
      if (!res || !res.ok) return null;

      const text = await res.text();
      const lines = text.split('\n');
      for (const line of lines) {
        const [s, n] = line.trim().split(':');
        if (!s) continue;
        if (s === suffix) {
          const count = parseInt(n || '0', 10);
          // count > 0 = aparece em algum vazamento
          return count > 0;
        }
      }
      return false;
    } catch (err) {
      this.logger.warn(`HIBP check falhou: ${(err as Error).message}`);
      return null;
    }
  }
}
