import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import Papa from 'papaparse';

function hashPin(pin) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(String(pin), salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

function random6DigitPin() {
  return String(crypto.randomInt(100000, 999999));
}

const csvPath = path.join(process.cwd(), 'data', 'ledger.csv');
const authPath = path.join(process.cwd(), 'data', 'auth-hashes.json');
const pinsTxtPath = path.join(process.cwd(), 'PRIVATE_PINS.txt');

const targetArg = process.argv[2]; // "--all", "A-001", "ROLE_COMMITTEE", "ROLE_BUILDER"

if (!targetArg) {
  console.log('Usage:');
  console.log('  node scripts/generate-pins.mjs --all           (Regenerates all PINs)');
  console.log('  node scripts/generate-pins.mjs A-001           (Resets PIN for flat A-001 only)');
  console.log('  node scripts/generate-pins.mjs ROLE_COMMITTEE  (Resets Committee PIN only)');
  process.exit(1);
}

const csvContent = fs.readFileSync(csvPath, 'utf8').replace(/^\uFEFF/, '');
const { data: rows } = Papa.parse(csvContent, { header: true, skipEmptyLines: true });

if (targetArg !== '--all') {
  if (!fs.existsSync(authPath)) {
    console.error('❌ data/auth-hashes.json not found. Run with --all first.');
    process.exit(1);
  }
  const authHashes = JSON.parse(fs.readFileSync(authPath, 'utf8'));
  const newPin = random6DigitPin();
  authHashes[targetArg] = hashPin(newPin);
  fs.writeFileSync(authPath, JSON.stringify(authHashes, null, 2), 'utf8');
  console.log(`✅ Reset PIN for [${targetArg}] -> New 6-Digit PIN: ${newPin}`);
  process.exit(0);
}

const authHashes = {};
const pinDistributionList = [];

const builderPin = random6DigitPin();
const committeePin = random6DigitPin();
authHashes['ROLE_BUILDER'] = hashPin(builderPin);
authHashes['ROLE_COMMITTEE'] = hashPin(committeePin);

pinDistributionList.push(`=== ADMIN CREDENTIALS ===`);
pinDistributionList.push(`BUILDER 6-DIGIT PIN   : ${builderPin}`);
pinDistributionList.push(`COMMITTEE 6-DIGIT PIN : ${committeePin}`);
pinDistributionList.push(`\n=== FLAT OWNER 6-DIGIT PINS ===`);

for (const r of rows) {
  const id = `${r.wing.trim()}-${r.flat_no.trim()}`;
  const pin = random6DigitPin();
  authHashes[id] = hashPin(pin);
  pinDistributionList.push(`${id.padEnd(6)} | ${r.owner_name.trim().padEnd(25)} | PIN: ${pin}`);
}

fs.writeFileSync(authPath, JSON.stringify(authHashes, null, 2), 'utf8');
fs.writeFileSync(pinsTxtPath, pinDistributionList.join('\n'), 'utf8');
console.log('✅ Generated PINs in PRIVATE_PINS.txt and saved hashes to data/auth-hashes.json');