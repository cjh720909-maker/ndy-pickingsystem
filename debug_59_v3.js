const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const iconv = require('iconv-lite');

function fixEncoding(str) {
    if (typeof str !== 'string') return str;
    try {
        return iconv.decode(Buffer.from(str, 'binary'), 'euc-kr');
    } catch (e) { return str; }
}

async function debug59Details() {
    try {
        const date = '2026-02-06';
        const driver = '하(바른)';

        console.log(`--- Detailed Debugging 59 picks for ${driver} on ${date} ---`);

        const rows = await prisma.$queryRaw`
            SELECT 
                b.B_P_NO, 
                b.B_P_NAME,
                b.B_C_NAME,
                p.P_DIV_PICK,
                c340.CD_GROUP
            FROM t_balju b
            LEFT JOIN t_product p ON b.B_P_NO = p.P_CODE
            LEFT JOIN t_code_340 c340 ON p.P_DIV_PICK = c340.P_DIV_PICK
            WHERE b.B_DATE = ${date}
            AND CONVERT(CAST(b.CB_DRIVER AS BINARY) USING euckr) = ${driver}
        `;

        const kongRows = rows.filter(r => {
            const group = fixEncoding(r.CD_GROUP || r.P_DIV_PICK);
            return group === '콩나물';
        });

        console.log(`P_NO | P_NAME | C_NAME | GROUP`);
        kongRows.forEach(r => {
            console.log(`${r.B_P_NO} | ${fixEncoding(r.B_P_NAME)} | ${fixEncoding(r.B_C_NAME)} | ${fixEncoding(r.CD_GROUP || r.P_DIV_PICK)}`);
        });

    } catch (e) {
        console.error(e);
    } finally {
        await prisma.$disconnect();
    }
}

debug59Details();
