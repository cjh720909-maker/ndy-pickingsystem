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
    let mysqlConn = null;
    try {
        const { startDate, endDate, drivers, custName } = req.query;
        if (!startDate || !endDate) return res.status(400).json({ error: "날짜를 입력하세요." });

        const sourceUrl = process.env.MYSQL_URL || "mysql://user_web:pass_web%40%23@221.143.21.135:3306/db_ndy?charset=utf8mb4";
        mysqlConn = await mysql.createConnection(sourceUrl);

        let whereClause = `WHERE b.B_DATE >= ? AND b.B_DATE <= ?`;
        let params = [startDate, endDate];

        if (custName && custName !== "") {
            const custBuf = iconv.encode(custName, 'euc-kr');
            whereClause += ` AND b.CB_DIV_CUST = BINARY ?`;
            params.push(custBuf);
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
        LEFT JOIN t_car c ON BINARY b.CB_DRIVER = BINARY c.CB_DRIVER
        ${whereClause}
        AND b.CB_DRIVER IS NOT NULL AND b.CB_DRIVER <> ''
        GROUP BY b.CB_DRIVER, c.CA_NAME, c.CA_KG
        ORDER BY COALESCE(c.CA_NAME, b.CB_DRIVER) ASC
        `;

        const [rows] = await mysqlConn.execute(query, params);

        const serializedResult = rows.map(row => ({
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
    finally { if (mysqlConn) await mysqlConn.end(); }
});

// API: 피킹 요약 정보 조회
app.get('/api/picking-summary', async (req, res) => {
    let mysqlConn = null;
    try {
        const { startDate, endDate, custName } = req.query;
        
        const sourceUrl = process.env.MYSQL_URL || "mysql://user_web:pass_web%40%23@221.143.21.135:3306/db_ndy?charset=utf8mb4";
        mysqlConn = await mysql.createConnection(sourceUrl);

        let whereClause = `WHERE b.B_DATE >= ? AND b.B_DATE <= ?`;
        let params = [startDate, endDate];

        if (custName && custName !== '') {
            const custBuf = iconv.encode(custName, 'euc-kr');
            whereClause += ` AND b.CB_DIV_CUST = BINARY ?`;
            params.push(custBuf);
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
                LEFT JOIN t_product p ON BINARY b.B_P_NO = BINARY p.P_CODE
                ${whereClause}
                GROUP BY p.P_DIV_PICK, b.B_DATE, b.CB_DRIVER, b.B_P_NO
            ) as sub
            GROUP BY picking_class
            ORDER BY pick_count DESC
        `;
        
        const [rows] = await mysqlConn.execute(query, params);
        
        const safeResult = rows.map(row => ({
            className: fixEncoding(row.picking_class) || '미분류',
            pickCount: Number(row.pick_count || 0),
            totalQty: Number(row.total_qty || 0),
            totalWeight: Number(row.total_weight || 0)
        }));
        res.json({ data: safeResult });
    } catch (e) { res.status(500).json({ error: e.message }); }
    finally { if (mysqlConn) await mysqlConn.end(); }
});

// API: 피킹 분석 정보 조회
app.get('/api/picking-analysis', async (req, res) => {
    let mysqlConn = null;
    try {
        const { startDate, endDate, pickingClass } = req.query;
        
        const sourceUrl = process.env.MYSQL_URL || "mysql://user_web:pass_web%40%23@221.143.21.135:3306/db_ndy?charset=utf8mb4";
        mysqlConn = await mysql.createConnection(sourceUrl);

        let whereClause = `WHERE b.B_DATE >= ? AND b.B_DATE <= ?`;
        let params = [startDate, endDate];
        let outerWhere = 'WHERE 1=1';

        if (pickingClass && pickingClass !== '') {
            const classBuf = iconv.encode(pickingClass, 'euc-kr');
            outerWhere += ` AND group_name = BINARY ?`;
            params.push(classBuf);
        }

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
                    SUM(b.B_QTY) % NULLIF(MAX(p.P_IPSU), 0) as total_items
                FROM t_balju b
                LEFT JOIN t_product p ON BINARY b.B_P_NO = BINARY p.P_CODE
                LEFT JOIN t_code_340 c340 ON BINARY p.P_DIV_PICK = BINARY c340.P_DIV_PICK
                LEFT JOIN t_car c ON BINARY b.CB_DRIVER = BINARY c.CB_DRIVER
                ${whereClause}
                GROUP BY group_name, b.B_DATE, b.CB_DRIVER, b.B_P_NO, c.CA_DOCKNO
            ) as sub
            ${outerWhere}
            GROUP BY group_name, driver_name
            ORDER BY group_name ASC, total_qty DESC
        `;

        const [rows] = await mysqlConn.execute(query, params);
        
        const safeResult = rows.map(row => ({
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
    finally { if (mysqlConn) await mysqlConn.end(); }
});

// API: 데이터 동기화 (최근 14일)


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

app.get('/api/loading-list', async (req, res) => {
    let mysqlConn = null;
    try {
        const { startDate, endDate, driverName } = req.query;
        if (!startDate || !endDate) return res.status(400).json({ error: "날짜를 입력하세요." });

        const sourceUrl = process.env.MYSQL_URL || "mysql://user_web:pass_web%40%23@221.143.21.135:3306/db_ndy?charset=utf8mb4";
        mysqlConn = await mysql.createConnection(sourceUrl);

        let whereClause = `WHERE b.B_DATE >= ? AND b.B_DATE <= ?`;
        let params = [startDate, endDate];

        if (driverName && driverName !== '') {
            const driverBuf = iconv.encode(driverName, 'euc-kr');
            whereClause += ` AND b.CB_DRIVER = BINARY ?`;
            params.push(driverBuf);
        }

        const query = `
            SELECT 
                b.B_C_NAME,
                b.B_P_NAME,
                p.P_BARCODE,
                SUM(b.B_QTY) as total_qty,
                MAX(p.P_IPSU) as ipsu,
                MAX(p.P_DIV_BAS) as picking_class,
                SUM(b.B_KG) as total_weight,
                MAX(b.CB_DRIVER) as driver_name,
                MAX(c.CA_DOCKNO) as dock_no
            FROM t_balju b
            LEFT JOIN t_product p ON BINARY b.B_P_NO = BINARY p.P_CODE
            LEFT JOIN t_car c ON BINARY b.CB_DRIVER = BINARY c.CB_DRIVER
            ${whereClause}
            GROUP BY b.B_C_NAME, b.B_P_NAME, p.P_BARCODE
            ORDER BY MAX(b.CB_ADDRESS) ASC, b.B_C_NAME ASC, picking_class ASC, b.B_P_NAME ASC
        `;

        const [rows] = await mysqlConn.execute(query, params);

        const safeResult = rows.map(row => {
            const qty = Number(row.total_qty || 0);
            const ipsu = Number(row.ipsu || 1);
            const boxes = ipsu > 0 ? Math.floor(qty / ipsu) : 0;
            const pieces = ipsu > 0 ? qty % ipsu : qty;
            
            return {
                customerName: fixEncoding(row.B_C_NAME) || '미상',
                productName: fixEncoding(row.B_P_NAME) || '알 수 없는 상품',
                barcode: fixEncoding(row.P_BARCODE) || '',
                boxes: boxes,
                pieces: pieces,
                totalQty: qty,
                pickingClass: fixEncoding(row.picking_class) || '미분류',
                weight: Number(row.total_weight || 0),
                driverName: fixEncoding(row.driver_name) || '',
                dockNo: fixEncoding(row.dock_no) || ''
            };
        });
        
        const totalWeight = safeResult.reduce((sum, item) => sum + item.weight, 0);

        res.json({ data: safeResult, summary: { totalWeight } });
    } catch (e) { 
        console.error('Loading List Error:', e);
        res.status(500).json({ error: e.message }); 
    } finally {
        if (mysqlConn) await mysqlConn.end();
    }
});

app.get('/api/customers', async (req, res) => {
    let mysqlConn = null;
    try {
        const sourceUrl = process.env.MYSQL_URL || "mysql://user_web:pass_web%40%23@221.143.21.135:3306/db_ndy?charset=utf8mb4";
        mysqlConn = await mysql.createConnection(sourceUrl);
        const query = `
            SELECT DISTINCT CB_DIV_CUST 
            FROM t_balju 
            WHERE B_DATE >= DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL 30 DAY), '%Y-%m-%d') 
            AND CB_DIV_CUST IS NOT NULL AND CB_DIV_CUST <> ''
        `;
        const [rows] = await mysqlConn.execute(query);
        res.json({ data: rows.map(r => fixEncoding(r.CB_DIV_CUST)).filter(c => c) });
    } catch (e) { res.status(500).json({ error: e.message }); }
    finally { if (mysqlConn) await mysqlConn.end(); }
});

app.get(/.*/, (req, res) => {
    res.sendFile(path.resolve(__dirname, '..', 'public', 'index.html'));
});

app.listen(port, () => {
    console.log(`🚚 시스템 가동 중: http://localhost:${port}`);
});
