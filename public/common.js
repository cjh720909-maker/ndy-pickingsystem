// 글로벌 상태 관리
window.appState = {
    dispatchData: [],
    pickingData: [],
    analysisData: [],
    sortKey: '',
    sortOrder: 'asc' // 'asc' or 'desc'
};

function toDateStr(d) {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}

function formatNumber(n) {
    return n ? n.toLocaleString('ko-KR') : '0';
}

/**
 * 데이터 정렬 함수
 * @param {string} view - 'dispatch', 'picking', 'analysis' 중 하나
 * @param {string} key - 정렬 기준 필드명
 * @param {string} type - 'number' 또는 'string'
 */
function handleSort(view, key, type = 'string') {
    let targetData = [];
    if (view === 'dispatch') targetData = window.appState.dispatchData;
    else if (view === 'picking') targetData = window.appState.pickingData;
    else if (view === 'analysis') targetData = window.appState.analysisData;

    if (!targetData || targetData.length === 0) return;

    // 정렬 방향 토글
    if (window.appState.sortKey === key) {
        window.appState.sortOrder = window.appState.sortOrder === 'asc' ? 'desc' : 'asc';
    } else {
        window.appState.sortKey = key;
        window.appState.sortOrder = 'desc'; // 기본적으로 큰 값(내림차순)부터 보여주는 게 리포트에서 유용함
    }

    // 정렬 수행
    targetData.sort((a, b) => {
        let valA = a[key];
        let valB = b[key];

        if (type === 'number') {
            valA = parseFloat(valA) || 0;
            valB = parseFloat(valB) || 0;
        } else {
            valA = String(valA || "").toLowerCase();
            valB = String(valB || "").toLowerCase();
        }

        if (valA < valB) return window.appState.sortOrder === 'asc' ? -1 : 1;
        if (valA > valB) return window.appState.sortOrder === 'asc' ? 1 : -1;
        return 0;
    });

    // 화면 다시 그리기
    if (view === 'dispatch') renderDispatchData({ data: targetData, summary: window.appState.dispatchSummary }, document.getElementById('dispatch-tableBody'), document.getElementById('dispatch-summaryCards'));
    else if (view === 'picking') renderPickingData({ data: targetData, summary: window.appState.pickingSummary }, document.getElementById('picking-tableBody'), document.getElementById('picking-summaryCards'));
    else if (view === 'analysis') renderAnalysisData(targetData, document.getElementById('analysis-tableBody'), document.getElementById('analysis-summaryCards'));

    // 헤더 아이콘 업데이트 (선택 사항)
    updateSortIcons(view, key, window.appState.sortOrder);
}

function updateSortIcons(view, key, order) {
    const headerId = `${view}-header`;
    const headers = document.querySelectorAll(`#${headerId} > div`);
    headers.forEach(h => {
        // 기존 화살표 제거
        const text = h.innerText.replace(' ▲', '').replace(' ▼', '');
        h.innerText = text;

        // 현재 클릭한 항목에 화살표 추가
        if (h.getAttribute('data-sort') === key) {
            h.innerText += (order === 'asc' ? ' ▲' : ' ▼');
            h.classList.add('text-indigo-600');
        } else {
            h.classList.remove('text-indigo-600');
        }
    });
}

function setDateRange(minusStart, minusEnd, btnId) {
    const s = new Date(); s.setDate(s.getDate() - minusStart);
    const e = new Date(); e.setDate(e.getDate() - minusEnd);
    document.getElementById('startDate').value = toDateStr(s);
    document.getElementById('endDate').value = toDateStr(e);

    document.querySelectorAll('.date-btn').forEach(btn => {
        btn.classList.remove('bg-indigo-600', 'text-white', 'shadow-md', 'scale-105');
        btn.classList.add('bg-slate-100', 'text-slate-600');
    });

    if (btnId) {
        const activeBtn = document.getElementById(btnId);
        if (activeBtn) {
            activeBtn.classList.remove('bg-slate-100', 'text-slate-600');
            activeBtn.classList.add('bg-indigo-600', 'text-white', 'shadow-md', 'scale-105');
        }
    }
}

function setToday() { setDateRange(0, 0, 'btn-today'); }
function setYesterday() { setDateRange(1, 1, 'btn-yesterday'); }
function setLast7Days() { setDateRange(7, 0, 'btn-7days'); }

document.addEventListener('DOMContentLoaded', () => {
    const today = new Date();
    const todayStr = toDateStr(today);
    const startInput = document.getElementById('startDate');
    const endInput = document.getElementById('endDate');
    const dateDisplay = document.getElementById('currentDate');

    if (startInput) startInput.value = todayStr;
    if (endInput) endInput.value = todayStr;
    if (dateDisplay) {
        dateDisplay.innerText = today.toLocaleDateString('ko-KR', {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });
    }

    setToday();
});
