/**
 * Common Utilities for Dispatch/Picking System
 */

function toDateStr(d) {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}

function formatNumber(n) {
    return n ? n.toLocaleString('ko-KR') : '0';
}

function setDateRange(minusStart, minusEnd, btnId) {
    const s = new Date(); s.setDate(s.getDate() - minusStart);
    const e = new Date(); e.setDate(e.getDate() - minusEnd);
    document.getElementById('startDate').value = toDateStr(s);
    document.getElementById('endDate').value = toDateStr(e);

    // 버튼 하이라이트 처리
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

// Initialization for common elements
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

    // 초기 로딩 시 '오늘' 버튼 강조
    setToday();
});
