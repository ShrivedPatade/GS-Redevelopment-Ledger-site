import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import Papa from 'papaparse';

const SECRET_HEX = process.env.LEDGER_SECRET_KEY || '';
const masterKey =
  SECRET_HEX.length === 64
    ? Buffer.from(SECRET_HEX, 'hex')
    : crypto.createHash('sha256').update(SECRET_HEX || 'DEV_FALLBACK_SECRET_2026').digest();

function getFloorLabel(n) {
  if (n === 0) return 'Ground Floor (0)';
  if (n === 1) return '1st Floor (1)';
  if (n === 2) return '2nd Floor (2)';
  if (n === 3) return '3rd Floor (3)';
  return '4th Floor (4)';
}

const csvPath = path.join(process.cwd(), 'data', 'ledger.csv');
const encPath = path.join(process.cwd(), 'data', 'ledger.enc');

const csvContent = fs.readFileSync(csvPath, 'utf8').replace(/^\uFEFF/, '');
const { data: rows } = Papa.parse(csvContent, { header: true, skipEmptyLines: true });

const records = [];

for (const r of rows) {
  const id = `${r.wing.trim()}-${r.flat_no.trim()}`;
  const floorNum = parseInt(r.floor, 10);
  const payments = [];

  let i = 1;
  while (r[`m${i}_name`]) {
    const rawStatus = r[`m${i}_status`]?.trim().toUpperCase();
    const status =
      rawStatus === 'PAID'
        ? 'PAID'
        : rawStatus === 'PARTIALLY_PAID'
        ? 'PARTIALLY_PAID'
        : 'PENDING';
    const stageAmount = Number(r[`m${i}_amt`]) || 0;

    // Seed an initial payment entry if the CSV stage was marked PAID
    const paymentInfo =
      status === 'PAID'
        ? [
            {
              mode: 'CHEQUE',
              chequeNo: '',
              date: '',
              amount: stageAmount,
            },
          ]
        : [];

    const amountPaid = paymentInfo.reduce((sum, entry) => sum + (Number(entry.amount) || 0), 0);

    payments.push({
      name: r[`m${i}_name`].trim(),
      amount: stageAmount,
      amountPaid,
      status,
      paymentInfo,
      remark: r[`m${i}_remark`]?.trim() || '',
    });
    i++;
  }

  const paid = payments.reduce((s, p) => s + p.amountPaid, 0);
  const toPay = payments.reduce((s, p) => s + Math.max(0, p.amount - p.amountPaid), 0);

  records.push({
    id,
    wing: r.wing.trim(),
    floor: floorNum,
    floorLabel: getFloorLabel(floorNum),
    flat_no: r.flat_no.trim(),
    owner_name: r.owner_name.trim(),
    payments,
    paid,
    toPay,
  });
}

const iv = crypto.randomBytes(12);
const cipher = crypto.createCipheriv('aes-256-gcm', masterKey, iv);
const encrypted = Buffer.concat([cipher.update(JSON.stringify(records), 'utf8'), cipher.final()]);
const authTag = cipher.getAuthTag();
const encryptedPayload = `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;

fs.writeFileSync(encPath, encryptedPayload, 'utf8');
console.log('✅ Encrypted data/ledger.csv -> data/ledger.enc (PINs untouched)');