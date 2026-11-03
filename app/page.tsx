'use client';

import { useState, useEffect, FormEvent } from 'react';
import { FlatRecord, UserRole, ApiResponse, PaymentMilestone, PaymentMode } from '@/types/ledger';

const FLOORS = [
  { num: 0, label: 'Ground Floor' },
  { num: 1, label: '1st Floor' },
  { num: 2, label: '2nd Floor' },
  { num: 3, label: '3rd Floor' },
  { num: 4, label: '4th Floor' },
];

export default function Home() {
  const [records, setRecords] = useState<FlatRecord[]>([]);
  const [selectedFlat, setSelectedFlat] = useState<FlatRecord | null>(null);
  const [mobileWing, setMobileWing] = useState<'A' | 'B'>('A');

  // Auth & Session States
  const [role, setRole] = useState<UserRole>(null);
  const [adminPinSession, setAdminPinSession] = useState<string>('');
  const [unlockedFlats, setUnlockedFlats] = useState<Record<string, FlatRecord>>({});

  // Committee Editable Draft State
  const [draftPayments, setDraftPayments] = useState<PaymentMilestone[]>([]);
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
    if (flat.payments) {
      setDraftPayments(flat.payments.map((p) => ({ ...p })));
    }
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

  const handleMilestoneChange = (idx: number, field: keyof PaymentMilestone, value: string) => {
    setSaveMessage('');
    setDraftPayments((prev) => {
      const updated = [...prev];
      const item = { ...updated[idx] };

      if (field === 'status') {
        item.status = value as 'PAID' | 'PENDING';
        if (item.status === 'PENDING') {
          item.mode = '';
          item.chequeNo = '';
        } else if (!item.mode) {
          item.mode = 'CASH';
        }
      } else if (field === 'mode') {
        item.mode = value as PaymentMode;
        if (item.mode !== 'CHEQUE') {
          item.chequeNo = '';
        }
      } else if (field === 'chequeNo') {
        item.chequeNo = value;
      }

      updated[idx] = item;
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
      setDraftPayments(data.updatedFlat.payments.map((p: PaymentMilestone) => ({ ...p })));
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

  const currentPaid = draftPayments
    .filter((p) => p.status === 'PAID')
    .reduce((sum, p) => sum + p.amount, 0);
  const currentToPay = draftPayments
    .filter((p) => p.status === 'PENDING')
    .reduce((sum, p) => sum + p.amount, 0);

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
      {/* Modern Responsive Navbar */}
      <header className="bg-slate-900 text-white sticky top-0 z-30 shadow-md">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between gap-3">
          <div>
            <h1 className="text-base sm:text-xl font-bold tracking-tight inter">
              Redevelopment Payment Ledger
            </h1>
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

      {/* Main Content */}
      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
        {/* Mobile Wing Switcher (Visible only on phones) */}
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
                  {/* Wing A Column */}
                  <div className={`${mobileWing === 'A' ? 'block' : 'hidden'} md:block space-y-2.5`}>
                    {Array.from({ length: maxHouses }).map((_, idx) =>
                      renderFlatCard(wingAFlats[idx], `A-gap-${floor.num}-${idx}`)
                    )}
                  </div>

                  {/* Wing B Column */}
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

      {/* Payment Details Modal (5 Stages Scrollable) */}
      {selectedFlat && selectedFlat.payments && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-40 flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-white rounded-t-2xl sm:rounded-2xl border border-slate-200 w-full max-w-2xl p-4 sm:p-6 relative shadow-2xl max-h-[92vh] flex flex-col">
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
                {selectedFlat.floorLabel} • Showing 5 of {draftPayments.length} stages (Scroll table)
              </p>
            </div>

            {/* 5-Stage Scrollable Container (45px header + 5 * 56px rows = 325px) */}
            <div className="border border-slate-200 rounded-xl mb-4 max-h-[325px] overflow-y-auto overflow-x-auto">
              <table className="w-full text-left text-sm border-collapse min-w-[520px]">
                <thead className="sticky top-0 bg-slate-100 border-b border-slate-200 z-10 text-slate-700">
                  <tr className="h-[45px]">
                    <th className="px-3 py-2 font-semibold w-9 text-center text-xs">#</th>
                    <th className="px-3 py-2 font-semibold text-xs">Stage</th>
                    <th className="px-3 py-2 font-semibold text-right text-xs">Amount</th>
                    <th className="px-3 py-2 font-semibold text-center text-xs">Status</th>
                    <th className="px-3 py-2 font-semibold text-xs">Payment Mode</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {draftPayments.map((m, idx) => (
                    <tr key={idx} className="h-[56px] hover:bg-slate-50/80">
                      <td className="px-3 py-1.5 text-xs font-mono text-slate-400 text-center">
                        {idx + 1}
                      </td>
                      <td className="px-3 py-1.5 font-medium text-xs text-slate-800 leading-tight max-w-[180px]">
                        {m.name}
                      </td>
                      <td className="px-3 py-1.5 text-right whitespace-nowrap text-xs font-mono font-medium text-slate-700">
                        ₹{m.amount.toLocaleString('en-IN')}
                      </td>

                      <td className="px-3 py-1.5 text-center whitespace-nowrap">
                        {isCommitteeEditor ? (
                          <select
                            value={m.status}
                            onChange={(e) => handleMilestoneChange(idx, 'status', e.target.value)}
                            className={`border rounded-lg px-2 py-1 text-xs font-bold focus:outline-none ${
                              m.status === 'PAID'
                                ? 'bg-emerald-50 text-emerald-700 border-emerald-300'
                                : 'bg-rose-50 text-rose-700 border-rose-300'
                            }`}
                          >
                            <option value="PAID">Paid</option>
                            <option value="PENDING">To be Paid</option>
                          </select>
                        ) : (
                          <span
                            className={`text-xs font-bold px-2.5 py-1 rounded-full ${
                              m.status === 'PAID'
                                ? 'bg-emerald-50 text-emerald-700'
                                : 'bg-rose-50 text-rose-600'
                            }`}
                          >
                            {m.status === 'PAID' ? 'Paid' : 'To be Paid'}
                          </span>
                        )}
                      </td>

                      <td className="px-3 py-1.5 text-xs">
                        {m.status === 'PENDING' ? (
                          <span className="text-slate-300 italic">—</span>
                        ) : isCommitteeEditor ? (
                          <div className="flex items-center gap-1.5">
                            <select
                              value={m.mode || 'CASH'}
                              onChange={(e) => handleMilestoneChange(idx, 'mode', e.target.value)}
                              className="border border-slate-300 rounded-lg px-2 py-1 text-xs bg-white"
                            >
                              <option value="CASH">Cash</option>
                              <option value="CHEQUE">Cheque</option>
                            </select>

                            {m.mode === 'CHEQUE' && (
                              <input
                                type="text"
                                placeholder="Cheque No."
                                value={m.chequeNo || ''}
                                onChange={(e) =>
                                  handleMilestoneChange(idx, 'chequeNo', e.target.value)
                                }
                                className="border border-slate-300 rounded-lg px-2 py-1 text-xs w-28 font-mono"
                              />
                            )}
                          </div>
                        ) : (
                          <div className="leading-tight">
                            <span className="font-semibold text-slate-700">
                              {m.mode === 'CHEQUE' ? 'Cheque' : 'Cash'}
                            </span>
                            {m.mode === 'CHEQUE' && m.chequeNo && (
                              <span className="block text-[11px] font-mono text-slate-500">
                                #{m.chequeNo}
                              </span>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
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