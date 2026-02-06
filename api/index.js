// dispatch_server.js
// [SME 개발 사수] 배차 요약 화면 (기사별 납품처/중량 집계)
require('dotenv').config();
const express = require('express');
const { PrismaClient } = require('@prisma/client');
const path = require('path');

const app = express();
const port = 3011;
const prisma = new PrismaClient();

app.use(express.static(path.join(__dirname, '..', 'public')));
app.use(express.json());

const iconv = require('iconv-lite');

function fixEncoding(str) {
    if (typeof str !== 'string') return str;
    try {
        return iconv.decode(Buffer.from(str, 'binary'), 'euc-kr');
    } catch (e) { return str; }
}

// API: 배차 요약 정보 조회
app.get('/api/summary', async (req, res) => {
    try {
        const { startDate, endDate, drivers, custName } = req.query;
        if (!startDate || !endDate) return res.status(400).json({ error: "날짜를 입력하세요." });

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
            COUNT(DISTINCT b.B_DATE, b.CB_DRIVER, b.B_P_NO) as total_count,
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
        const serializedResult = result.map(row => ({
            driverName: fixEncoding(row.CA_NAME) || fixEncoding(row.CB_DRIVER),
            dispatchName: fixEncoding(row.CB_DRIVER),
            maxWeight: Number(row.CA_KG || 0) * 1000,
            destCount: Number(row.delivery_dest_count || 0),
            totalCount: Number(row.total_count || 0),
            totalWeight: Number(row.total_weight || 0)
        }));

        res.json({
            data: serializedResult,
            summary: {
                totalDrivers: new Set(serializedResult.map(r => r.driverName)).size,
                totalDispatchNames: serializedResult.length,
                totalDestinations: serializedResult.reduce((acc, cur) => acc + cur.destCount, 0),
                totalShipments: serializedResult.reduce((acc, cur) => acc + cur.totalCount, 0),
                totalWeight: serializedResult.reduce((acc, cur) => acc + cur.totalWeight, 0)
            }
        });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// API: 피킹 요약 정보 조회
app.get('/api/picking-summary', async (req, res) => {
    try {
        const { startDate, endDate, custName } = req.query;
        let whereClause = `WHERE b.B_DATE >= '${startDate}' AND b.B_DATE <= '${endDate}'`;
        if (custName && custName !== '') {
            whereClause += ` AND TRIM(CONVERT(CAST(b.CB_DIV_CUST AS BINARY) USING euckr)) = CONVERT('${custName}' USING euckr)`;
        }

        const query = `
            SELECT 
                p_div_pick_fixed as picking_class,
                COUNT(*) as pick_count,
                SUM(qty) as total_qty,
                SUM(kg) as total_weight
            FROM (
                SELECT 
                    p.P_DIV_PICK as p_div_pick_fixed,
                    b.CB_DRIVER,
                    b.B_P_NO,
                    SUM(b.B_QTY) as qty,
                    SUM(b.B_KG) as kg
                FROM t_balju b
                LEFT JOIN t_product p ON b.B_P_NO = p.P_CODE
                ${whereClause}
                GROUP BY p_div_pick_fixed, b.B_DATE, b.CB_DRIVER, b.B_P_NO
            ) as sub
            GROUP BY picking_class
            ORDER BY pick_count DESC
        `;
        const result = await prisma.$queryRawUnsafe(query);
        const safeResult = result.map(row => ({
            className: fixEncoding(row.picking_class) || '미분류',
            pickCount: Number(row.pick_count || 0),
            totalQty: Number(row.total_qty || 0),
            totalWeight: Number(row.total_weight || 0)
        }));
        res.json({ data: safeResult });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// API: 피킹 분석 정보 조회
app.get('/api/picking-analysis', async (req, res) => {
    try {
        const { startDate, endDate, pickingClass } = req.query;
        let whereClause = `WHERE b.B_DATE >= '${startDate}' AND b.B_DATE <= '${endDate}'`;

        // [최종 진화형 쿼리] 서브쿼리에서 먼저 품목별로 묶고 외부에서 필터링하여 오차를 0으로 만듭니다.
        const query = `
            SELECT 
                group_name,
                driver_name,
                MAX(dock_no) as dock_no,
                COUNT(*) as pick_count,
                SUM(total_qty) as total_qty,
                SUM(total_weight) as total_weight,
                SUM(total_boxes) as total_boxes,
                SUM(total_items) as total_items
            FROM (
                SELECT 
                    COALESCE(c340.CD_GROUP, p.P_DIV_PICK) as group_name,
                    b.CB_DRIVER as driver_name,
                    c.CA_DOCKNO as dock_no,
                    b.B_P_NO,
                    SUM(b.B_QTY) as total_qty,
                    SUM(b.B_KG) as total_weight,
                    FLOOR(SUM(b.B_QTY) / NULLIF(MAX(p.P_IPSU), 0)) as total_boxes,
                    MOD(SUM(b.B_QTY), NULLIF(MAX(p.P_IPSU), 0)) as total_items
                FROM t_balju b
                LEFT JOIN t_product p ON b.B_P_NO = p.P_CODE
                LEFT JOIN t_code_340 c340 ON p.P_DIV_PICK = c340.P_DIV_PICK
                LEFT JOIN t_car c ON b.CB_DRIVER = c.CB_DRIVER
                ${whereClause}
                GROUP BY group_name, b.B_DATE, b.CB_DRIVER, b.B_P_NO
            ) as sub
            WHERE 1=1
            ${pickingClass && pickingClass !== '' ? ` AND CONVERT(CAST(group_name AS BINARY) USING euckr) = CONVERT('${pickingClass}' USING euckr)` : ''}
            GROUP BY group_name, driver_name
            ORDER BY group_name ASC, total_qty DESC
        `;

        const result = await prisma.$queryRawUnsafe(query);
        const safeResult = result.map(row => ({
            groupName: fixEncoding(row.group_name) || '미분류',
            driverName: fixEncoding(row.driver_name) || '-',
            dockNo: fixEncoding(row.dock_no) || '-',
            pickCount: Number(row.pick_count || 0),
            totalQty: Number(row.total_qty || 0),
            totalWeight: Number(row.total_weight || 0),
            totalBoxes: Number(row.total_boxes || 0),
            totalItems: Number(row.total_items || 0)
        }));
        res.json({ data: safeResult });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/customers', async (req, res) => {
    try {
        const raw = await prisma.$queryRaw`SELECT DISTINCT CB_DIV_CUST FROM t_balju WHERE B_DATE >= DATE_SUB(CURDATE(), INTERVAL 30 DAY) AND CB_DIV_CUST IS NOT NULL`;
        res.json({ data: raw.map(r => fixEncoding(r.CB_DIV_CUST)).filter(c => c) });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get(/.*/, (req, res) => {
    res.sendFile(path.resolve(__dirname, '..', 'public', 'index.html'));
});

app.listen(port, () => {
    console.log(`🚚 시스템 가동 중: http://localhost:${port}`);
});
