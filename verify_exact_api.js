const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const iconv = require('iconv-lite');

function fixEncoding(str) {
    if (typeof str !== 'string') return str;
    try {
        return iconv.decode(Buffer.from(str, 'binary'), 'euc-kr');
    } catch (e) { return str; }
}

async function verifyExactApiQuery() {
    try {
        const startDate = '2026-02-06';
        const endDate = '2026-02-06';
        const pickingClass = '콩나물';
        const whereClause = `WHERE b.B_DATE >= '${startDate}' AND b.B_DATE <= '${endDate}'`;

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
            AND CONVERT(CAST(group_name AS BINARY) USING euckr) = CONVERT('${pickingClass}' USING euckr)
            GROUP BY group_name, driver_name
            ORDER BY group_name ASC, total_qty DESC
        `;

        const result = await prisma.$queryRawUnsafe(query);
        console.log("Result length:", result.length);

        const row = result.find(r => fixEncoding(r.driver_name).includes('하(바른)'));
        if (row) {
            console.log(`기사: ${fixEncoding(row.driver_name)}, 피킹건수: ${row.pick_count}`);
        } else {
            console.log("하(바른) 기사를 찾지 못했습니다.");
        }

    } catch (e) {
        console.error(e);
    } finally {
        await prisma.$disconnect();
    }
}

verifyExactApiQuery();
