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
app.use(express.static(path.join(__dirname, '..', 'public')));
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
        const { startDate, endDate, drivers, custName } = req.query;

        if (!startDate || !endDate) {
            return res.status(400).json({ error: "시작일과 종료일을 입력해주세요." });
        }

        console.log(`[API] 배차 요약 조회 요청: ${startDate} ~ ${endDate}, 고객사: ${custName || '전체'}`);

        // 고객사 필터링 조건 (인코딩/공백 해결 방식)
        let customerCondition = "";
        if (custName && custName !== "") {
            customerCondition = ` AND TRIM(CONVERT(CAST(b.CB_DIV_CUST AS BINARY) USING euckr)) = CONVERT('${custName}' USING euckr)`;
        }

        const query = `
        SELECT
            b.CB_DRIVER,
            c.CA_NAME,
            c.CA_KG,
            COUNT(DISTINCT b.B_C_NAME) as delivery_dest_count,
            COUNT(*) as total_count,
            SUM(b.B_KG) as total_weight
        FROM t_balju b
        LEFT JOIN t_car c ON b.CB_DRIVER = c.CB_DRIVER
        WHERE b.B_DATE >= '${startDate}' AND b.B_DATE <= '${endDate}'
        ${customerCondition}
        AND b.CB_DRIVER IS NOT NULL AND b.CB_DRIVER <> ''
        GROUP BY b.CB_DRIVER, c.CA_NAME, c.CA_KG
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
                maxWeight: Number(row.CA_KG || 0) * 1000, // 차량 적재량 (톤 -> kg 변환)
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
        const { startDate, endDate, custName } = req.query;

        if (!startDate || !endDate) {
            return res.status(400).json({ error: "시작일과 종료일을 입력해주세요." });
        }

        console.log(`[API] 피킹 조회 요청: ${startDate} ~ ${endDate}, 고객사: ${custName || '전체'}`);

        const codes = await prisma.$queryRawUnsafe("SELECT C_DIV, C_NAME, C_IS_DAS FROM t_code_basic");
        const dasMap = new Map();
        codes.forEach(c => {
            if (fixEncoding(c.C_DIV) === '피킹리스트분류') {
                dasMap.set(fixEncoding(c.C_NAME), c.C_IS_DAS);
            }
        });

        // 고객사 필터링 조건 추가 (Collation 충돌 방지를 위해 BINARY CAST + TRIM 적용)
        let whereClause = `WHERE b.B_DATE >= '${startDate}' AND b.B_DATE <= '${endDate}'`;
        if (custName && custName !== '') {
            whereClause += ` AND TRIM(CONVERT(CAST(b.CB_DIV_CUST AS BINARY) USING euckr)) = CONVERT('${custName}' USING euckr)`;
        }

        const query = `
            SELECT 
                p.P_DIV_PICK as picking_class,
                COUNT(*) as pick_count,
                SUM(b.B_QTY) as total_qty,
                SUM(b.B_KG) as total_weight
            FROM t_balju b
            LEFT JOIN t_product p ON b.B_P_NO = p.P_CODE
            ${whereClause}
            GROUP BY p.P_DIV_PICK
            ORDER BY pick_count DESC
        `;

        const result = await prisma.$queryRawUnsafe(query);

        const safeResult = result.map(row => {
            const className = fixEncoding(row.picking_class) || '미분류';
            return {
                className: className,
                isDas: dasMap.get(className) || 'N',
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
// API: 피킹 분석 정보 조회 (배차명별 상세 집계 - t_code_340 매칭 적용)
// ------------------------------------------------------------------
app.get('/api/picking-analysis', async (req, res) => {
    try {
        const { startDate, endDate, pickingClass } = req.query;

        if (!startDate || !endDate) {
            return res.status(400).json({ error: "시작일과 종료일을 입력해주세요." });
        }

        console.log(`[API] 피킹 현장분석 요청: ${startDate} ~ ${endDate}, 그룹명(포함): ${pickingClass || '전체'}`);

        let whereClause = `WHERE b.B_DATE >= '${startDate}' AND b.B_DATE <= '${endDate}'`;

        // 검색어가 있을 경우 P_DIV_PICK 또는 매칭된 CD_GROUP과 정확히 일치해야 함
        if (pickingClass && pickingClass !== '') {
            whereClause += ` AND (
                CONVERT(CAST(p.P_DIV_PICK AS BINARY) USING euckr) = CONVERT('${pickingClass}' USING euckr)
                OR 
                CONVERT(CAST(c340.CD_GROUP AS BINARY) USING euckr) = CONVERT('${pickingClass}' USING euckr)
            )`;
        }

        const query = `
            SELECT 
                group_name,
                driver_code,
                dock_no,
                SUM(pick_count) as pick_count,
                SUM(total_qty) as total_qty,
                SUM(total_weight) as total_weight,
                SUM(total_boxes) as total_boxes,
                SUM(total_items) as total_items
            FROM (
                SELECT 
                    COALESCE(c340.CD_GROUP, p.P_DIV_PICK) as group_name,
                    b.CB_DRIVER as driver_code,
                    c.CA_DOCKNO as dock_no,
                    p.P_CODE,
                    COUNT(*) as pick_count,
                    SUM(b.B_QTY) as total_qty,
                    SUM(b.B_KG) as total_weight,
                    FLOOR(SUM(b.B_QTY) / NULLIF(p.P_IPSU, 0)) as total_boxes,
                    MOD(SUM(b.B_QTY), NULLIF(p.P_IPSU, 0)) as total_items
                FROM t_balju b
                LEFT JOIN t_product p ON b.B_P_NO = p.P_CODE
                LEFT JOIN t_code_340 c340 ON p.P_DIV_PICK = c340.P_DIV_PICK
                LEFT JOIN t_car c ON b.CB_DRIVER = c.CB_DRIVER
                ${whereClause}
                GROUP BY group_name, b.CB_DRIVER, c.CA_DOCKNO, p.P_CODE, p.P_IPSU
            ) as sub
            GROUP BY group_name, driver_code, dock_no
            ORDER BY group_name ASC, total_qty DESC
        `;

        const result = await prisma.$queryRawUnsafe(query);

        const safeResult = result.map(row => ({
            groupName: fixEncoding(row.group_name) || '미분류',
            driverName: fixEncoding(row.driver_code) || '-',
            dockNo: row.dock_no ? fixEncoding(row.dock_no) : '-',
            pickCount: Number(row.pick_count || 0),
            totalQty: Number(row.total_qty || 0),
            totalWeight: Number(row.total_weight || 0),
            totalBoxes: Number(row.total_boxes || 0),
            totalItems: Number(row.total_items || 0)
        }));

        res.json({ data: safeResult });

    } catch (e) {
        console.error("Analysis API Error:", e);
        res.status(500).json({ error: e.message });
    }
});


// ------------------------------------------------------------------
// API: 고객사 목록 조회 (t_cust 기준)
// ------------------------------------------------------------------
app.get('/api/customers', async (req, res) => {
    try {
        const query = `SELECT DISTINCT CB_DIV_CUST FROM t_cust WHERE CB_DIV_CUST IS NOT NULL AND CB_DIV_CUST <> '' ORDER BY CB_DIV_CUST ASC`;
        const result = await prisma.$queryRawUnsafe(query);
        const customers = result.map(row => fixEncoding(row.CB_DIV_CUST)).filter(name => name);
        console.log(`[API] 고객사 목록 로드 성공: ${customers.length}개`);
        res.json({ data: customers });
    } catch (e) {
        console.error("Customers API Error:", e);
        res.status(500).json({ error: e.message });
    }
});

// ------------------------------------------------------------------
// HTML 화면 제공 (SPA 지원)
// ------------------------------------------------------------------
app.get(['/', '/dispatch', '/picking', '/analysis'], (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.listen(port, () => {
    console.log(`
==========================================================
 🚚 배차 요약 시스템(API + Static)이 시작되었습니다!
 👉 접속 주소: http://localhost:${port}
==========================================================
`);
});

module.exports = app;
