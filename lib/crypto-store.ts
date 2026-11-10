import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { Redis } from '@upstash/redis';
import { FlatRecord } from '@/types/ledger';

const SECRET_HEX = process.env.LEDGER_SECRET_KEY || '';
const REDIS_KEY = 'society_ledger_enc_v2';

// Supports both standard Upstash env vars and Vercel KV Marketplace env vars
const redisUrl = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

const redis = redisUrl && redisToken
  ? new Redis({ url: redisUrl, token: redisToken })
  : null;

function getMasterKey(): Buffer {
  if (SECRET_HEX && SECRET_HEX.length === 64) {
    return Buffer.from(SECRET_HEX, 'hex');
  }
  return crypto.createHash('sha256').update(SECRET_HEX || 'DEV_FALLBACK_SECRET_2026').digest();
}

export function hashPin(pin: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derivedKey = crypto.scryptSync(pin, salt, 64).toString('hex');
  return `${salt}:${derivedKey}`;
}

export function verifyPin(pin: string, storedHash: string): boolean {
  const [salt, keyHex] = storedHash.split(':');
  if (!salt || !keyHex) return false;
  const keyBuffer = Buffer.from(keyHex, 'hex');
  const derivedBuffer = crypto.scryptSync(pin, salt, 64);
  return crypto.timingSafeEqual(keyBuffer, derivedBuffer);
}

export function encryptLedger(records: FlatRecord[]): string {
  const iv = crypto.randomBytes(12);
  const key = getMasterKey();
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

  const plaintext = JSON.stringify(records);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

export function decryptLedger(payload: string): FlatRecord[] {
  const [ivHex, authTagHex, encryptedHex] = payload.trim().split(':');
  const key = getMasterKey();
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    key,
    Buffer.from(ivHex, 'hex')
  );
  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));

  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encryptedHex, 'hex')),
    decipher.final(),
  ]);
  return JSON.parse(decrypted.toString('utf8'));
}

const ENC_FILE_PATH = path.join(process.cwd(), 'data', 'ledger.enc');
const AUTH_FILE_PATH = path.join(process.cwd(), 'data', 'auth-hashes.json');

export async function readEncryptedLedger(): Promise<FlatRecord[]> {
  // 1. If Upstash Redis is connected, read from cloud
  if (redis) {
    let cloudPayload = await redis.get<string>(REDIS_KEY);

    // Auto-seed Redis from local data/ledger.enc on first run
    if (!cloudPayload) {
      cloudPayload = fs.readFileSync(ENC_FILE_PATH, 'utf8').trim();
      await redis.set(REDIS_KEY, cloudPayload);
    }

    return decryptLedger(cloudPayload);
  }

  // 2. Fallback for local development without Redis
  const localPayload = fs.readFileSync(ENC_FILE_PATH, 'utf8');
  return decryptLedger(localPayload);
}

export async function writeEncryptedLedger(records: FlatRecord[]): Promise<void> {
  const payload = encryptLedger(records);

  // 1. Save to Upstash Redis in cloud
  if (redis) {
    await redis.set(REDIS_KEY, payload);
    return;
  }

  // 2. Save to local disk in local development
  fs.writeFileSync(ENC_FILE_PATH, payload, 'utf8');
}

export function readAuthHashes(): Record<string, string> {
  const raw = fs.readFileSync(AUTH_FILE_PATH, 'utf8');
  return JSON.parse(raw);
}