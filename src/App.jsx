import React, { useState, useMemo, useEffect } from 'react';
import {
  TrendingUp,
  Settings,
  Plus,
  PlusCircle,
  Trash2,
  Edit2,
  RefreshCw,
  Cloud,
  HardDrive,
  Upload,
  ChevronUp,
  ChevronDown
} from 'lucide-react';
import { loadAppData, saveAppData, syncWithGoogleDrive } from './services/dataService';

// --- 定数 ---
const DEFAULT_START_DATE = '2025-12';

// --- ユーティリティ ---
const getMonthDiff = (start, end) => {
  if (!start || !end) return 0;
  const d1 = new Date(start + '-01');
  const d2 = new Date(end + '-01');
  return (d2.getFullYear() - d1.getFullYear()) * 12 + (d2.getMonth() - d1.getMonth());
};

const formatMonth = (date) => {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
};

const addMonths = (monthStr, count) => {
  if (!monthStr) return DEFAULT_START_DATE;
  const d = new Date(monthStr + '-01');
  d.setMonth(d.getMonth() + count);
  return formatMonth(d);
};

const getFutureMonths = (start, count) => {
  const months = [];
  for (let i = 0; i < count; i++) {
    months.push(addMonths(start, i));
  }
  return months;
};

const parseCurrency = (val) => {
  if (!val && val !== 0) return 0;
  const halfVal = val.toString().replace(/[０-９]/g, (s) => String.fromCharCode(s.charCodeAt(0) - 0xFEE0));
  return parseInt(halfVal.replace(/["\s,]/g, '')) || 0;
};

// --- メインコンポーネント ---
export default function App() {
  // Sync Key Management (Internal)
  const syncKey = useMemo(() => {
    let key = localStorage.getItem('prefund_user_key');
    if (!key) {
      key = 'local-user-' + Math.random().toString(36).substr(2, 9);
      localStorage.setItem('prefund_user_key', key);
    }
    return key;
  }, []);

  // Local State
  const [accounts, setAccounts] = useState([]);
  const [items, setItems] = useState([]);
  // 口座の折りたたみ状態 (expanded by default)
  const [collapsedAccounts, setCollapsedAccounts] = useState({});

  const [isSaving, setIsSaving] = useState(false);
  const [isDriveSyncing, setIsDriveSyncing] = useState(false);

  const [modalType, setModalType] = useState(null);
  const [activeAccount, setActiveAccount] = useState(null);
  const [activeItem, setActiveItem] = useState(null);

  // Monthly CSV update states (Category-based)
  const [categoryBalances, setCategoryBalances] = useState({}); // { accountId: { '2025-10': 150000 } }
  const [csvUploadMonth, setCsvUploadMonth] = useState(null);
  const [csvUploadData, setCsvUploadData] = useState(null);
  const [showCategorySelector, setShowCategorySelector] = useState(false);

  // 初回データロード
  useEffect(() => {
    const { accounts: acc, items: itm } = loadAppData(syncKey);
    // orderでの初期ソート（念のため）
    const sortedAcc = [...acc].sort((a, b) => (a.order || 0) - (b.order || 0));
    const sortedItm = [...itm].sort((a, b) => (a.order || 0) - (b.order || 0));
    setAccounts(sortedAcc);
    setItems(sortedItm);
  }, [syncKey]);

  // データ変更時に保存
  const saveData = (newAccounts, newItems) => {
    saveAppData(syncKey, { accounts: newAccounts, items: newItems });
    setAccounts(newAccounts);
    setItems(newItems);
  };

  // DB 操作の代替
  const handleSave = async (col, data, isDelete = false) => {
    setIsSaving(true);
    // Mimic API delay
    await new Promise(r => setTimeout(r, 300));

    if (col === 'accounts') {
      let newAccounts;
      if (isDelete) {
        newAccounts = accounts.filter(a => a.id !== data.id);
      } else {
        const index = accounts.findIndex(a => a.id === data.id);
        if (index >= 0) {
          newAccounts = [...accounts];
          newAccounts[index] = { ...newAccounts[index], ...data };
        } else {
          newAccounts = [...accounts, data];
        }
      }
      // orderでソート
      newAccounts.sort((a, b) => (a.order || 0) - (b.order || 0));
      saveData(newAccounts, items);
    } else if (col === 'items') {
      let newItems;
      if (isDelete) {
        newItems = items.filter(i => i.id !== data.id);
      } else {
        const index = items.findIndex(i => i.id === data.id);
        if (index >= 0) {
          newItems = [...items];
          newItems[index] = { ...newItems[index], ...data };
        } else {
          // 新規追加時は末尾へ (そのAccount内の)
          // グローバルなitems配列の末尾に追加するが、orderはそのAccount内での最大+1にしたい
          const accountItems = items.filter(i => i.accountId === data.accountId);
          const maxOrder = accountItems.length > 0 ? Math.max(...accountItems.map(i => i.order || 0)) : -1;
          data.order = maxOrder + 1;
          newItems = [...items, data];
        }
      }
      // orderでソート
      newItems.sort((a, b) => (a.order || 0) - (b.order || 0));
      saveData(accounts, newItems);
    }

    setIsSaving(false);
  };

  // 並べ替え（ソート）機能
  const handleSort = async (type, id, direction) => {
    if (type === 'accounts') {
      const index = accounts.findIndex(a => a.id === id);
      if (index < 0) return;

      const newAccounts = [...accounts];
      const targetIndex = direction === 'up' ? index - 1 : index + 1;

      if (targetIndex >= 0 && targetIndex < newAccounts.length) {
        // Swap items in array logic
        [newAccounts[index], newAccounts[targetIndex]] = [newAccounts[targetIndex], newAccounts[index]];
        // Re-assign order property based on new index
        newAccounts.forEach((a, i) => a.order = i);
        saveData(newAccounts, items);
      }
    } else if (type === 'items') {
      // Items are a bit trickier because we only display/sort within an account
      // First, get items for the account of the target item
      const targetItem = items.find(i => i.id === id);
      if (!targetItem) return;
      const accountId = targetItem.accountId;

      // Extract all items for this account, sorted by current order
      const accountItems = items.filter(i => i.accountId === accountId).sort((a, b) => (a.order || 0) - (b.order || 0));
      const otherItems = items.filter(i => i.accountId !== accountId);

      const localIndex = accountItems.findIndex(i => i.id === id);
      const targetLocalIndex = direction === 'up' ? localIndex - 1 : localIndex + 1;

      if (targetLocalIndex >= 0 && targetLocalIndex < accountItems.length) {
        // Swap
        [accountItems[localIndex], accountItems[targetLocalIndex]] = [accountItems[targetLocalIndex], accountItems[localIndex]];
        // Re-assign order for this subset
        accountItems.forEach((item, idx) => item.order = idx);

        // Merge back
        const newItems = [...otherItems, ...accountItems];
        saveData(accounts, newItems);
      }
    }
  };

  const handleDriveSync = async () => {
    setIsDriveSyncing(true);
    const result = await syncWithGoogleDrive(syncKey, { accounts, items });
    if (result) {
      // Sync returns merged data. Ensure it's sorted.
      const sAccounts = result.accounts.sort((a, b) => (a.order || 0) - (b.order || 0));
      const sItems = result.items.sort((a, b) => (a.order || 0) - (b.order || 0));
      setAccounts(sAccounts);
      setItems(sItems);
    }
    setIsDriveSyncing(false);
  };

  // Monthly CSV Upload Handler (Sumishin SBI Bank Format - Shift-JIS)
  const handleMonthlyCSVUpload = (month, file) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        // Decode Shift-JIS to UTF-8
        const arrayBuffer = event.target.result;
        const decoder = new TextDecoder('shift-jis');
        const csvText = decoder.decode(arrayBuffer);

        const rows = csvText.split(/\r?\n/).filter(r => r.trim());
        if (rows.length < 2) {
          alert('CSVファイルが空または無効です');
          return;
        }

        // Find columns: 日付 and 残高(円)
        const headers = rows[0].split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/);
        const dateCol = headers.findIndex(h => h.includes('日付') || h.toLowerCase().includes('date'));
        const balanceCol = headers.findIndex(h => h.includes('残高') || h.toLowerCase().includes('balance'));

        if (dateCol === -1 || balanceCol === -1) {
          alert('CSVに「日付」または「残高」の列が見つかりませんでした');
          return;
        }

        // Parse target month
        const targetYear = parseInt(month.split('-')[0]);
        const targetMonth = parseInt(month.split('-')[1]);

        // Find FIRST matching row (newest date in Sumishin SBI CSV format)
        let latestBalance = null;

        for (let i = 1; i < rows.length; i++) {
          const cols = rows[i].split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/);
          if (cols.length <= Math.max(dateCol, balanceCol)) continue;

          const dateStr = cols[dateCol].replace(/"/g, '').trim();
          const balanceStr = cols[balanceCol].replace(/"/g, '').trim();

          // Parse date (format: YYYY/MM/DD or YYYY-MM-DD)
          const dateParts = dateStr.split(/[/-]/);
          if (dateParts.length < 3) continue;

          const year = parseInt(dateParts[0]);
          const monthNum = parseInt(dateParts[1]);

          // Check if this row belongs to target month
          if (year === targetYear && monthNum === targetMonth) {
            // Remove commas and parse
            const cleanBalance = balanceStr.replace(/,/g, '');
            latestBalance = parseCurrency(cleanBalance);
            break; // Take FIRST matching row (newest in this month)
          }
        }

        if (latestBalance !== null && !isNaN(latestBalance)) {
          setCsvUploadMonth(month);
          setCsvUploadData(latestBalance);
          setShowCategorySelector(true);
        } else {
          alert(`${month}のデータがCSVに見つかりませんでした`);
        }
      } catch (error) {
        console.error('CSV parsing error:', error);
        alert('CSVの解析に失敗しました: ' + error.message);
      }
    };
    reader.readAsArrayBuffer(file);
  };

  // Apply selected category update
  const applyCategoryBalance = (accountId) => {
    if (!csvUploadMonth || csvUploadData === null) return;

    setCategoryBalances(prev => ({
      ...prev,
      [accountId]: {
        ...(prev[accountId] || {}),
        [csvUploadMonth]: csvUploadData
      }
    }));

    setShowCategorySelector(false);
    setCsvUploadMonth(null);
    setCsvUploadData(null);
  };

  const toggleAccountCollapse = (accId) => {
    setCollapsedAccounts(prev => ({ ...prev, [accId]: !prev[accId] }));
  };

  // --- シミュレーション ---
  const futureMonths = useMemo(() => getFutureMonths(DEFAULT_START_DATE, 36), []); // 3年分に拡張
  const currentMonth = new Date().toISOString().slice(0, 7); // yyyy-mm

  const simulationData = useMemo(() => {
    // 1. 各月・各口座・各目的の数値を計算
    // Structure: { [month]: { global: { ... }, accounts: { [accId]: { ..., items: [...] } } } }
    const matrix = {};

    futureMonths.forEach(m => {
      matrix[m] = {
        global: { savings: 0, spending: 0, target: 0, balance: 0 },
        accounts: {}
      };

      accounts.forEach(acc => {
        matrix[m].accounts[acc.id] = {
          target: 0, // その月の目標累積残高
          spending: 0, // その月の支出合計
          required: 0, // その月の必要積立額
          balance: 0,  // その月時点の累積残高（シミュレーション）
          items: []
        };
      });
    });

    // 計算実行
    accounts.forEach(acc => {
      const accItems = items.filter(i => i.accountId === acc.id && i.status === 'active');
      const startM = acc.startMonth || DEFAULT_START_DATE;

      // 目的ごとの計算 (Interval / Count 対応)
      accItems.forEach(item => {
        // 繰り返し回数分のループ
        const maxCount = item.count || 1;
        const interval = item.interval || 0;

        for (let k = 0; k < maxCount; k++) {

          let currentUseMonth = item.useMonth;
          let currentStartMonth = item.startMonth || startM;

          if (k > 0) {
            if (interval <= 0) break; // intervalなしなら1回で終了
            const prevUseRaw = addMonths(item.useMonth, interval * (k - 1));
            currentUseMonth = addMonths(item.useMonth, interval * k);
            currentStartMonth = prevUseRaw; // 支出したその月から次回の積立開始
          }

          const totalM = getMonthDiff(currentStartMonth, currentUseMonth);
          const itemInitial = (k === 0) ? (item.initialBalance || 0) : 0; // 初回以外は初期残高0

          futureMonths.forEach(m => {
            if (m < currentStartMonth || (!matrix[m])) return;

            const passedM = getMonthDiff(currentStartMonth, m);
            let saving = 0;
            let accumulated = 0;

            // 積立額計算
            if (totalM > 0) {
              const perM = (item.targetAmount - itemInitial) / totalM;
              if (m < currentUseMonth && m >= currentStartMonth) saving = perM;

              if (m < currentStartMonth) {
                accumulated = 0;
              } else if (m < currentUseMonth) {
                accumulated = itemInitial + (perM * (passedM + 1));
              } else {
                // m >= currentUseMonth (After spending, keep the target amount as accumulated history)
                accumulated = item.targetAmount;
              }
            } else if (totalM === 0 && m >= currentUseMonth) {
              accumulated = item.targetAmount;
            }

            // 支出判定
            const isSpend = m === currentUseMonth;
            const spendAmount = isSpend ? item.targetAmount : 0;

            // Matrixへの反映
            let entry = matrix[m].accounts[acc.id].items.find(x => x.id === item.id);
            if (!entry) {
              entry = {
                id: item.id,
                name: item.name,
                saving: 0,
                spendAmount: 0,
                isSpend: false,
                accumulated: 0
              };
              matrix[m].accounts[acc.id].items.push(entry);
            }

            entry.saving += saving;
            entry.accumulated += accumulated;
            if (isSpend) {
              entry.spendAmount += spendAmount;
              entry.isSpend = true;
            }

            // Account Level Accumulation
            matrix[m].accounts[acc.id].required += saving;
            matrix[m].accounts[acc.id].spending += spendAmount;
            matrix[m].accounts[acc.id].target += accumulated;
          });
        }
      });
    });

    // 2. 実残高 (Actual Balance) の時系列計算 (CSV反映と自動伝播)
    accounts.forEach(acc => {
      // 初期残高 (または現在設定されている開始残高)
      let currentActual = acc.initialBalance || 0;

      futureMonths.forEach(m => {
        if (!matrix[m]) return;
        const accData = matrix[m].accounts[acc.id];

        // CSVによる上書きチェック
        const csvVal = categoryBalances[acc.id]?.[m];

        if (csvVal !== undefined) {
          // CSVデータがあればそれを正とする（リセット）
          currentActual = csvVal;
        } else {
          // CSVがなければ、前月残高 + 今月の積立 - 今月の支出
          currentActual += (accData.required - accData.spending);
        }

        accData.balance = currentActual;
      });
    });

    // 3. 全体集計 (Global Summary)
    futureMonths.forEach(m => {
      if (!matrix[m]) return;

      accounts.forEach(acc => {
        const accData = matrix[m].accounts[acc.id];
        matrix[m].global.savings += accData.required;
        matrix[m].global.target += accData.target;
        matrix[m].global.spending += accData.spending;
        matrix[m].global.balance += accData.balance; // 実残高の合計
      });
    });

    // Calculate Global "Actual" & "Diff"
    futureMonths.forEach(m => {
      const g = matrix[m].global;
      // Future assumption: Actual = Target
      // g.balance is already calculated in step 3
    });

    return matrix;
  }, [accounts, items, futureMonths, categoryBalances]);

  return (
    <div className="h-screen flex flex-col bg-[#FAF9F6] text-black overflow-hidden font-sans text-sm selection:bg-amber-100">

      {/* --- App Header --- */}
      <header className="flex-none bg-[#E65100] text-white border-b border-[#E65100] px-8 py-4 flex items-center justify-between z-50 shadow-md">
        <div className="flex items-center gap-4">
          <div className="bg-white/20 p-2.5 rounded-xl text-white shadow-inner">
            <TrendingUp size={22} />
          </div>
          <div>
            <h1 className="text-xl font-black tracking-tight leading-none font-sans">資産管理アプリ</h1>
            <p className="text-[11px] text-white/80 font-bold tracking-widest mt-0.5">PRE-FUND SIMULATOR</p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className={`flex items-center gap-1.5 text-[10px] font-black uppercase px-4 py-2 rounded-full border-2 transition-all ${isSaving ? 'border-white text-white bg-white/20' : 'border-white/50 text-white/70 bg-transparent'}`}>
            {isSaving ? <RefreshCw className="animate-spin" size={12} /> : <Cloud size={12} />}
            {isSaving ? '保存中...' : '保存完了'}
          </div>
          <button onClick={handleDriveSync} disabled={isDriveSyncing} className="flex items-center gap-2 bg-white text-[#E65100] hover:bg-[#FFF8E1] border-2 border-white px-5 py-2.5 rounded-lg font-black text-xs transition-all shadow-md hover:shadow-lg active:scale-95 disabled:opacity-50 disabled:active:scale-100">
            {isDriveSyncing ? <RefreshCw className="animate-spin" size={14} /> : <HardDrive size={14} />}
            同期する
          </button>
        </div>
      </header>

      {/* --- Main Sheet Area --- */}
      <div className="flex-1 overflow-auto relative scroll-smooth bg-[#FAF9F6]">
        <table className="border-collapse table-fixed w-max min-w-full">

          {/* --- Table Header --- */}
          <thead className="sticky top-0 z-50 shadow-sm bg-[#FAF9F6]">
            <tr>
              {/* Corner Fixed */}
              <th className="sticky left-0 top-0 z-50 bg-[#FAF9F6] w-[320px] p-4 text-left border-b border-stone-300 text-xs font-black text-stone-400 tracking-widest relative backdrop-blur-sm">
                口座 / 目的
              </th>
              {/* Month Headers */}
              {futureMonths.map(m => {
                const isCurrent = m === currentMonth;
                return (
                  <th key={m} className={`w-[160px] p-2 text-center border-b border-stone-200 text-xs font-bold tracking-widest relative ${isCurrent ? 'bg-amber-100/50 text-amber-800' : 'bg-[#FAF9F6] text-stone-400'}`}>
                    {isCurrent && <div className="absolute inset-x-0 top-0 h-1 bg-amber-400 shadow-[0_0_10px_rgba(251,191,36,0.5)]"></div>}
                    <div className="flex flex-col gap-1 items-center">
                      <span className="font-mono">{m}</span>
                      <label className="text-[8px] font-bold text-[#1e3a8a] hover:text-[#E65100] cursor-pointer bg-white hover:bg-amber-50 px-2 py-0.5 rounded-full border border-[#1e3a8a]/20 hover:border-[#E65100]/30 transition-all">
                        CSV更新
                        <input
                          type="file"
                          className="hidden"
                          accept=".csv"
                          onChange={(e) => {
                            const file = e.target.files[0];
                            if (!file) return;
                            handleMonthlyCSVUpload(m, file);
                            e.target.value = ''; // Reset input
                          }}
                        />
                      </label>
                    </div>
                  </th>
                );
              })}
            </tr>

            {/* --- Section 1: All Company Summary (Sticky) --- */}
            <tr className="relative z-50">
              <th className="sticky left-0 z-50 p-4 text-left shadow-[0_4px_6px_-1px_rgba(0,0,0,0.2)] bg-[#1e3a8a] text-white">
                <div className="flex flex-col gap-1">
                  <span className="text-base font-black tracking-tight">全口座合計</span>
                  <span className="text-[10px] text-white/80 font-bold tracking-widest">TOTAL ASSETS</span>
                </div>
              </th>
              {futureMonths.map(m => {
                const g = simulationData[m]?.global;
                const isCurrent = m === currentMonth;

                // Actual calculation from matrix (calculated in useMemo)
                const totalActual = g.balance;
                const totalTarget = g.target;
                const diff = totalActual - totalTarget;

                // Navy Summary Cells
                return (
                  <td key={m} className={`p-2 vertical-align-top h-[140px] shadow-[0_4px_6px_-1px_rgba(0,0,0,0.2)] border-r border-[#1e3a8a]/30 bg-[#1e3a8a] text-white ${isCurrent ? 'border-l-[3px] border-r-[3px] border-l-[#4A4A4A] border-r-[#4A4A4A]' : ''}`}>
                    <div className="flex flex-col gap-1.5 h-full justify-center text-right font-mono text-xs">
                      {/* 1. Actual Balance */}
                      <div className="flex justify-between items-baseline px-1 border-b border-white/10 pb-1">
                        <span className="text-[9px] font-bold sans-serif text-emerald-300 whitespace-nowrap">実残高</span>
                        <span className="text-base font-black tracking-tight whitespace-nowrap">¥{Math.round(totalActual).toLocaleString()}</span>
                      </div>

                      {/* 2. Target Balance */}
                      <div className="flex justify-between items-baseline px-1">
                        <span className="text-[9px] font-bold sans-serif text-white/70 whitespace-nowrap">目標</span>
                        <span className="text-sm font-bold text-white/90 whitespace-nowrap">¥{Math.round(totalTarget).toLocaleString()}</span>
                      </div>

                      {/* 3. Diff */}
                      <div className={`flex justify-between items-center p-1.5 rounded border shadow-sm ${diff >= 0 ? 'bg-white text-emerald-700' : 'bg-white text-[#dc2626]'}`}>
                        <span className="text-[9px] font-bold sans-serif text-black whitespace-nowrap">差額</span>
                        <span className="text-sm font-black whitespace-nowrap">¥{Math.round(diff).toLocaleString()}</span>
                      </div>

                      {/* 4. Spending */}
                      <div className="flex justify-between items-center px-1 mt-auto pt-1 border-t border-white/20">
                        <span className="text-[9px] font-bold sans-serif text-white/70 whitespace-nowrap">支出計</span>
                        <span className={`text-sm font-bold whitespace-nowrap ${g.spending > 0 ? 'text-amber-300' : 'text-white/40'}`}>
                          {g.spending > 0 ? `¥${Math.round(g.spending).toLocaleString()}` : '-'}
                        </span>
                      </div>
                    </div>
                  </td>
                );
              })}
            </tr>
          </thead>

          {/* --- Section 2 & 3: Body --- */}
          <tbody>
            {(accounts || []).map((acc, accIdx) => (
              <React.Fragment key={acc.id}>
                {/* --- Section 2: Account Row (Category - 4 Item Stack) --- */}
                <tr className="group relative z-40">
                  {/* Sticky Name Col - Sea Color Style */}
                  <td className="sticky left-0 z-40 p-0 align-top bg-[#B2EBF2] border-b-[10px] border-[#CBD5E0]" style={{ boxShadow: 'none', transform: 'none' }}>
                    <div className="p-4 flex items-start gap-3 h-full min-h-[140px] bg-[#B2EBF2] text-[#1A202C] my-2 rounded-r-lg" style={{ boxShadow: 'none', transform: 'none' }}>
                      <button onClick={() => toggleAccountCollapse(acc.id)} className="mt-1 text-[#1A202C] hover:text-black transition-colors p-1 rounded-md hover:bg-black/10">
                        {collapsedAccounts[acc.id] ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
                      </button>
                      <div className="flex-1">
                        <div className="flex flex-col gap-2">
                          <div className="flex justify-between items-start">
                            <h3 className="text-base font-black leading-tight tracking-tight">{acc.name}</h3>
                            <button onClick={() => { setActiveAccount(acc); setModalType('editAccount'); }} className="text-[#1A202C]/80 hover:text-black p-1 rounded hover:bg-black/10 transition-colors"><Settings size={16} /></button>
                          </div>
                          <div className="flex gap-1">
                            <button disabled={accIdx === 0} onClick={() => handleSort('accounts', acc.id, 'up')} className="p-1 rounded bg-white/50 border border-black/10 text-[#1A202C] hover:bg-white disabled:opacity-30 transition-all"><ChevronUp size={14} /></button>
                            <button disabled={accIdx === accounts.length - 1} onClick={() => handleSort('accounts', acc.id, 'down')} className="p-1 rounded bg-white/50 border border-black/10 text-[#1A202C] hover:bg-white disabled:opacity-30 transition-all"><ChevronDown size={14} /></button>
                          </div>
                        </div>
                      </div>
                    </div>
                  </td>

                  {/* Data Columns for Account - Sea Color Style with 4-Item Stack */}
                  {futureMonths.map(m => {
                    const accData = simulationData[m]?.accounts[acc.id];
                    const isCurrent = m === currentMonth;
                    const isCsv = categoryBalances[acc.id]?.[m] !== undefined;

                    return (
                      <td key={m} className={`p-2 vertical-align-top h-[140px] font-mono text-right border-r border-[#B2EBF2]/20 transition-colors bg-[#B2EBF2] text-[#1A202C] border-b-[10px] border-[#CBD5E0] ${isCurrent ? 'border-l-[3px] border-r-[3px] border-l-[#4A4A4A] border-r-[#4A4A4A]' : ''}`} style={{ boxShadow: 'none' }}>
                        <div className="flex flex-col gap-1.5 h-full justify-center text-xs">
                          {/* 1. Target Sum */}
                          <div className="flex justify-between items-baseline px-1">
                            <span className="text-[9px] font-bold sans-serif text-[#1A202C]/60 whitespace-nowrap">目標合計</span>
                            <span className="text-sm font-bold tracking-tight whitespace-nowrap">
                              ¥{Math.round(accData.target).toLocaleString()}
                            </span>
                          </div>

                          {/* 2. Actual Balance */}
                          <div className={`flex justify-between items-baseline px-1 py-0.5 rounded ${isCsv ? 'bg-white/50 ring-1 ring-[#1e3a8a]/20' : ''}`}>
                            <span className={`text-[9px] font-bold sans-serif whitespace-nowrap ${isCsv ? 'text-[#1e3a8a]' : 'text-[#1A202C]/60'}`}>{isCsv ? 'CSV実残高' : '実残高'}</span>
                            <span className={`text-base font-black tracking-tight whitespace-nowrap ${isCsv ? 'text-[#1e3a8a]' : 'text-[#1A202C]'}`}>
                              ¥{Math.round(accData.balance).toLocaleString()}
                            </span>
                          </div>

                          {/* 3. Required Saving */}
                          <div className="flex justify-between items-center px-1 border-t border-[#1A202C]/10 pt-1">
                            <span className="text-[9px] font-bold sans-serif text-[#1A202C]/60 whitespace-nowrap">必要積立</span>
                            <span className="text-sm font-bold whitespace-nowrap text-[#16a34a]">¥{Math.round(accData.required).toLocaleString()}</span>
                          </div>

                          {/* 4. Spending */}
                          <div className="flex justify-between items-center px-1 mt-auto">
                            <span className="text-[9px] font-bold sans-serif text-[#1A202C]/60 whitespace-nowrap">支出合計</span>
                            <span className={`text-sm font-bold whitespace-nowrap ${accData.spending > 0 ? 'text-[#e65100]' : 'text-[#1A202C]/30'}`}>
                              {accData.spending > 0 ? `¥${Math.round(accData.spending).toLocaleString()}` : '-'}
                            </span>
                          </div>
                        </div>
                      </td>
                    );
                  })}
                </tr>

                {/* --- Section 3: Item Rows (Child / Collapsible) - 3-Item Stack --- */}
                {!collapsedAccounts[acc.id] && items.filter(i => i.accountId === acc.id && i.status === 'active').sort((a, b) => (a.order || 0) - (b.order || 0)).map((item, itemIdx, arr) => {
                  const bgColor = itemIdx % 2 === 0 ? 'bg-[#FFFDE7]' : 'bg-[#FFF3E0]';
                  const hoverColor = itemIdx % 2 === 0 ? 'hover:bg-[#FFF9C4]' : 'hover:bg-[#FFE0B2]';

                  return (
                    <tr key={item.id} className={`${bgColor} ${hoverColor} transition-colors border-b border-[#E65100]/60 group/item`}>
                      {/* Sticky Name Col - High Contrast */}
                      <td className="sticky left-0 z-30 bg-white group-hover/item:bg-white border-b border-[#E65100]/60 p-0 pl-10 align-middle transition-colors">
                        <div className="p-3 pl-4 flex justify-between items-center h-full border-r border-[#E65100]/40">
                          <span className="text-base font-bold text-black truncate max-w-[200px]">{item.name}</span>
                          <div className="flex items-center gap-2">
                            {/* Persistent Item Sort Buttons */}
                            <div className="flex flex-col gap-0.5">
                              <button disabled={itemIdx === 0} onClick={() => handleSort('items', item.id, 'up')} className="text-black/50 hover:text-black border border-black/10 rounded bg-white/50 hover:bg-white disabled:opacity-20"><ChevronUp size={12} /></button>
                              <button disabled={itemIdx === arr.length - 1} onClick={() => handleSort('items', item.id, 'down')} className="text-black/50 hover:text-black border border-black/10 rounded bg-white/50 hover:bg-white disabled:opacity-20"><ChevronDown size={12} /></button>
                            </div>
                            <button onClick={() => { setActiveAccount(acc); setActiveItem(item); setModalType('item'); }} className="p-2 hover:bg-black/10 rounded text-black/50 hover:text-black transition-colors"><Edit2 size={16} /></button>
                          </div>
                        </div>
                      </td>

                      {/* Data Columns for Item - 3-Item Stack */}
                      {futureMonths.map(m => {
                        const itemData = simulationData[m]?.accounts[acc.id]?.items.find(i => i.id === item.id);
                        const isCurrent = m === currentMonth;

                        if (!itemData) return <td key={m} className={`border-r border-[#E65100]/40 ${isCurrent ? 'border-l-[3px] border-r-[3px] border-l-[#4A4A4A] border-r-[#4A4A4A]' : ''}`}></td>;

                        const startDate = new Date(item.startMonth + '-01');
                        const useDate = new Date(item.useMonth + '-01');
                        const currentDate = new Date(m + '-01');
                        const totalMonths = getMonthDiff(item.startMonth, item.useMonth);
                        const elapsedMonths = Math.max(0, getMonthDiff(item.startMonth, m)) + 1;

                        const accumulatedTarget = itemData?.accumulated || 0;

                        const monthlySaving = itemData.saving || 0;
                        const monthlySpending = itemData.spendAmount || 0;

                        return (
                          <td key={m} className={`p-2 border-r border-[#E65100]/40 text-right vertical-align-middle h-[90px] font-mono transition-colors ${isCurrent ? 'border-l-[3px] border-r-[3px] border-l-[#4A4A4A] border-r-[#4A4A4A]' : ''}`}>
                            <div className="flex flex-col justify-center h-full gap-1 px-1 text-xs">
                              {/* 1. Need Balance */}
                              <div className="flex justify-between items-baseline">
                                <span className="text-[9px] font-bold text-black/40 sans-serif whitespace-nowrap scale-90 origin-left">必要残高</span>
                                <span className="text-xs font-bold text-black/70 whitespace-nowrap">
                                  ¥{Math.round(accumulatedTarget).toLocaleString()}
                                </span>
                              </div>
                              {/* 2. Need Saving */}
                              <div className="flex justify-between items-baseline">
                                <span className="text-[9px] font-bold text-black/40 sans-serif whitespace-nowrap scale-90 origin-left">必要積立</span>
                                <span className={`text-sm font-bold whitespace-nowrap ${monthlySaving > 0 ? 'text-[#16a34a]' : 'text-black/20'}`}>
                                  {monthlySaving > 0 ? `¥${Math.round(monthlySaving).toLocaleString()}` : '-'}
                                </span>
                              </div>
                              {/* 3. Spending */}
                              <div className="flex justify-between items-center border-t border-black/5 pt-0.5 mt-0.5">
                                <span className="text-[9px] font-bold text-black/40 sans-serif whitespace-nowrap scale-90 origin-left">支出</span>
                                <span className={`text-xs font-bold whitespace-nowrap ${monthlySpending > 0 ? 'text-[#e65100]' : 'text-black/20'}`}>
                                  {monthlySpending > 0 ? `¥${Math.round(monthlySpending).toLocaleString()}` : '-'}
                                </span>
                              </div>
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}

                {/* Add Item Button Row */}
                {!collapsedAccounts[acc.id] && (
                  <tr>
                    <td className="sticky left-0 bg-[#FAF9F6] border-b border-[#E65100]/20 p-0 text-right">
                      <button onClick={() => { setActiveAccount(acc); setActiveItem(null); setModalType('item'); }} className="my-2 mr-4 ml-auto px-4 py-2 text-xs font-black text-[#E65100] hover:text-white bg-white hover:bg-[#E65100] border border-[#E65100] rounded-full transition-all flex items-center gap-2 shadow-sm w-fit">
                        <PlusCircle size={14} /> 目的を追加
                      </button>
                    </td>
                    <td colSpan={futureMonths.length} className="bg-[#FAF9F6] border-b border-[#E65100]/20"></td>
                  </tr>
                )}
              </React.Fragment>
            ))}

            {/* --- Section 4: Add New Account --- */}
            <tr>
              <td className="sticky left-0 bg-[#FAF9F6] p-6">
                <button onClick={() => { setActiveAccount(null); setModalType('account'); }} className="w-full py-4 border-2 border-dashed border-[#E65100]/40 rounded-2xl text-[#E65100] font-black hover:border-[#E65100] hover:bg-[#FFF8E1] transition-all flex items-center justify-center gap-2">
                  <PlusCircle size={20} /> 新しい口座を追加
                </button>
              </td>
              <td colSpan={futureMonths.length} className="bg-[#FAF9F6]"></td>
            </tr>

          </tbody>
        </table>
      </div>

      {/* --- Modals (Reused & Localized) --- */}
      {(modalType === 'account' || modalType === 'editAccount') && (
        <div className="fixed inset-0 bg-stone-900/40 backdrop-blur-sm z-[100] flex items-center justify-center p-6 animate-in text-left">
          <div className="bg-[#FAF9F6] rounded-[2rem] w-full max-w-sm p-8 shadow-2xl scale-in ring-1 ring-black/5">
            <h3 className="text-xl font-black text-slate-800 mb-6 font-serif tracking-tight">{modalType === 'account' ? '新しい口座を追加' : '口座設定'}</h3>
            <form onSubmit={async (e) => {
              e.preventDefault(); const f = new FormData(e.target);
              const init = parseCurrency(f.get('initialBalance'));
              await handleSave('accounts', { id: activeAccount?.id || `acc-${Date.now()}`, name: f.get('name'), startMonth: f.get('startMonth'), initialBalance: init, actualBalance: activeAccount ? (activeAccount.actualBalance || init) : init, order: activeAccount?.order || accounts.length });
              setModalType(null); setActiveAccount(null);
            }} className="space-y-5">
              <div>
                <label className="block text-[10px] font-bold text-stone-400 uppercase mb-1.5 tracking-wider">口座名称</label>
                <input name="name" autoFocus defaultValue={activeAccount?.name || ''} required className="w-full bg-white rounded-xl p-3.5 font-bold text-slate-700 outline-none ring-1 ring-stone-200 focus:ring-2 focus:ring-amber-400 transition-all shadow-sm" placeholder="例: 住信SBI: 車関係" />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-stone-400 uppercase mb-1.5 tracking-wider">管理開始月</label>
                <input name="startMonth" type="month" defaultValue={activeAccount?.startMonth || DEFAULT_START_DATE} required className="w-full bg-white rounded-xl p-3.5 font-bold text-slate-700 outline-none ring-1 ring-stone-200 focus:ring-2 focus:ring-amber-400 transition-all shadow-sm" />
              </div>
              <div className="p-4 bg-white rounded-xl border border-stone-100 shadow-sm">
                <label className="block text-[10px] font-bold text-stone-400 mb-2 tracking-wider">開始時点の残高</label>
                <input name="initialBalance" defaultValue={activeAccount?.initialBalance || '0'} inputMode="decimal" required className="w-full bg-stone-50 rounded-lg p-2 font-mono text-lg font-black text-slate-700 border-none focus:ring-0 text-right" placeholder="¥ 0" />
              </div>
              <div className="flex flex-col gap-3 pt-2">
                <button type="submit" className="w-full bg-slate-800 hover:bg-slate-700 text-white font-bold py-3.5 rounded-xl shadow-lg shadow-slate-900/20 active:scale-95 transition-all">保存する</button>
                {modalType === 'editAccount' && (
                  <button type="button" onClick={async () => { if (confirm('本当に削除しますか？')) await handleSave('accounts', activeAccount, true); setModalType(null); }} className="text-rose-500 font-bold text-xs py-2 hover:bg-rose-50 rounded-lg transition-colors">
                    この口座を削除
                  </button>
                )}
                <button type="button" onClick={() => { setModalType(null); setActiveAccount(null); }} className="text-stone-400 font-bold text-xs py-2 hover:bg-stone-100 rounded-lg transition-colors">
                  キャンセル
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {modalType === 'item' && (
        <div className="fixed inset-0 bg-stone-900/40 backdrop-blur-sm z-[100] flex items-center justify-center p-6 text-left">
          <div className="bg-[#FAF9F6] rounded-[2rem] w-full max-w-lg p-8 shadow-2xl overflow-y-auto max-h-[90vh] scale-in ring-1 ring-black/5">
            <h3 className="text-xl font-black text-slate-800 mb-6 font-serif tracking-tight">{activeItem ? '目的を編集' : '新しい目的を追加'}</h3>
            <form className="space-y-5" onSubmit={async (e) => {
              e.preventDefault(); const f = new FormData(e.target);
              await handleSave('items', {
                id: activeItem?.id || `item-${Date.now()}`,
                accountId: activeAccount?.id,
                name: f.get('name'),
                startMonth: f.get('startMonth'),
                targetAmount: parseCurrency(f.get('amount')),
                initialBalance: parseCurrency(f.get('initial')),
                useMonth: f.get('month'),
                interval: parseInt(f.get('interval') || 0),
                count: parseInt(f.get('count') || 1),
                status: 'active',
                order: activeItem?.order
              });
              setModalType(null); setActiveItem(null);
            }}>
              <div>
                <label className="block text-[10px] font-bold text-stone-400 uppercase mb-1.5 tracking-wider">目的の名称</label>
                <input name="name" autoFocus defaultValue={activeItem?.name || ''} required className="w-full bg-white rounded-xl p-3.5 font-bold text-slate-700 outline-none ring-1 ring-stone-200 focus:ring-2 focus:ring-amber-400 transition-all shadow-sm" placeholder="例: バッテリー交換" />
              </div>

              <div className="grid grid-cols-2 gap-5">
                <div>
                  <label className="block text-[10px] font-bold text-stone-400 uppercase mb-1.5 tracking-wider">積立開始月</label>
                  <input name="startMonth" type="month" defaultValue={activeItem?.startMonth || activeAccount?.startMonth || DEFAULT_START_DATE} required className="w-full bg-white rounded-xl p-3.5 font-bold text-slate-700 outline-none ring-1 ring-stone-200 focus:ring-2 focus:ring-amber-400 transition-all shadow-sm" />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-stone-400 uppercase mb-1.5 tracking-wider">現在の積立済み額</label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400 font-bold">¥</span>
                    <input name="initial" defaultValue={activeItem?.initialBalance || '0'} inputMode="decimal" className="w-full bg-white rounded-xl p-3.5 pl-8 font-mono font-bold text-slate-700 outline-none ring-1 ring-stone-200 focus:ring-2 focus:ring-amber-400 transition-all shadow-sm text-right" />
                  </div>
                </div>
              </div>

              <div className="bg-white p-5 rounded-2xl border border-stone-100 shadow-sm space-y-4">
                <div className="grid grid-cols-2 gap-5">
                  <div>
                    <label className="block text-[10px] font-bold text-stone-400 uppercase mb-1.5 tracking-wider">目標金額</label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400 font-bold">¥</span>
                      <input name="amount" defaultValue={activeItem?.targetAmount || ''} inputMode="decimal" required className="w-full bg-stone-50 rounded-xl p-3.5 pl-8 font-mono font-bold text-slate-700 outline-none ring-1 ring-stone-200 focus:ring-2 focus:ring-amber-400 transition-all text-right" />
                    </div>
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-stone-400 uppercase mb-1.5 tracking-wider">使用予定月</label>
                    <input name="month" type="month" defaultValue={activeItem?.useMonth || ''} required className="w-full bg-stone-50 rounded-xl p-3.5 font-bold text-slate-700 outline-none ring-1 ring-stone-200 focus:ring-2 focus:ring-amber-400 transition-all" />
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-5 pt-2">
                <div>
                  <label className="block text-[10px] font-bold text-stone-400 uppercase mb-1.5 tracking-wider">繰り返し間隔 (ヶ月)</label>
                  <input name="interval" type="number" defaultValue={activeItem?.interval || '0'} className="w-full bg-white rounded-xl p-3.5 font-bold text-slate-700 outline-none ring-1 ring-stone-200 focus:ring-2 focus:ring-amber-400 transition-all shadow-sm" placeholder="0 = 1回のみ" />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-stone-400 uppercase mb-1.5 tracking-wider">繰り返し回数</label>
                  <input name="count" type="number" defaultValue={activeItem?.count || '1'} className="w-full bg-white rounded-xl p-3.5 font-bold text-slate-700 outline-none ring-1 ring-stone-200 focus:ring-2 focus:ring-amber-400 transition-all shadow-sm" placeholder="1" />
                </div>
              </div>

              <div className="flex flex-col gap-3 pt-6">
                <button type="submit" className="w-full bg-slate-800 hover:bg-slate-700 text-white font-bold py-3.5 rounded-xl shadow-lg shadow-slate-900/20 active:scale-95 transition-all">保存する</button>
                <button type="button" onClick={() => { setModalType(null); setActiveItem(null); }} className="text-stone-400 font-bold text-xs py-2 hover:bg-stone-100 rounded-lg transition-colors">
                  キャンセル
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Category Selection Modal for Monthly CSV Update */}
      {showCategorySelector && csvUploadMonth && csvUploadData !== null && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex items-center justify-center p-6 text-left">
          <div className="bg-[#FFF8E1] rounded-[2rem] w-full max-w-md p-8 shadow-2xl scale-in ring-4 ring-[#1e3a8a]">
            <h3 className="text-xl font-black text-black mb-4 font-sans tracking-tight border-b-2 border-[#1e3a8a] pb-2">
              {csvUploadMonth}月の残高を更新
            </h3>
            <div className="mb-4 p-3 bg-white rounded-lg border border-[#1e3a8a]/30">
              <div className="text-sm font-bold text-black/60">抽出された残高</div>
              <div className="text-2xl font-black text-[#1e3a8a] font-mono">
                ¥{Math.round(csvUploadData).toLocaleString()}
              </div>
            </div>
            <p className="text-sm text-black/70 mb-4 font-bold">
              この残高を反映する口座（カテゴリ）を選択してください：
            </p>
            <div className="max-h-[300px] overflow-y-auto space-y-2 mb-6">
              {accounts.map(acc => (
                <button
                  key={acc.id}
                  onClick={() => applyCategoryBalance(acc.id)}
                  className="w-full text-left p-3 rounded-lg bg-white hover:bg-amber-50 border border-black/10 hover:border-[#E65100]/30 transition-all shadow-sm group"
                >
                  <div className="flex justify-between items-center">
                    <div className="text-base font-black text-black group-hover:text-[#E65100]">{acc.name}</div>
                    <ChevronDown className="rotate-[-90deg] text-black/30 group-hover:text-[#E65100]" size={16} />
                  </div>
                </button>
              ))}
            </div>
            <button
              onClick={() => {
                setShowCategorySelector(false);
                setCsvUploadMonth(null);
                setCsvUploadData(null);
              }}
              className="w-full py-3 text-center font-bold text-black/60 hover:bg-black/5 rounded-lg transition-colors"
            >
              キャンセル
            </button>
          </div>
        </div>
      )}

      <style>{`.scale-in { animation: scaleIn 0.2s cubic-bezier(0.16, 1, 0.3, 1); } @keyframes scaleIn { from { transform: scale(0.95); opacity: 0; } to { transform: scale(1); opacity: 1; } }`}</style>
    </div>
  );
}
