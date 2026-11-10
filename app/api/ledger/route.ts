import { NextRequest, NextResponse } from 'next/server';
import {
  readEncryptedLedger,
  writeEncryptedLedger,
  readAuthHashes,
  verifyPin,
} from '@/lib/crypto-store';
import { FlatRecord, PaymentMilestone, PaymentEntry, MilestoneStatus } from '@/types/ledger';

// Ensures backwards compatibility if existing Redis records lack paymentInfo or remark
function normalizeRecord(record: FlatRecord): FlatRecord {
  if (!record.payments) return record;

  const normalizedPayments: PaymentMilestone[] = record.payments.map((p) => {
    const rawAny = p as unknown as Record<string, unknown>;
    let paymentInfo: PaymentEntry[] = Array.isArray(p.paymentInfo) ? p.paymentInfo : [];

    // Migrate old single-payment fields if paymentInfo wasn't initialized yet
    if (!Array.isArray(p.paymentInfo) && p.status === 'PAID') {
      paymentInfo = [
        {
          mode: rawAny.mode === 'CHEQUE' ? 'CHEQUE' : 'CASH',
          chequeNo: String(rawAny.chequeNo || ''),
          date: String(rawAny.paymentDate || ''),
          amount: Number(p.amount) || 0,
        },
      ];
    }

    const amountPaid = paymentInfo.reduce((sum, item) => sum + (Number(item.amount) || 0), 0);

    return {
      name: p.name,
      amount: Number(p.amount) || 0,
      amountPaid,
      status:
        p.status === 'PAID' || p.status === 'PARTIALLY_PAID' ? p.status : 'PENDING',
      paymentInfo,
      remark: String(p.remark || ''),
    };
  });

  const paid = normalizedPayments.reduce((sum, p) => sum + p.amountPaid, 0);
  const toPay = normalizedPayments.reduce(
    (sum, p) => sum + Math.max(0, p.amount - p.amountPaid),
    0
  );

  return {
    ...record,
    payments: normalizedPayments,
    paid,
    toPay,
  };
}

export async function POST(req: NextRequest) {
  try {
    const { authType, wing, flatNo, password } = await req.json();
    const rawRecords = await readEncryptedLedger();
    const records = rawRecords.map(normalizeRecord);
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

    const rawRecords = await readEncryptedLedger();
    const records = rawRecords.map(normalizeRecord);
    const targetIndex = records.findIndex((r) => r.id === flatId);
    if (targetIndex === -1) {
      return NextResponse.json({ error: 'Flat not found' }, { status: 404 });
    }

    const sanitizedPayments: PaymentMilestone[] = payments.map((p) => {
      const cleanEntries: PaymentEntry[] = (p.paymentInfo || []).map((entry) => ({
        mode: entry.mode === 'CHEQUE' ? 'CHEQUE' : 'CASH',
        chequeNo: entry.mode === 'CHEQUE' ? (entry.chequeNo || '').trim() : '',
        date: (entry.date || '').trim(),
        amount: Math.max(0, Number(entry.amount) || 0),
      }));

      const amountPaid = cleanEntries.reduce((sum, item) => sum + item.amount, 0);
      const validStatus: MilestoneStatus =
        p.status === 'PAID' || p.status === 'PARTIALLY_PAID' ? p.status : 'PENDING';

      return {
        name: p.name,
        amount: Math.max(0, Number(p.amount) || 0),
        amountPaid,
        status: validStatus,
        paymentInfo: cleanEntries,
        remark: (p.remark || '').trim(),
      };
    });

    const paid = sanitizedPayments.reduce((sum, p) => sum + p.amountPaid, 0);
    const toPay = sanitizedPayments.reduce(
      (sum, p) => sum + Math.max(0, p.amount - p.amountPaid),
      0
    );

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