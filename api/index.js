// dispatch_server.js
// [SME 개발 사수] 배차 요약 화면 (기사별 납품처/중량 집계)
require('dotenv').config();
const express = require('express');
const { PrismaClient } = require('@prisma/client');
const path = require('path');
const mysql = require('mysql2/promise');
const { Client } = require('pg');
const fs = require('fs');

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
            customerCondition = ` AND b."CB_DIV_CUST" = '${custName}'`;
        }

        const query = `
        SELECT
            b."CB_DRIVER",
            c."CA_NAME",
            c."CA_KG",
            COUNT(DISTINCT b."B_C_NAME") as delivery_dest_count,
            COUNT(DISTINCT (b."B_DATE", b."CB_DRIVER", b."B_P_NO")) as total_count,
            SUM(b."B_KG") as total_weight
        FROM "prj_picking_system"."NPS_t_balju" b
        LEFT JOIN "prj_picking_system"."NPS_t_car" c ON b."CB_DRIVER" = c."CB_DRIVER"
        WHERE b."B_DATE" >= '${startDate}' AND b."B_DATE" <= '${endDate}'
        ${customerCondition}
        AND b."CB_DRIVER" IS NOT NULL AND b."CB_DRIVER" <> ''
        GROUP BY b."CB_DRIVER", c."CA_NAME", c."CA_KG"
        ORDER BY COALESCE(c."CA_NAME", b."CB_DRIVER") ASC
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
        let whereClause = `WHERE b."B_DATE" >= '${startDate}' AND b."B_DATE" <= '${endDate}'`;
        if (custName && custName !== '') {
            whereClause += ` AND b."CB_DIV_CUST" = '${custName}'`;
        }

        const query = `
            SELECT 
                p_div_pick_fixed as picking_class,
                COUNT(*) as pick_count,
                SUM(qty) as total_qty,
                SUM(kg) as total_weight
            FROM (
                SELECT 
                    p."P_DIV_PICK" as p_div_pick_fixed,
                    b."CB_DRIVER",
                    b."B_P_NO",
                    SUM(b."B_QTY") as qty,
                    SUM(b."B_KG") as kg
                FROM "prj_picking_system"."NPS_t_balju" b
                LEFT JOIN "prj_picking_system"."NPS_t_product" p ON b."B_P_NO" = p."P_CODE"
                ${whereClause}
                GROUP BY p_div_pick_fixed, b."B_DATE", b."CB_DRIVER", b."B_P_NO"
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
        let whereClause = `WHERE b."B_DATE" >= '${startDate}' AND b."B_DATE" <= '${endDate}'`;

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
                    COALESCE(c340."CD_GROUP", p."P_DIV_PICK") as group_name,
                    b."CB_DRIVER" as driver_name,
                    c."CA_DOCKNO" as dock_no,
                    b."B_P_NO",
                    SUM(b."B_QTY") as total_qty,
                    SUM(b."B_KG") as total_weight,
                    FLOOR(SUM(b."B_QTY") / NULLIF(MAX(p."P_IPSU"), 0)) as total_boxes,
                    SUM(b."B_QTY") % NULLIF(MAX(p."P_IPSU"), 0) as total_items
                FROM "prj_picking_system"."NPS_t_balju" b
                LEFT JOIN "prj_picking_system"."NPS_t_product" p ON b."B_P_NO" = p."P_CODE"
                LEFT JOIN "prj_picking_system"."NPS_t_code_340" c340 ON p."P_DIV_PICK" = c340."P_DIV_PICK"
                LEFT JOIN "prj_picking_system"."NPS_t_car" c ON b."CB_DRIVER" = c."CB_DRIVER"
                ${whereClause}
                GROUP BY group_name, b."B_DATE", b."CB_DRIVER", b."B_P_NO", c."CA_DOCKNO"
            ) as sub
            WHERE 1=1
            ${pickingClass && pickingClass !== '' ? ` AND group_name = '${pickingClass}'` : ''}
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

// API: 데이터 동기화 (최근 14일)
app.post('/api/sync', async (req, res) => {
    let mysqlConn = null;
    let pgClient = null;
    try {
        const sourceUrl = process.env.MYSQL_URL || "mysql://user_web:pass_web%40%23@221.143.21.135:3306/db_ndy?charset=utf8mb4";
        const targetUrl = process.env.DATABASE_URL;
        const targetSchema = 'prj_picking_system';

        const TARGET_TABLES = [
            { source: 't_balju', target: 'NPS_t_balju', useFilter: true },
            { source: 't_car', target: 'NPS_t_car', useFilter: false },
            { source: 't_code_340', target: 'NPS_t_code_340', useFilter: false },
            { source: 't_product', target: 'NPS_t_product', useFilter: false }
        ];

        const fourteenDaysAgo = new Date();
        fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);
        const dateStr = fourteenDaysAgo.toISOString().split('T')[0];

        mysqlConn = await mysql.createConnection(sourceUrl);
        pgClient = new Client({ connectionString: targetUrl });
        await pgClient.connect();
        await pgClient.query(`SET search_path TO ${targetSchema}`);

        const batchSize = 1000;

        for (const table of TARGET_TABLES) {
            await pgClient.query(`TRUNCATE TABLE "${table.target}" RESTART IDENTITY`);

            let offset = 0;
            let hasMore = true;
            const filterClause = table.useFilter ? `WHERE B_DATE >= '${dateStr}'` : '';

            while (hasMore) {
                const query = `SELECT * FROM ${table.source} ${filterClause} LIMIT ${batchSize} OFFSET ${offset}`;
                const [rows] = await mysqlConn.execute(query);

                if (rows.length === 0) {
                    hasMore = false;
                    break;
                }

                const cols = Object.keys(rows[0]);
                const fields = cols.map(c => `"${c}"`).join(', ');
                let valueIdx = 1;
                const values = [];
                const rowsPlaceholders = rows.map(() => {
                    const rowPlaceholders = cols.map(() => `$${valueIdx++}`).join(', ');
                    return `(${rowPlaceholders})`;
                }).join(', ');

                for (const row of rows) {
                    for (const col of cols) {
                        values.push(row[col] !== undefined ? row[col] : null);
                    }
                }

                const bulkInsertQuery = `INSERT INTO "${table.target}" (${fields}) VALUES ${rowsPlaceholders}`;
                await pgClient.query(bulkInsertQuery, values);

                offset += rows.length;
            }
        }

        res.json({ success: true });
    } catch (e) {
        console.error('Sync Error:', e);
        res.status(500).json({ error: e.message });
    } finally {
        if (mysqlConn) await mysqlConn.end();
        if (pgClient) await pgClient.end();
    }
});

// API: 배차 현황 조회 (MySQL 원본 직접 조회)
app.get('/api/dispatch-status', async (req, res) => {
    let mysqlConn = null;
    try {
        const { startDate, endDate, search, custName } = req.query;
        if (!startDate || !endDate) return res.status(400).json({ error: "날짜를 입력하세요." });

        const sourceUrl = process.env.MYSQL_URL || "mysql://user_web:pass_web%40%23@221.143.21.135:3306/db_ndy?charset=utf8mb4";
        mysqlConn = await mysql.createConnection(sourceUrl);

        let whereClause = `WHERE B_DATE >= ? AND B_DATE <= ?`;
        let params = [startDate, endDate];

        // 기사명 또는 거래처명 통합 검색 (문자셋 변환을 통해 Collation 충돌을 해결하고 정확한 매칭을 유도합니다)
        if (search && search !== '') {
            const searchBuf = iconv.encode(`%${search}%`, 'euc-kr');
            whereClause += ` AND (CB_DRIVER LIKE BINARY ? OR B_C_NAME LIKE BINARY ?)`;
            params.push(searchBuf, searchBuf);
        }

        // 고객사 필터
        if (custName && custName !== '') {
            const custBuf = iconv.encode(custName, 'euc-kr');
            whereClause += ` AND CB_DIV_CUST = ?`;
            params.push(custBuf);
        }

        const query = `
            SELECT 
                B_DATE,
                B_C_NAME,
                MAX(CB_DRIVER) as CB_DRIVER,
                SUM(B_QTY) as B_QTY,
                SUM(B_KG) as B_KG,
                SUM(B_IN_QTY) as B_IN_QTY,
                COUNT(DISTINCT B_P_NO) as item_types
            FROM t_balju 
            ${whereClause} 
            GROUP BY B_DATE, B_C_NAME
            ORDER BY B_QTY ASC, B_KG ASC 
            LIMIT 1000`;
        const [rows] = await mysqlConn.execute(query, params);

        // 한글 깨짐 방지를 위해 모든 데이터 디코딩 처리
        const fixedRows = rows.map(row => {
            const newRow = {};
            for (const key in row) {
                if (typeof row[key] === 'string') {
                    newRow[key] = fixEncoding(row[key]);
                } else {
                    newRow[key] = row[key];
                }
            }
            return newRow;
        });

        res.json({ data: fixedRows });
    } catch (e) {
        console.error('Dispatch Status Error:', e);
        res.status(500).json({ error: e.message });
    } finally {
        if (mysqlConn) await mysqlConn.end();
    }
});

// API: 배차 현황 상세 품목 조회
app.get('/api/dispatch-status-details', async (req, res) => {
    let mysqlConn = null;
    try {
        const { date, custName } = req.query;
        if (!date || !custName) return res.status(400).json({ error: "날짜와 거래처명을 확인하세요." });

        const sourceUrl = process.env.MYSQL_URL || "mysql://user_web:pass_web%40%23@221.143.21.135:3306/db_ndy?charset=utf8mb4";
        mysqlConn = await mysql.createConnection(sourceUrl);

        const custBuf = iconv.encode(custName, 'euc-kr');
        const query = `
            SELECT 
                B_P_NAME,
                SUM(B_QTY) as qty
            FROM t_balju 
            WHERE B_DATE = ? AND B_C_NAME = BINARY ?
            GROUP BY B_P_NAME
            ORDER BY qty DESC`;

        const [rows] = await mysqlConn.execute(query, [date, custBuf]);

        const fixedRows = rows.map(row => ({
            itemName: fixEncoding(row.B_P_NAME),
            qty: Number(row.qty || 0)
        }));

        res.json({ data: fixedRows });
    } catch (e) {
        console.error('Dispatch Status Details Error:', e);
        res.status(500).json({ error: e.message });
    } finally {
        if (mysqlConn) await mysqlConn.end();
    }
});

app.get('/api/customers', async (req, res) => {
    try {
        const raw = await prisma.$queryRawUnsafe(`SELECT DISTINCT "CB_DIV_CUST" FROM "prj_picking_system"."NPS_t_balju" WHERE "B_DATE" >= (CURRENT_DATE - INTERVAL '30 days')::text AND "CB_DIV_CUST" IS NOT NULL`);
        res.json({ data: raw.map(r => fixEncoding(r.CB_DIV_CUST)).filter(c => c) });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get(/.*/, (req, res) => {
    res.sendFile(path.resolve(__dirname, '..', 'public', 'index.html'));
});

app.listen(port, () => {
    console.log(`🚚 시스템 가동 중: http://localhost:${port}`);
});
