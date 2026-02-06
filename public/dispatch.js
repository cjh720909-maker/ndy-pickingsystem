/**
 * Dispatch Summary Logic
 */

async function fetchDispatchData() {
    const sDate = document.getElementById('startDate').value;
    const eDate = document.getElementById('endDate').value;
    const driverVal = document.getElementById('driverInput').value;
    const custName = document.getElementById('custSelect').value;

    const tbody = document.getElementById('dispatch-tableBody');
    const cards = document.getElementById('dispatch-summaryCards');

    if (!sDate || !eDate) return alert("날짜를 선택해주세요.");

    // Loading State
    tbody.innerHTML = '<tr><td colspan="9" class="p-12 text-center"><div class="animate-spin inline-block w-8 h-8 border-4 border-indigo-500 border-t-transparent rounded-full mb-2"></div><div class="text-indigo-600 font-bold">배차 데이터 분석 중...</div></td></tr>';

    try {
        const url = `/api/summary?startDate=${sDate}&endDate=${eDate}&drivers=${encodeURIComponent(driverVal)}&custName=${encodeURIComponent(custName)}`;
        const res = await fetch(url);
        const json = await res.json();

        if (json.error) {
            alert('배차 데이터 에러: ' + json.error);
            tbody.innerHTML = '<tr><td colspan="9" class="p-8 text-center text-red-500">조회 실패</td></tr>';
            return;
        }

        // 정렬을 위해 데이터 저장
        window.appState.dispatchData = json.data;
        window.appState.dispatchSummary = json.summary;

        renderDispatchData(json, tbody, cards);
    } catch (e) {
        console.error(e);
        tbody.innerHTML = '<tr><td colspan="9" class="p-8 text-center text-red-500">서버 통신 오류</td></tr>';
    }
}

function renderDispatchData(json, tbody, cards) {
    const { data, summary } = json;

    if (data.length === 0) {
        tbody.innerHTML = '<tr><td colspan="9" class="p-8 text-center text-slate-400">해당 기간에 배차 데이터가 없습니다.</td></tr>';
        cards.innerHTML = '';
        return;
    }

    // 1. Cards (Ultra Slim Chips)
    cards.innerHTML = `
        <div class="bg-white px-3 py-1.5 rounded-full shadow-sm border border-slate-200 flex items-center gap-2">
            <div class="w-1.5 h-1.5 rounded-full bg-blue-500"></div>
            <span class="text-[11px] font-bold text-slate-400 uppercase">기사</span>
            <span class="text-sm font-bold text-slate-800">${formatNumber(summary.totalDrivers)}</span>
        </div>
        <div class="bg-white px-3 py-1.5 rounded-full shadow-sm border border-slate-200 flex items-center gap-2">
            <div class="w-1.5 h-1.5 rounded-full bg-cyan-500"></div>
            <span class="text-[11px] font-bold text-slate-400 uppercase">배차</span>
            <span class="text-sm font-bold text-slate-800">${formatNumber(summary.totalDispatchNames)}</span>
        </div>
        <div class="bg-white px-3 py-1.5 rounded-full shadow-sm border border-slate-200 flex items-center gap-2">
            <div class="w-1.5 h-1.5 rounded-full bg-green-500"></div>
            <span class="text-[11px] font-bold text-slate-400 uppercase">거래처</span>
            <span class="text-sm font-bold text-slate-800">${formatNumber(summary.totalDestinations)}</span>
        </div>
        <div class="bg-white px-3 py-1.5 rounded-full shadow-sm border border-slate-200 flex items-center gap-2">
            <div class="w-1.5 h-1.5 rounded-full bg-purple-500"></div>
            <span class="text-[11px] font-bold text-slate-400 uppercase">피킹</span>
            <span class="text-sm font-bold text-slate-800">${formatNumber(summary.totalShipments)}</span>
        </div>
        <div class="bg-white px-3 py-1.5 rounded-full shadow-sm border border-slate-200 flex items-center gap-2">
            <div class="w-1.5 h-1.5 rounded-full bg-orange-500"></div>
            <span class="text-[11px] font-bold text-slate-400 uppercase">총중량</span>
            <span class="text-sm font-bold text-slate-800">${formatNumber(summary.totalWeight)}<span class="text-[10px] ml-0.5 font-normal">kg</span></span>
        </div>
    `;

    // 2. Table Body (Must match header widths)
    tbody.innerHTML = data.map((row, i) => {
        const share = summary.totalWeight > 0 ? ((row.totalWeight / summary.totalWeight) * 100).toFixed(1) : 0;
        const loadRate = row.maxWeight > 0 ? ((row.totalWeight / row.maxWeight) * 100).toFixed(1) : 0;
        const loadColor = loadRate >= 80 ? 'text-red-600 font-bold' : 'text-slate-600';

        return `
        <tr class="hover:bg-slate-50 border-b border-slate-50 last:border-0 flex px-6">
            <td class="py-3 text-center text-slate-400 w-[50px] shrink-0">${i + 1}</td>
            <td class="py-3 font-bold text-slate-800 w-[100px] shrink-0 truncate">${row.driverName || '-'}</td>
            <td class="py-3 text-slate-600 w-[150px] shrink-0 truncate">${row.dispatchName}</td>
            <td class="py-3 text-right w-[100px] shrink-0">${formatNumber(row.destCount)}</td>
            <td class="py-3 text-right w-[100px] shrink-0 font-bold text-indigo-600">${formatNumber(row.totalCount)}</td>
            <td class="py-3 text-right w-[110px] shrink-0 text-indigo-700 font-medium">${formatNumber(row.totalWeight)}</td>
            <td class="py-3 text-right text-blue-600 w-[110px] shrink-0 font-medium">${row.maxWeight > 0 ? formatNumber(row.maxWeight) : '-'}</td>
            <td class="py-3 text-right ${loadColor} w-[90px] shrink-0 font-bold">${loadRate}%</td>
            <td class="py-3 flex-grow shrink-0 flex items-center justify-center">
                <div class="flex items-center gap-1.5">
                    <div class="w-16 bg-slate-200 rounded-full h-1">
                        <div class="bg-indigo-600 h-1 rounded-full" style="width: ${share}%"></div>
                    </div>
                    <span class="text-[10px] text-slate-400 w-6 text-right">${share}%</span>
                </div>
            </td>
        </tr>
        `;
    }).join('');
}
