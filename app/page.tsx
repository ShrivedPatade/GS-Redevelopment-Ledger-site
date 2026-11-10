'use client';

import { useState, useEffect, FormEvent, Fragment } from 'react';
import {
  FlatRecord,
  UserRole,
  ApiResponse,
  PaymentMilestone,
  PaymentEntry,
  MilestoneStatus,
} from '@/types/ledger';

const FLOORS = [
  { num: 0, label: 'Ground Floor' },
  { num: 1, label: '1st Floor' },
  { num: 2, label: '2nd Floor' },
  { num: 3, label: '3rd Floor' },
  { num: 4, label: '4th Floor' },
];

function formatDisplayDate(isoDate?: string): string {
  if (!isoDate) return '—';
  const parts = isoDate.split('-');
  if (parts.length !== 3) return isoDate;
  return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

export default function Home() {
  const [records, setRecords] = useState<FlatRecord[]>([]);
  const [selectedFlat, setSelectedFlat] = useState<FlatRecord | null>(null);
  const [mobileWing, setMobileWing] = useState<'A' | 'B'>('A');

  // Auth & Session States
  const [role, setRole] = useState<UserRole>(null);
  const [adminPinSession, setAdminPinSession] = useState<string>('');
  const [unlockedFlats, setUnlockedFlats] = useState<Record<string, FlatRecord>>({});

  // Modal & Expandable Payment Info State
  const [draftPayments, setDraftPayments] = useState<PaymentMilestone[]>([]);
  const [expandedStages, setExpandedStages] = useState<Record<number, boolean>>({});
  const [isSaving, setIsSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState('');

  // Login Modal State
  const [modalOpen, setModalOpen] = useState(false);
  const [authType, setAuthType] = useState<'OWNER' | 'ADMIN'>('OWNER');
  const [targetFlat, setTargetFlat] = useState<FlatRecord | null>(null);
  const [passwordInput, setPasswordInput] = useState('');
  const [authError, setAuthError] = useState('');

  const loadData = async (authPayload?: {
    authType: 'OWNER' | 'ADMIN';
    wing?: string;
    flatNo?: string;
    password?: string;
  }) => {
    try {
      setAuthError('');
      const res = await fetch('/api/ledger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(authPayload || {}),
      });

      const data: ApiResponse = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to authenticate');

      if (authPayload?.authType === 'OWNER' && data.records?.[0]) {
        const flatData = data.records[0];
        setUnlockedFlats((prev) => ({ ...prev, [flatData.id]: flatData }));
        openFlatModal(flatData);
        closeModal();
      } else if (authPayload?.authType === 'ADMIN') {
        setRole(data.role || null);
        setAdminPinSession(authPayload.password || '');
        setRecords(data.records || []);
        closeModal();
      } else {
        setRecords(data.records || []);
      }
    } catch (err: unknown) {
      if (err instanceof Error) setAuthError(err.message);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const openFlatModal = (flat: FlatRecord) => {
    setSelectedFlat(flat);
    setSaveMessage('');
    setExpandedStages({});
    if (flat.payments) {
      setDraftPayments(
        flat.payments.map((p) => ({
          ...p,
          paymentInfo: (p.paymentInfo || []).map((entry) => ({ ...entry })),
          remark: p.remark || '',
        }))
      );
    }
  };

  const toggleStageExpand = (idx: number) => {
    setExpandedStages((prev) => ({ ...prev, [idx]: !prev[idx] }));
  };

  const handleFlatClick = (flat: FlatRecord) => {
    if (role === 'Builder' || role === 'Committee') {
      const activeRecord = records.find((r) => r.id === flat.id) || flat;
      openFlatModal(activeRecord);
      return;
    }

    if (unlockedFlats[flat.id]) {
      openFlatModal(unlockedFlats[flat.id]);
      return;
    }

    setTargetFlat(flat);
    setAuthType('OWNER');
    setPasswordInput('');
    setAuthError('');
    setModalOpen(true);
  };

  const handleAuthSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (authType === 'OWNER' && targetFlat) {
      loadData({
        authType: 'OWNER',
        wing: targetFlat.wing,
        flatNo: targetFlat.flat_no,
        password: passwordInput,
      });
    } else {
      loadData({ authType: 'ADMIN', password: passwordInput });
    }
  };

  const handleLogoutAdmin = () => {
    setRole(null);
    setAdminPinSession('');
    setSelectedFlat(null);
    loadData();
  };

  // Update Stage Top-Level Fields (Amount, Status, Remark)
  const handleStageFieldChange = (
    idx: number,
    field: 'amount' | 'status' | 'remark',
    value: string
  ) => {
    setSaveMessage('');
    setDraftPayments((prev) => {
      const updated = [...prev];
      const item = { ...updated[idx] };

      if (field === 'amount') {
        item.amount = Math.max(0, Number(value) || 0);
      } else if (field === 'status') {
        item.status = value as MilestoneStatus;
      } else if (field === 'remark') {
        item.remark = value;
      }

      updated[idx] = item;
      return updated;
    });
  };

  // Add a new payment row inside a stage's Payment Info list
  const handleAddPaymentEntry = (stageIdx: number) => {
    setSaveMessage('');
    setExpandedStages((prev) => ({ ...prev, [stageIdx]: true }));
    setDraftPayments((prev) => {
      const updated = [...prev];
      const stage = { ...updated[stageIdx] };
      const nextList: PaymentEntry[] = [
        ...(stage.paymentInfo || []),
        { mode: 'CASH', chequeNo: '', date: '', amount: 0 },
      ];
      stage.paymentInfo = nextList;
      stage.amountPaid = nextList.reduce((s, e) => s + (Number(e.amount) || 0), 0);
      updated[stageIdx] = stage;
      return updated;
    });
  };

  // Edit an individual payment entry inside a stage's Payment Info list
  const handlePaymentEntryChange = (
    stageIdx: number,
    entryIdx: number,
    field: keyof PaymentEntry,
    value: string
  ) => {
    setSaveMessage('');
    setDraftPayments((prev) => {
      const updated = [...prev];
      const stage = { ...updated[stageIdx] };
      const list = [...(stage.paymentInfo || [])];
      const entry = { ...list[entryIdx] };

      if (field === 'mode') {
        entry.mode = value === 'CHEQUE' ? 'CHEQUE' : 'CASH';
        if (entry.mode === 'CASH') entry.chequeNo = '';
      } else if (field === 'chequeNo') {
        entry.chequeNo = value;
      } else if (field === 'date') {
        entry.date = value;
      } else if (field === 'amount') {
        entry.amount = Math.max(0, Number(value) || 0);
      }

      list[entryIdx] = entry;
      stage.paymentInfo = list;
      stage.amountPaid = list.reduce((s, e) => s + (Number(e.amount) || 0), 0);
      updated[stageIdx] = stage;
      return updated;
    });
  };

  // Remove a payment entry from a stage's Payment Info list
  const handleRemovePaymentEntry = (stageIdx: number, entryIdx: number) => {
    setSaveMessage('');
    setDraftPayments((prev) => {
      const updated = [...prev];
      const stage = { ...updated[stageIdx] };
      const list = (stage.paymentInfo || []).filter((_, i) => i !== entryIdx);
      stage.paymentInfo = list;
      stage.amountPaid = list.reduce((s, e) => s + (Number(e.amount) || 0), 0);
      updated[stageIdx] = stage;
      return updated;
    });
  };

  const handleCommitteeSave = async () => {
    if (!selectedFlat || role !== 'Committee') return;
    setIsSaving(true);
    setSaveMessage('');

    try {
      const res = await fetch('/api/ledger', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          adminPin: adminPinSession,
          flatId: selectedFlat.id,
          payments: draftPayments,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save changes');

      setRecords(data.records);
      setSelectedFlat(data.updatedFlat);
      setDraftPayments(
        data.updatedFlat.payments.map((p: PaymentMilestone) => ({
          ...p,
          paymentInfo: (p.paymentInfo || []).map((e) => ({ ...e })),
          remark: p.remark || '',
        }))
      );
      setSaveMessage('✓ Changes saved & encrypted');
    } catch (err: unknown) {
      if (err instanceof Error) setSaveMessage(`Error: ${err.message}`);
    } finally {
      setIsSaving(false);
    }
  };

  const closeModal = () => {
    setModalOpen(false);
    setPasswordInput('');
    setAuthError('');
    setTargetFlat(null);
  };

  const isCommitteeEditor = role === 'Committee';

  const currentPaid = draftPayments.reduce((sum, p) => sum + (Number(p.amountPaid) || 0), 0);
  const currentToPay = draftPayments.reduce(
    (sum, p) => sum + Math.max(0, (Number(p.amount) || 0) - (Number(p.amountPaid) || 0)),
    0
  );

  const getStatusBadgeStyle = (status: MilestoneStatus) => {
    if (status === 'PAID') return 'bg-emerald-100 text-emerald-800 border-emerald-300';
    if (status === 'PARTIALLY_PAID') return 'bg-amber-100 text-amber-800 border-amber-300';
    return 'bg-rose-50 text-rose-700 border-rose-300';
  };

  const getStatusLabel = (status: MilestoneStatus) => {
    if (status === 'PAID') return 'Paid';
    if (status === 'PARTIALLY_PAID') return 'Partially Paid';
    return 'To be Paid';
  };

  const renderFlatCard = (flat: FlatRecord | undefined, gapKey: string) => {
    if (!flat) {
      return (
        <div
          key={gapKey}
          className="hidden md:flex h-[64px] rounded-xl border border-dashed border-slate-200 bg-slate-100/60 items-center justify-center text-xs text-slate-400 select-none italic"
        >
          — No Flat —
        </div>
      );
    }

    const isUnlocked = Boolean(unlockedFlats[flat.id] || role);

    return (
      <div
        key={flat.id}
        onClick={() => handleFlatClick(flat)}
        className={`min-h-[64px] px-4 py-3 rounded-xl border transition-all cursor-pointer flex items-center justify-between gap-3 shadow-sm ${
          isUnlocked
            ? 'bg-white border-indigo-200 hover:border-indigo-400 hover:shadow-md'
            : 'bg-white border-slate-200 hover:border-slate-300 hover:shadow'
        }`}
      >
        <div className="flex items-center gap-3 min-w-0">
          <span className="shrink-0 bg-slate-100 text-slate-800 font-bold text-xs px-2.5 py-1.5 rounded-lg border border-slate-200">
            {flat.flat_no}
          </span>
          <span className="text-sm sm:text-base font-medium text-slate-800 truncate">
            {flat.owner_name}
          </span>
        </div>

        <span
          className={`shrink-0 text-xs font-semibold px-2.5 py-1 rounded-full ${
            isUnlocked
              ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
              : 'bg-slate-100 text-slate-500'
          }`}
        >
          {isUnlocked ? 'View' : '🔒 Locked'}
        </span>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans antialiased">
      {/* Navbar */}
      <header className="bg-slate-900 text-white sticky top-0 z-30 shadow-md">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between gap-3">
          <div>
            <h1 className="text-base sm:text-xl font-bold tracking-tight">
              Redevelopment Payment Ledger
            </h1>
            <p className="text-[11px] sm:text-xs text-slate-400">
              Encrypted Member & Milestone Portal
            </p>
          </div>

          <div className="flex items-center gap-2">
            {role ? (
              <div className="flex items-center gap-2">
                <span className="bg-indigo-500/20 text-indigo-200 border border-indigo-400/30 px-2.5 py-1 rounded-lg text-xs font-semibold">
                  {role}
                </span>
                <button
                  onClick={handleLogoutAdmin}
                  className="bg-slate-800 hover:bg-slate-700 text-slate-200 px-3 py-1.5 rounded-lg text-xs font-medium border border-slate-700 transition-colors"
                >
                  Logout
                </button>
              </div>
            ) : (
              <button
                onClick={() => {
                  setAuthType('ADMIN');
                  setPasswordInput('');
                  setAuthError('');
                  setModalOpen(true);
                }}
                className="bg-indigo-600 hover:bg-indigo-500 text-white px-3.5 py-2 rounded-xl text-xs sm:text-sm font-semibold shadow-sm transition-colors"
              >
                Builder / Committee
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Main Grid */}
      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
        {/* Mobile Wing Switcher */}
        <div className="flex md:hidden bg-slate-200/80 p-1 rounded-xl mb-6">
          <button
            onClick={() => setMobileWing('A')}
            className={`flex-1 py-2 text-sm font-bold rounded-lg transition-all ${
              mobileWing === 'A' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
            }`}
          >
            Wing A
          </button>
          <button
            onClick={() => setMobileWing('B')}
            className={`flex-1 py-2 text-sm font-bold rounded-lg transition-all ${
              mobileWing === 'B' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
            }`}
          >
            Wing B
          </button>
        </div>

        {/* Desktop Wing Headers */}
        <div className="hidden md:grid md:grid-cols-2 gap-8 mb-6">
          <div className="bg-white border border-slate-200 rounded-xl px-5 py-3 shadow-sm flex items-center justify-between">
            <h2 className="text-lg font-bold text-slate-800">Wing A</h2>
            <span className="text-xs font-medium text-slate-500">10 Flats</span>
          </div>
          <div className="bg-white border border-slate-200 rounded-xl px-5 py-3 shadow-sm flex items-center justify-between">
            <h2 className="text-lg font-bold text-slate-800">Wing B</h2>
            <span className="text-xs font-medium text-slate-500">14 Flats</span>
          </div>
        </div>

        {/* Floor-by-Floor Rows */}
        <div className="space-y-8">
          {FLOORS.map((floor) => {
            const wingAFlats = records.filter((r) => r.wing === 'A' && r.floor === floor.num);
            const wingBFlats = records.filter((r) => r.wing === 'B' && r.floor === floor.num);
            const maxHouses = Math.max(wingAFlats.length, wingBFlats.length);

            return (
              <div key={floor.num} className="space-y-3">
                <div className="flex items-center gap-3">
                  <span className="text-xs font-bold tracking-wider text-slate-500 uppercase bg-slate-200/70 px-3 py-1 rounded-full">
                    {floor.label}
                  </span>
                  <div className="h-px flex-1 bg-slate-200" />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-8 items-start">
                  <div className={`${mobileWing === 'A' ? 'block' : 'hidden'} md:block space-y-2.5`}>
                    {Array.from({ length: maxHouses }).map((_, idx) =>
                      renderFlatCard(wingAFlats[idx], `A-gap-${floor.num}-${idx}`)
                    )}
                  </div>

                  <div className={`${mobileWing === 'B' ? 'block' : 'hidden'} md:block space-y-2.5`}>
                    {Array.from({ length: maxHouses }).map((_, idx) =>
                      renderFlatCard(wingBFlats[idx], `B-gap-${floor.num}-${idx}`)
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </main>

      {/* Payment Details Modal */}
      {selectedFlat && selectedFlat.payments && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-40 flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-white rounded-t-2xl sm:rounded-2xl border border-slate-200 w-full max-w-4xl p-4 sm:p-6 relative shadow-2xl max-h-[94vh] flex flex-col">
            <button
              onClick={() => setSelectedFlat(null)}
              className="absolute top-4 right-4 w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-600 font-bold"
            >
              ✕
            </button>

            <div className="mb-4 pr-8">
              <div className="flex flex-wrap items-center gap-2">
                <span className="bg-indigo-50 text-indigo-700 font-bold text-xs px-2.5 py-1 rounded-lg border border-indigo-200">
                  Wing {selectedFlat.wing} • {selectedFlat.flat_no}
                </span>
                <h3 className="text-lg sm:text-xl font-bold text-slate-900">
                  {selectedFlat.owner_name}
                </h3>
                {isCommitteeEditor && (
                  <span className="bg-amber-100 text-amber-800 text-[11px] font-bold px-2 py-0.5 rounded-md">
                    Committee Edit Mode
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500 mt-1">
                {selectedFlat.floorLabel} • Showing 5 stages at a time (Scroll table • Tap Payment Info to expand)
              </p>
            </div>

            {/* 5-Stage Scrollable Container */}
            <div className="border border-slate-200 rounded-xl mb-4 max-h-[345px] overflow-y-auto overflow-x-auto">
              <table className="w-full text-left text-sm border-collapse min-w-[780px]">
                <thead className="sticky top-0 bg-slate-100 border-b border-slate-200 z-10 text-slate-700">
                  <tr className="h-[45px]">
                    <th className="px-3 py-2 font-semibold w-9 text-center text-xs">#</th>
                    <th className="px-3 py-2 font-semibold text-xs">Stage</th>
                    <th className="px-3 py-2 font-semibold text-right text-xs">Amount</th>
                    <th className="px-3 py-2 font-semibold text-right text-xs">Amount Paid</th>
                    <th className="px-3 py-2 font-semibold text-center text-xs">Status</th>
                    <th className="px-3 py-2 font-semibold text-center text-xs">Payment Info</th>
                    <th className="px-3 py-2 font-semibold text-xs min-w-[180px]">Remark</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {draftPayments.map((m, idx) => {
                    const isExpanded = Boolean(expandedStages[idx]);
                    const entryCount = m.paymentInfo?.length || 0;

                    return (
                      <Fragment key={idx}>
                        <tr className="min-h-[58px] hover:bg-slate-50/80 align-middle">
                          <td className="px-3 py-2 text-xs font-mono text-slate-400 text-center">
                            {idx + 1}
                          </td>

                          {/* Stage Name */}
                          <td className="px-3 py-2 font-medium text-xs text-slate-800 leading-tight max-w-[160px]">
                            {m.name}
                          </td>

                          {/* Editable Amount */}
                          <td className="px-3 py-2 text-right whitespace-nowrap text-xs font-mono font-medium text-slate-700">
                            {isCommitteeEditor ? (
                              <input
                                type="number"
                                min={0}
                                value={m.amount}
                                onChange={(e) =>
                                  handleStageFieldChange(idx, 'amount', e.target.value)
                                }
                                className="w-24 border border-slate-300 rounded-lg px-2 py-1 text-right text-xs font-mono bg-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
                              />
                            ) : (
                              `₹${m.amount.toLocaleString('en-IN')}`
                            )}
                          </td>

                          {/* Amount Paid (Sum of paymentInfo amounts) */}
                          <td className="px-3 py-2 text-right whitespace-nowrap text-xs font-mono font-bold text-emerald-700">
                            ₹{(m.amountPaid || 0).toLocaleString('en-IN')}
                          </td>

                          {/* Status (Paid / Partially Paid / To be Paid) */}
                          <td className="px-3 py-2 text-center whitespace-nowrap">
                            {isCommitteeEditor ? (
                              <select
                                value={m.status}
                                onChange={(e) =>
                                  handleStageFieldChange(idx, 'status', e.target.value)
                                }
                                className={`border rounded-lg px-2 py-1 text-xs font-bold focus:outline-none ${getStatusBadgeStyle(
                                  m.status
                                )}`}
                              >
                                <option value="PAID">Paid</option>
                                <option value="PARTIALLY_PAID">Partially Paid</option>
                                <option value="PENDING">To be Paid</option>
                              </select>
                            ) : (
                              <span
                                className={`text-xs font-bold px-2.5 py-1 rounded-full border ${getStatusBadgeStyle(
                                  m.status
                                )}`}
                              >
                                {getStatusLabel(m.status)}
                              </span>
                            )}
                          </td>

                          {/* Expandable Payment Info Trigger */}
                          <td className="px-3 py-2 text-center whitespace-nowrap">
                            <div className="inline-flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => toggleStageExpand(idx)}
                                className={`px-2.5 py-1 rounded-lg text-xs font-semibold border transition-colors flex items-center gap-1 ${
                                  isExpanded
                                    ? 'bg-indigo-600 text-white border-indigo-600'
                                    : 'bg-slate-100 text-slate-700 border-slate-200 hover:bg-slate-200'
                                }`}
                              >
                                <span>
                                  {entryCount} {entryCount === 1 ? 'Entry' : 'Entries'}
                                </span>
                                <span className="text-[10px]">{isExpanded ? '▴' : '▾'}</span>
                              </button>

                              {isCommitteeEditor && (
                                <button
                                  type="button"
                                  onClick={() => handleAddPaymentEntry(idx)}
                                  title="Add payment entry"
                                  className="w-6 h-6 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm flex items-center justify-center shadow-2xs"
                                >
                                  +
                                </button>
                              )}
                            </div>
                          </td>

                          {/* Remark Section (Viewable on all devices) */}
                          <td className="px-3 py-2 text-xs min-w-[180px] max-w-[240px]">
                            {isCommitteeEditor ? (
                              <input
                                type="text"
                                placeholder="Add remark..."
                                value={m.remark || ''}
                                onChange={(e) =>
                                  handleStageFieldChange(idx, 'remark', e.target.value)
                                }
                                className="w-full border border-slate-300 rounded-lg px-2.5 py-1 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
                              />
                            ) : m.remark ? (
                              <p className="text-xs text-slate-700 whitespace-normal break-words leading-snug">
                                {m.remark}
                              </p>
                            ) : (
                              <span className="text-slate-300 italic">—</span>
                            )}
                          </td>
                        </tr>

                        {/* Expanded Payment Info Sub-Row */}
                        {isExpanded && (
                          <tr className="bg-slate-50/90 border-b border-slate-200">
                            <td colSpan={7} className="px-4 py-3">
                              <div className="bg-white border border-slate-200 rounded-xl p-3 shadow-2xs">
                                <div className="flex items-center justify-between mb-2">
                                  <span className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                                    Payment Info — Stage #{idx + 1} ({m.name})
                                  </span>
                                  {isCommitteeEditor && (
                                    <button
                                      type="button"
                                      onClick={() => handleAddPaymentEntry(idx)}
                                      className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold px-2.5 py-1 rounded-lg flex items-center gap-1"
                                    >
                                      <span>+</span> Add Payment
                                    </button>
                                  )}
                                </div>

                                {/* Scrollable list of payments inside this stage */}
                                {(!m.paymentInfo || m.paymentInfo.length === 0) ? (
                                  <p className="text-xs text-slate-400 italic py-2">
                                    No payments recorded for this stage yet.
                                  </p>
                                ) : (
                                  <div className="max-h-[150px] overflow-y-auto space-y-2 pr-1">
                                    {m.paymentInfo.map((entry, eIdx) => (
                                      <div
                                        key={eIdx}
                                        className="flex flex-wrap items-center justify-between gap-2 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs"
                                      >
                                        <span className="font-mono text-[11px] text-slate-400 font-semibold">
                                          #{eIdx + 1}
                                        </span>

                                        {/* Mode & Cheque No */}
                                        <div className="flex items-center gap-2">
                                          <span className="text-slate-500 font-medium">Mode:</span>
                                          {isCommitteeEditor ? (
                                            <>
                                              <select
                                                value={entry.mode}
                                                onChange={(e) =>
                                                  handlePaymentEntryChange(
                                                    idx,
                                                    eIdx,
                                                    'mode',
                                                    e.target.value
                                                  )
                                                }
                                                className="border border-slate-300 rounded-md px-2 py-1 text-xs bg-white font-semibold"
                                              >
                                                <option value="CASH">Cash</option>
                                                <option value="CHEQUE">Cheque</option>
                                              </select>
                                              {entry.mode === 'CHEQUE' && (
                                                <input
                                                  type="text"
                                                  placeholder="Cheque No."
                                                  value={entry.chequeNo || ''}
                                                  onChange={(e) =>
                                                    handlePaymentEntryChange(
                                                      idx,
                                                      eIdx,
                                                      'chequeNo',
                                                      e.target.value
                                                    )
                                                  }
                                                  className="border border-slate-300 rounded-md px-2 py-1 text-xs w-28 font-mono bg-white"
                                                />
                                              )}
                                            </>
                                          ) : (
                                            <span className="font-semibold text-slate-800">
                                              {entry.mode === 'CHEQUE'
                                                ? `Cheque ${
                                                    entry.chequeNo ? `(#${entry.chequeNo})` : ''
                                                  }`
                                                : 'Cash'}
                                            </span>
                                          )}
                                        </div>

                                        {/* Date */}
                                        <div className="flex items-center gap-1.5">
                                          <span className="text-slate-500 font-medium">Date:</span>
                                          {isCommitteeEditor ? (
                                            <input
                                              type="date"
                                              value={entry.date || ''}
                                              onChange={(e) =>
                                                handlePaymentEntryChange(
                                                  idx,
                                                  eIdx,
                                                  'date',
                                                  e.target.value
                                                )
                                              }
                                              className="border border-slate-300 rounded-md px-2 py-1 text-xs font-mono bg-white"
                                            />
                                          ) : (
                                            <span className="font-mono text-slate-700">
                                              {formatDisplayDate(entry.date)}
                                            </span>
                                          )}
                                        </div>

                                        {/* Amount */}
                                        <div className="flex items-center gap-1.5">
                                          <span className="text-slate-500 font-medium">
                                            Amount:
                                          </span>
                                          {isCommitteeEditor ? (
                                            <input
                                              type="number"
                                              min={0}
                                              value={entry.amount}
                                              onChange={(e) =>
                                                handlePaymentEntryChange(
                                                  idx,
                                                  eIdx,
                                                  'amount',
                                                  e.target.value
                                                )
                                              }
                                              className="border border-slate-300 rounded-md px-2 py-1 text-xs w-24 text-right font-mono bg-white"
                                            />
                                          ) : (
                                            <span className="font-mono font-bold text-emerald-700">
                                              ₹{(Number(entry.amount) || 0).toLocaleString('en-IN')}
                                            </span>
                                          )}
                                        </div>

                                        {/* Remove Entry Button (Committee Only) */}
                                        {isCommitteeEditor && (
                                          <button
                                            type="button"
                                            onClick={() => handleRemovePaymentEntry(idx, eIdx)}
                                            className="text-rose-600 hover:text-rose-800 font-bold px-1.5 py-0.5 rounded"
                                            title="Remove this payment entry"
                                          >
                                            ✕
                                          </button>
                                        )}
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Totals Summary Cards */}
            <div className="grid grid-cols-2 gap-3 mb-4">
              <div className="bg-emerald-50/70 border border-emerald-200 rounded-xl p-3">
                <span className="block text-[11px] font-semibold uppercase text-emerald-700">
                  Total Paid
                </span>
                <span className="font-bold text-emerald-800 font-mono text-sm sm:text-base">
                  ₹{currentPaid.toLocaleString('en-IN')}
                </span>
              </div>
              <div className="bg-rose-50/70 border border-rose-200 rounded-xl p-3">
                <span className="block text-[11px] font-semibold uppercase text-rose-700">
                  Total Pending
                </span>
                <span className="font-bold text-rose-700 font-mono text-sm sm:text-base">
                  ₹{currentToPay.toLocaleString('en-IN')}
                </span>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex items-center gap-3">
              {isCommitteeEditor && (
                <button
                  onClick={handleCommitteeSave}
                  disabled={isSaving}
                  className="flex-1 bg-indigo-600 text-white py-2.5 rounded-xl font-semibold text-sm hover:bg-indigo-500 transition-colors disabled:opacity-50"
                >
                  {isSaving ? 'Encrypting & Saving...' : 'Save Changes'}
                </button>
              )}
              <button
                onClick={() => setSelectedFlat(null)}
                className="flex-1 bg-slate-900 text-white py-2.5 rounded-xl font-semibold text-sm hover:bg-slate-800 transition-colors"
              >
                Close
              </button>
            </div>

            {saveMessage && (
              <p className="mt-2 text-center text-xs font-bold text-emerald-700">{saveMessage}</p>
            )}
          </div>
        </div>
      )}

      {/* 6-Digit PIN Modal */}
      {modalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <form
            onSubmit={handleAuthSubmit}
            className="bg-white rounded-2xl border border-slate-200 w-full max-w-sm p-6 space-y-4 shadow-xl"
          >
            <div>
              <h3 className="text-lg font-bold text-slate-900">
                {authType === 'OWNER'
                  ? `Wing ${targetFlat?.wing} — Flat ${targetFlat?.flat_no}`
                  : 'Builder / Committee Access'}
              </h3>
              {authType === 'OWNER' && targetFlat && (
                <p className="text-xs text-slate-500 mt-0.5">{targetFlat.owner_name}</p>
              )}
            </div>

            <div>
              <label className="block text-xs font-semibold mb-1.5 text-slate-600">
                Enter 6-Digit Security PIN
              </label>
              <input
                type="password"
                inputMode="numeric"
                required
                autoFocus
                placeholder="••••••"
                value={passwordInput}
                onChange={(e) => {
                  const cleanPin = e.target.value.replace(/\D/g, '').slice(0, 6);
                  setPasswordInput(cleanPin);
                }}
                className="w-full border border-slate-300 rounded-xl p-3 text-center text-lg font-mono tracking-[0.4em] focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            {authError && <p className="text-rose-600 text-xs font-semibold">{authError}</p>}

            <div className="flex gap-2.5 pt-1">
              <button
                type="submit"
                className="flex-1 bg-indigo-600 text-white py-2.5 rounded-xl text-sm font-semibold hover:bg-indigo-500 transition-colors"
              >
                Unlock
              </button>
              <button
                type="button"
                onClick={closeModal}
                className="flex-1 bg-slate-100 text-slate-700 py-2.5 rounded-xl text-sm font-semibold hover:bg-slate-200 transition-colors"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}