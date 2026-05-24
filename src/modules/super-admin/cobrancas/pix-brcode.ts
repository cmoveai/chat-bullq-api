// Gerador de BR Code Pix estático (EMV · padrão BACEN). Não depende de API
// de banco — monta o copia-e-cola/QR a partir da chave + valor. Quando a
// API Pix do Itaú (Recebimentos) for liberada, o EMV passa a vir dela
// (cobrança dinâmica com txid + webhook de confirmação).
function emv(id: string, value: string): string {
  const len = String(value.length).padStart(2, '0');
  return `${id}${len}${value}`;
}

function crc16(payload: string): string {
  let crc = 0xffff;
  for (let i = 0; i < payload.length; i++) {
    crc ^= payload.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      crc = crc & 0x8000 ? (crc << 1) ^ 0x1021 : crc << 1;
      crc &= 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

function sanitize(text: string, max: number): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9 ]/g, '')
    .toUpperCase()
    .slice(0, max)
    .trim();
}

export function buildStaticPixBRCode(opts: {
  pixKey: string;
  amount?: number;
  merchantName: string;
  merchantCity: string;
  txid?: string;
}): string {
  const key = String(opts.pixKey).replace(/[.\-/\s]/g, '');
  const mai = emv('26', emv('00', 'br.gov.bcb.pix') + emv('01', key));
  const additional = emv('62', emv('05', (opts.txid || '***').slice(0, 25)));
  let payload =
    emv('00', '01') +
    mai +
    emv('52', '0000') +
    emv('53', '986') +
    (opts.amount != null ? emv('54', Number(opts.amount).toFixed(2)) : '') +
    emv('58', 'BR') +
    emv('59', sanitize(opts.merchantName, 25)) +
    emv('60', sanitize(opts.merchantCity, 15)) +
    additional;
  payload += '6304';
  return payload + crc16(payload);
}
