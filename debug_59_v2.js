const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const iconv = require('iconv-lite');

function fixEncoding(str) {
    if (typeof str !== 'string') return str;
    try {
        return iconv.decode(Buffer.from(str, 'binary'), 'euc-kr');
    } catch (e) { return str; }
}

async function debug59() {
    try {
        const date = '2026-02-06';
        const driver = '하(바른)';

        console.log(`--- Debugging 59 picks for ${driver} on ${date} ---`);

        const rows = await prisma.$queryRaw`
            SELECT 
                b.B_P_NO, 
                b.B_P_NAME,
                p.P_DIV_PICK,
                COALESCE(c340.CD_GROUP, p.P_DIV_PICK) as group_name
            FROM t_balju b
            LEFT JOIN t_product p ON b.B_P_NO = p.P_CODE
            LEFT JOIN t_code_340 c340 ON p.P_DIV_PICK = c340.P_DIV_PICK
            WHERE b.B_DATE = ${date}
            AND CONVERT(CAST(b.CB_DRIVER AS BINARY) USING euckr) = ${driver}
        `;

        console.log(`Total rows found for driver: ${rows.length}`);

        const kongRows = rows.filter(r => fixEncoding(r.group_name) === '콩나물');
        console.log(`Rows classified as '콩나물': ${kongRows.length}`);

        // Group by B_P_NO
        const grouped = {};
        kongRows.forEach(r => {
            if (!grouped[r.B_P_NO]) grouped[r.B_P_NO] = [];
            grouped[r.B_P_NO].push(r);
        });

        console.log(`Unique B_P_NOs in '콩나물': ${Object.keys(grouped).length}`);

        // Let's see if there are other things that AREN'T 콩나물 but being counted
        const otherRows = rows.filter(r => fixEncoding(r.group_name) !== '콩나물');
        console.log(`Rows NOT classified as '콩나물': ${otherRows.length}`);

        const otherGroups = [...new Set(otherRows.map(r => fixEncoding(r.group_name)))];
        console.log(`Other groups found: ${otherGroups.join(', ')}`);

        // If the picking analysis screen shows 59, and it's filtered by '콩나물'
        // Let's check the query in index.js again.
    } catch (e) {
        console.error(e);
    } finally {
        await prisma.$disconnect();
    }
}

debug59();
