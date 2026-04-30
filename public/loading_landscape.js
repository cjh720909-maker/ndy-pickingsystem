// loading.js

const LANDSCAPE_ROWS_PER_PAGE = 45; // Adjust this number to fit A4 page perfectly

async function fetchLoadingLandscapeData() {
    const startDate = document.getElementById('startDate').value;
    const endDate = document.getElementById('endDate').value;
    const driverInput = document.getElementById('driverInput').value;

    if (!startDate || !endDate) {
        alert("시작일과 종료일을 설정해주세요.");
        return;
    }

    if (!driverInput) {
        alert("기사명을 입력해주세요.");
        return;
    }

    try {
        const url = `/api/loading-list?startDate=${startDate}&endDate=${endDate}&driverName=${encodeURIComponent(driverInput)}`;
        const response = await fetch(url);
        const result = await response.json();

        if (result.error) {
            alert("Error: " + result.error);
            return;
        }

        renderLoadingLandscapeData(result.data, result.summary, driverInput, startDate);

    } catch (e) {
        console.error(e);
        alert("데이터를 가져오는 중 오류가 발생했습니다.");
    }
}

function renderLoadingLandscapeData(data, summary, searchDriver, printDate) {
    const pagesContainer = document.getElementById('loadingLandscape-pages-container');
    const summaryCards = document.getElementById('loadingLandscape-summaryCards');

    let driverNameStr = data.length > 0 ? data[0].driverName : searchDriver;
    let dockNoStr = data.length > 0 ? data[0].dockNo : '';
    let totalWeightStr = summary.totalWeight.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 });

    // Update Summary Cards (Web View)
    summaryCards.innerHTML = `
        <div class="px-3 py-1.5 bg-indigo-50 border border-indigo-100 rounded flex items-center gap-2">
            <span class="text-[10px] font-bold text-indigo-400">조회 기사</span>
            <span class="text-xs font-bold text-indigo-900">${driverNameStr}</span>
        </div>
        <div class="px-3 py-1.5 bg-indigo-50 border border-indigo-100 rounded flex items-center gap-2">
            <span class="text-[10px] font-bold text-indigo-400">도크 번호</span>
            <span class="text-xs font-bold text-indigo-900">${dockNoStr || '-'}</span>
        </div>
        <div class="px-3 py-1.5 bg-indigo-50 border border-indigo-100 rounded flex items-center gap-2">
            <span class="text-[10px] font-bold text-indigo-400">총 중량</span>
            <span class="text-xs font-bold text-indigo-900">${totalWeightStr} kg</span>
        </div>
        <div class="px-3 py-1.5 bg-indigo-50 border border-indigo-100 rounded flex items-center gap-2">
            <span class="text-[10px] font-bold text-indigo-400">총 품목 수</span>
            <span class="text-xs font-bold text-indigo-900">${data.length} 건</span>
        </div>
    `;

    if (!data || data.length === 0) {
        pagesContainer.innerHTML = `<div class="p-8 text-center text-slate-400 bg-white border rounded shadow-sm">해당 조건에 데이터가 없습니다.</div>`;
        return;
    }

    // Split data into pages
    const totalPages = Math.ceil(data.length / LANDSCAPE_ROWS_PER_PAGE);
    let html = '';

    for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
        const startIndex = (pageNum - 1) * LANDSCAPE_ROWS_PER_PAGE;
        const endIndex = Math.min(startIndex + LANDSCAPE_ROWS_PER_PAGE, data.length);
        const pageData = data.slice(startIndex, endIndex);

        let tableRowsHtml = '';
        let currentCustomer = null;

        pageData.forEach((row, index) => {
            // First item in this page, or customer changed
            let isFirstOfCustomer = false;
            
            if (currentCustomer !== row.customerName) {
                currentCustomer = row.customerName;
                isFirstOfCustomer = true;
            } else if (index === 0) {
                // If it's the first row of the page but same customer as previous page, we still might want to show name
                isFirstOfCustomer = true;
            }

            const borderClass = isFirstOfCustomer ? 'border-t-2 border-black' : 'border-t border-slate-300';
            
            const fullBarcode = row.barcode || '';

            // Checkbox state
            const showBarcode = document.getElementById('showBarcodeCheck')?.checked || false;

            let customerDisplay = '';
            if (isFirstOfCustomer) {
                customerDisplay = `<div class="font-bold leading-tight break-words" title="${row.customerName}">${row.customerName}</div>`;
            } else {
                if (showBarcode && fullBarcode) {
                    customerDisplay = `<div class="text-[11px] text-slate-500 font-mono tracking-wider pt-0.5">${fullBarcode}</div>`;
                }
            }

            const boxStr = row.boxes > 0 ? row.boxes : '';
            const pieceStr = row.pieces > 0 ? row.pieces : '';
            
            const isSpecialClass = row.pickingClass && (row.pickingClass.includes('냉동') || row.pickingClass.includes('콩나물'));
            const extraBoldClass = isSpecialClass ? 'font-bold' : '';

            tableRowsHtml += `
                <tr class="${borderClass} hover:bg-slate-50 transition-colors">
                    <td class="w-[230px] border-r border-slate-300 px-1 py-1 align-top">${customerDisplay}</td>
                    <td class="border-r border-slate-300 px-1 py-1 leading-tight break-words ${extraBoldClass}" title="${row.productName}">${row.productName}</td>
                    <td class="w-[55px] text-right border-r border-slate-300 px-1 py-1">${boxStr}</td>
                    <td class="w-[55px] text-right border-r border-slate-300 px-1 py-1">${pieceStr}</td>
                    <td class="w-[55px] text-right border-r border-slate-300 px-1 py-1">${row.totalQty.toLocaleString()}</td>
                    <td class="w-[75px] text-center px-1 py-1 ${extraBoldClass}">${row.pickingClass}</td>
                </tr>
            `;
        });

        tableRowsHtml += `<tr class="border-t-2 border-black"></tr>`;

        html += `
            <div class="print-area bg-white border border-slate-300 shadow-sm mb-8 overflow-hidden mx-auto" style="width: 29.7cm; min-height: 21cm; padding: 0.5cm; box-sizing: border-box;">
                <!-- Header Info for Print -->
                <div class="flex justify-between items-end mb-1 pb-1 font-bold text-sm">
                    <div class="flex gap-4 items-end">
                        <div class="text-lg flex items-end">기사명 <span class="ml-2 text-xl inline-block w-28 border-b border-black text-center">${driverNameStr}</span></div>
                        ${dockNoStr ? `<div class="text-lg flex items-end">도크: <span class="ml-1 text-xl inline-block w-16 border-b border-black text-center">${dockNoStr}</span></div>` : ''}
                        <div class="text-lg flex items-end">총중량: <span class="ml-1 w-24 inline-block text-right border-b border-black">${totalWeightStr}</span> kg</div>
                    </div>
                    <div class="flex gap-4 items-center">
                        <div class="text-sm text-slate-600">Page ${pageNum} / ${totalPages}</div>
                        <div class="text-lg">${printDate}</div>
                    </div>
                </div>
                
                <table class="w-full text-left text-[13px] border-collapse" style="table-layout: fixed;">
                    <thead class="border-y-2 border-black bg-slate-50 text-center font-bold text-slate-800">
                        <tr>
                            <th class="w-[230px] border-r border-slate-300 py-1">거래처</th>
                            <th class="border-r border-slate-300 py-1">제품명</th>
                            <th class="w-[55px] border-r border-slate-300 py-1">박스</th>
                            <th class="w-[55px] border-r border-slate-300 py-1">낱개</th>
                            <th class="w-[55px] border-r border-slate-300 py-1">총량</th>
                            <th class="w-[75px] py-1">구분</th>
                        </tr>
                    </thead>
                    <tbody class="text-black">
                        ${tableRowsHtml}
                    </tbody>
                </table>
            </div>
        `;
    }

    pagesContainer.innerHTML = html;
}
