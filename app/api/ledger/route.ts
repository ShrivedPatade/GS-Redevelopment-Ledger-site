import { NextRequest, NextResponse } from 'next/server';
import {
  readEncryptedLedger,
  writeEncryptedLedger,
  readAuthHashes,
  verifyPin,
} from '@/lib/crypto-store';
import { FlatRecord, PaymentMilestone } from '@/types/ledger';

export async function POST(req: NextRequest) {
  try {
    const { authType, wing, flatNo, password } = await req.json();
    const records = await readEncryptedLedger();
    const hashes = readAuthHashes();
    const cleanPin = String(password || '').trim();

    if (authType === 'ADMIN') {
      if (hashes['ROLE_BUILDER'] && verifyPin(cleanPin, hashes['ROLE_BUILDER'])) {
        return NextResponse.json({ status: 'OK', role: 'Builder', records });
      }
      if (hashes['ROLE_COMMITTEE'] && verifyPin(cleanPin, hashes['ROLE_COMMITTEE'])) {
        return NextResponse.json({ status: 'OK', role: 'Committee', records });
      }
      return NextResponse.json({ error: 'Invalid 6-digit Builder/Committee PIN' }, { status: 401 });
    }

    if (authType === 'OWNER') {
      const flatId = `${wing}-${flatNo}`;
      const storedHash = hashes[flatId];
      if (!storedHash || !verifyPin(cleanPin, storedHash)) {
        return NextResponse.json(
          { error: `Invalid 6-digit PIN for Wing ${wing} Flat ${flatNo}` },
          { status: 401 }
        );
      }

      const matched = records.find((r) => r.id === flatId);
      if (!matched) {
        return NextResponse.json({ error: 'Flat record not found' }, { status: 404 });
      }

      return NextResponse.json({
        status: 'OK',
        role: 'Owner',
        records: [matched],
      });
    }

    const masked: FlatRecord[] = records.map((r) => ({
      ...r,
      payments: null,
      paid: null,
      toPay: null,
    }));

    return NextResponse.json({ status: 'OK', records: masked });
  } catch {
    return NextResponse.json({ error: 'Failed to read encrypted ledger' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const { adminPin, flatId, payments } = (await req.json()) as {
      adminPin: string;
      flatId: string;
      payments: PaymentMilestone[];
    };

    const hashes = readAuthHashes();
    const cleanPin = String(adminPin || '').trim();

    if (!hashes['ROLE_COMMITTEE'] || !verifyPin(cleanPin, hashes['ROLE_COMMITTEE'])) {
      return NextResponse.json(
        { error: 'Unauthorized: Only Committee can modify payment records' },
        { status: 403 }
      );
    }

    const records = await readEncryptedLedger();
    const targetIndex = records.findIndex((r) => r.id === flatId);
    if (targetIndex === -1) {
      return NextResponse.json({ error: 'Flat not found' }, { status: 404 });
    }

    const sanitizedPayments: PaymentMilestone[] = payments.map((p) => ({
      name: p.name,
      amount: Number(p.amount) || 0,
      status: p.status === 'PAID' ? 'PAID' : 'PENDING',
      mode: p.status === 'PAID' ? p.mode : '',
      chequeNo: p.status === 'PAID' && p.mode === 'CHEQUE' ? (p.chequeNo || '').trim() : '',
    }));

    const paid = sanitizedPayments
      .filter((p) => p.status === 'PAID')
      .reduce((sum, p) => sum + p.amount, 0);
    const toPay = sanitizedPayments
      .filter((p) => p.status === 'PENDING')
      .reduce((sum, p) => sum + p.amount, 0);

    records[targetIndex] = {
      ...records[targetIndex],
      payments: sanitizedPayments,
      paid,
      toPay,
    };

    await writeEncryptedLedger(records);

    return NextResponse.json({
      status: 'OK',
      updatedFlat: records[targetIndex],
      records,
    });
  } catch {
    return NextResponse.json({ error: 'Failed to update encrypted ledger' }, { status: 500 });
  }
}