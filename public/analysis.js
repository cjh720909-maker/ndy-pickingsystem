/**
 * Picking Analysis Logic (Enhanced with Dispatch Name)
 */

async function fetchAnalysisData() {
    const sDate = document.getElementById('startDate').value;
    const eDate = document.getElementById('endDate').value;
    const pickingClass = document.getElementById('analysisSelect').value;

    const tbody = document.getElementById('analysis-tableBody');
    const cards = document.getElementById('analysis-summaryCards');

    if (!sDate || !eDate) return alert("날짜를 선택해주세요.");

    // Loading State
    tbody.innerHTML = '<tr><td colspan="12" class="p-12 text-center"><div class="animate-spin inline-block w-8 h-8 border-4 border-indigo-500 border-t-transparent rounded-full mb-2"></div><div class="text-indigo-600 font-bold">정밀 분석 진행 중...</div></td></tr>';

    try {
        // 배차명이 포함된 전용 분석 API 호출
        const url = `/api/picking-analysis?startDate=${sDate}&endDate=${eDate}&pickingClass=${encodeURIComponent(pickingClass)}`;
        const res = await fetch(url);
        const json = await res.json();

        if (json.error) {
            alert('분석 에러: ' + json.error);
            tbody.innerHTML = '<tr><td colspan="12" class="p-8 text-center text-red-500">조회 실패</td></tr>';
            return;
        }

        // 정렬을 위해 데이터 저장
        window.appState.analysisData = json.data;
        window.appState.analysisSummary = json; // 전체 저장

        renderAnalysisData(json.data, tbody, cards);
    } catch (e) {
        console.error(e);
        tbody.innerHTML = '<tr><td colspan="12" class="p-8 text-center text-red-500">서버 통신 오류</td></tr>';
    }
}

function renderAnalysisData(data, tbody, cards) {
    if (data.length === 0) {
        tbody.innerHTML = '<tr><td colspan="12" class="p-8 text-center text-slate-400">데이터가 없습니다. 다른 분류를 선택해 보세요.</td></tr>';
        cards.innerHTML = '';
        return;
    }

    const totalPick = data.reduce((a, c) => a + c.pickCount, 0);
    const totalQty = data.reduce((a, c) => a + c.totalQty, 0);
    const totalWeight = data.reduce((a, c) => a + c.totalWeight, 0);

    // 1. Cards (Ultra Slim Chips)
    cards.innerHTML = `
        <div class="bg-white px-3 py-1.5 rounded-full shadow-sm border border-slate-200 flex items-center gap-2">
            <div class="w-1.5 h-1.5 rounded-full bg-indigo-600"></div>
            <span class="text-[11px] font-bold text-slate-400 uppercase">전체 피킹</span>
            <span class="text-sm font-bold text-slate-800">${formatNumber(totalPick)} <span class="text-[10px] ml-0.5 font-normal">건</span></span>
        </div>
        <div class="bg-white px-3 py-1.5 rounded-full shadow-sm border border-slate-200 flex items-center gap-2">
            <div class="w-1.5 h-1.5 rounded-full bg-emerald-600"></div>
            <span class="text-[11px] font-bold text-slate-400 uppercase">수량 합계</span>
            <span class="text-sm font-bold text-slate-800">${formatNumber(totalQty)} <span class="text-[10px] ml-0.5 font-normal">ea</span></span>
        </div>
        <div class="bg-white px-3 py-1.5 rounded-full shadow-sm border border-slate-200 flex items-center gap-2">
            <div class="w-1.5 h-1.5 rounded-full bg-orange-600"></div>
            <span class="text-[11px] font-bold text-slate-400 uppercase">중량 합계</span>
            <span class="text-sm font-bold text-slate-800">${formatNumber(totalWeight)} <span class="text-[10px] ml-0.5 font-normal">kg</span></span>
        </div>
    `;

    // 2. Table Body (Must match header widths)
    tbody.innerHTML = data.map((row, i) => {
        const share = totalPick > 0 ? ((row.pickCount / totalPick) * 100).toFixed(1) : 0;
        return `
        <tr class="hover:bg-indigo-50 border-b border-slate-50 last:border-0 transition-colors flex px-6">
            <td class="py-3 text-center text-slate-400 w-[50px] shrink-0">${i + 1}</td>
            <td class="py-3 font-bold text-slate-800 w-[130px] shrink-0 truncate">${row.groupName}</td>
            <td class="py-3 text-slate-600 font-medium w-[150px] shrink-0 truncate">${row.driverName || row.groupName}</td>
            <td class="py-3 text-center w-[80px] shrink-0">
                <span class="px-1.5 py-0.5 bg-blue-50 text-blue-600 rounded text-[10px] border border-blue-100 italic">
                    ${row.dockNo}
                </span>
            </td>
            <td class="py-3 text-right font-bold text-blue-700 w-[100px] shrink-0">${formatNumber(row.totalBoxes)}</td>
            <td class="py-3 text-right font-medium text-blue-500 w-[100px] shrink-0">${formatNumber(row.totalItems)}</td>
            <td class="py-3 text-right font-bold text-indigo-600 w-[100px] shrink-0">${formatNumber(row.pickCount)}</td>
            <td class="py-3 text-right text-slate-600 w-[110px] shrink-0">${formatNumber(row.totalQty)}</td>
            <td class="py-3 text-right text-slate-800 w-[110px] shrink-0 font-medium">${formatNumber(row.totalWeight)}</td>
            <td class="py-3 flex-grow shrink-0 flex items-center justify-center">
                <div class="flex items-center gap-1.5">
                    <div class="w-12 bg-slate-200 rounded-full h-1">
                        <div class="bg-indigo-500 h-1 rounded-full" style="width: ${share}%"></div>
                    </div>
                    <span class="text-[10px] text-slate-400 w-6 text-right">${share}%</span>
                </div>
            </td>
        </tr>
        `;
    }).join('');
}
