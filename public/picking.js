/**
 * Picking Summary Logic
 */

async function fetchPickingData() {
    const sDate = document.getElementById('startDate').value;
    const eDate = document.getElementById('endDate').value;
    const custName = document.getElementById('custSelect').value;

    const tbody = document.getElementById('picking-tableBody');
    const cards = document.getElementById('picking-summaryCards');

    if (!sDate || !eDate) return alert("날짜를 선택해주세요.");

    // Loading State
    tbody.innerHTML = '<tr><td colspan="10" class="p-12 text-center"><div class="animate-spin inline-block w-8 h-8 border-4 border-indigo-500 border-t-transparent rounded-full mb-2"></div><div class="text-indigo-600 font-bold">피킹 데이터 분석 중...</div></td></tr>';

    try {
        const url = `/api/picking-summary?startDate=${sDate}&endDate=${eDate}&custName=${encodeURIComponent(custName)}`;
        const res = await fetch(url);
        const json = await res.json();

        // 정렬을 위해 데이터 저장
        window.appState.pickingData = json.data;
        window.appState.pickingSummary = json; // summary 객체가 따로 없으므로 전체 저장

        renderPickingData(json, tbody, cards);
    } catch (e) {
        console.error(e);
        tbody.innerHTML = '<tr><td colspan="10" class="p-8 text-center text-red-500">서버 통신 오류</td></tr>';
    }
}

function renderPickingData(json, tbody, cards) {
    const { data } = json;

    if (data.length === 0) {
        tbody.innerHTML = '<tr><td colspan="10" class="p-8 text-center text-slate-400">해당 기간에 피킹 데이터가 없습니다.</td></tr>';
        cards.innerHTML = '';
        return;
    }

    const totalPick = data.reduce((a, c) => a + c.pickCount, 0);
    const totalQty = data.reduce((a, c) => a + c.totalQty, 0);
    const totalWeight = data.reduce((a, c) => a + c.totalWeight, 0);

    // 1. Cards (Ultra Slim Chips)
    cards.innerHTML = `
        <div class="bg-white px-3 py-1.5 rounded-full shadow-sm border border-slate-200 flex items-center gap-2">
            <div class="w-1.5 h-1.5 rounded-full bg-indigo-500"></div>
            <span class="text-[11px] font-bold text-slate-400 uppercase">전체 피킹</span>
            <span class="text-sm font-bold text-slate-800">${formatNumber(totalPick)} <span class="text-[10px] ml-0.5 font-normal">라인</span></span>
        </div>
        <div class="bg-white px-3 py-1.5 rounded-full shadow-sm border border-slate-200 flex items-center gap-2">
            <div class="w-1.5 h-1.5 rounded-full bg-emerald-500"></div>
            <span class="text-[11px] font-bold text-slate-400 uppercase">수량 합계</span>
            <span class="text-sm font-bold text-slate-800">${formatNumber(totalQty)} <span class="text-[10px] ml-0.5 font-normal">ea</span></span>
        </div>
        <div class="bg-white px-3 py-1.5 rounded-full shadow-sm border border-slate-200 flex items-center gap-2">
            <div class="w-1.5 h-1.5 rounded-full bg-orange-500"></div>
            <span class="text-[11px] font-bold text-slate-400 uppercase">중량 합계</span>
            <span class="text-sm font-bold text-slate-800">${formatNumber(totalWeight)} <span class="text-[10px] ml-0.5 font-normal">kg</span></span>
        </div>
    `;

    // 2. Table Body (Must match header widths)
    tbody.innerHTML = data.map((row, i) => {
        const share = totalPick > 0 ? ((row.pickCount / totalPick) * 100).toFixed(1) : 0;
        const isDas = row.isDas === 'Y' ? '<span class="text-indigo-600 font-bold">사용</span>' : '<span class="text-slate-400">안함</span>';
        return `
        <tr class="hover:bg-slate-50 border-b border-slate-50 last:border-0 flex px-6">
            <td class="py-3 text-center text-slate-400 w-[50px] shrink-0">${i + 1}</td>
            <td class="py-3 font-bold text-slate-800 w-[200px] shrink-0 truncate">${row.className}</td>
            <td class="py-3 text-center w-[80px] shrink-0 text-xs">${isDas}</td>
            <td class="py-3 text-right w-[130px] shrink-0 font-medium">${formatNumber(row.pickCount)}</td>
            <td class="py-3 text-right w-[140px] shrink-0 text-slate-600">${formatNumber(row.totalQty)}</td>
            <td class="py-3 text-right w-[140px] shrink-0 text-indigo-700 font-bold">${formatNumber(row.totalWeight)}</td>
            <td class="py-3 flex-grow shrink-0 flex items-center justify-center">
                <div class="flex items-center gap-1.5">
                    <div class="w-16 bg-slate-200 rounded-full h-1">
                        <div class="bg-blue-500 h-1 rounded-full" style="width: ${share}%"></div>
                    </div>
                    <span class="text-[10px] text-slate-400 w-6 text-right">${share}%</span>
                </div>
            </td>
        </tr>
        `;
    }).join('');
}
