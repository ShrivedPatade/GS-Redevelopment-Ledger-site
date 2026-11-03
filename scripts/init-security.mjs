import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import Papa from 'papaparse';

const SECRET_HEX = process.env.LEDGER_SECRET_KEY || '';
const masterKey = SECRET_HEX.length === 64
  ? Buffer.from(SECRET_HEX, 'hex')
  : crypto.createHash('sha256').update(SECRET_HEX || 'DEV_FALLBACK_SECRET_2026').digest();

function hashPin(pin) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(String(pin), salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

function random6DigitPin() {
  return String(crypto.randomInt(100000, 999999));
}

function getFloorLabel(n) {
  if (n === 0) return 'Ground Floor (0)';
  if (n === 1) return '1st Floor (1)';
  if (n === 2) return '2nd Floor (2)';
  if (n === 3) return '3rd Floor (3)';
  return '4th Floor (4)';
}

// 1. Read CSV
const csvPath = path.join(process.cwd(), 'data', 'ledger.csv');
const csvContent = fs.readFileSync(csvPath, 'utf8');
const { data: rows } = Papa.parse(csvContent, { header: true, skipEmptyLines: true });

const authHashes = {};
const pinDistributionList = [];
const records = [];

// 2. Generate 6-digit PINs for Builder & Committee
const builderPin = random6DigitPin();
const committeePin = random6DigitPin();
authHashes['ROLE_BUILDER'] = hashPin(builderPin);
authHashes['ROLE_COMMITTEE'] = hashPin(committeePin);

pinDistributionList.push(`=== ADMIN CREDENTIALS ===`);
pinDistributionList.push(`BUILDER 6-DIGIT PIN   : ${builderPin}`);
pinDistributionList.push(`COMMITTEE 6-DIGIT PIN : ${committeePin}`);
pinDistributionList.push(`\n=== FLAT OWNER 6-DIGIT PINS ===`);

// 3. Process all 24 flats
for (const r of rows) {
  const id = `${r.wing}-${r.flat_no}`;
  const pin = random6DigitPin();
  authHashes[id] = hashPin(pin);
  pinDistributionList.push(`${id.padEnd(6)} | ${r.owner_name.padEnd(25)} | PIN: ${pin}`);

  const floorNum = parseInt(r.floor, 10);
  const payments = [];
  let i = 1;
  while (r[`m${i}_name`]) {
    const status = r[`m${i}_status`]?.toUpperCase() === 'PAID' ? 'PAID' : 'PENDING';
    payments.push({
      name: r[`m${i}_name`],
      amount: Number(r[`m${i}_amt`]) || 0,
      status,
      mode: r[`m${i}_mode`] || (status === 'PAID' ? 'CHEQUE' : ''),
      chequeNo: r[`m${i}_cheque`] || '',
    });
    i++;
  }

  const paid = payments.filter((p) => p.status === 'PAID').reduce((s, p) => s + p.amount, 0);
  const toPay = payments.filter((p) => p.status === 'PENDING').reduce((s, p) => s + p.amount, 0);

  records.push({
    id,
    wing: r.wing,
    floor: floorNum,
    floorLabel: getFloorLabel(floorNum),
    flat_no: r.flat_no,
    owner_name: r.owner_name,
    payments,
    paid,
    toPay,
  });
}

// 4. Encrypt ledger records with AES-256-GCM
const iv = crypto.randomBytes(12);
const cipher = crypto.createCipheriv('aes-256-gcm', masterKey, iv);
const encrypted = Buffer.concat([cipher.update(JSON.stringify(records), 'utf8'), cipher.final()]);
const authTag = cipher.getAuthTag();
const encryptedPayload = `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;

// 5. Save outputs
fs.writeFileSync(path.join(process.cwd(), 'data', 'auth-hashes.json'), JSON.stringify(authHashes, null, 2));
fs.writeFileSync(path.join(process.cwd(), 'data', 'ledger.enc'), encryptedPayload);
fs.writeFileSync(path.join(process.cwd(), 'PRIVATE_PINS.txt'), pinDistributionList.join('\n'));

console.log('✅ Generated data/auth-hashes.json, data/ledger.enc, and PRIVATE_PINS.txt');