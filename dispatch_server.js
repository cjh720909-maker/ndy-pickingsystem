// dispatch_server.js
// [SME 개발 사수] 배차 요약 화면 (기사별 납품처/중량 집계)
require('dotenv').config();
const express = require('express');
const { PrismaClient } = require('@prisma/client');
const path = require('path');
// const open = require('open'); // 브라우저 자동 실행용 (선택 사항, 없으면 생략 가능)

const app = express();
const port = 3011; // 기존 3010과 충돌 방지
const prisma = new PrismaClient();

// 정적 파일 제공 (혹시 필요할 경우를 대비)
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

const iconv = require('iconv-lite');

// ------------------------------------------------------------------
// [핵심] 깨진 한글 복구 함수 (EUC-KR)
// ------------------------------------------------------------------
function fixEncoding(str) {
    if (typeof str !== 'string') return str;
    try {
        // DB에서 binary로 읽어서 EUC-KR로 디코딩
        return iconv.decode(Buffer.from(str, 'binary'), 'euc-kr');
    } catch (e) {
        return str;
    }
}

// ------------------------------------------------------------------
// API: 배차 요약 정보 조회
// ------------------------------------------------------------------
app.get('/api/summary', async (req, res) => {
    try {
        const { startDate, endDate } = req.query;

        if (!startDate || !endDate) {
            return res.status(400).json({ error: "시작일과 종료일을 입력해주세요." });
        }

        console.log(`[API] 조회 요청: ${startDate} ~ ${endDate}`);

        // B_DATE는 VARCHAR(10) 형식이므로 문자열 비교 (YYYY-MM-DD or YYYYMMDD)
        // 입력받은 startDate, endDate가 'YYYY-MM-DD' 형식이라고 가정.

        // 데이터베이스의 B_DATE가 하이픈이 있을수도, 없을수도 있음.
        // 안전하게 둘 다 고려하거나, 포맷을 통일해서 비교해야 함.
        // 여기서는 하이픈 있는 포맷을 기준으로 조회
        const query = `
        SELECT
        b.CB_DRIVER,
            c.CA_NAME,
            COUNT(DISTINCT b.B_C_NAME) as delivery_dest_count,
            COUNT(*) as total_count,
            SUM(b.B_KG) as total_weight
            FROM t_balju b
            LEFT JOIN t_car c ON b.CB_DRIVER = c.CB_DRIVER
            WHERE b.B_DATE >= '${startDate}' AND b.B_DATE <= '${endDate}'
            AND b.CB_DRIVER IS NOT NULL AND b.CB_DRIVER <> ''
            GROUP BY b.CB_DRIVER, c.CA_NAME
            ORDER BY COALESCE(c.CA_NAME, b.CB_DRIVER) ASC
            `;

        const result = await prisma.$queryRawUnsafe(query);

        // BigInt 처리 + 한글 인코딩 변환 + 이름 조합
        const serializedResult = result.map(row => {
            const dispatchName = fixEncoding(row.CB_DRIVER) || '';
            const realName = fixEncoding(row.CA_NAME) || '';

            return {
                driverName: realName,       // 실 기사명 (t_car.CA_NAME)
                dispatchName: dispatchName, // 배차명 (t_balju.CB_DRIVER)
                destCount: Number(row.delivery_dest_count || 0),
                totalCount: Number(row.total_count || 0),
                totalWeight: Number(row.total_weight || 0)
            };
        });

        // [필터링] 기사명 검색 조건이 있는 경우 필터링 수행
        const searchDrivers = req.query.drivers ? req.query.drivers.split(',').map(d => d.trim()).filter(d => d) : [];

        let finalResult = serializedResult;
        if (searchDrivers.length > 0) {
            finalResult = serializedResult.filter(row => {
                // 기사명이 없는 경우 제외하거나 포함 여부 결정 (현재는 검색어 있으면 매칭되는 것만)
                if (!row.driverName) return false;
                // 부분 일치 허용 (OR 조건)
                return searchDrivers.some(searchName => row.driverName.includes(searchName));
            });
        }

        // 전체 합계 계산 (필터링된 결과 기준)

        // 총 배송 기사: CA_NAME 기준 (순수 기사명만 집계, 없는 경우 제외)
        // 총 배송 기사: CA_NAME 기준 (순수 기사명만 집계, 없는 경우 제외)
        const uniqueDrivers = new Set(finalResult.map(row => row.driverName).filter(name => name && name.trim() !== ''));

        const summary = {
            totalDrivers: uniqueDrivers.size,
            totalDispatchNames: finalResult.length, // CB_DRIVER count (rows count)
            totalDestinations: finalResult.reduce((acc, cur) => acc + cur.destCount, 0),
            totalShipments: finalResult.reduce((acc, cur) => acc + cur.totalCount, 0),
            totalWeight: finalResult.reduce((acc, cur) => acc + cur.totalWeight, 0)
        };

        res.json({
            data: finalResult,
            summary: summary
        });

    } catch (e) {
        console.error("API 에러:", e);
        res.status(500).json({ error: e.message });
    }
});

// ------------------------------------------------------------------
// API: 피킹 요약 정보 조회 (신규)
// ------------------------------------------------------------------
app.get('/api/picking-summary', async (req, res) => {
    try {
        const { startDate, endDate } = req.query;

        if (!startDate || !endDate) {
            return res.status(400).json({ error: "시작일과 종료일을 입력해주세요." });
        }

        console.log(`[API] 피킹 조회 요청: ${startDate} ~ ${endDate}`);

        // [주의] 연결 고리 컬럼은 실제 DB 환경에 맞춰 수정 필요
        // 가정: t_balju.B_ITEM_CODE -> t_product.P_CODE
        // 가정: t_product.P_PICKING_CLASS (또는 P_Work_Code) -> t_code_basic.bc_code (또는 상세구분 매칭)
        // t_code_basic에서 '피킹리스트분류'에 해당하는 bc_name 혹은 bc_remark를 찾아야 함.

        // 여기서는 안전하게 't_product'에 'P_PICKING_CLASS' 같은 컬럼이 있다고 가정하고 작성하되,
        // 에러 발생 시 디버깅을 위해 catch 블록 강화.

        // P_L_CLASS (대분류), P_M_CLASS (중분류), P_S_CLASS (소분류) 등이 있을 수 있음.
        // 유저 요청: "피킹리스트분류" -> t_code_basic과 연동

        // 1. 기초 코드(t_code_basic) 조회하여 DAS 매핑 테이블 생성 (JS에서 처리하여 Collation 문제 회피)
        const codes = await prisma.$queryRawUnsafe("SELECT C_DIV, C_NAME, C_IS_DAS FROM t_code_basic");
        const dasMap = new Map();
        codes.forEach(c => {
            if (fixEncoding(c.C_DIV) === '피킹리스트분류') {
                dasMap.set(fixEncoding(c.C_NAME), c.C_IS_DAS);
            }
        });

        // 2. 발주-상품 데이터 집계 (단순화된 SQL)
        const query = `
            SELECT 
                p.P_DIV_PICK as picking_class,
                COUNT(*) as pick_count,
                SUM(b.B_QTY) as total_qty,
                SUM(b.B_KG) as total_weight
            FROM t_balju b
            LEFT JOIN t_product p ON b.B_P_NO = p.P_CODE
            WHERE b.B_DATE >= '${startDate}' AND b.B_DATE <= '${endDate}'
            GROUP BY p.P_DIV_PICK
            ORDER BY pick_count DESC
        `;

        const result = await prisma.$queryRawUnsafe(query);

        // 3. 결과 매핑 및 DAS 정보 결합
        const safeResult = result.map(row => {
            const className = fixEncoding(row.picking_class) || '미분류';
            return {
                className: className,
                isDas: dasMap.get(className) || 'N', // JS Map에서 DAS 여부 확인
                pickCount: Number(row.pick_count || 0),
                totalQty: Number(row.total_qty || 0),
                totalWeight: Number(row.total_weight || 0)
            };
        });

        res.json({ data: safeResult });

    } catch (e) {
        console.error("Picking API Error:", e);
        // 에러 메시지 자세히 반환 (컬럼명 확인용)
        res.status(500).json({ error: e.message });
    }
});


// ------------------------------------------------------------------
// HTML 화면 제공 (SPA)
// ------------------------------------------------------------------
// ------------------------------------------------------------------
// HTML 화면 제공 (SPA + Sidebar Layout)
// ------------------------------------------------------------------
app.get(['/', '/dispatch', '/picking'], (req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(`
    <!DOCTYPE html>
    <html lang="ko">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>배차 관리 시스템</title>
        <script src="https://cdn.tailwindcss.com"></script>
        <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@300;400;500;700&display=swap" rel="stylesheet">
        <style>
            body {font-family: 'Noto Sans KR', sans-serif;}
            .glass {background: rgba(255, 255, 255, 0.95); backdrop-filter: blur(10px);}
            .sidebar-item { transition: all 0.2s; }
            .sidebar-item:hover, .sidebar-item.active { background-color: #4338ca; color: white; } /* indigo-700 */
        </style>
    </head>
    <body class="bg-slate-100 text-slate-800 h-screen flex overflow-hidden">

        <!-- Sidebar -->
        <aside class="w-64 bg-indigo-900 text-indigo-100 flex-shrink-0 hidden md:flex flex-col shadow-2xl relative z-20">
            <div class="h-16 flex items-center px-6 font-bold text-xl tracking-wider text-white bg-indigo-950">
                🚚 Antigravity
            </div>
            <div class="p-4 space-y-2 flex-grow">
                <button onclick="switchView('dispatch')" id="menu-dispatch" class="sidebar-item w-full flex items-center px-4 py-3 rounded-xl font-medium text-left active">
                    <svg class="w-5 h-5 mr-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"></path></svg>
                    배차 요약 리포트
                </button>
                <button onclick="switchView('picking')" id="menu-picking" class="sidebar-item w-full flex items-center px-4 py-3 rounded-xl font-medium text-left">
                    <svg class="w-5 h-5 mr-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z"></path></svg>
                    피킹 요약 리포트
                </button>
            </div>
            <div class="p-4 text-xs text-indigo-400 text-center">
                © 2026 Antigravity System
            </div>
        </aside>

        <!-- Main Content -->
        <div class="flex-1 flex flex-col h-screen overflow-hidden relative">
            
            <!-- Navbar (Mobile + Header) -->
            <header class="h-16 bg-white shadow-sm flex items-center px-6 z-10 justify-between">
                <div class="font-bold text-lg text-slate-700" id="page-title">배차 요약 리포트</div>
                <div class="text-xs text-slate-400" id="currentDate"></div>
            </header>

            <!-- Scrollable Area -->
            <main class="flex-1 overflow-y-auto p-6 bg-slate-100">
                <div class="max-w-7xl mx-auto space-y-6">

                    <!-- Filter Controls -->
                    <div class="bg-white rounded-xl shadow-sm p-5 border border-slate-200">
                        <div class="flex flex-col md:flex-row gap-4 items-end">
                            <div>
                                <label class="block text-xs font-bold text-slate-400 uppercase mb-1">기간 조회</label>
                                <div class="flex gap-2">
                                    <input type="date" id="startDate" class="px-3 py-2 border rounded-lg text-sm">
                                    <input type="date" id="endDate" class="px-3 py-2 border rounded-lg text-sm">
                                </div>
                            </div>
                            <div class="flex gap-1">
                                <button onclick="setToday()" class="px-3 py-2 text-xs font-bold bg-indigo-50 text-indigo-600 rounded-lg">오늘</button>
                                <button onclick="setYesterday()" class="px-3 py-2 text-xs font-bold bg-slate-100 text-slate-600 rounded-lg">어제</button>
                                <button onclick="setLast7Days()" class="px-3 py-2 text-xs font-bold bg-slate-100 text-slate-600 rounded-lg">7일</button>
                            </div>

                            <!-- Driver Search Input (Dispatch View Only) -->
                            <div id="driver-filter-group" class="flex-grow">
                                <label class="block text-xs font-bold text-slate-400 uppercase mb-1">
                                    기사명 검색 
                                    <span class="text-[10px] text-slate-400 font-normal ml-1 tracking-tighter">(여러 명은 콤마 <b>,</b> 로 구분)</span>
                                </label>
                                <input type="text" id="driverInput" placeholder="이름 입력" class="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none">
                            </div>

                            <button onclick="fetchData()" class="bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2 px-6 rounded-lg text-sm shadow transition-colors flex items-center gap-2">
                                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path></svg>
                                조회
                            </button>
                        </div>
                    </div>

                    <!-- Summary Cards Generator -->
                    <div id="summaryCards" class="grid grid-cols-2 lg:grid-cols-4 gap-4">
                        <!-- Injected by JS -->
                    </div>

                    <!-- Data Table -->
                    <div class="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                        <div class="px-6 py-4 border-b border-slate-50 flex justify-between items-center bg-slate-50">
                            <h3 class="font-bold text-slate-700" id="table-title">상세 내역</h3>
                        </div>
                        <div class="overflow-x-auto">
                            <table class="w-full text-left border-collapse text-sm">
                                <thead id="tableHead" class="bg-slate-100 text-slate-500 uppercase font-bold tracking-wider">
                                    <!-- Injected by JS -->
                                </thead>
                                <tbody id="tableBody" class="divide-y divide-slate-100 text-slate-600">
                                    <tr><td colspan="10" class="p-8 text-center text-slate-400">데이터를 조회해주세요.</td></tr>
                                </tbody>
                            </table>
                        </div>
                    </div>

                </div>
            </main>
        </div>

        <script>
            // --- Global State ---
            let currentView = 'dispatch'; // 'dispatch' or 'picking'

            // --- Initialization ---
            const today = new Date();
            const todayStr = toDateStr(today);
            document.getElementById('startDate').value = todayStr;
            document.getElementById('endDate').value = todayStr;
            document.getElementById('currentDate').innerText = today.toLocaleDateString('ko-KR', {weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'});

            // Handle URL Routing (Basic)
            const path = window.location.pathname;
            if (path.includes('picking')) switchView('picking');
            else switchView('dispatch');

            // --- Event Listeners ---
            document.getElementById('driverInput').addEventListener('keypress', (e) => { if(e.key === 'Enter') fetchData(); });

            // --- Functions ---
            function toDateStr(d) {
                const yyyy = d.getFullYear();
                const mm = String(d.getMonth() + 1).padStart(2, '0');
                const dd = String(d.getDate()).padStart(2, '0');
                return \`\${yyyy}-\${mm}-\${dd}\`;
            }

            function setToday() { setDateRange(0, 0); }
            function setYesterday() { setDateRange(1, 1); }
            function setLast7Days() { setDateRange(7, 0); }
            
            function setDateRange(minusStart, minusEnd) {
                const s = new Date(); s.setDate(s.getDate() - minusStart);
                const e = new Date(); e.setDate(e.getDate() - minusEnd);
                document.getElementById('startDate').value = toDateStr(s);
                document.getElementById('endDate').value = toDateStr(e);
            }

            function formatNumber(n) { return n ? n.toLocaleString('ko-KR') : '0'; }

            function switchView(view) {
                currentView = view;
                
                // Sidebar Active State
                document.querySelectorAll('.sidebar-item').forEach(el => el.classList.remove('active', 'bg-indigo-700', 'text-white'));
                document.querySelectorAll('.sidebar-item').forEach(el => el.classList.add('text-indigo-100', 'hover:bg-indigo-800'));
                
                const activeBtn = document.getElementById('menu-' + view);
                activeBtn.classList.add('active', 'bg-indigo-700', 'text-white');
                activeBtn.classList.remove('text-indigo-100', 'hover:bg-indigo-800');

                // UI Changes
                if (view === 'dispatch') {
                    document.getElementById('page-title').innerText = '배차 요약 리포트';
                    document.getElementById('driver-filter-group').style.display = 'block'; // Show Filter
                    document.getElementById('table-title').innerText = '기사별 상세 현황';
                    // Update URL without reload
                    window.history.pushState({}, '', '/dispatch');
                } else {
                    document.getElementById('page-title').innerText = '피킹 요약 리포트';
                    document.getElementById('driver-filter-group').style.display = 'none'; // Hide Filter
                    document.getElementById('table-title').innerText = '분류별 집계 현황';
                    window.history.pushState({}, '', '/picking');
                }

                // Clear Data
                document.getElementById('summaryCards').innerHTML = '';
                document.getElementById('tableHead').innerHTML = '';
                document.getElementById('tableBody').innerHTML = '<tr><td colspan="10" class="p-8 text-center text-slate-400">조회 버튼을 눌러주세요.</td></tr>';
            }

            async function fetchData() {
                const sDate = document.getElementById('startDate').value;
                const eDate = document.getElementById('endDate').value;
                const driverVal = document.getElementById('driverInput').value;
                const tbody = document.getElementById('tableBody');
                const thead = document.getElementById('tableHead');
                const cards = document.getElementById('summaryCards');

                if(!sDate || !eDate) return alert("날짜를 선택해주세요.");

                // Loading
                tbody.innerHTML = '<tr><td colspan="10" class="p-12 text-center"><div class="animate-spin inline-block w-8 h-8 border-4 border-indigo-500 border-t-transparent rounded-full mb-2"></div><div class="text-indigo-600 font-bold">데이터 분석 중...</div></td></tr>';

                try {
                    let url = '';
                    if (currentView === 'dispatch') {
                        url = \`/api/summary?startDate=\${sDate}&endDate=\${eDate}&drivers=\${encodeURIComponent(driverVal)}\`;
                    } else {
                        url = \`/api/picking-summary?startDate=\${sDate}&endDate=\${eDate}\`;
                    }

                    const res = await fetch(url);
                    const json = await res.json();

                    if (json.error) {
                        alert('에러 발생: ' + json.error);
                        tbody.innerHTML = '<tr><td colspan="10" class="p-8 text-center text-red-500">조회 실패</td></tr>';
                        return;
                    }

                    renderData(json);

                } catch (e) {
                    console.error(e);
                    alert("통신 오류가 발생했습니다.");
                    tbody.innerHTML = '<tr><td colspan="10" class="p-8 text-center text-red-500">서버 통신 오류</td></tr>';
                }
            }

            function renderData(json) {
                const tbody = document.getElementById('tableBody');
                const thead = document.getElementById('tableHead');
                const cards = document.getElementById('summaryCards');
                const { data, summary } = json;

                if (data.length === 0) {
                    tbody.innerHTML = '<tr><td colspan="10" class="p-8 text-center text-slate-400">해당 기간에 데이터가 없습니다.</td></tr>';
                    cards.innerHTML = '';
                    return;
                }

                if (currentView === 'dispatch') {
                    // --- Dispatch View Render ---
                    // 1. Cards
                    cards.className = "grid grid-cols-2 lg:grid-cols-5 gap-4"; // 5 items
                    cards.innerHTML = \`
                        <div class="bg-white p-5 rounded-xl shadow-sm border-l-4 border-blue-500">
                            <div class="text-xs font-bold text-slate-400 uppercase">총 배송 기사</div>
                            <div class="text-2xl font-bold text-slate-800">\${formatNumber(summary.totalDrivers)} <span class="text-sm font-normal text-slate-400">명</span></div>
                        </div>
                        <div class="bg-white p-5 rounded-xl shadow-sm border-l-4 border-cyan-500">
                            <div class="text-xs font-bold text-slate-400 uppercase">총 배차 건수</div>
                            <div class="text-2xl font-bold text-slate-800">\${formatNumber(summary.totalDispatchNames)} <span class="text-sm font-normal text-slate-400">건</span></div>
                        </div>
                        <div class="bg-white p-5 rounded-xl shadow-sm border-l-4 border-green-500">
                            <div class="text-xs font-bold text-slate-400 uppercase">총 납품 거래처</div>
                            <div class="text-2xl font-bold text-slate-800">\${formatNumber(summary.totalDestinations)} <span class="text-sm font-normal text-slate-400">곳</span></div>
                        </div>
                        <div class="bg-white p-5 rounded-xl shadow-sm border-l-4 border-purple-500">
                            <div class="text-xs font-bold text-slate-400 uppercase">총 피킹 건수</div>
                            <div class="text-2xl font-bold text-slate-800">\${formatNumber(summary.totalShipments)} <span class="text-sm font-normal text-slate-400">건</span></div>
                        </div>
                         <div class="bg-white p-5 rounded-xl shadow-sm border-l-4 border-orange-500">
                            <div class="text-xs font-bold text-slate-400 uppercase">총 중량</div>
                            <div class="text-2xl font-bold text-slate-800">\${formatNumber(summary.totalWeight)} <span class="text-sm font-normal text-slate-400">kg</span></div>
                        </div>
                    \`;
                    
                    // 2. Table Header
                    thead.innerHTML = \`
                        <tr>
                            <th class="p-4 border-b">No.</th>
                            <th class="p-4 border-b">기사명</th>
                            <th class="p-4 border-b">배차명</th>
                            <th class="p-4 border-b text-right">납품처 수</th>
                            <th class="p-4 border-b text-right">피킹 건수</th>
                            <th class="p-4 border-b text-right">중량 (kg)</th>
                            <th class="p-4 border-b text-center">점유율</th>
                        </tr>
                    \`;

                    // 3. Table Body
                    tbody.innerHTML = data.map((row, i) => {
                        const share = summary.totalWeight > 0 ? ((row.totalWeight / summary.totalWeight) * 100).toFixed(1) : 0;
                        return \`
                        <tr class="hover:bg-slate-50 border-b border-slate-50 last:border-0">
                            <td class="p-4 text-center text-slate-400">\${i+1}</td>
                            <td class="p-4 font-bold text-slate-800">\${row.driverName || '-'}</td>
                            <td class="p-4 text-slate-600">\${row.dispatchName}</td>
                            <td class="p-4 text-right">\${formatNumber(row.destCount)}</td>
                            <td class="p-4 text-right">\${formatNumber(row.totalCount)}</td>
                            <td class="p-4 text-right text-indigo-700 font-medium">\${formatNumber(row.totalWeight)}</td>
                            <td class="p-4">
                                <div class="flex items-center gap-2">
                                    <div class="w-20 bg-slate-200 rounded-full h-1.5">
                                        <div class="bg-indigo-600 h-1.5 rounded-full" style="width: \${share}%"></div>
                                    </div>
                                    <span class="text-xs text-slate-500 w-8 text-right">\${share}%</span>
                                </div>
                            </td>
                        </tr>
                        \`;
                    }).join('');

                } else {
                    // --- Picking View Render ---
                    // 1. Cards (Aggregates)
                    const totalPick = data.reduce((a,c) => a + c.pickCount, 0);
                    const totalQty = data.reduce((a,c) => a + c.totalQty, 0);
                    const totalWeight = data.reduce((a,c) => a + c.totalWeight, 0);

                    cards.innerHTML = \`
                        <div class="bg-white p-5 rounded-xl shadow-sm border-l-4 border-indigo-500">
                            <div class="text-xs font-bold text-slate-400 uppercase">전체 피킹 건수</div>
                            <div class="text-2xl font-bold text-slate-800">\${formatNumber(totalPick)} <span class="text-sm font-normal text-slate-400">라인</span></div>
                        </div>
                        <div class="bg-white p-5 rounded-xl shadow-sm border-l-4 border-emerald-500">
                            <div class="text-xs font-bold text-slate-400 uppercase">전체 수량 합계</div>
                            <div class="text-2xl font-bold text-slate-800">\${formatNumber(totalQty)} <span class="text-sm font-normal text-slate-400">ea</span></div>
                        </div>
                        <div class="bg-white p-5 rounded-xl shadow-sm border-l-4 border-orange-500">
                            <div class="text-xs font-bold text-slate-400 uppercase">전체 중량 합계</div>
                            <div class="text-2xl font-bold text-slate-800">\${formatNumber(totalWeight)} <span class="text-sm font-normal text-slate-400">kg</span></div>
                        </div>
                    \`;

                    // 2. Table Header
                    thead.innerHTML = \`
                        <tr>
                            <th class="p-4 border-b">No.</th>
                            <th class="p-4 border-b">피킹 분류명 (구분)</th>
                            <th class="p-4 border-b text-center text-sm font-bold text-orange-600">DAS</th>
                            <th class="p-4 border-b text-right">피킹 건수 (Line)</th>
                            <th class="p-4 border-b text-right">총 수량 (Qty)</th>
                            <th class="p-4 border-b text-right">총 중량 (kg)</th>
                            <th class="p-4 border-b text-center">비중 (건수)</th>
                        </tr>
                    \`;

                    // 3. Table Body
                    tbody.innerHTML = data.map((row, i) => {
                        const share = totalPick > 0 ? ((row.pickCount / totalPick) * 100).toFixed(1) : 0;
                        const isDas = row.isDas === 'Y' ? '<span class="text-indigo-600 font-bold">사용</span>' : '<span class="text-slate-400">사용안함</span>';
                        return \`
                        <tr class="hover:bg-slate-50 border-b border-slate-50 last:border-0">
                            <td class="p-4 text-center text-slate-400">\${i+1}</td>
                            <td class="p-4 font-bold text-slate-800">\${row.className}</td>
                            <td class="p-4 text-center">\${isDas}</td>
                            <td class="p-4 text-right font-medium">\${formatNumber(row.pickCount)}</td>
                            <td class="p-4 text-right text-slate-600">\${formatNumber(row.totalQty)}</td>
                            <td class="p-4 text-right text-indigo-700">\${formatNumber(row.totalWeight)}</td>
                             <td class="p-4">
                                <div class="flex items-center justify-center gap-2">
                                    <div class="w-20 bg-slate-200 rounded-full h-1.5">
                                        <div class="bg-blue-500 h-1.5 rounded-full" style="width: \${share}%"></div>
                                    </div>
                                    <span class="text-xs text-slate-500 w-8 text-right">\${share}%</span>
                                </div>
                            </td>
                        </tr>
                        \`;
                    }).join('');
                }
            }
        </script>
    </body>
    </html>
    `);
});

app.listen(port, () => {
    console.log(`
==========================================================
 🚚 배차 요약 시스템이 시작되었습니다!
 👉 접속 주소: http://localhost:${port}
==========================================================
`);
    // open(`http://localhost:${port}`); // 브라우저 자동 실행
});

module.exports = app;
